# Codex CLI Agent Demo (Vanilla JS)

This project is a web-based agent demo built as a single `index.html` application using Vanilla JavaScript and CSS. It is inspired by the agentic logic and architecture observed in the Codex CLI codebase. The demo showcases how an AI agent can handle complex user queries by breaking them down into smaller steps and using a predefined set of tools.

## Features

-   **Agentic Workflow**: Implements a ReAct (Reason + Act) loop where the agent thinks, chooses an action (calls a tool or responds), and observes the result.
-   **Tool Usage**: The agent can use a set of predefined tools (`search_web`, `create_file`, `list_files`) to solve problems.
-   **Multi-Provider Support**: Supports both Google Gemini and OpenAI as the backing LLM.
-   **Transparent Thinking**: The agent's thought process is displayed in the UI, providing insight into its decision-making.
-   **Pure Frontend**: Runs entirely in the browser using HTML, CSS, and JavaScript. No server or build step is needed.
-   **State Persistence**: Remembers your API key and selected provider via `localStorage`.

## Project Structure

The entire application is self-contained and consists of the following files:

-   `index.html`: The main HTML file containing the UI structure.
-   `style.css`: The stylesheet for the application.
-   `agent.js`: Contains the core `Agent` class, which manages the main ReAct loop and state.
-   `tools.js`: Defines the available tools, their schemas, and their JavaScript implementations.
-   `llm_providers.js`: Implements the logic for communicating with the Gemini and OpenAI APIs.
-   `main.js`: The entry point of the application, responsible for handling user interactions and wiring all the components together.

## How to Run

1.  **Download Files**: Make sure you have all the files (`index.html`, `style.css`, `agent.js`, `tools.js`, `llm_providers.js`, `main.js`) in the same directory.
2.  **Open `index.html`**: Open the `index.html` file in a modern web browser (like Chrome, Firefox, or Edge).
3.  **Enter API Key**: Select your desired LLM provider from the dropdown/input and enter your corresponding API key. Your settings will be saved in your browser's local storage.
    -   **Security Note**: Your API key is used directly from the browser. This approach is for demo purposes only and is not secure for production use.
4.  **Start Querying**: Type a complex query into the input box and click "Send".

## Example Queries

-   "What is an agentic workflow and can you create a file named 'summary.txt' explaining it?"
-   "Search the web for information about React, then create a file named 'react_intro.txt' with the summary. Finally, list all the files you have created."
