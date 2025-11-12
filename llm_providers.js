function buildSystemPrompt(tools) {
    // Accept either full tool objects ({ function: { name, description, usage } })
    // or sanitized specs ({ name, description, usage })
    const toolDescriptions = (tools || []).map((t) => {
        const name = (t && (t.name || (t.function && t.function.name))) || 'unknown';
        const description = (t && (t.description || (t.function && t.function.description))) || '';
        const usage = (t && (t.usage || (t.function && t.function.usage))) || '';
        return `- ${name}: ${description}\n  Usage: ${usage}`;
    }).join('\n');

    return `You are an agent that works in an iterative loop: Think -> Act (call a tool) -> Observe -> Repeat, until the task is finished.
On every turn, respond with EXACTLY ONE JSON object and nothing else. You must choose one of:

1) Tool call:
{"tool":"<tool_name>","arguments":{...}}

2) Final answer in natural language:
{"final":"<your concise, human‑readable answer>"}

Rules:
- Use ONLY tools listed below. Do not invent tool names or parameters.
- If no tool is appropriate or the user asks a simple question, reply with {"final":"..."}.
- After I send you an "Observation: ..." message, use that observation to decide the next action (another tool or a final answer).
- Do NOT include any text outside the single JSON object.

Available Tools:
${toolDescriptions}
`;
}

function tryParseToolCall(text) {
    // Helper to robustly parse arguments which might be double-encoded or fenced
    const robustParseArgs = (val) => {
        if (val == null) return {};
        if (typeof val === 'object') return val;
        if (typeof val === 'string') {
            let s = val.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1').trim();
            try { return JSON.parse(s); } catch (_) {
                try { return JSON.parse(JSON.parse(s)); } catch (_) { return {}; }
            }
        }
        return {};
    };

    try {
        // Strip code fences if present ```json ... ```
        const cleaned = (text || '').replace(/```(?:json)?\s*([\s\S]*?)\s*```/i, '$1').trim();

        // Prefer strict JSON parse first
        try {
            const obj = JSON.parse(cleaned);

            // Case 1: Final answer
            if (typeof obj.final === 'string') {
                return { toolCalls: null, content: obj.final, stopReason: 'final' };
            }

            // Case 2: Multiple tool calls: {"tool_calls":[{name,args,id?}, ...]}
            if (Array.isArray(obj.tool_calls)) {
                const calls = obj.tool_calls
                    .map((c, idx) => {
                        const name = c?.name || c?.tool || c?.function?.name;
                        if (!name) return null;
                        const argsRaw = c?.arguments ?? c?.args ?? c?.function?.arguments ?? {};
                        const args = robustParseArgs(argsRaw);
                        const id = c?.id || name || `parsed-${Date.now()}-${idx}`;
                        return { id, name, args };
                    })
                    .filter(Boolean);
                if (calls.length > 0) {
                    return { toolCalls: calls, content: null, stopReason: 'continue' };
                }
            }

            // Case 3: Single tool call in object form
            if (obj.tool || obj.name) {
                const toolName = obj.tool || obj.name;
                const toolArgs = robustParseArgs(obj.arguments ?? obj.args ?? {});
                return {
                    toolCalls: [{ id: toolName, name: toolName, args: toolArgs }],
                    content: null,
                    stopReason: 'continue',
                };
            }

            // Case 4: Parsed to a plain string content
            if (typeof obj === 'string' && obj.trim()) {
                return { toolCalls: null, content: obj.trim(), stopReason: 'continue' };
            }
        } catch (_) {
            // JSON.parse failed – fall back to regex heuristics below
        }

        // Heuristic 1: Final-answer JSON embedded in text
        const finalMatch = cleaned.match(/{\s*"final"\s*:\s*"([\s\S]*?)"\s*}/);
        if (finalMatch) {
            return { toolCalls: null, content: finalMatch[1], stopReason: 'final' };
        }

        // Heuristic 2: Single tool call JSON embedded in text
        const toolMatch = cleaned.match(/{\s*["'](tool|name)["']\s*:\s*["']([^"']+)["']\s*,\s*["']arguments["']\s*:\s*({[^}]*}|"[^"]*")\s*}/);
        if (toolMatch) {
            const jsonString = toolMatch[0];
            const parsed = JSON.parse(jsonString);
            const toolName = parsed.tool || parsed.name;
            const toolArgs = robustParseArgs(parsed.arguments);
            if (toolName) {
                return {
                    toolCalls: [{ id: toolName, name: toolName, args: toolArgs }],
                    content: null,
                    stopReason: 'continue',
                };
            }
        }

        // Otherwise treat as plain content (continue)
        if (cleaned) {
            return { toolCalls: null, content: cleaned, stopReason: 'continue' };
        }
    } catch (_) {
        // swallow and fall through
    }

    // If nothing parsed, return raw content so the caller can treat it as normal text.
    return { toolCalls: null, content: text, stopReason: 'continue' };
}


/**
 * A factory to create instances of LLM providers.
 */
class LlmProviderFactory {
    static create(provider, model, apiKey) {
        switch (provider) {
            case 'google':
                return new GeminiProvider(apiKey, model);
            case 'openai':
                return new OpenAiProvider(apiKey, model);
            default:
                throw new Error(`Unknown provider: ${provider}`);
        }
    }
}

/**
 * Base class for LLM providers.
 */
class BaseLlmProvider {
    constructor(apiKey, model) {
        if (!apiKey) {
            throw new Error("API key is required.");
        }
        this.apiKey = apiKey;
        this.model = model;
    }

    async getCompletion(history, tools) {
        throw new Error("getCompletion must be implemented by subclasses.");
    }
}

/**
 * LLM provider for Google Gemini.
 */
class GeminiProvider extends BaseLlmProvider {
    constructor(apiKey, model) {
        super(apiKey, model);
        this.apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
    }

    async getCompletion(history, tools) {
        const systemPrompt = buildSystemPrompt(tools);
        const fullHistory = [{ role: 'user', content: systemPrompt }, ...history];

        const contents = fullHistory.map((h) => {
            // Gemini requires role to be either 'user' or 'model'.
            // Map assistant -> model; all others (including 'tool' and 'user') -> user.
            let safeText = '';
            if (h && typeof h.content === 'string') {
                safeText = h.content;
            } else if (h && h.content != null) {
                try {
                    safeText = String(h.content);
                } catch (_) {
                    safeText = '';
                }
            }
            const role = h && h.role === 'assistant' ? 'model' : 'user';
            return {
                role,
                parts: [{ text: safeText }],
            };
        });

        const body = { contents };

        const requestOnce = async () => {
            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                let message = `HTTP ${response.status}`;
                try {
                    const error = await response.json();
                    message = (error && error.error && error.error.message) || message;
                } catch (_) {
                    // ignore parse error
                }
                throw new Error(`Gemini API error: ${message}`);
            }

            let data;
            try {
                data = await response.json();
            } catch (e) {
                throw new Error(`Gemini JSON parse error: ${e.message}`);
            }

            const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
            return (textResponse || '').trim();
        };

        let lastErr;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const text = await requestOnce();
                return tryParseToolCall(text);
            } catch (e) {
                lastErr = e;
                const delay = 200 * Math.pow(2, attempt); // 200ms, 400ms
                await new Promise((res) => setTimeout(res, delay));
            }
        }

        return {
            toolCalls: null,
            content: `[ProviderError Gemini] ${lastErr?.message || 'unknown error'}`,
            stopReason: 'continue',
        };
    }
}

