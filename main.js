document.addEventListener('DOMContentLoaded', () => {
    const chatLog = document.getElementById('chat-log');
    const userInput = document.getElementById('user-input');
    const submitBtn = document.getElementById('submit-btn');
    const llmProviderSelect = document.getElementById('llm-provider');
    const llmModelSelect = document.getElementById('llm-model');
    const apiKeyInput = document.getElementById('api-key');
    const agentThought = document.getElementById('agent-thought');

    let agent;

    const models = {
        google: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-1.5-flash-latest', 'gemini-1.5-pro-latest'],
        openai: ['gpt-5', 'gpt-5-mini'],
    };

    function updateModels() {
        const selectedProvider = llmProviderSelect.value;
        const providerModels = models[selectedProvider] || [];
        llmModelSelect.innerHTML = '';
        providerModels.forEach(model => {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            llmModelSelect.appendChild(option);
        });

        const savedModel = localStorage.getItem('codex-agent-model');
        if (savedModel && providerModels.includes(savedModel)) {
            llmModelSelect.value = savedModel;
        }
    }

    // Load settings from localStorage on startup
    function loadSettings() {
        const savedProvider = localStorage.getItem('codex-agent-provider');
        if (savedProvider) {
            llmProviderSelect.value = savedProvider;
        }
        updateModels(); // This will also set the model from localStorage if available

        const savedApiKey = localStorage.getItem('codex-agent-api-key');
        if (savedApiKey) {
            apiKeyInput.value = savedApiKey;
        }
    }

    // Save settings to localStorage
    function saveSettings(provider, model, apiKey) {
        localStorage.setItem('codex-agent-provider', provider);
        localStorage.setItem('codex-agent-model', model);
        localStorage.setItem('codex-agent-api-key', apiKey);
    }

    /**
     * Appends a message to the chat log.
     * @param {string} sender - 'user' or 'agent'.
     * @param {string} text - The message content.
     */
    function appendMessage(sender, text) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', `${sender}-message`);
        messageDiv.textContent = text;
        chatLog.appendChild(messageDiv);
        chatLog.scrollTop = chatLog.scrollHeight; // Auto-scroll to bottom
    }

    /**
     * Updates the agent's thought process display.
     * @param {string} thought - The thought text to display.
     */
    function updateThought(thought) {
        agentThought.textContent = thought;
    }

    /**
     * Initializes the agent and starts processing the user's query.
     */
    async function handleUserQuery() {
        const query = userInput.value.trim();
        if (!query) return;

        const provider = llmProviderSelect.value;
        const model = llmModelSelect.value;
        const apiKey = apiKeyInput.value;

        if (!apiKey) {
            appendMessage('agent', 'Error: Please enter your API key.');
            return;
        }
        saveSettings(provider, model, apiKey); // Save settings when they are used

        userInput.value = '';
        updateThought('Initializing agent...');

        try {
            const llmProvider = LlmProviderFactory.create(provider, model, apiKey);
            agent = new Agent(llmProvider, tools, updateThought, appendMessage);
            await agent.run(query);
        } catch (error) {
            console.error(error);
            appendMessage('agent', `An error occurred: ${error.message}`);
        }
    }

    submitBtn.addEventListener('click', handleUserQuery);
    userInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            handleUserQuery();
        }
    });

    llmProviderSelect.addEventListener('change', updateModels);

    loadSettings(); // Load settings when the page loads
    appendMessage('agent', "Hello! I'm a web-based agent inspired by Codex CLI. How can I help you with a complex task today?");
});