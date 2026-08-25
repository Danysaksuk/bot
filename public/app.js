// Grok Clone - Frontend Application
class GrokClone {
  constructor() {
    this.ws = null;
    this.temperature = 0.7;
    this.isProcessing = false;
    this.currentMessage = null;
    this.providers = [];
    
    this.init();
  }
  
  init() {
    this.setupElements();
    this.setupEventListeners();
    this.connectWebSocket();
  }
  
  setupElements() {
    this.chatContainer = document.getElementById('chatContainer');
    this.messagesContainer = document.getElementById('messages');
    this.messageInput = document.getElementById('messageInput');
    this.sendBtn = document.getElementById('sendBtn');
    this.temperatureSlider = document.getElementById('temperature');
    this.tempValue = document.getElementById('tempValue');
    this.charCount = document.getElementById('charCount');
    this.modelBadge = document.getElementById('modelBadge');
    this.welcomeScreen = document.getElementById('welcomeScreen');
    this.statusIndicator = document.getElementById('statusIndicator');
    this.loadingOverlay = document.getElementById('loadingOverlay');
    this.newChatBtn = document.getElementById('newChatBtn');
    this.clearChat = document.getElementById('clearChat');
    this.menuToggle = document.getElementById('menuToggle');
    this.sidebar = document.querySelector('.sidebar');
    this.providerList = document.getElementById('providerList');
  }
  
