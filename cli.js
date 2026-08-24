#!/usr/bin/env node

const readline = require('readline');
const { OllamaClient } = require('./lib/ollama');
const { TOOL_DEFINITIONS, executeTool, getSystemPrompt } = require('./lib/tools');

// Configuration
const DEFAULT_MODEL = process.env.MODEL || 'kimi-k2.5:cloud';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const WORKSPACE = process.env.WORKSPACE || process.cwd();

// Initialize
const ollama = new OllamaClient(OLLAMA_URL);
const history = [];

// Colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m'
};

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: `${colors.cyan}you ${colors.reset}> `
});

// Helper functions
function print(text) {
  process.stdout.write(text);
}

function println(text = '') {
  console.log(text);
}

function printError(text) {
  console.error(`${colors.red}Error: ${text}${colors.reset}`);
}

function printSuccess(text) {
  console.log(`${colors.green}${text}${colors.reset}`);
}

function printInfo(text) {
  console.log(`${colors.dim}${text}${colors.reset}`);
}

// Welcome message
function showWelcome() {
  println(`
${colors.bright}${colors.cyan}
  ╔══════════════════════════════════════════════════════════╗
  ║                   ⚡ Grok Clone CLI                     ║
  ║──────────────────────────────────────────────────────────║
  ║  AI-powered coding assistant with tool access           ║
  ╚══════════════════════════════════════════════════════════╝
${colors.reset}

${colors.dim}Commands:${colors.reset}
  ${colors.bright}/help${colors.reset}     - Show available commands
  ${colors.bright}/models${colors.reset}   - List available models
  ${colors.bright}/model${colors.reset}    - Change model
  ${colors.bright}/temp${colors.reset}     - Set temperature (0-2)
  ${colors.bright}/clear${colors.reset}    - Clear conversation history
  ${colors.bright}/workspace${colors.reset} - Set workspace path
  ${colors.bright}/quit${colors.reset}     - Exit the application

${colors.dim}Tools available:${colors.reset} web_search, execute_command, read_file, write_file, list_directory
`);
}

// Handle commands
async function handleCommand(input) {
  const parts = input.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ');

  switch (cmd) {
    case '/help':
      showHelp();
      return true;

    case '/models':
      await listModels();
      return true;

    case '/model':
      if (args) {
        currentModel = args;
        printSuccess(`Model changed to: ${args}`);
      } else {
        println(`Current model: ${colors.bright}${currentModel}${colors.reset}`);
      }
      return true;

    case '/temp':
      if (args && !isNaN(parseFloat(args))) {
        const temp = parseFloat(args);
        if (temp >= 0 && temp <= 2) {
          temperature = temp;
          printSuccess(`Temperature set to: ${temperature}`);
        } else {
          printError('Temperature must be between 0 and 2');
        }
      } else {
        println(`Current temperature: ${colors.bright}${temperature}${colors.reset}`);
      }
      return true;

    case '/clear':
      history.length = 0;
      printSuccess('Conversation history cleared');
      return true;

    case '/workspace':
      if (args) {
        workspace = args;
        printSuccess(`Workspace set to: ${args}`);
      } else {
        println(`Current workspace: ${colors.bright}${workspace}${colors.reset}`);
      }
      return true;

    case '/quit':
    case '/exit':
      println('\nGoodbye! 👋');
      process.exit(0);

    default:
      printError(`Unknown command: ${cmd}. Type /help for available commands.`);
      return true;
  }
}

// Show help
function showHelp() {
  println(`
${colors.bright}Available Commands:${colors.reset}

  ${colors.cyan}/help${colors.reset}        Show this help message
  ${colors.cyan}/models${colors.reset}      List all available Ollama models
  ${colors.cyan}/model <name>${colors.reset}  Switch to a different model
  ${colors.cyan}/temp <0-2>${colors.reset}   Set response temperature
  ${colors.cyan}/clear${colors.reset}       Clear conversation history
  ${colors.cyan}/workspace <path>${colors.reset} Set working directory
  ${colors.cyan}/quit${colors.reset}        Exit the application

${colors.bright}Tips:${colors.reset}
  - Ask me to search the web for current information
  - Request code in any programming language
  - Ask me to read, write, or list files
  - I can execute safe terminal commands

${colors.bright}Tool Usage:${colors.reset}
  I can use tools automatically when needed. Tools include:
  • ${colors.green}web_search${colors.reset} - Search the internet
  • ${colors.green}execute_command${colors.reset} - Run terminal commands
  • ${colors.green}read_file${colors.reset} - Read file contents
  • ${colors.green}write_file${colors.reset} - Write to files
  • ${colors.green}list_directory${colors.reset} - List directory contents
`);
}

