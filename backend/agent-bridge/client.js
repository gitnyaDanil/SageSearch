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
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.autoConnect) this.connect();
    }, 3000);
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
    } else if (type === 'step_started' || type === 'step_completed' || type === 'task_completed') {
      this.emit(type, msg);
    }
  }

  async startTask(goal, autoApprove = false) {
    const res = await fetch(`${this.agentHttpUrl}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal, auto_approve: autoApprove }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to start task: ${err}`);
    }
    return res.json();
  }

  async respondToTask(taskId, approved, feedback = null) {
    const res = await fetch(`${this.agentHttpUrl}/tasks/${taskId}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved, feedback }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to respond to task: ${err}`);
    }
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
