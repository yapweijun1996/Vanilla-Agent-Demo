/**
 * Represents the core logic of the agent, inspired by the Codex CLI's agentic workflow.
 * It manages the conversation, tools, and the main ReAct (Reason + Act) loop.
 */
class Agent {
    constructor(llmProvider, tools, onThought, onMessage) {
        this.llmProvider = llmProvider;
        this.tools = tools;
        // Build a strict registry for white‑listing tool names.
        this.registry = new Map(
            (tools || [])
                .filter((t) => t && t.function)
                .map((t) => [t.function.name, t.function])
        );
        this.onThought = onThought; // Callback to display agent's thinking
        this.onMessage = onMessage; // Callback to display a message in the chat log
        this.history = [];
        this.maxTurns = 10; // Safety brake to prevent infinite loops
        this.toolTimeoutMs = 10000;
        this.obsTruncateChars = 3000;
    }

    // Run a promise with timeout
    async runWithTimeout(promise, ms) {
        let timer;
        try {
            return await Promise.race([
                promise,
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error(`tool timeout after ${ms}ms`)), ms);
                }),
            ]);
        } finally {
            clearTimeout(timer);
        }
    }

    // Sanitize and truncate observation going back to the model
    sanitizeObservation(value) {
        const limit = this.obsTruncateChars;

        const escAndTrunc = (s) => {
            if (typeof s !== 'string') {
                try { s = String(s ?? ''); } catch { s = ''; }
            }
            // Escape basic HTML to preserve structure instead of stripping tags
            const safe = s
                .replace(/&/g, '&')
                .replace(/</g, '<')
                .replace(/>/g, '>');
            return safe.length > limit ? `${safe.slice(0, limit)}…` : safe;
        };

        if (value == null) return '';
        const t = typeof value;
        if (t === 'string' || t === 'number' || t === 'boolean') {
            return escAndTrunc(String(value));
        }

        // Prefer JSON for objects/arrays; guard circular refs and BigInt
        const seen = new WeakSet();
        try {
            const json = JSON.stringify(
                value,
                (key, val) => {
                    if (typeof val === 'bigint') return Number(val);
                    if (val && typeof val === 'object') {
                        if (seen.has(val)) return '[Circular]';
                        seen.add(val);
                    }
                    return val;
                },
                2
            );
            return escAndTrunc(json);
        } catch {
            try { return escAndTrunc(String(value)); } catch { return ''; }
        }
    }

    /**
     * Starts the agentic loop to process a user's query.
     * @param {string} userInput The initial query from the user.
     */
    async run(userInput) {
        this.history = [{ role: 'user', content: userInput }];
        this.onMessage('user', userInput);

        for (let i = 0; i < this.maxTurns; i++) {
            // Ask model for next step (Planner)
            const step = await this.llmProvider.getCompletion(this.history, this.tools);
            const toolCalls = step.toolCalls || step.tool_calls || [];
            const stopReason = step.stopReason || step.stop_reason || 'continue';
            const content = step.content;

            // A) Tool calls – aggregate into a single assistant message, then emit per-call tool observations
            if (toolCalls && toolCalls.length > 0) {
                this.onThought(`[plan] Model proposed ${toolCalls.length} tool call(s).`);

                // Normalize calls: ids, names, robust args parse
                const normalizedCalls = toolCalls
                    .map((call, idx) => {
                        const name = call.name || call.tool;
                        let args = call.args ?? call.arguments ?? {};
                        if (typeof args === 'string') {
                            // strip possible code fences and attempt double-parse
                            let s = args.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1').trim();
                            try { args = JSON.parse(s); }
                            catch {
                                try { args = JSON.parse(JSON.parse(s)); }
                                catch { args = {}; }
                            }
                        }
                        if (typeof args !== 'object' || args === null) args = {};

                        const id = call.id
                            || (typeof crypto !== 'undefined' && crypto.randomUUID
                                ? crypto.randomUUID()
                                : `call-${i}-${idx}-${Date.now()}-${Math.random().toString(36).slice(2)}`);

                        return { id, name, args };
                    })
                    .filter(c => !!c.name);

                // 1) Record a single assistant message with all tool_calls
                this.history.push({
                    role: 'assistant',
                    content: '', // ensure Gemini has a text part
                    tool_calls: normalizedCalls.map(c => ({
                        id: c.id,
                        function: { name: c.name, arguments: JSON.stringify(c.args) },
                    })),
                });

                // 2) Execute each tool and emit its observation
                for (const c of normalizedCalls) {
                    const fn = this.registry.get(c.name);
                    if (!fn) {
                        const msg = `Unknown tool '${c.name}'. Please choose a listed tool.`;
                        this.onThought(`[act] ${msg}`);
                        this.history.push({
                            role: 'tool',
                            tool_call_id: c.id,
                            content: `OBSERVATION[${c.name}]: ${msg}`,
                        });
                        continue;
                    }

                    this.onThought(`[act] Executing ${c.name} ${JSON.stringify(c.args)}`);
                    let result;
                    try {
                        result = await this.runWithTimeout(fn.implementation(c.args), this.toolTimeoutMs);
                    } catch (e) {
                        result = `Tool '${c.name}' failed: ${e.message}`;
                    }
                    const obsText = this.sanitizeObservation(result);
                    this.onThought(`[observe] ${c.name} => ${obsText.slice(0, 120)}${obsText.length > 120 ? '…' : ''}`);

                    this.history.push({
                        role: 'tool',
                        tool_call_id: c.id,
                        content: `OBSERVATION[${c.name}]: ${obsText}`,
                    });
                }

                // After tools, continue next turn so the model can reflect or finalize.
                continue;
            }

            // B) Natural language content
            if (typeof content === 'string' && content.length > 0) {
                this.onThought(`[reflect] Model produced content. stopReason=${stopReason}`);
                this.onMessage('agent', content);
                this.history.push({ role: 'assistant', content });

                // Only stop when the model explicitly emits a final answer
                const isFinal = (s) => ['final', 'stop', 'completed', 'end', 'done'].includes((s || '').toLowerCase());
                if (isFinal(stopReason)) {
                    return;
                }
                // Otherwise allow another round (e.g., verification/refinement)
                continue;
            }

            // C) No tool and no content – nudge replanning
            this.onThought('[plan] Model produced no content and no tool. Replanning.');
            this.history.push({ role: 'assistant', content: 'No valid next action. Replanning with constraints.' });
        }

        this.onMessage('agent', "I seem to be stuck in a loop. Please try rephrasing your query.");
    }
}