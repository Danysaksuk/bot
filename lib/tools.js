const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

// Tool definitions for the AI
const TOOL_DEFINITIONS = [
  {
    name: 'web_search',
    description: 'Search the web for real-time information. Use this when you need current data, documentation, or recent events.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' }
      },
      required: ['query']
    }
  },
  {
    name: 'execute_command',
    description: 'Execute a terminal command. Use with caution. Only safe commands are allowed (no rm, sudo, etc.).',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The terminal command to execute' }
      },
      required: ['command']
    }
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The file path to read' }
      },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: 'Write content to a file. Creates the file if it does not exist.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The file path to write' },
        content: { type: 'string', description: 'The content to write' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'list_directory',
    description: 'List files and directories in a given path.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The directory path to list' }
      },
      required: ['path']
    }
  }
];

// Dangerous command patterns - these are NOT allowed
const DANGEROUS_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|--recursive\s+--force|--force\s+--recursive)\b/,
  /\bmkfs\b/,
  /\bdd\b.*of=\/dev/,
  />\s*\/dev\/sd/,
  /\b(sudo|su)\b/,
  /\bchmod\s+[0-7]*7[0-7]*\b.*\/etc/,
  /\bkill\s+-9\s+1\b/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\binit\s+0\b/,
  /\bformat\b/,
  /\bkeychain\b/,
  /\bssh\s+.*\|\s*bash\b/,
  /\bcurl\s+.*\|\s*(ba)?sh\b/,
  /\bwget\s+.*\|\s*(ba)?sh\b/,
  /\b(rm|del|rd)\s+.*\*\.\*/,  // rm *.* patterns
];

// Check if command is safe
function isCommandSafe(command) {
  const lowerCmd = command.toLowerCase().trim();
  
  // Check dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(lowerCmd)) {
      return { safe: false, reason: `Dangerous command pattern detected: ${pattern.source}` };
    }
  }
  
  // Additional checks
  const blocked = ['rm -rf /', 'rm -rf /*', ':(){', 'fork bomb', '> /dev/sda'];
  for (const b of blocked) {
    if (lowerCmd.includes(b)) {
      return { safe: false, reason: `Blocked dangerous command: ${b}` };
    }
  }
  
  return { safe: true };
}

// Tool executors
async function executeWebSearch(query) {
  return new Promise((resolve, reject) => {
    // Using DuckDuckGo lite for simple search (no API key needed)
    const searchUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    
    http.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GrokClone/1.0)'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        // Parse results from DuckDuckGo lite
        const results = [];
        const titleRegex = /<a[^>]*class="result-link"[^>]*>([^<]+)<\/a>/gi;
        const snippetRegex = /<td[^>]*class="result-snippet"[^>]*>([^<]+)<\/td>/gi;
        
        let titleMatch, snippetMatch;
        while ((titleMatch = titleRegex.exec(data)) !== null && results.length < 5) {
          snippetMatch = snippetRegex.exec(data);
          results.push({
            title: titleMatch[1].trim(),
            snippet: snippetMatch ? snippetMatch[1].trim() : ''
          });
        }
        
        resolve({
          results: results.length > 0 ? results : [{ title: 'Search completed', snippet: `Searched for: ${query}. Please note that real-time web search requires additional setup (API keys).` }],
          raw: results.length === 0 ? 'Web search returned limited results. For full functionality, consider adding a search API key.' : undefined
        });
      });
    }).on('error', (err) => {
      resolve({ results: [{ title: 'Search unavailable', snippet: `Error: ${err.message}. Web search may require network access or API configuration.` }] });
    });
  });
}

function executeCommand(command) {
  const safetyCheck = isCommandSafe(command);
  if (!safetyCheck.safe) {
    return { error: safetyCheck.reason, stdout: '', stderr: safetyCheck.reason };
  }

  return new Promise((resolve) => {
    exec(command, { 
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      cwd: process.cwd()
    }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        error: error ? error.message : null,
        exitCode: error ? error.code : 0
      });
    });
  });
}

function readFile(filePath) {
  try {
    const resolved = path.resolve(filePath);
    const content = fs.readFileSync(resolved, 'utf-8');
    return { content, path: resolved };
  } catch (error) {
    return { error: error.message };
  }
}

function writeFile(filePath, content) {
  try {
    const resolved = path.resolve(filePath);
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(resolved, content, 'utf-8');
    return { success: true, path: resolved };
  } catch (error) {
    return { error: error.message };
  }
}

function listDirectory(dirPath) {
  try {
    const resolved = path.resolve(dirPath || '.');
    const items = fs.readdirSync(resolved, { withFileTypes: true });
    return {
      path: resolved,
      items: items.map(item => ({
        name: item.name,
        type: item.isDirectory() ? 'directory' : 'file',
        path: path.join(resolved, item.name)
      }))
    };
  } catch (error) {
    return { error: error.message };
  }
}

// Execute a tool by name
async function executeTool(toolName, params) {
  switch (toolName) {
    case 'web_search':
      return await executeWebSearch(params.query);
    case 'execute_command':
      return await executeCommand(params.command);
    case 'read_file':
      return readFile(params.path);
    case 'write_file':
      return writeFile(params.path, params.content);
    case 'list_directory':
      return listDirectory(params.path);
    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

// System prompt that includes tool usage instructions
function getSystemPrompt(workspacePath = process.cwd()) {
  return `You are a powerful AI coding assistant, similar to Grok. You have access to tools that let you interact with the user's development environment.

Available tools:
1. web_search(query) - Search the web for real-time information, documentation, and current events
2. execute_command(command) - Run terminal commands (safe commands only)
3. read_file(path) - Read file contents
4. write_file(path, content) - Write content to files
5. list_directory(path) - List files in a directory

Current workspace: ${workspacePath}

When you need to use a tool, respond with a JSON code block like this:
\`\`\`tool
{
  "name": "tool_name",
  "params": { "param1": "value1" }
}
\`\`\`

After receiving tool results, incorporate them into your response naturally.

Guidelines:
- Be helpful, concise, and accurate
- For code tasks, provide clean, well-commented code
- When debugging, explain the issue and provide fixes
- Use tools when you need current information or need to interact with the filesystem
- Always explain what you're doing and why
- Format code blocks with proper syntax highlighting markers
- For complex tasks, break them down into steps`;
}

module.exports = {
  TOOL_DEFINITIONS,
  executeTool,
  getSystemPrompt,
  isCommandSafe
};
