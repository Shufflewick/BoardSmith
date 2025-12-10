/**
 * GameConnection - WebSocket connection to a game with auto-reconnect
 */

import type {
  GameConnectionConfig,
  GameState,
  ConnectionStatus,
  StateChangeCallback,
  ErrorCallback,
  ConnectionCallback,
  WebSocketOutgoingMessage,
  WebSocketIncomingMessage,
  ActionResult,
} from './types.js';

export class GameConnection {
  private config: Required<GameConnectionConfig>;
  private baseUrl: string;
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimeout: ReturnType<typeof setTimeout> | null = null;
  private awaitingPong = false;
  private lastState: GameState | null = null;

  // Callbacks
  private stateCallbacks: Set<StateChangeCallback> = new Set();
  private errorCallbacks: Set<ErrorCallback> = new Set();
  private connectionCallbacks: Set<ConnectionCallback> = new Set();

  // Pending action promises
  private pendingActions: Map<
    string,
    { resolve: (result: ActionResult) => void; reject: (error: Error) => void }
  > = new Map();

  constructor(baseUrl: string, config: GameConnectionConfig) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.config = {
      gameId: config.gameId,
      playerId: config.playerId,
      playerPosition: config.playerPosition ?? -1,
      spectator: config.spectator ?? false,
      autoReconnect: config.autoReconnect ?? true,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 5,
      reconnectDelay: config.reconnectDelay ?? 1000,
    };
  }

  // ============================================
  // Connection Management
  // ============================================

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return; // Already connected or connecting
    }

    this.setStatus('connecting');
    this.clearReconnectTimer();

    try {
      const wsUrl = this.buildWebSocketUrl();
      this.ws = new WebSocket(wsUrl);
      this.setupWebSocketHandlers();
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)));
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.config.autoReconnect = false; // Prevent auto-reconnect
    this.cleanup();
    this.setStatus('disconnected');
  }

  reconnect(): void {
    this.config.autoReconnect = true;
    this.reconnectAttempts = 0;
    this.cleanup();
    this.connect();
  }

  // ============================================
  // State & Actions
  // ============================================

  getState(): GameState | null {
    return this.lastState;
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  isConnected(): boolean {
    return this.status === 'connected';
  }

  async action(actionName: string, args: Record<string, unknown> = {}): Promise<ActionResult> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return { success: false, error: 'Not connected' };
    }

    if (this.config.spectator) {
      return { success: false, error: 'Spectators cannot perform actions' };
    }

    const message: WebSocketOutgoingMessage = {
      type: 'action',
      action: actionName,
      args,
    };

    try {
      this.ws.send(JSON.stringify(message));
    } catch (err) {
      return { success: false, error: String(err) };
    }

    // For WebSocket actions, success is indicated by receiving a new state
    // Errors come back as separate error messages
    return { success: true };
  }

  requestState(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message: WebSocketOutgoingMessage = { type: 'getState' };
      this.ws.send(JSON.stringify(message));
    }
  }

  // ============================================
  // Event Subscriptions
  // ============================================

  onStateChange(callback: StateChangeCallback): () => void {
    this.stateCallbacks.add(callback);

    // Immediately call with current state if available
    if (this.lastState) {
      callback(this.lastState);
    }

    return () => this.stateCallbacks.delete(callback);
  }

  onError(callback: ErrorCallback): () => void {
    this.errorCallbacks.add(callback);
    return () => this.errorCallbacks.delete(callback);
  }

  onConnectionChange(callback: ConnectionCallback): () => void {
    this.connectionCallbacks.add(callback);

    // Immediately call with current status
    callback(this.status);

    return () => this.connectionCallbacks.delete(callback);
  }

  // ============================================
  // Private: WebSocket Handling
  // ============================================

  private buildWebSocketUrl(): string {
    const httpUrl = new URL(`${this.baseUrl}/games/${this.config.gameId}`);
    const wsProtocol = httpUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = new URL(`${wsProtocol}//${httpUrl.host}${httpUrl.pathname}`);

    wsUrl.searchParams.set('playerId', this.config.playerId);
    if (this.config.playerPosition >= 0) {
      wsUrl.searchParams.set('player', String(this.config.playerPosition));
    }
    if (this.config.spectator) {
      wsUrl.searchParams.set('spectator', 'true');
    }

    return wsUrl.toString();
  }

  private setupWebSocketHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus('connected');
      this.startPingInterval();
      // Request initial state after connection
      this.requestState();
    };

    this.ws.onclose = (event) => {
      this.cleanup();

      if (event.wasClean) {
        this.setStatus('disconnected');
      } else {
        this.handleError(new Error(`Connection closed unexpectedly: ${event.code}`));
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // Error details are not available in the error event
      this.handleError(new Error('WebSocket error'));
    };

    this.ws.onmessage = (event) => {
      this.handleMessage(event.data);
    };
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data) as WebSocketIncomingMessage;

      switch (message.type) {
        case 'state':
        case 'restart':
          if (message.state && message.flowState !== undefined) {
            this.lastState = {
              flowState: message.flowState,
              state: message.state,
              playerPosition: message.playerPosition ?? this.config.playerPosition,
              isSpectator: message.isSpectator ?? this.config.spectator,
            };
            this.notifyStateChange();
          }
          break;

        case 'error':
          if (message.error) {
            this.handleError(new Error(message.error));
          }
          break;

        case 'pong':
          // Ping acknowledged - connection is alive
          this.awaitingPong = false;
          if (this.pongTimeout) {
            clearTimeout(this.pongTimeout);
            this.pongTimeout = null;
          }
          break;
      }
    } catch (error) {
      this.handleError(new Error(`Invalid message: ${error}`));
    }
  }

  // ============================================
  // Private: Reconnection
  // ============================================

  private scheduleReconnect(): void {
    if (!this.config.autoReconnect) return;
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.setStatus('error');
      this.handleError(new Error('Max reconnection attempts reached'));
      return;
    }

    this.setStatus('reconnecting');
    this.reconnectAttempts++;

    // Exponential backoff with jitter
    const delay = this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    const jitter = delay * 0.2 * Math.random();
    const totalDelay = Math.min(delay + jitter, 30000); // Cap at 30 seconds

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, totalDelay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ============================================
  // Private: Ping/Keep-alive
  // ============================================

  private startPingInterval(): void {
    this.stopPingInterval();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // If we're still waiting for a pong from the last ping, connection is dead
        if (this.awaitingPong) {
          console.warn('Pong timeout - connection appears dead, reconnecting...');
          this.handleError(new Error('Connection timeout - no response from server'));
          this.cleanup();
          this.scheduleReconnect();
          return;
        }

        // Send ping and start pong timeout
        const message: WebSocketOutgoingMessage = { type: 'ping' };
        this.ws.send(JSON.stringify(message));
        this.awaitingPong = true;

        // Set a timeout for pong response (10 seconds)
        this.pongTimeout = setTimeout(() => {
          if (this.awaitingPong && this.ws) {
            console.warn('Pong not received within timeout, reconnecting...');
            this.handleError(new Error('Connection timeout - server not responding'));
            this.cleanup();
            this.scheduleReconnect();
          }
        }, 10000);
      }
    }, 30000); // Ping every 30 seconds
  }

  private stopPingInterval(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
    this.awaitingPong = false;
  }

  // ============================================
  // Private: Helpers
  // ============================================

  private cleanup(): void {
    this.clearReconnectTimer();
    this.stopPingInterval();

    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;

      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.notifyConnectionChange();
    }
  }

  private notifyStateChange(): void {
    if (this.lastState) {
      for (const callback of this.stateCallbacks) {
        try {
          callback(this.lastState);
        } catch (error) {
          console.error('State callback error:', error);
        }
      }
    }
  }

  private notifyConnectionChange(): void {
    for (const callback of this.connectionCallbacks) {
      try {
        callback(this.status);
      } catch (error) {
        console.error('Connection callback error:', error);
      }
    }
  }

  private handleError(error: Error): void {
    for (const callback of this.errorCallbacks) {
      try {
        callback(error);
      } catch (e) {
        console.error('Error callback error:', e);
      }
    }
  }
}