/**
 * LLM provider for OpenAI.
 */
class OpenAiProvider extends BaseLlmProvider {
    constructor(apiKey, model) {
        super(apiKey, model);
        this.apiUrl = 'https://api.openai.com/v1/completions';
    }

    async getCompletion(history, tools) {
        const systemPrompt = buildSystemPrompt(tools);
        
        // Convert history to a single string prompt
        const historyString = history.map(h => `${h.role}: ${h.content}`).join('\n');
        const fullPrompt = `${systemPrompt}\n\n${historyString}\nassistant:`;

        const body = {
            // The v1/completions endpoint does not support newer models like gpt-5.
            // We fall back to a compatible model to prevent API errors.
            model: 'gpt-3.5-turbo-instruct',
            prompt: fullPrompt,
            max_tokens: 1500,
            temperature: 0.7,
            stop: ["\nuser:", "\ntool:"],
        };

        const requestOnce = async () => {
            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                let message = `HTTP ${response.status}`;
                try {
                    const error = await response.json();
                    message = (error && error.error && error.error.message) || message;
                } catch (_) {
                    // ignore parse error
                }
                throw new Error(`OpenAI API error: ${message}`);
            }

            let data;
            try {
                data = await response.json();
            } catch (e) {
                throw new Error(`OpenAI JSON parse error: ${e.message}`);
            }

            const textResponse = (data.choices && data.choices[0] && data.choices[0].text) ? data.choices[0].text : '';
            return (textResponse || '').trim();
        };

        let lastErr;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const text = await requestOnce();
                return tryParseToolCall(text);
            } catch (e) {
                lastErr = e;
                const delay = 200 * Math.pow(2, attempt); // 200ms, 400ms
                await new Promise((res) => setTimeout(res, delay));
            }
        }

        return {
            toolCalls: null,
            content: `[ProviderError OpenAI] ${lastErr?.message || 'unknown error'}`,
            stopReason: 'continue',
        };
    }
}