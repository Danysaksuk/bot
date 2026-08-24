# ⚡ Grok Clone - AI Coding Assistant

A standalone AI coding assistant inspired by Grok, powered by Ollama for local inference with real-time web search, file operations, and terminal access.

## Features

- 💻 **Code Generation & Debugging** - Write, explain, and debug code in any language
- 🔍 **Real-time Web Search** - Access current information and documentation
- 📁 **File Operations** - Read, write, and list files directly
- ⚡ **Terminal Access** - Execute safe terminal commands
- 🎨 **Modern Web UI** - Beautiful dark theme interface
- 💻 **CLI Interface** - Command-line interface for terminal users

## Prerequisites

1. **Node.js** (v18 or higher)
2. **Ollama** - Local AI model runner
   ```bash
   # macOS/Windows: Download from https://ollama.com
   # Linux:
   curl -fsSL https://ollama.com/install.sh | sh
   ```

## Quick Start

### 1. Install Dependencies

```bash
cd grok-clone
npm install
```

### 2. Pull a Model

```bash
# Recommended: Code-focused model
ollama pull qwen2.5-coder:7b

# Or other options:
ollama pull deepseek-r1:7b    # For complex reasoning
ollama pull qwen3:8b          # Lightweight option
```

### 3. Start the Server

```bash
# Web UI mode
npm start

# Or with custom settings:
MODEL=qwen2.5-coder:7b PORT=3001 npm start
```

### 4. Open Web UI

Navigate to http://localhost:3001 in your browser.

### 5. CLI Mode

```bash
npm run cli
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MODEL` | `qwen2.5-coder:7b` | Default Ollama model |
| `PORT` | `3001` | Web UI port |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API URL |
| `WORKSPACE` | `process.cwd()` | Working directory for file operations |

### CLI Commands

In CLI mode, use these commands:

- `/help` - Show available commands
- `/models` - List available models
- `/model <name>` - Switch model
- `/temp <0-2>` - Set temperature
- `/clear` - Clear conversation history
- `/workspace <path>` - Set working directory
- `/quit` - Exit

## Available Tools

The AI has access to these tools:

1. **web_search(query)** - Search the web for information
2. **execute_command(command)** - Run terminal commands (safe commands only)
3. **read_file(path)** - Read file contents
4. **write_file(path, content)** - Write to files
5. **list_directory(path)** - List directory contents

## Safety Features

- Dangerous commands are blocked (rm -rf, sudo, etc.)
- File operations are limited to the workspace
- Tool calls require explicit model decisions
- All tool executions are logged

## Recommended Models

| Model | Size | Best For |
|-------|------|----------|
| `qwen2.5-coder:7b` | 4.7GB | General coding (recommended) |
| `deepseek-r1:7b` | 4.7GB | Complex reasoning |
| `qwen3:8b` | 5.0GB | Lightweight option |
| `qwen2.5-coder:14b` | 8.9GB | Advanced coding (needs more RAM) |

## Architecture

```
grok-clone/
├── server.js          # Express + WebSocket server
├── cli.js            # CLI interface
├── lib/
│   ├── ollama.js     # Ollama API client
│   └── tools.js      # Tool definitions & execution
├── public/
│   ├── index.html    # Web UI
│   ├── styles.css    # Styling
│   └── app.js        # Frontend JavaScript
└── package.json
```

## License

MIT
