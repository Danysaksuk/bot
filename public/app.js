// NEXUS — Frontend Application
class NexusApp {
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
    this.sidebar = document.getElementById('sidebar');
    this.providerList = document.getElementById('providerList');
    this.startConversationBtn = document.getElementById('startConversationBtn');
    this.browseModelsBtn = document.getElementById('browseModelsBtn');
    this.sidebarBackdrop = document.getElementById('sidebarBackdrop');
    this.sidebarClose = document.getElementById('sidebarClose');
    this.connectionMeta = document.getElementById('connectionMeta');
  }

  setupEventListeners() {
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

    this.sendBtn.addEventListener('click', () => this.sendMessage());

    this.temperatureSlider.addEventListener('input', (e) => {
      this.temperature = parseFloat(e.target.value);
      this.tempValue.textContent = this.temperature.toFixed(1);
    });

    this.newChatBtn.addEventListener('click', () => this.clearConversation());
    this.clearChat.addEventListener('click', () => this.clearConversation());

    this.menuToggle.addEventListener('click', () => this.openSidebar());
    this.sidebarClose.addEventListener('click', () => this.closeSidebar());
    this.sidebarBackdrop.addEventListener('click', () => this.closeSidebar());

    if (this.startConversationBtn) {
      this.startConversationBtn.addEventListener('click', () => {
        this.messageInput.focus();
      });
    }

    if (this.browseModelsBtn) {
      this.browseModelsBtn.addEventListener('click', () => {
        this.openSidebar();
        const providers = document.getElementById('providerList');
        if (providers) {
          providers.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
    }

    document.querySelectorAll('.example-prompt').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.messageInput.value = btn.dataset.prompt;
        this.sendBtn.disabled = false;
        this.updateCharCount();
        this.closeSidebar();
        this.sendMessage();
      });
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeSidebar();
    });
  }

  openSidebar() {
    this.sidebar.classList.add('open');
    this.sidebarBackdrop.hidden = false;
  }

  closeSidebar() {
    this.sidebar.classList.remove('open');
    this.sidebarBackdrop.hidden = true;
  }

  connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.updateStatus('connected');
      this.ws.send(JSON.stringify({ type: 'providers' }));
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleMessage(data);
    };

    this.ws.onclose = () => {
      this.updateStatus('disconnected');
      setTimeout(() => this.connectWebSocket(), 3000);
    };

    this.ws.onerror = () => {
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
        if (this.connectionMeta) this.connectionMeta.textContent = 'Connected';
        break;
      case 'disconnected':
        dot.style.background = 'var(--warning)';
        text.textContent = 'Reconnecting...';
        if (this.connectionMeta) this.connectionMeta.textContent = 'Reconnecting';
        break;
      case 'error':
        dot.style.background = 'var(--alert)';
        text.textContent = 'Error';
        if (this.connectionMeta) this.connectionMeta.textContent = 'Error';
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

    providers.forEach((provider) => {
      const item = document.createElement('div');
      item.className = `provider-item ${provider.status}`;

      const models = provider.models.slice(0, 3).join(', ');
      const moreModels = provider.models.length > 3 ? ` +${provider.models.length - 3}` : '';

      item.innerHTML = `
        <div class="provider-header">
          <span class="provider-status" aria-hidden="true"></span>
          <span class="provider-name">${provider.name}</span>
        </div>
        <div class="provider-models">${models}${moreModels}</div>
      `;

      this.providerList.appendChild(item);
    });

    const availableCount = providers.filter((p) => p.status === 'available').length;
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

    this.welcomeScreen.classList.add('is-hidden');

    this.addMessage('user', content);

    this.messageInput.value = '';
    this.autoResize();
    this.updateCharCount();

    this.showThinking();

    this.ws.send(JSON.stringify({
      type: 'chat',
      content,
      temperature: this.temperature
    }));
  }

  handleMessage(data) {
    switch (data.type) {
      case 'ready':
        if (data.providers) this.updateProviderList(data.providers);
        break;

      case 'system':
        this.welcomeScreen.classList.add('is-hidden');
        this.addMessage('system', data.message);
        break;

      case 'thinking':
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
        this.sendBtn.disabled = !this.messageInput.value.trim();
        break;

      case 'error':
        this.hideThinking();
        this.addMessage('error', data.message);
        this.isProcessing = false;
        this.sendBtn.disabled = !this.messageInput.value.trim();
        break;

      case 'cleared':
        this.messagesContainer.innerHTML = '';
        this.welcomeScreen.classList.remove('is-hidden');
        this.messageInput.focus();
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
    messageDiv.className = `message ${role === 'user' ? 'user' : role === 'error' ? 'error' : 'assistant'}`;

    const avatarLabel = role === 'user' ? 'YOU' : role === 'error' ? 'ERR' : 'NX';
    const avatarClass = role === 'user' ? 'user-avatar' : 'assistant-avatar';
    const senderName = role === 'user' ? 'You' :
                       role === 'system' ? 'NEXUS' :
                       role === 'error' ? 'Error' : 'NEXUS';

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    messageDiv.innerHTML = `
      <div class="message-shell">
        <div class="message-header">
          <div class="message-avatar ${avatarClass}">${avatarLabel}</div>
          <span class="message-sender">${senderName}</span>
          <span class="message-time">${time}</span>
        </div>
        <div class="message-content"></div>
      </div>
    `;

    const contentEl = messageDiv.querySelector('.message-content');
    this.messagesContainer.appendChild(messageDiv);
    this.currentMessage = contentEl;

    if (role === 'system' || role === 'error') {
      this.currentMessage.innerHTML = this.formatContent(content);
    } else if (role === 'user') {
      this.currentMessage.textContent = content;
      this.currentMessage = null;
    } else {
      this.currentMessage.textContent = content;
    }

    this.scrollToBottom();
    return messageDiv;
  }

  appendToCurrentMessage(content) {
    if (!this.currentMessage) {
      this.addMessage('assistant', '');
    }
    if (this.currentMessage) {
      this.currentMessage.textContent = (this.currentMessage.textContent || '') + content;
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
            <span>Tools used: ${toolCalls.join(', ')}</span>
          </div>
        `;
        this.currentMessage.appendChild(toolInfo);
      }

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
    if (thinking) thinking.remove();
  }

  formatContent(content) {
    marked.setOptions({
      breaks: true,
      gfm: true,
      headerIds: false,
      mangle: false
    });

    let formatted = marked.parse(content);

    formatted = formatted.replace(/```tool\s*\n([\s\S]*?)\n```/g, (match, p1) => {
      return `<div class="tool-call"><div class="tool-call-header"><span>Tool call</span></div><div class="tool-call-content"><pre>${p1}</pre></div></div>`;
    });

    formatted = formatted.replace(/<tool-result name="([^"]+)">([\s\S]*?)<\/tool-result>/g, (match, name, body) => {
      return `<div class="tool-result"><div class="tool-result-header"><span>${name} result</span></div><div class="tool-result-content"><pre>${body}</pre></div></div>`;
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
    this.closeSidebar();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new NexusApp();
});
