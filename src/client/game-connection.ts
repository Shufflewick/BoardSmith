/**
 * GameConnection - WebSocket connection to a game with auto-reconnect
 */

import type {
  GameConnectionConfig,
  GameState,
  ConnectionStatus,
  StateChangeCallback,
  LobbyChangeCallback,
  ErrorCallback,
  ConnectionCallback,
  WebSocketOutgoingMessage,
  WebSocketIncomingMessage,
  ActionResult,
  LobbyInfo,
} from './types.js';
import { resolveWsCtor } from './ws-ctor.js';

export class GameConnection {
  private config: Required<Omit<GameConnectionConfig, 'wsImplementation'>>;
  private baseUrl: string;
  private ws: WebSocket | null = null;
  /** Resolved WebSocket constructor: injected override or the runtime global. */
  #wsCtor: typeof WebSocket;
  private status: ConnectionStatus = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimeout: ReturnType<typeof setTimeout> | null = null;
  private awaitingPong = false;
  private lastState: GameState | null = null;

  // Callbacks
  private stateCallbacks: Set<StateChangeCallback> = new Set();
  private lobbyCallbacks: Set<LobbyChangeCallback> = new Set();
  private errorCallbacks: Set<ErrorCallback> = new Set();
  private connectionCallbacks: Set<ConnectionCallback> = new Set();

  // Last lobby state
  private lastLobby: LobbyInfo | null = null;

  // Pending action promises (for request/response pattern)
  private pendingActions: Map<
    string,
    {
      resolve: (result: ActionResult) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  > = new Map();

  // Request ID counter
  private requestIdCounter = 0;

  /**
   * Resolves when the current socket finishes its opening handshake; rejects
   * with an actionable error if the socket errors or closes before opening.
   * Reassigned on every `connect()` call. A no-op `.catch()` is attached
   * immediately so callers that rely on `action()`'s internal await (rather
   * than awaiting `opened` directly) don't trigger an unhandled rejection.
   */
  opened: Promise<void> = Promise.resolve();
  #openedResolve: (() => void) | null = null;
  #openedReject: ((error: Error) => void) | null = null;
  #openPending = false;

  /**
   * Set by `disconnect()`, cleared by `connect()`. Suppresses
   * `scheduleReconnect()` for a user-initiated disconnect without mutating
   * `config.autoReconnect` (the caller's config object is never touched).
   */
  #userDisconnected = false;

  /**
   * @remarks
   * Constructs and connects natively on Node >=22.4 via `globalThis.WebSocket`.
   * On older Node or other runtimes without a global `WebSocket`, pass
   * `config.wsImplementation` — otherwise the constructor throws.
   */
  constructor(baseUrl: string, config: GameConnectionConfig) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.config = {
      gameId: config.gameId,
      playerId: config.playerId,
      playerSeat: config.playerSeat ?? -1,
      spectator: config.spectator ?? false,
      autoReconnect: config.autoReconnect ?? true,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 5,
      reconnectDelay: config.reconnectDelay ?? 1000,
      connectImmediately: config.connectImmediately ?? true,
      connectionTimeout: config.connectionTimeout ?? 10000,
    };

    this.#wsCtor = resolveWsCtor(config.wsImplementation, 'GameConnection');
  }

  // ============================================
  // Connection Management
  // ============================================

