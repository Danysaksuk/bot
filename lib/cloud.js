const https = require('https');
const http = require('http');

// ============================================================
// CLOUD AI CLIENT
// Supports: OpenRouter (free models), Freebuff, and custom APIs
// Features: Smart rotation, fallback chains, rate limit handling
// ============================================================

class CloudAIClient {
  constructor(config = {}) {
    this.providers = config.providers || [];
    this.currentProviderIndex = 0;
    this.rateLimitCooldowns = new Map(); // provider -> cooldown until timestamp
    this.requestCounts = new Map(); // provider -> { count, resetTime }
    
    // Initialize providers from env or config
    this.initProviders(config);
  }

  initProviders(config) {
    // OpenRouter - free models
    if (config.openrouter?.apiKey || process.env.OPENROUTER_API_KEY) {
      this.providers.push({
        name: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: config.openrouter?.apiKey || process.env.OPENROUTER_API_KEY,
        models: config.openrouter?.models || [
          'z-ai/glm-5.2:free',
          'nvidia/nemotron-3.5-lightning:free',
          'liquid/lfm-2.5-2.6b:free',
          'dots-studio/dots-3-note-preview:free',
          'poolside/laguna-s-2.1:free',
          'thinkingmachines/inkling:free',
          'cohere/north-mini-code:free',
          'stealth/ox-alpha',
        ],
        headers: {
          'Authorization': `Bearer ${config.openrouter?.apiKey || process.env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://grok-clone.local',
          'X-OpenRouter-Title': 'Grok Clone',
        },
        rateLimit: { rpm: 20, rpd: 200 },
        priority: 1,
      });
    }

    // Freebuff (via Freebuff2API proxy)
    if (config.freebuff?.apiKey || process.env.FREEBUFF_API_KEY) {
      this.providers.push({
        name: 'freebuff',
        baseUrl: config.freebuff?.baseUrl || process.env.FREEBUFF_BASE_URL || 'http://localhost:8080',
        apiKey: config.freebuff?.apiKey || process.env.FREEBUFF_API_KEY,
        models: config.freebuff?.models || [
          'gpt-5.6-luna',
          'deepseek-v4-flash',
          'deepseek-v4-pro',
          'mimo-2.5',
        ],
        headers: {
          'Authorization': `Bearer ${config.freebuff?.apiKey || process.env.FREEBUFF_API_KEY}`,
        },
        rateLimit: { rpm: 10, rpd: 100 },
        priority: 2,
      });
    }

    // Google Gemini API (Free tier from Google AI Studio)
    if (config.gemini?.apiKey || process.env.GEMINI_API_KEY) {
      this.providers.push({
        name: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: config.gemini?.apiKey || process.env.GEMINI_API_KEY,
        models: config.gemini?.models || [
          'gemini-2.0-flash',
          'gemini-2.0-flash-lite',
          'gemini-1.5-flash',
        ],
        headers: {},
        rateLimit: { rpm: 15, rpd: 1500 },
        priority: 0, // Highest priority - Google's free tier is generous
        type: 'gemini', // Custom handler needed
      });
    }

    // Custom OpenAI-compatible API
    if (config.custom?.apiKey || process.env.CUSTOM_AI_API_KEY) {
      this.providers.push({
        name: 'custom',
        baseUrl: config.custom?.baseUrl || process.env.CUSTOM_AI_BASE_URL,
        apiKey: config.custom?.apiKey || process.env.CUSTOM_AI_API_KEY,
        models: config.custom?.models || ['default'],
        headers: {
          'Authorization': `Bearer ${config.custom?.apiKey || process.env.CUSTOM_AI_API_KEY}`,
        },
        rateLimit: { rpm: 30, rpd: 500 },
        priority: 3,
      });
    }

    // Sort by priority
    this.providers.sort((a, b) => a.priority - b.priority);

    // If no providers configured, use OpenRouter free router as default
    if (this.providers.length === 0) {
      console.log('[Cloud AI] No API keys configured. Using OpenRouter free tier.');
      this.providers.push({
        name: 'openrouter-free',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'none', // OpenRouter free tier doesn't need a key for some models
        models: ['openrouter/free'],
        headers: {},
        rateLimit: { rpm: 5, rpd: 50 },
        priority: 1,
      });
    }
  }

  // Get next available provider (skipping ones on cooldown)
  getNextProvider() {
    const now = Date.now();
    
    for (let i = 0; i < this.providers.length; i++) {
      const idx = (this.currentProviderIndex + i) % this.providers.length;
      const provider = this.providers[idx];
      const cooldown = this.rateLimitCooldowns.get(provider.name);
      
      if (!cooldown || now > cooldown) {
        this.currentProviderIndex = (idx + 1) % this.providers.length;
        return provider;
      }
    }
    
    // All providers on cooldown, find the one with shortest cooldown
    let earliest = Infinity;
    let bestProvider = this.providers[0];
    
    for (const provider of this.providers) {
      const cooldown = this.rateLimitCooldowns.get(provider.name) || 0;
      if (cooldown < earliest) {
        earliest = cooldown;
        bestProvider = provider;
      }
    }
    
    return bestProvider;
  }

  // Mark provider as rate limited
  markRateLimited(providerName, retryAfterSeconds = 60) {
    const cooldownUntil = Date.now() + (retryAfterSeconds * 1000);
    this.rateLimitCooldowns.set(providerName, cooldownUntil);
    console.log(`[Cloud AI] ${providerName} rate limited. Cooldown until ${new Date(cooldownUntil).toISOString()}`);
  }

  // Get next model from provider (rotate through models)
  getNextModel(provider) {
    if (!provider._modelIndex) provider._modelIndex = 0;
    const model = provider.models[provider._modelIndex % provider.models.length];
    provider._modelIndex++;
    return model;
  }

  // Convert OpenAI messages to Gemini format
  convertToGeminiFormat(messages) {
    const systemInstruction = messages.find(m => m.role === 'system')?.content || '';
    const contents = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));
    
    return {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents
    };
  }

  // Make API request to Gemini
  async requestToGemini(provider, messages, options = {}) {
    const model = options.model || this.getNextModel(provider);
    const geminiFormat = this.convertToGeminiFormat(messages);
    
    const body = JSON.stringify({
      ...geminiFormat,
      generationConfig: {
        temperature: options.temperature || 0.7,
        maxOutputTokens: options.maxTokens || 4096,
      }
    });

    return new Promise((resolve, reject) => {
      const url = new URL(`${provider.baseUrl}/models/${model}:generateContent?key=${provider.apiKey}`);
      const req = https.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 429) {
            this.markRateLimited(provider.name, 60);
            reject(new Error(`Rate limited by ${provider.name}`));
            return;
          }
          
          if (res.statusCode !== 200) {
            reject(new Error(`Gemini API error ${res.statusCode}: ${data.substring(0, 200)}`));
            return;
          }

          try {
            const json = JSON.parse(data);
            const content = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
            resolve({
              provider: provider.name,
              model,
              choices: [{ message: { content } }]
            });
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  // Stream from Gemini
  streamFromGemini(provider, messages, options, onData, onEnd, onError) {
    const model = options.model || this.getNextModel(provider);
    const geminiFormat = this.convertToGeminiFormat(messages);
    
    const body = JSON.stringify({
      ...geminiFormat,
      generationConfig: {
        temperature: options.temperature || 0.7,
        maxOutputTokens: options.maxTokens || 4096,
      }
    });

    const url = new URL(`${provider.baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${provider.apiKey}`);
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      if (res.statusCode === 429) {
        this.markRateLimited(provider.name, 60);
        onError(new Error(`Rate limited by ${provider.name}`));
        return;
      }

      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const json = JSON.parse(line.slice(6));
              const content = json.candidates?.[0]?.content?.parts?.[0]?.text;
              if (content) onData(content, { provider: provider.name, model });
            } catch (e) {}
          }
        }
      });
      res.on('end', () => onEnd({ provider: provider.name, model }));
      res.on('error', onError);
    });
    req.on('error', onError);
    req.write(body);
    req.end();
    return req;
  }

  // Make API request to a provider
  async requestToProvider(provider, messages, options = {}) {
    // Use Gemini-specific handler if needed
    if (provider.type === 'gemini') {
      return this.requestToGemini(provider, messages, options);
    }

    const model = options.model || this.getNextModel(provider);
    const body = JSON.stringify({
      model,
      messages,
      temperature: options.temperature || 0.7,
      max_tokens: options.maxTokens || 4096,
      stream: options.stream || false,
    });

    return new Promise((resolve, reject) => {
      const url = new URL(`${provider.baseUrl}/chat/completions`);
      const isHttps = url.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const req = httpModule.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...provider.headers,
        },
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 429) {
            const retryAfter = parseInt(res.headers['retry-after'] || '60');
            this.markRateLimited(provider.name, retryAfter);
            reject(new Error(`Rate limited by ${provider.name}`));
            return;
          }
          
          if (res.statusCode !== 200) {
            reject(new Error(`API error ${res.statusCode}: ${data.substring(0, 200)}`));
            return;
          }

          try {
            const json = JSON.parse(data);
            resolve({ provider: provider.name, model, ...json });
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  // Streaming request to a provider
  streamToProvider(provider, messages, options, onData, onEnd, onError) {
    // Use Gemini-specific handler if needed
    if (provider.type === 'gemini') {
      return this.streamFromGemini(provider, messages, options, onData, onEnd, onError);
    }

    const model = options.model || this.getNextModel(provider);
    const body = JSON.stringify({
      model,
      messages,
      temperature: options.temperature || 0.7,
      max_tokens: options.maxTokens || 4096,
      stream: true,
    });

    const url = new URL(`${provider.baseUrl}/chat/completions`);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const req = httpModule.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...provider.headers,
      },
    }, (res) => {
      if (res.statusCode === 429) {
        const retryAfter = parseInt(res.headers['retry-after'] || '60');
        this.markRateLimited(provider.name, retryAfter);
        onError(new Error(`Rate limited by ${provider.name}`));
        return;
      }

      let buffer = '';
      
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              onEnd({ provider: provider.name, model });
              return;
            }
            try {
              const json = JSON.parse(data);
              const content = json.choices?.[0]?.delta?.content;
              if (content) {
                onData(content, { provider: provider.name, model });
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      });

      res.on('end', () => {
        if (buffer.startsWith('data: ')) {
          const data = buffer.slice(6);
          if (data !== '[DONE]') {
            try {
              const json = JSON.parse(data);
              const content = json.choices?.[0]?.delta?.content;
              if (content) onData(content, { provider: provider.name, model });
            } catch (e) {}
          }
        }
        onEnd({ provider: provider.name, model });
      });

      res.on('error', onError);
    });

    req.on('error', onError);
    req.write(body);
    req.end();
    
    return req;
  }

  // Main chat method with automatic fallback
  async chat(messages, options = {}) {
    const maxRetries = this.providers.length * 2;
    let lastError;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const provider = this.getNextProvider();
      
      try {
        console.log(`[Cloud AI] Attempt ${attempt + 1}: Using ${provider.name}`);
        const result = await this.requestToProvider(provider, messages, options);
        return result;
      } catch (error) {
        lastError = error;
        console.log(`[Cloud AI] ${provider.name} failed: ${error.message}`);
        
        // If rate limited, try next provider immediately
        if (error.message.includes('Rate limited')) {
          continue;
        }
        
        // For other errors, wait briefly before retrying
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    throw new Error(`All providers failed. Last error: ${lastError?.message}`);
  }

  // Streaming chat with automatic fallback
  chatStream(messages, options, onData, onEnd, onError) {
    const maxRetries = this.providers.length;
    let attempt = 0;

    const tryNext = () => {
      if (attempt >= maxRetries) {
        onError(new Error('All providers failed'));
        return;
      }

      const provider = this.getNextProvider();
      attempt++;
      
      console.log(`[Cloud AI] Stream attempt ${attempt}: Using ${provider.name}`);
      
      this.streamToProvider(
        provider,
        messages,
        options,
        onData,
        (result) => onEnd(result),
        (error) => {
          console.log(`[Cloud AI] ${provider.name} stream failed: ${error.message}`);
          if (error.message.includes('Rate limited')) {
            tryNext();
          } else {
            tryNext();
          }
        }
      );
    };

    tryNext();
  }

  // Get status of all providers
  getStatus() {
    const now = Date.now();
    return this.providers.map(p => {
      const cooldown = this.rateLimitCooldowns.get(p.name);
      return {
        name: p.name,
        models: p.models,
        status: cooldown && now < cooldown ? 'cooldown' : 'available',
        cooldownUntil: cooldown ? new Date(cooldown).toISOString() : null,
      };
    });
  }
}

// ============================================================
// SYSTEM PROMPT
// ============================================================

function getCloudSystemPrompt(workspacePath = process.cwd()) {
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

module.exports = { CloudAIClient, getCloudSystemPrompt };