  setupEventListeners() {
    // Message input
    this.messageInput.addEventListener('input', () => {
      this.autoResize();
      this.updateCharCount();
      this.sendBtn.disabled = !this.messageInput.value.trim();
    });
    
    this.messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });
    
    // Send button
    this.sendBtn.addEventListener('click', () => this.sendMessage());
    
    // Temperature slider
    this.temperatureSlider.addEventListener('input', (e) => {
      this.temperature = parseFloat(e.target.value);
      this.tempValue.textContent = this.temperature.toFixed(1);
    });
    
    // New chat button
    this.newChatBtn.addEventListener('click', () => this.clearConversation());
    
    // Clear chat
    this.clearChat.addEventListener('click', () => this.clearConversation());
    
    // Menu toggle (mobile)
    this.menuToggle.addEventListener('click', () => {
      this.sidebar.classList.toggle('open');
    });
    
    // Example prompts
    document.querySelectorAll('.example-prompt').forEach(btn => {
      btn.addEventListener('click', () => {
        this.messageInput.value = btn.dataset.prompt;
        this.sendMessage();
      });
    });
    
    // Close sidebar on mobile when clicking outside
    document.addEventListener('click', (e) => {
      if (window.innerWidth <= 768 && 
          this.sidebar.classList.contains('open') && 
          !this.sidebar.contains(e.target) && 
          !this.menuToggle.contains(e.target)) {
        this.sidebar.classList.remove('open');
      }
    });
  }
  
  connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    this.ws = new WebSocket(wsUrl);
    
    this.ws.onopen = () => {
      console.log('Connected to server');
      this.updateStatus('connected');
      // Request provider status
      this.ws.send(JSON.stringify({ type: 'providers' }));
    };
    
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleMessage(data);
    };
    
    this.ws.onclose = () => {
      console.log('Disconnected from server');
      this.updateStatus('disconnected');
      // Reconnect after 3 seconds
      setTimeout(() => this.connectWebSocket(), 3000);
    };
    
    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.updateStatus('error');
    };
  }
  
  updateStatus(status) {
    const dot = this.statusIndicator.querySelector('.status-dot');
    const text = this.statusIndicator.querySelector('.status-text');
    
    switch (status) {
      case 'connected':
        dot.style.background = 'var(--success)';
        text.textContent = 'Connected';
        break;
      case 'disconnected':
        dot.style.background = 'var(--warning)';
        text.textContent = 'Reconnecting...';
        break;
      case 'error':
        dot.style.background = 'var(--error)';
        text.textContent = 'Error';
        break;
    }
  }
  
  updateProviderList(providers) {
    this.providers = providers;
    this.providerList.innerHTML = '';
    
    if (providers.length === 0) {
      this.providerList.innerHTML = '<div class="provider-item empty">No providers configured</div>';
      return;
    }
    
    providers.forEach(provider => {
      const item = document.createElement('div');
      item.className = `provider-item ${provider.status}`;
      
      const statusIcon = provider.status === 'available' ? '🟢' : '🟡';
      const models = provider.models.slice(0, 3).join(', ');
      const moreModels = provider.models.length > 3 ? ` +${provider.models.length - 3} more` : '';
      
      item.innerHTML = `
        <div class="provider-header">
          <span class="provider-status">${statusIcon}</span>
          <span class="provider-name">${provider.name}</span>
        </div>
        <div class="provider-models">${models}${moreModels}</div>
      `;
      
      this.providerList.appendChild(item);
    });
    
    // Update model badge
    const availableCount = providers.filter(p => p.status === 'available').length;
    this.modelBadge.textContent = `${availableCount} provider${availableCount !== 1 ? 's' : ''} active`;
  }
  
  autoResize() {
    this.messageInput.style.height = 'auto';
    this.messageInput.style.height = Math.min(this.messageInput.scrollHeight, 150) + 'px';
  }
  
  updateCharCount() {
    this.charCount.textContent = this.messageInput.value.length;
  }
  
  async sendMessage() {
    const content = this.messageInput.value.trim();
    if (!content || this.isProcessing) return;
    
    this.isProcessing = true;
    this.sendBtn.disabled = true;
    
    // Hide welcome screen
    this.welcomeScreen.style.display = 'none';
    
    // Add user message
    this.addMessage('user', content);
    
    // Clear input
    this.messageInput.value = '';
    this.autoResize();
    this.updateCharCount();
    
    // Show thinking indicator
    this.showThinking();
    
    // Send to server
    this.ws.send(JSON.stringify({
      type: 'chat',
      content,
      temperature: this.temperature
    }));
  }
  
  handleMessage(data) {
    switch (data.type) {
      case 'system':
        this.addMessage('system', data.message);
        break;
        
      case 'thinking':
        // Already showing thinking indicator
        break;
        
      case 'chunk':
        this.hideThinking();
        if (data.provider) {
          this.updateModelBadge(data.provider, data.model);
        }
        this.appendToCurrentMessage(data.content);
        break;
        
      case 'tool_executed':
        this.showToolExecution(data.tools);
        break;
        
      case 'done':
        this.finalizeMessage(data.provider, data.toolCalls);
        this.isProcessing = false;
        this.sendBtn.disabled = false;
        break;
        
      case 'error':
        this.hideThinking();
        this.addMessage('error', data.message);
        this.isProcessing = false;
        this.sendBtn.disabled = false;
        break;
        
      case 'cleared':
        this.messagesContainer.innerHTML = '';
        this.welcomeScreen.style.display = 'block';
        break;
        
      case 'providers':
        this.updateProviderList(data.providers);
        break;
    }
  }
  
  updateModelBadge(provider, model) {
    if (model) {
      this.modelBadge.textContent = `${provider}: ${model}`;
    } else {
      this.modelBadge.textContent = provider;
    }
  }
  
  addMessage(role, content) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    
    const avatarClass = role === 'user' ? 'user-avatar' : 
                        role === 'system' ? 'assistant-avatar' : 'assistant-avatar';
    const avatarIcon = role === 'user' ? '👤' : 
                       role === 'system' ? '⚡' : 
                       role === 'error' ? '❌' : '⚡';
    const senderName = role === 'user' ? 'You' : 
                       role === 'system' ? 'Grok Clone' : 
                       role === 'error' ? 'Error' : 'Grok Clone';
    
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    messageDiv.innerHTML = `
      <div class="message-header">
        <div class="message-avatar ${avatarClass}">${avatarIcon}</div>
        <span class="message-sender">${senderName}</span>
        <span class="message-time">${time}</span>
      </div>
      <div class="message-content" id="currentMessage"></div>
    `;
    
    this.messagesContainer.appendChild(messageDiv);
    this.currentMessage = document.getElementById('currentMessage');
    
    if (role === 'system' || role === 'error') {
      this.currentMessage.innerHTML = this.formatContent(content);
    } else {
      this.currentMessage.textContent = content;
    }
    
    this.scrollToBottom();
    
    return messageDiv;
  }
  
  appendToCurrentMessage(content) {
    if (this.currentMessage) {
      const existing = this.currentMessage.textContent;
      this.currentMessage.textContent = existing + content;
      this.scrollToBottom();
    }
  }
  
  finalizeMessage(provider, toolCalls = []) {
    if (this.currentMessage) {
      const content = this.currentMessage.textContent;
      this.currentMessage.innerHTML = this.formatContent(content);
      
      if (toolCalls && toolCalls.length > 0) {
        const toolInfo = document.createElement('div');
        toolInfo.className = 'tool-call';
        toolInfo.innerHTML = `
          <div class="tool-call-header">
            <span>🔧</span>
            <span>Tools used: ${toolCalls.join(', ')}</span>
          </div>
        `;
        this.currentMessage.appendChild(toolInfo);
      }
      
      // Apply syntax highlighting to code blocks
      this.currentMessage.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block);
      });
      
      this.currentMessage = null;
    }
  }
  
  showToolExecution(tools) {
    const toolDiv = document.createElement('div');
    toolDiv.className = 'tool-call';
    toolDiv.innerHTML = `
      <div class="tool-call-header">
        <span>⚡</span>
        <span>Executing: ${tools.join(', ')}</span>
      </div>
    `;
    this.messagesContainer.appendChild(toolDiv);
    this.scrollToBottom();
  }
  
  showThinking() {
    const thinkingDiv = document.createElement('div');
    thinkingDiv.className = 'thinking';
    thinkingDiv.id = 'thinkingIndicator';
    thinkingDiv.innerHTML = `
      <div class="thinking-dots">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <span class="thinking-text">Thinking...</span>
    `;
    this.messagesContainer.appendChild(thinkingDiv);
    this.scrollToBottom();
  }
  
  hideThinking() {
    const thinking = document.getElementById('thinkingIndicator');
    if (thinking) {
      thinking.remove();
    }
  }
  
  formatContent(content) {
    // Configure marked
    marked.setOptions({
      breaks: true,
      gfm: true,
      headerIds: false,
      mangle: false
    });
    
    // Parse markdown
    let formatted = marked.parse(content);
    
    // Clean up tool blocks
    formatted = formatted.replace(/```tool\s*\n([\s\S]*?)\n```/g, (match, p1) => {
      return `<div class="tool-call"><div class="tool-call-header"><span>🔧</span><span>Tool call</span></div><div class="tool-call-content"><pre>${p1}</pre></div></div>`;
    });
    
    // Clean up tool results
    formatted = formatted.replace(/<tool-result name="([^"]+)">([\s\S]*?)<\/tool-result>/g, (match, name, content) => {
      return `<div class="tool-result"><div class="tool-result-header"><span>📋</span><span>${name} result</span></div><div class="tool-result-content"><pre>${content}</pre></div></div>`;
    });
    
    return formatted;
  }
  
  scrollToBottom() {
    this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
  }
  
  clearConversation() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'clear' }));
    }
  }
}

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
  new GrokClone();
});