  connect(): void {
    if (this.ws && (this.ws.readyState === this.#wsCtor.OPEN || this.ws.readyState === this.#wsCtor.CONNECTING)) {
      return; // Already connected or connecting
    }

    this.#userDisconnected = false;

    if (!this.config.connectImmediately) {
      // Honor connectImmediately: skip dialing so a caller can construct a
      // GameConnection without opening a socket it immediately has to kill
      // (e.g. useGame({ autoConnect: false })).
      return;
    }

    if (this.ws) {
      // A stale CLOSING/CLOSED socket may still have handlers attached
      // (server-initiated close whose close event hasn't been delivered
      // yet). Detach it before dialing, or its late onclose would fire
      // against `this` — rejecting the NEW opened promise and cleaning up
      // the NEW socket.
      this.cleanup();
    }

    this.setStatus('connecting');
    this.clearReconnectTimer();

    this.opened = new Promise<void>((resolve, reject) => {
      this.#openedResolve = resolve;
      this.#openedReject = reject;
    });
    this.#openPending = true;
    // Prevent an unhandled-rejection crash for callers relying on action()'s
    // internal await instead of awaiting `opened` directly.
    this.opened.catch(() => {});

    try {
      const wsUrl = this.buildWebSocketUrl();
      this.ws = new this.#wsCtor(wsUrl);
      this.setupWebSocketHandlers();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.handleError(err);
      this.#rejectOpen(err);
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.#userDisconnected = true;
    this.cleanup();
    this.setStatus('disconnected');
  }

  /**
   * Resets reconnect state and reconnects immediately. Delegates to
   * `connect()` for the actual dial + `#userDisconnected` clearing — no
   * longer maintains a divergent restore path from a plain disconnect() ->
   * connect() sequence.
   */
  reconnect(): void {
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
    if (this.config.spectator) {
      return { success: false, error: 'Spectators cannot perform actions' };
    }

    if (!this.ws) {
      if (this.status === 'reconnecting') {
        // The socket dropped uncleanly and an automatic reconnect is
        // already in progress — telling the caller to connect() would be
        // wrong advice. Wait for the reconnect, bounded by
        // connectionTimeout (symmetric with the CONNECTING window handled
        // by awaitOpen below).
        await this.awaitReconnect(actionName);
      } else {
        throw new Error(
          `GameConnection: cannot perform action '${actionName}' — not connected. Call connect() first.`
        );
      }
    }

    if (this.ws.readyState !== this.#wsCtor.OPEN) {
      await this.awaitOpen(actionName);
    }

    if (!this.ws || this.ws.readyState !== this.#wsCtor.OPEN) {
      throw new Error(
        `GameConnection: connection closed while waiting to send action '${actionName}'.`
      );
    }

    // Generate unique request ID
    const requestId = `req-${++this.requestIdCounter}-${Date.now()}`;

    const message: WebSocketOutgoingMessage = {
      type: 'action',
      action: actionName,
      args,
      requestId,
    };

    // Create promise that will be resolved when server responds
    return new Promise<ActionResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingActions.delete(requestId);
        reject(
          new Error(
            `GameConnection: action '${actionName}' timed out waiting for a server response after ${this.config.connectionTimeout}ms.`
          )
        );
      }, this.config.connectionTimeout);

      this.pendingActions.set(requestId, { resolve, reject, timeout });

      try {
        this.ws!.send(JSON.stringify(message));
      } catch (err) {
        clearTimeout(timeout);
        this.pendingActions.delete(requestId);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * Awaits `this.opened`, bounded by `config.connectionTimeout`. Rejects
   * loudly on timeout or open-failure — never resolves silently.
   */
  private async awaitOpen(actionName: string): Promise<void> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(
          new Error(
            `GameConnection: timed out waiting for the connection to open before sending action '${actionName}' (connectionTimeout=${this.config.connectionTimeout}ms).`
          )
        );
      }, this.config.connectionTimeout);
    });

    try {
      await Promise.race([this.opened, timeoutPromise]);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  /**
   * Awaits the completion of an in-progress automatic reconnect, bounded
   * by `config.connectionTimeout`. Resolves once the connection reaches
   * 'connected'; rejects loudly on timeout, a clean disconnect, or
   * reconnect exhaustion ('error') — never resolves silently.
   */
  private awaitReconnect(actionName: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(
          new Error(
            `GameConnection: timed out waiting for the automatic reconnect to complete before sending action '${actionName}' (connectionTimeout=${this.config.connectionTimeout}ms).`
          )
        );
      }, this.config.connectionTimeout);

      const unsubscribe = this.onConnectionChange((status) => {
        if (status === 'connected') {
          clearTimeout(timeout);
          unsubscribe();
          resolve();
        } else if (status === 'disconnected' || status === 'error') {
          clearTimeout(timeout);
          unsubscribe();
          reject(
            new Error(
              `GameConnection: connection ${
                status === 'error' ? 'failed (reconnect attempts exhausted)' : 'was closed'
              } while waiting to send action '${actionName}'.`
            )
          );
        }
        // 'connecting'/'reconnecting': keep waiting.
      });
    });
  }

  /** Resolves the current `opened` promise, if one is pending. */
  #resolveOpen(): void {
    if (!this.#openPending) return;
    this.#openPending = false;
    this.#openedResolve?.();
  }

  /** Rejects the current `opened` promise, if one is pending. */
  #rejectOpen(error: Error): void {
    if (!this.#openPending) return;
    this.#openPending = false;
    this.#openedReject?.(error);
  }

  requestState(): void {
    if (this.ws && this.ws.readyState === this.#wsCtor.OPEN) {
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

  onLobbyChange(callback: LobbyChangeCallback): () => void {
    this.lobbyCallbacks.add(callback);

    // Immediately call with current lobby if available
    if (this.lastLobby) {
      callback(this.lastLobby);
    }

    return () => this.lobbyCallbacks.delete(callback);
  }

  getLobby(): LobbyInfo | null {
    return this.lastLobby;
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
    if (this.config.playerSeat >= 1) {
      wsUrl.searchParams.set('player', String(this.config.playerSeat));
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
      this.#resolveOpen();
      this.startPingInterval();
      // Request initial state after connection
      this.requestState();
    };

    this.ws.onclose = (event) => {
      this.#rejectOpen(
        new Error(`GameConnection: connection to '${this.baseUrl}' closed before opening.`)
      );
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
      this.#rejectOpen(
        new Error(`GameConnection: connection to '${this.baseUrl}' failed before opening.`)
      );
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
              playerSeat: message.playerSeat ?? this.config.playerSeat,
              isSpectator: message.isSpectator ?? this.config.spectator,
            };
            this.notifyStateChange();
          }
          break;

        case 'lobby':
          if (message.lobby) {
            this.lastLobby = message.lobby;
            this.notifyLobbyChange();
          }
          break;

        case 'error':
          if (message.error) {
            this.handleError(new Error(message.error));
          }
          break;

        case 'actionResult':
          // Handle action response with request ID
          if (message.requestId) {
            const pending = this.pendingActions.get(message.requestId);
            if (pending) {
              clearTimeout(pending.timeout);
              this.pendingActions.delete(message.requestId);
              pending.resolve({
                success: message.success ?? false,
                error: message.error,
                data: message.data,
                message: message.message,
                followUp: message.followUp,
              });
            }
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
    if (this.#userDisconnected) return;
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
      if (this.ws && this.ws.readyState === this.#wsCtor.OPEN) {
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
    // Settle a still-pending `opened` promise before detaching handlers:
    // cleanup() nulls ws.onclose before close(), so the close event that
    // would have rejected it is swallowed. Without this, disconnect()/
    // reconnect() mid-handshake strands awaiters forever (and a later
    // connect() reassigns the resolvers, orphaning them permanently).
    // #rejectOpen is a no-op when nothing is pending, and the no-op
    // .catch() attached in connect() prevents unhandled rejections.
    this.#rejectOpen(
      new Error('GameConnection: connection closed while the socket was still opening.')
    );
    this.clearReconnectTimer();
    this.stopPingInterval();

    // Reject all pending actions
    for (const [, pending] of this.pendingActions) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('GameConnection: connection closed while an action was pending.'));
    }
    this.pendingActions.clear();

    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;

      if (this.ws.readyState === this.#wsCtor.OPEN || this.ws.readyState === this.#wsCtor.CONNECTING) {
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

  private notifyLobbyChange(): void {
    if (this.lastLobby) {
      for (const callback of this.lobbyCallbacks) {
        try {
          callback(this.lastLobby);
        } catch (error) {
          console.error('Lobby callback error:', error);
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
