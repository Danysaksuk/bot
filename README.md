# ⚡ Grok Clone - AI Coding Assistant

A standalone AI coding assistant inspired by Grok, powered by **cloud models** with smart rotation to never hit rate limits. Integrates OpenRouter, Freebuff, and custom providers.

## Features

- ☁️ **Cloud Models** - GLM 5.2, DeepSeek, Mistral, Qwen, NVIDIA, GPT & more
- 🔄 **Smart Rotation** - Auto-fallback between providers to avoid rate limits
- 💻 **Code Generation & Debugging** - Write, explain, and debug code
- 🔍 **Real-time Web Search** - Access current information
- 📁 **File Operations** - Read, write, and list files
- ⚡ **Terminal Access** - Execute safe terminal commands
- 🎨 **Modern Web UI** - Beautiful dark theme interface
- 💻 **CLI Interface** - Command-line interface for terminal users

## Quick Start

### 1. Install Dependencies

```bash
cd grok-clone
npm install
```

### 2. Get API Keys (Optional but Recommended)

**OpenRouter (Recommended - Free tier available):**
1. Go to [openrouter.ai](https://openrouter.ai)
2. Sign up and get your API key
3. Free models available with `:free` suffix

**Freebuff (Optional):**
1. Use [Freebuff2API](https://github.com/Quorinex/Freebuff2API) proxy
2. Set the proxy URL and your Freebuff token

### 3. Configure Environment

```bash
# Create .env file
cat > .env << 'EOF'
# OpenRouter (recommended)
OPENROUTER_API_KEY=sk-or-v1-your-key-here

# Freebuff (optional, requires proxy)
FREEBUFF_API_KEY=your-freebuff-token
FREEBUFF_BASE_URL=http://localhost:8080

# Custom OpenAI-compatible API (optional)
CUSTOM_AI_API_KEY=your-key
CUSTOM_AI_BASE_URL=https://your-api.com/v1
EOF
```

### 4. Start the Server

```bash
# Web UI mode
npm start

# CLI mode
npm run cli
```

### 5. Open Web UI

Navigate to http://localhost:3001 in your browser.

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENROUTER_API_KEY` | Recommended | OpenRouter API key |
| `FREEBUFF_API_KEY` | Optional | Freebuff token |
| `FREEBUFF_BASE_URL` | Optional | Freebuff2API proxy URL |
| `CUSTOM_AI_API_KEY` | Optional | Custom API key |
| `CUSTOM_AI_BASE_URL` | Optional | Custom API endpoint |
| `PORT` | No | Server port (default: 3001) |
| `WORKSPACE` | No | Working directory |

### CLI Commands

In CLI mode, use these commands:

- `/help` - Show available commands
- `/providers` - Show provider status
- `/temp <0-2>` - Set temperature
- `/clear` - Clear conversation history
- `/quit` - Exit

## Supported Providers

### OpenRouter Free Models
- `openrouter/free` - Auto-routes to best free model
- `deepseek/deepseek-chat-v3-0324:free`
- `qwen/qwen3-235b-a22b:free`
- `meta-llama/llama-4-maverick:free`
- `google/gemma-3-27b-it:free`
- `mistralai/mistral-small-3.2-24b-instruct:free`
- `nvidia/llama-3.1-nemotron-ultra-253b-v1:free`

### Freebuff Models
- `gpt-5.6-luna`
- `deepseek-v4-flash`
- `deepseek-v4-pro`
- `mimo-2.5`

### Custom Providers
Any OpenAI-compatible API works.

## Smart Rotation

The system automatically rotates between providers to avoid rate limits:

1. **Priority-based routing** - Primary provider tried first
2. **Automatic fallback** - Switches on 429 or 5xx errors
3. **Cooldown tracking** - Skips rate-limited providers
4. **Model rotation** - Cycles through available models

## Architecture

```
grok-clone/
├── server.js          # Express + WebSocket server
├── cli.js            # CLI interface
├── lib/
│   ├── cloud.js      # Cloud AI client with rotation
│   ├── ollama.js     # Ollama client (optional local)
│   └── tools.js      # Tool definitions & execution
├── public/
│   ├── index.html    # Web UI
│   ├── styles.css    # Styling
│   └── app.js        # Frontend JavaScript
├── .env              # Environment config
└── README.md
```

## License

MIT
