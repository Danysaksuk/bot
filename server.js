const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { CloudAIClient, getCloudSystemPrompt } = require('./lib/cloud');
const { TOOL_DEFINITIONS, executeTool } = require('./lib/tools');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Configuration
const PORT = process.env.PORT || 3001;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const WORKSPACE = process.env.WORKSPACE || process.cwd();

// Initialize Cloud AI client with rotation
const cloudAI = new CloudAIClient({
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    models: process.env.GEMINI_MODELS?.split(',') || undefined,
  },
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY,
    models: process.env.OPENROUTER_MODELS?.split(',') || undefined,
  },
  freebuff: {
    apiKey: process.env.FREEBUFF_API_KEY,
    baseUrl: process.env.FREEBUFF_BASE_URL,
    models: process.env.FREEBUFF_MODELS?.split(',') || undefined,
  },
  custom: {
    apiKey: process.env.CUSTOM_AI_API_KEY,
    baseUrl: process.env.CUSTOM_AI_BASE_URL,
    models: process.env.CUSTOM_AI_MODELS?.split(',') || undefined,
  },
});

// Store chat histories per session
const chatHistories = new Map();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint for Render
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    // Boolean-only — never expose secret values
    keys: {
      openrouter: Boolean(process.env.OPENROUTER_API_KEY),
      gemini: Boolean(process.env.GEMINI_API_KEY),
      freebuff: Boolean(process.env.FREEBUFF_API_KEY),
      custom: Boolean(process.env.CUSTOM_AI_API_KEY),
    },
  });
});

// API Routes
app.get('/api/providers', (req, res) => {
  res.json({
    providers: cloudAI.getStatus(),
    keys: {
      openrouter: Boolean(process.env.OPENROUTER_API_KEY),
      gemini: Boolean(process.env.GEMINI_API_KEY),
      freebuff: Boolean(process.env.FREEBUFF_API_KEY),
      custom: Boolean(process.env.CUSTOM_AI_API_KEY),
    },
  });
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
      } else if (message.type === 'providers') {
        ws.send(JSON.stringify({ type: 'providers', providers: cloudAI.getStatus() }));
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
  
  // Ready signal only — empty-state UI lives in the client
  ws.send(JSON.stringify({
    type: 'ready',
    providers: cloudAI.getStatus()
  }));
});

async function handleChatMessage(ws, sessionId, message) {
  const history = chatHistories.get(sessionId) || [];
  
  // Add user message to history
  history.push({ role: 'user', content: message.content });
  
  // Build messages array with system prompt
  const messages = [
    { role: 'system', content: getCloudSystemPrompt(WORKSPACE) },
    ...history
  ];
  
  ws.send(JSON.stringify({ type: 'thinking' }));

  const usableProviders = cloudAI.getStatus().filter((p) => p.status === 'available');
  if (usableProviders.length === 0) {
    ws.send(JSON.stringify({
      type: 'error',
      message: cloudAI.getSetupMessage(),
    }));
    return;
  }

  // Track if we need to process tool calls
  let fullResponse = '';
  let toolCalls = [];
  let lastProvider = '';
  
  try {
    cloudAI.chatStream(
      messages,
      { temperature: message.temperature || 0.7, model: message.model },
      // On data chunk
      (chunk, info) => {
        if (info?.provider) lastProvider = info.provider;
        fullResponse += chunk;
        ws.send(JSON.stringify({ 
          type: 'chunk', 
          content: chunk,
          provider: info?.provider,
          model: info?.model,
        }));
      },
      // On end
      async (result) => {
        if (!fullResponse.trim()) {
          ws.send(JSON.stringify({
            type: 'error',
            message: cloudAI.getSetupMessage(),
          }));
          return;
        }

        // Add assistant response to history
        history.push({ role: 'assistant', content: fullResponse });
        
        // Check for tool calls in the response
        const toolCallRegex = /```tool\s*\n([\s\S]*?)\n```/g;
        let match;
        
        while ((match = toolCallRegex.exec(fullResponse)) !== null) {
          try {
            const toolCall = JSON.parse(match[1]);
            toolCalls.push(toolCall);
            
            // Execute the tool
            const toolResult = await executeTool(toolCall.name, toolCall.params);
            
            // Add tool result to history for context
            history.push({ 
              role: 'system', 
              content: `Tool "${toolCall.name}" result: ${JSON.stringify(toolResult)}` 
            });
          } catch (e) {
            console.error('Tool execution error:', e);
          }
        }
        
        // If tools were called, get a follow-up response
        if (toolCalls.length > 0) {
          ws.send(JSON.stringify({ type: 'tool_executed', tools: toolCalls.map(t => t.name) }));
          
          // Get follow-up response incorporating tool results
          const followUpMessages = [
            { role: 'system', content: getCloudSystemPrompt(WORKSPACE) },
            ...history,
            { role: 'user', content: 'Based on the tool results above, provide a comprehensive response to my original question.' }
          ];
          
          let followUpResponse = '';
          cloudAI.chatStream(
            followUpMessages,
            { temperature: message.temperature || 0.7 },
            (chunk, info) => {
              followUpResponse += chunk;
              ws.send(JSON.stringify({ 
                type: 'chunk', 
                content: chunk,
                provider: info?.provider,
              }));
            },
            (final) => {
              history.push({ role: 'assistant', content: followUpResponse });
              ws.send(JSON.stringify({ 
                type: 'done', 
                provider: lastProvider,
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
            provider: lastProvider,
            toolCalls: []
          }));
        }
      },
      // On error
      (error) => {
        ws.send(JSON.stringify({ 
          type: 'error', 
          message: `Cloud AI error: ${error.message}` 
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
  const providers = cloudAI.getStatus();
  const usableCount = providers.filter((p) => p.status === 'available').length;
  console.log(`
╔══════════════════════════════════════════════════════════╗
║                   🚀 NEXUS Server                       ║
║──────────────────────────────────────────────────────────║
║  Web UI:    http://localhost:${PORT}                      ║
║  Providers: ${providers.map(p => p.name).join(', ').padEnd(40)}║
║  Active:    ${String(usableCount).padEnd(40)}║
║  Workspace: ${WORKSPACE.substring(0, 40).padEnd(40)}║
╚══════════════════════════════════════════════════════════╝
  `);

  if (usableCount === 0) {
    console.log(`
⚠️  No working AI providers configured!
    Chat requests will fail until you set an API key in Railway:

    OPENROUTER_API_KEY=sk-or-v1-...   # Free key: https://openrouter.ai/keys
    GEMINI_API_KEY=...                # Optional: https://aistudio.google.com/apikey
    `);
  }
});

module.exports = { app, server };
