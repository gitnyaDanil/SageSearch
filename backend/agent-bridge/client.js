const EventEmitter = require('events');
const { localSearchFiles, localReadFileContent, localCreateArtifact } = require('./local-tools');

class AgentBridgeClient extends EventEmitter {
  constructor({ bridgeUrl = 'ws://localhost:8080/ws/bridge', agentHttpUrl = 'http://localhost:8080', searchIndex, autoConnect = true } = {}) {
    super();
    this.bridgeUrl = bridgeUrl;
    this.agentHttpUrl = agentHttpUrl;
    this.searchIndex = searchIndex;
    this.autoConnect = autoConnect;
    this.ws = null;
    this.connected = false;
    this.reconnectTimer = null;
    this.pingInterval = null;

    if (this.autoConnect) {
      this.connect();
    }
  }

  connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) {
      return;
    }

    try {
      // Use Node 22+ native WebSocket
      this.ws = new WebSocket(this.bridgeUrl);

      this.ws.onopen = () => {
        this.connected = true;
        console.log(`[AgentBridge] Connected to cloud agent at ${this.bridgeUrl}`);
        this.emit('connected');

        // Send handshake
        this.send({
          type: 'handshake',
          client_info: {
            app: 'SageSearch Desktop',
            version: '1.0.0',
            capabilities: ['search_files', 'read_file_content', 'create_artifact'],
          },
        });

        // Start heartbeat
        this.startPing();
      };

      this.ws.onmessage = async (event) => {
        try {
          const message = typeof event.data === 'string' ? JSON.parse(event.data) : JSON.parse(event.data.toString());
          await this.handleMessage(message);
        } catch (err) {
          console.error('[AgentBridge] Error parsing incoming message:', err.message);
        }
      };

      this.ws.onclose = () => {
        this.cleanup();
        console.log('[AgentBridge] WebSocket disconnected. Reconnecting in 3s...');
        this.emit('disconnected');
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.warn(`[AgentBridge] WebSocket error: ${err.message || 'Connection failed'}`);
      };
    } catch (err) {
      console.error('[AgentBridge] Connection initialization error:', err.message);
      this.scheduleReconnect();
    }
  }

  startPing() {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      if (this.connected) {
        this.send({ type: 'ping', timestamp: Date.now() });
      }
    }, 15000);
  }

  stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  cleanup() {
    this.connected = false;
    this.stopPing();
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectAttempts = (this.reconnectAttempts || 0) + 1;
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 15000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.autoConnect) this.connect();
    }, delay);
  }

  send(data) {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(data));
    }
  }

  async handleMessage(msg) {
    const { type, id, tool, params } = msg;

    if (type === 'tool_call') {
      let result = null;
      let error = null;

      try {
        if (tool === 'search_files') {
          result = localSearchFiles(params, this.searchIndex);
        } else if (tool === 'read_file_content') {
          result = await localReadFileContent(params);
        } else if (tool === 'create_artifact') {
          result = await localCreateArtifact(params);
        } else {
          error = `Unsupported local tool: ${tool}`;
        }
      } catch (e) {
        error = e.message;
      }

      this.send({
        type: 'tool_result',
        id,
        result: error ? { error, status: 'error' } : result,
      });

      this.emit('tool_executed', { tool, params, result, error });
    } else if (type === 'approval_request') {
      this.emit('approval_request', msg);
    } else if (type === 'step_started' || type === 'step_completed' || type === 'task_completed' || type === 'task_failed') {
      this.emit(type, msg);
    }
  }

  async getTask(taskId) {
    let res;
    try {
      res = await fetch(`${this.agentHttpUrl}/tasks/${encodeURIComponent(taskId)}`);
    } catch (error) {
      throw new Error(`Agent service unavailable at ${this.agentHttpUrl}. (${error.message})`);
    }
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to get task: ${err}`);
    }
    return res.json();
  }

  async startTask(goal, autoApprove = false) {
    let res;
    try {
      res = await fetch(`${this.agentHttpUrl}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal, auto_approve: autoApprove }),
      });
    } catch (error) {
      throw new Error(`Agent service unavailable at ${this.agentHttpUrl}. Start the SageSearch Agent Brain first. (${error.message})`);
    }
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to start task: ${err}`);
    }
    return res.json();
  }

  async respondToTask(taskId, approved, feedback = null) {
    let res;
    try {
      res = await fetch(`${this.agentHttpUrl}/tasks/${taskId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved, feedback }),
      });
    } catch (error) {
      throw new Error(`Agent service unavailable at ${this.agentHttpUrl}. Start the SageSearch Agent Brain first. (${error.message})`);
    }
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to respond to task: ${err}`);
    }
    return res.json();
  }

  async getMemory(userId = 'default_user') {
    try {
      const res = await fetch(`${this.agentHttpUrl}/memory?user_id=${encodeURIComponent(userId)}`);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    } catch (error) {
      return {
        default_currency: 'USD',
        preferred_export_format: 'csv',
        learned_categories: ['Gym / Fitness', 'Travel / Flight', 'Travel / Lodging', 'Travel / Ground', 'Meals / Dining']
      };
    }
  }

  async saveMemory(preferences, userId = 'default_user') {
    const res = await fetch(`${this.agentHttpUrl}/memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, preferences }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async clearMemory(userId = 'default_user') {
    const res = await fetch(`${this.agentHttpUrl}/memory/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  getStatus() {
    return {
      connected: this.connected,
      bridgeUrl: this.bridgeUrl,
      agentHttpUrl: this.agentHttpUrl,
    };
  }

  disconnect() {
    this.autoConnect = false;
    this.cleanup();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

module.exports = { AgentBridgeClient };