// List available models
async function listModels() {
  try {
    printInfo('Fetching available models...');
    const models = await ollama.listModels();
    
    if (models.length === 0) {
      println('No models found. Run "ollama pull <model>" to download one.');
      return;
    }

    println(`\n${colors.bright}Available Models:${colors.reset}\n`);
    models.forEach(model => {
      const size = model.size ? `(${(model.size / 1e9).toFixed(1)}GB)` : '(cloud)';
      const marker = model.name === currentModel ? `${colors.green} ← current${colors.reset}` : '';
      println(`  ${colors.cyan}${model.name}${colors.reset} ${colors.dim}${size}${colors.reset}${marker}`);
    });
    println();
  } catch (error) {
    printError(`Failed to fetch models: ${error.message}`);
    println('Make sure Ollama is running (ollama serve)');
  }
}

// Process user message
async function processMessage(input) {
  // Add user message to history
  history.push({ role: 'user', content: input });

  // Build messages
  const messages = [
    { role: 'system', content: getSystemPrompt(workspace) },
    ...history
  ];

  try {
    printInfo('\nThinking...\n');

    let fullResponse = '';
    let toolCalls = [];

    // Stream response
    await new Promise((resolve, reject) => {
      ollama.chatStream(
        currentModel,
        messages,
        { temperature },
        // On data
        (chunk) => {
          if (chunk.message && chunk.message.content) {
            fullResponse += chunk.message.content;
            print(chunk.message.content);
          }
        },
        // On end
        async (finalChunk) => {
          println('\n');

          // Check for tool calls
          const toolCallRegex = /```tool\s*\n([\s\S]*?)\n```/g;
          let match;
          let processedResponse = fullResponse;

          while ((match = toolCallRegex.exec(fullResponse)) !== null) {
            try {
              const toolCall = JSON.parse(match[1]);
              toolCalls.push(toolCall);

              println(`\n${colors.magenta}🔧 Executing tool: ${toolCall.name}${colors.reset}`);
              println(`${colors.dim}   ${JSON.stringify(toolCall.params)}${colors.reset}`);

              // Execute tool
              const result = await executeTool(toolCall.name, toolCall.params);

              // Show result
              println(`\n${colors.green}📋 Result:${colors.reset}`);
              println(`${colors.dim}${JSON.stringify(result, null, 2)}${colors.reset}\n`);

              // Add to history
              history.push({
                role: 'system',
                content: `Tool "${toolCall.name}" result: ${JSON.stringify(result)}`
              });

              // Replace tool call
              processedResponse = processedResponse.replace(
                match[0],
                `\n\n<tool-result name="${toolCall.name}">\n${JSON.stringify(result, null, 2)}\n</tool-result>\n`
              );
            } catch (e) {
              printError(`Tool execution failed: ${e.message}`);
            }
          }

          // Add assistant response to history
          history.push({ role: 'assistant', content: fullResponse });

          resolve();
        },
        // On error
        (error) => {
          printError(error.message);
          reject(error);
        }
      );
    });
  } catch (error) {
    printError(error.message);
  }
}

// Main loop
async function main() {
  showWelcome();

  // Check Ollama connection
  try {
    await ollama.listModels();
    printSuccess('✓ Connected to Ollama\n');
  } catch (error) {
    printError('Cannot connect to Ollama. Make sure it\'s running (ollama serve)');
    println(`${colors.dim}Starting anyway, but you may need to connect later.${colors.reset}\n`);
  }

  // Start REPL
  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    // Handle commands
    if (input.startsWith('/')) {
      const handled = await handleCommand(input);
      if (handled) {
        rl.prompt();
        return;
      }
    }

    // Process message
    await processMessage(input);
    rl.prompt();
  });

  rl.on('close', () => {
    println('\nGoodbye! 👋');
    process.exit(0);
  });
}

// Start the CLI
main();
