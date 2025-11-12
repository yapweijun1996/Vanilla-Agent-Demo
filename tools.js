/**
 * A virtual file system to simulate file operations for the agent's tools.
 */
const virtualFileSystem = new Map();

/**
 * Defines the set of tools available to the agent.
 * Each tool has a schema (for the LLM) and an implementation.
 */
const tools = [
    {
        type: 'function',
        function: {
            name: 'search_web',
            description: 'Searches the web for information on a given topic.',
            usage: '{"tool": "search_web", "arguments": {"query": "your search query"}}',
            /**
             * Simulates a web search. In a real application, this would call a search API.
             * @param {{query: string}} args - The arguments for the tool.
             * @returns {Promise<string>} A simulated search result.
             */
            implementation: async ({ query }) => {
                console.log(`Searching web for: ${query}`);
                // Simulate API call delay
                await new Promise(resolve => setTimeout(resolve, 500));
                
                if (query.toLowerCase().includes('react')) {
                    return "React is a popular JavaScript library for building user interfaces, maintained by Meta. It allows developers to create large web applications that can change data, without reloading the page.";
                }
                if (query.toLowerCase().includes('agentic workflow')) {
                    return "An agentic workflow involves a loop of reasoning, acting, and observing. The agent reasons about a problem, chooses a tool (action), and observes the result to inform its next step. This is inspired by frameworks like ReAct (Reason+Act).";
                }
                return `No specific information found for "${query}". General knowledge suggests it's a complex topic.`;
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'create_file',
            description: 'Creates a new file with specified content in the virtual file system.',
            usage: '{"tool": "create_file", "arguments": {"filename": "your_file.txt", "content": "content of the file"}}',
            /**
             * Creates a file in the virtual file system.
             * @param {{filename: string, content: string}} args - The arguments for the tool.
             * @returns {Promise<string>} A confirmation message.
             */
            implementation: async ({ filename, content }) => {
                console.log(`Creating file: ${filename}`);
                virtualFileSystem.set(filename, content);
                return `File "${filename}" created successfully.`;
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'list_files',
            description: 'Lists all files currently in the virtual file system.',
            usage: '{"tool": "list_files", "arguments": {}}',
            /**
             * Lists files in the virtual file system.
             * @returns {Promise<string>} A list of filenames.
             */
            implementation: async () => {
                console.log('Listing files');
                if (virtualFileSystem.size === 0) {
                    return "The virtual file system is empty.";
                }
                return `Files in virtual system: [${Array.from(virtualFileSystem.keys()).join(', ')}]`;
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_current_time',
            description: 'Gets the current date and time. Can also accept a relative date like "yesterday".',
            usage: '{"tool": "get_current_time", "arguments": {"date": "today"}} or {"tool": "get_current_time", "arguments": {"date": "yesterday"}}',
            /**
             * Gets the current or yesterday's date and time.
             * @param {{date?: string}} args - The arguments for the tool.
             * @returns {Promise<string>} The requested date and time as a string.
             */
            implementation: async (args) => {
                const dateArg = args.date ? args.date.toLowerCase() : 'today';
                console.log(`Getting time for: ${dateArg}`);
                
                let date = new Date();
                if (dateArg === 'yesterday') {
                    date.setDate(date.getDate() - 1);
                }
                
                return date.toLocaleString();
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'list_tools',
            description: 'Lists the available tools and how to call them.',
            usage: '{"tool": "list_tools", "arguments": {}}',
            implementation: async () => {
                const lines = ['Available tools:'];
                for (const t of tools) {
                    lines.push(`- ${t.function.name}: ${t.function.description} | usage: ${t.function.usage}`);
                }
                return lines.join('\\n');
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'calculator',
            description: 'Evaluates a simple arithmetic expression using + - * / % and parentheses.',
            usage: '{"tool":"calculator","arguments":{"expression":"1 + 2 * 3"}}',
            implementation: async ({ expression }) => {
                // Allow digits, whitespace (space or tab), and basic operators + - * / % and parentheses.
                // Note: hyphen must be escaped, and we avoid double-escaping to prevent invalid ranges.
                const allowed = /^[0-9+\-*/().% \t]+$/;
                if (typeof expression !== 'string' || !allowed.test(expression)) {
                    return 'Calculator error: only digits, spaces, and operators + - * / % ( ) are allowed.';
                }
                try {
                    const result = Function('"use strict"; return (' + expression + ');')();
                    return `Result: ${result}`;
                } catch (e) {
                    return `Calculator error: ${e.message}`;
                }
            },
        },
    }
];