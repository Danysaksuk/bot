#!/usr/bin/env node

const readline = require('readline');
const { CloudAIClient, getCloudSystemPrompt } = require('./lib/cloud');
const { TOOL_DEFINITIONS, executeTool } = require('./lib/tools');

// Configuration
const WORKSPACE = process.env.WORKSPACE || process.cwd();

// Initialize Cloud AI client
const cloudAI = new CloudAIClient({
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY,
  },
  freebuff: {
    apiKey: process.env.FREEBUFF_API_KEY,
    baseUrl: process.env.FREEBUFF_BASE_URL,
  },
});

// State
const history = [];
let temperature = 0.7;

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
  const providers = cloudAI.getStatus();
  println(`
${colors.bright}${colors.cyan}
  ╔══════════════════════════════════════════════════════════╗
  ║                   ⚡ Grok Clone CLI                     ║
  ║──────────────────────────────────────────────────────────║
  ║  Cloud AI coding assistant with smart model rotation    ║
  ╚══════════════════════════════════════════════════════════╝
${colors.reset}

${colors.dim}Connected providers:${colors.reset}
${providers.map(p => `  ${colors.green}✓${colors.reset} ${p.name} (${p.models.length} models)`).join('\n')}

${colors.dim}Commands:${colors.reset}
  ${colors.bright}/help${colors.reset}      - Show available commands
  ${colors.bright}/providers${colors.reset} - Show provider status
  ${colors.bright}/temp${colors.reset}      - Set temperature (0-2)
  ${colors.bright}/clear${colors.reset}     - Clear conversation history
  ${colors.bright}/quit${colors.reset}      - Exit the application

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

    case '/providers':
      showProviders();
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
  ${colors.cyan}/providers${colors.reset}   Show provider status and models
  ${colors.cyan}/temp <0-2>${colors.reset}   Set response temperature
  ${colors.cyan}/clear${colors.reset}       Clear conversation history
  ${colors.cyan}/quit${colors.reset}        Exit the application

${colors.bright}Tips:${colors.reset}
  - Ask me to search the web for current information
  - Request code in any programming language
  - Ask me to read, write, or list files
  - I can execute safe terminal commands
  - Models rotate automatically to avoid rate limits

${colors.bright}Tool Usage:${colors.reset}
  I can use tools automatically when needed. Tools include:
  • ${colors.green}web_search${colors.reset} - Search the internet
  • ${colors.green}execute_command${colors.reset} - Run terminal commands
  • ${colors.green}read_file${colors.reset} - Read file contents
  • ${colors.green}write_file${colors.reset} - Write to files
  • ${colors.green}list_directory${colors.reset} - List directory contents
`);
}

// Show providers
function showProviders() {
  const providers = cloudAI.getStatus();
  println(`\n${colors.bright}Provider Status:${colors.reset}\n`);
  
  providers.forEach(p => {
    const statusColor = p.status === 'available' ? colors.green : colors.yellow;
    const statusText = p.status === 'available' ? '● Available' : '○ Cooldown';
    println(`  ${statusColor}${statusText}${colors.reset} ${colors.bright}${p.name}${colors.reset}`);
    println(`    Models: ${colors.dim}${p.models.join(', ')}${colors.reset}`);
    if (p.cooldownUntil) {
      println(`    ${colors.yellow}Cooldown until: ${p.cooldownUntil}${colors.reset}`);
    }
    println();
  });
}

// Process user message
async function processMessage(input) {
  // Add user message to history
  history.push({ role: 'user', content: input });

  // Build messages
  const messages = [
    { role: 'system', content: getCloudSystemPrompt(WORKSPACE) },
    ...history
  ];

  try {
    printInfo('\nThinking...\n');

    let fullResponse = '';
    let toolCalls = [];
    let currentProvider = '';

    // Stream response
    await new Promise((resolve, reject) => {
      cloudAI.chatStream(
        messages,
        { temperature },
        // On data
        (chunk, info) => {
          if (info?.provider && info.provider !== currentProvider) {
            currentProvider = info.provider;
            printInfo(`\n[${info.provider}] `);
          }
          fullResponse += chunk;
          print(chunk);
        },
        // On end
        async (result) => {
          println('\n');

          // Check for tool calls
          const toolCallRegex = /```tool\s*\n([\s\S]*?)\n```/g;
          let match;

          while ((match = toolCallRegex.exec(fullResponse)) !== null) {
            try {
              const toolCall = JSON.parse(match[1]);
              toolCalls.push(toolCall);

              println(`\n${colors.magenta}🔧 Executing tool: ${toolCall.name}${colors.reset}`);
              println(`${colors.dim}   ${JSON.stringify(toolCall.params)}${colors.reset}`);

              // Execute tool
              const toolResult = await executeTool(toolCall.name, toolCall.params);

              // Show result
              println(`\n${colors.green}📋 Result:${colors.reset}`);
              println(`${colors.dim}${JSON.stringify(toolResult, null, 2)}${colors.reset}\n`);

              // Add to history
              history.push({
                role: 'system',
                content: `Tool "${toolCall.name}" result: ${JSON.stringify(toolResult)}`
              });
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
