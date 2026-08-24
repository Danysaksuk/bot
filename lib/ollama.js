const http = require('http');

class OllamaClient {
  constructor(baseUrl = 'http://localhost:11434') {
    this.baseUrl = baseUrl;
  }

  async listModels() {
    return new Promise((resolve, reject) => {
      http.get(`${this.baseUrl}/api/tags`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json.models || []);
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });
  }

  async generate(model, prompt, options = {}) {
    const body = JSON.stringify({
      model,
      prompt,
      stream: false,
      options: {
        temperature: options.temperature || 0.7,
        top_p: options.top_p || 0.9,
        num_predict: options.maxTokens || 4096,
        ...options
      }
    });

    return new Promise((resolve, reject) => {
      const req = http.request(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json);
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

  async chat(model, messages, options = {}) {
    const body = JSON.stringify({
      model,
      messages,
      stream: false,
      options: {
        temperature: options.temperature || 0.7,
        top_p: options.top_p || 0.9,
        num_predict: options.maxTokens || 4096,
        ...options
      }
    });

    return new Promise((resolve, reject) => {
      const req = http.request(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json);
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

  chatStream(model, messages, options = {}, onData, onEnd, onError) {
    const body = JSON.stringify({
      model,
      messages,
      stream: true,
      options: {
        temperature: options.temperature || 0.7,
        top_p: options.top_p || 0.9,
        num_predict: options.maxTokens || 4096,
        ...options
      }
    });

    const req = http.request(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let buffer = '';
      
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();
        
        for (const line of lines) {
          if (line.trim()) {
            try {
              const json = JSON.parse(line);
              onData(json);
              if (json.done) {
                onEnd(json);
              }
            } catch (e) {
              // Skip invalid JSON lines
            }
          }
        }
      });
      
      res.on('end', () => {
        if (buffer.trim()) {
          try {
            const json = JSON.parse(buffer);
            onData(json);
            if (json.done) onEnd(json);
          } catch (e) {}
        }
      });
      
      res.on('error', onError);
    });

    req.on('error', onError);
    req.write(body);
    req.end();
    
    return req;
  }
}

module.exports = { OllamaClient };
