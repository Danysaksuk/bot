const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { OllamaClient } = require('./lib/ollama');
const { TOOL_DEFINITIONS, executeTool, getSystemPrompt } = require('./lib/tools');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Configuration
const PORT = process.env.PORT || 3001;
const DEFAULT_MODEL = process.env.MODEL || 'kimi-k2.5:cloud';
const WORKSPACE = process.env.WORKSPACE || process.cwd();

// Initialize Ollama client
const ollama = new OllamaClient(process.env.OLLAMA_URL || 'http://localhost:11434');

// Store chat histories per session
const chatHistories = new Map();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.get('/api/models', async (req, res) => {
  try {
    const models = await ollama.listModels();
    res.json({ models, default: DEFAULT_MODEL });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch models. Is Ollama running?' });
  }
});

app.get('/api/tools', (req, res) => {
  res.json({ tools: TOOL_DEFINITIONS });
});

// WebSocket connection handler
wss.on('connection', (ws) => {
  const sessionId = Date.now().toString(36) + Math.random().toString(36).substr(2);
  chatHistories.set(sessionId, []);
  
  console.log(`[Grok Clone] New session: ${sessionId}`);
  
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);
      
      if (message.type === 'chat') {
        await handleChatMessage(ws, sessionId, message);
      } else if (message.type === 'clear') {
        chatHistories.set(sessionId, []);
        ws.send(JSON.stringify({ type: 'cleared' }));
      } else if (message.type === 'models') {
        const models = await ollama.listModels();
        ws.send(JSON.stringify({ type: 'models', models }));
      }
    } catch (error) {
      ws.send(JSON.stringify({ 
        type: 'error', 
        message: error.message 
      }));
    }
  });
  
  ws.on('close', () => {
    chatHistories.delete(sessionId);
    console.log(`[Grok Clone] Session ended: ${sessionId}`);
  });
  
  // Send welcome message
  ws.send(JSON.stringify({
    type: 'system',
    message: `Welcome to Grok Clone! I'm your AI coding assistant powered by ${DEFAULT_MODEL}.\n\nI can help you with:\n- 💻 Code generation, debugging, and explanation\n- 🔍 Web search for documentation and current info\n- 📁 File operations (read, write, list)\n- ⚡ Terminal command execution\n\nJust ask me anything!`
  }));
});

async function handleChatMessage(ws, sessionId, message) {
  const history = chatHistories.get(sessionId) || [];
  const model = message.model || DEFAULT_MODEL;
  
  // Add user message to history
  history.push({ role: 'user', content: message.content });
  
  // Build messages array with system prompt
  const messages = [
    { role: 'system', content: getSystemPrompt(WORKSPACE) },
    ...history
  ];
  
  ws.send(JSON.stringify({ type: 'thinking' }));
  
  // Track if we need to process tool calls
  let fullResponse = '';
  let toolCalls = [];
  
  try {
    await ollama.chatStream(
      model,
      messages,
      { temperature: message.temperature || 0.7 },
      // On data chunk
      (chunk) => {
        if (chunk.message && chunk.message.content) {
          fullResponse += chunk.message.content;
          ws.send(JSON.stringify({ 
            type: 'chunk', 
            content: chunk.message.content 
          }));
        }
      },
      // On end
      async (finalChunk) => {
        // Add assistant response to history
        history.push({ role: 'assistant', content: fullResponse });
        
        // Check for tool calls in the response
        const toolCallRegex = /```tool\s*\n([\s\S]*?)\n```/g;
        let match;
        let processedResponse = fullResponse;
        
        while ((match = toolCallRegex.exec(fullResponse)) !== null) {
          try {
            const toolCall = JSON.parse(match[1]);
            toolCalls.push(toolCall);
            
            // Execute the tool
            const result = await executeTool(toolCall.name, toolCall.params);
            
            // Add tool result to history for context
            history.push({ 
              role: 'system', 
              content: `Tool "${toolCall.name}" result: ${JSON.stringify(result)}` 
            });
            
            // Replace tool call with result in response
            processedResponse = processedResponse.replace(
              match[0],
              `\n\n<tool-result name="${toolCall.name}">\n${JSON.stringify(result, null, 2)}\n</tool-result>\n`
            );
          } catch (e) {
            console.error('Tool execution error:', e);
          }
        }
        
        // If tools were called, get a follow-up response
        if (toolCalls.length > 0) {
          ws.send(JSON.stringify({ type: 'tool_executed', tools: toolCalls.map(t => t.name) }));
          
          // Get follow-up response incorporating tool results
          const followUpMessages = [
            { role: 'system', content: getSystemPrompt(WORKSPACE) },
            ...history,
            { role: 'user', content: 'Based on the tool results above, provide a comprehensive response to my original question.' }
          ];
          
          let followUpResponse = '';
          await ollama.chatStream(
            model,
            followUpMessages,
            { temperature: message.temperature || 0.7 },
            (chunk) => {
              if (chunk.message && chunk.message.content) {
                followUpResponse += chunk.message.content;
                ws.send(JSON.stringify({ 
                  type: 'chunk', 
                  content: chunk.message.content 
                }));
              }
            },
            (final) => {
              history.push({ role: 'assistant', content: followUpResponse });
              ws.send(JSON.stringify({ 
                type: 'done', 
                model,
                toolCalls: toolCalls.map(t => t.name)
              }));
            },
            (error) => {
              ws.send(JSON.stringify({ type: 'error', message: error.message }));
            }
          );
        } else {
          ws.send(JSON.stringify({ 
            type: 'done', 
            model,
            toolCalls: []
          }));
        }
      },
      // On error
      (error) => {
        ws.send(JSON.stringify({ 
          type: 'error', 
          message: `Ollama error: ${error.message}` 
        }));
      }
    );
  } catch (error) {
    ws.send(JSON.stringify({ 
      type: 'error', 
      message: error.message 
    }));
  }
}

// Start server
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║                   🚀 Grok Clone Server                  ║
║──────────────────────────────────────────────────────────║
║  Web UI:    http://localhost:${PORT}                      ║
║  Model:     ${DEFAULT_MODEL.padEnd(40)}║
║  Workspace: ${WORKSPACE.substring(0, 40).padEnd(40)}║
╚══════════════════════════════════════════════════════════╝
  `);
});

module.exports = { app, server };
