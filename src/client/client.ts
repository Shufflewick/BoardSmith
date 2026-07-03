/**
 * BoardSmithClient - Main client SDK for BoardSmith
 */

import { GameConnection } from './game-connection.js';
import type {
  MeepleClientConfig,
  FindMatchOptions,
  MatchmakingResult,
  MatchmakingStatus,
  GameState,
  PlayerState,
  FlowState,
  CreateGameRequest,
  CreateGameResponse,
  GameConnectionConfig,
  LobbyInfo,
  ClaimSeatResponse,
  JoinLobbyResponse,
  LobbyResponse,
} from './types.js';
import type { ErrorCode } from '../types/protocol.js';

/**
 * Error thrown by every `MeepleClient` HTTP method on `!response.ok` or
 * `data.success === false`. `errorCode` is OPTIONAL — lobby-manager.ts
 * populates no `errorCode` today (see 136-FINDINGS-VERIFICATION.md F25), so
 * this type never fabricates one client-side.
 */
export class MeepleClientError extends Error {
  errorCode?: ErrorCode;

  constructor(message: string, errorCode?: ErrorCode) {
    super(message);
    this.name = 'MeepleClientError';
    this.errorCode = errorCode;
  }
}

export class MeepleClient {
  private config: Required<MeepleClientConfig>;
  private playerId: string;

  constructor(config: MeepleClientConfig) {
    // Use the explicit playerId if provided; otherwise mint one. Minting
    // first (before building `this.config`) so `Required<MeepleClientConfig>`
    // always has a concrete value to store.
    this.playerId = config.playerId ?? this.generatePlayerId();

    this.config = {
      baseUrl: config.baseUrl.replace(/\/$/, ''), // Remove trailing slash
      autoReconnect: config.autoReconnect ?? true,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 5,
      reconnectDelay: config.reconnectDelay ?? 1000,
      requestTimeout: config.requestTimeout ?? 10000,
      playerId: this.playerId,
    };
  }

  // ============================================
  // Matchmaking API
  // ============================================

  /**
   * Join the matchmaking queue for a game type.
   * Returns immediately if a match is found, otherwise returns queue position.
   */
  async findMatch(
    gameType: string,
    options: FindMatchOptions
  ): Promise<MatchmakingResult> {
    const response = await this.fetch('/matchmaking/join', {
      method: 'POST',
      body: JSON.stringify({
        gameType,
        playerCount: options.playerCount,
        playerId: this.playerId,
        playerName: options.playerName,
      }),
    });

    const data = await this.parseResponse<MatchmakingResult & { matched: boolean }>(response);

    return {
      matched: data.matched,
      gameId: data.gameId,
      playerSeat: data.playerSeat,
      players: data.players,
      position: data.position,
      queueSize: data.queueSize,
      playersNeeded: data.playersNeeded,
    };
  }

  /**
   * Check the current matchmaking status for this player.
   */
  async getMatchStatus(): Promise<MatchmakingStatus> {
    const url = new URL(`${this.config.baseUrl}/matchmaking/status`);
    url.searchParams.set('playerId', this.playerId);

    const response = await this.fetch(url.pathname + url.search);
    const data = await this.parseResponse<MatchmakingStatus>(response);

    return {
      status: data.status,
      gameType: data.gameType,
      playerCount: data.playerCount,
      gameId: data.gameId,
      playerSeat: data.playerSeat,
      players: data.players,
      position: data.position,
      queueSize: data.queueSize,
      playersNeeded: data.playersNeeded,
    };
  }

  /**
   * Leave the matchmaking queue.
   */
  async leaveMatchmaking(): Promise<void> {
    const response = await this.fetch('/matchmaking/leave', {
      method: 'POST',
      body: JSON.stringify({ playerId: this.playerId }),
    });

    await this.parseResponse<{ success: true }>(response);
  }

  /**
   * Poll for match status until matched or timeout.
   */
  async waitForMatch(
    gameType: string,
    options: FindMatchOptions & { pollInterval?: number; timeout?: number }
  ): Promise<MatchmakingResult> {
    const pollInterval = options.pollInterval ?? 2000;
    const timeout = options.timeout ?? 60000;
    const startTime = Date.now();

    // First, join the queue
    const initial = await this.findMatch(gameType, options);
    if (initial.matched) {
      return initial;
    }

    // Poll until matched or timeout
    while (Date.now() - startTime < timeout) {
      await this.sleep(pollInterval);

      const status = await this.getMatchStatus();

      if (status.status === 'matched' && status.gameId) {
        return {
          matched: true,
          gameId: status.gameId,
          playerSeat: status.playerSeat,
          players: status.players,
        };
      }

      if (status.status === 'not_in_queue') {
        throw new Error('No longer in matchmaking queue');
      }
    }

    // Timeout - leave the queue
    await this.leaveMatchmaking();
    throw new Error('Matchmaking timeout');
  }

  // ============================================
  // Game Connection API
  // ============================================

  /**
   * Connect to a game via WebSocket.
   */
  connect(gameId: string, options?: Partial<GameConnectionConfig>): GameConnection {
    const connectionConfig: GameConnectionConfig = {
      gameId,
      playerId: this.playerId,
      playerSeat: options?.playerSeat,
      spectator: options?.spectator ?? false,
      autoReconnect: options?.autoReconnect ?? this.config.autoReconnect,
      maxReconnectAttempts: options?.maxReconnectAttempts ?? this.config.maxReconnectAttempts,
      reconnectDelay: options?.reconnectDelay ?? this.config.reconnectDelay,
    };

    const connection = new GameConnection(this.config.baseUrl, connectionConfig);
    connection.connect();

    return connection;
  }

  /**
   * Convenience method: wait for match and then connect.
   */
  async findAndConnect(
    gameType: string,
    options: FindMatchOptions & { pollInterval?: number; timeout?: number }
  ): Promise<{ connection: GameConnection; matchResult: MatchmakingResult }> {
    const matchResult = await this.waitForMatch(gameType, options);

    if (!matchResult.gameId) {
      throw new Error('No game ID in match result');
    }

    const connection = this.connect(matchResult.gameId, {
      playerSeat: matchResult.playerSeat,
    });

    return { connection, matchResult };
  }

  // ============================================
  // Direct Game API (HTTP)
  // ============================================

  /**
   * Create a new game directly (without matchmaking).
   */
  async createGame(options: CreateGameRequest): Promise<CreateGameResponse> {
    const response = await this.fetch('/games', {
      method: 'POST',
      body: JSON.stringify(options),
    });

    return await this.parseResponse<CreateGameResponse>(response);
  }

  /**
   * Get game state via HTTP (useful when not using WebSocket).
   */
  async getGameState(gameId: string, playerSeat?: number): Promise<{
    flowState: FlowState;
    state: PlayerState;
  }> {
    const url = playerSeat !== undefined
      ? `/games/${gameId}?player=${playerSeat}`
      : `/games/${gameId}`;

    const response = await this.fetch(url);
    const data = await this.parseResponse<{ flowState: FlowState; state: PlayerState }>(response);

    return {
      flowState: data.flowState,
      state: data.state,
    };
  }

  /**
   * Perform an action via HTTP (useful when not using WebSocket).
   */
  async performAction(
    gameId: string,
    action: string,
    player: number,
    args: Record<string, unknown> = {}
  ): Promise<{ flowState: FlowState; state: PlayerState }> {
    const response = await this.fetch(`/games/${gameId}/action`, {
      method: 'POST',
      body: JSON.stringify({ action, player, args }),
    });

    const data = await this.parseResponse<{ flowState: FlowState; state: PlayerState }>(response);

    return {
      flowState: data.flowState,
      state: data.state,
    };
  }

  /**
   * Get action history for a game.
   */
  async getHistory(gameId: string): Promise<{
    actionHistory: unknown[];
    createdAt: number;
  }> {
    const response = await this.fetch(`/games/${gameId}/history`);
    const data = await this.parseResponse<{ actionHistory: unknown[]; createdAt: number }>(
      response
    );

    return {
      actionHistory: data.actionHistory,
      createdAt: data.createdAt,
    };
  }

  /**
   * Restart a game with the same players.
   * Creates a fresh game state while keeping the same game ID and player setup.
   */
  async restartGame(gameId: string): Promise<{ flowState: FlowState; state: PlayerState }> {
    const response = await this.fetch(`/games/${gameId}/restart`, {
      method: 'POST',
    });

    const data = await this.parseResponse<{ flowState: FlowState; state: PlayerState }>(response);

    return {
      flowState: data.flowState,
      state: data.state,
    };
  }

  // ============================================
  // Lobby API
  // ============================================

  /**
   * Get lobby state for a game.
   */
  async getLobby(gameId: string): Promise<LobbyInfo> {
    const response = await this.fetch(`/games/${gameId}/lobby`);
    const data = await this.parseResponse<{ lobby: LobbyInfo }>(response);

    return data.lobby;
  }

  /**
   * Claim a seat in the game lobby.
   */
  async claimSeat(gameId: string, seat: number, name: string): Promise<ClaimSeatResponse> {
    const response = await this.fetch(`/games/${gameId}/claim-seat`, {
      method: 'POST',
      body: JSON.stringify({
        seat,
        name,
        playerId: this.playerId,
      }),
    });

    return await this.parseResponse<ClaimSeatResponse>(response);
  }

  /**
   * Join the game lobby. The server assigns the first available seat.
   */
  async joinLobby(gameId: string, name: string): Promise<JoinLobbyResponse> {
    const response = await this.fetch(`/games/${gameId}/join-lobby`, {
      method: 'POST',
      body: JSON.stringify({
        name,
        playerId: this.playerId,
      }),
    });

    return await this.parseResponse<JoinLobbyResponse>(response);
  }

  /**
   * Update player name in lobby.
   */
  async updateLobbyName(gameId: string, name: string): Promise<void> {
    const response = await this.fetch(`/games/${gameId}/update-name`, {
      method: 'POST',
      body: JSON.stringify({
        playerId: this.playerId,
        name,
      }),
    });

    await this.parseResponse<{ success: true }>(response);
  }

  /**
   * Set ready state in lobby.
   */
  async setReady(gameId: string, ready: boolean): Promise<LobbyResponse> {
    const response = await this.fetch(`/games/${gameId}/set-ready`, {
      method: 'POST',
      body: JSON.stringify({
        playerId: this.playerId,
        ready,
      }),
    });

    return await this.parseResponse<LobbyResponse>(response);
  }

  /**
   * Add a player slot (host only).
   */
  async addSlot(gameId: string): Promise<LobbyResponse> {
    const response = await this.fetch(`/games/${gameId}/add-slot`, {
      method: 'POST',
      body: JSON.stringify({
        playerId: this.playerId,
      }),
    });

    return await this.parseResponse<LobbyResponse>(response);
  }

  /**
   * Remove a player slot (host only).
   */
  async removeSlot(gameId: string, seat: number): Promise<LobbyResponse> {
    const response = await this.fetch(`/games/${gameId}/remove-slot`, {
      method: 'POST',
      body: JSON.stringify({
        playerId: this.playerId,
        seat,
      }),
    });

    return await this.parseResponse<LobbyResponse>(response);
  }

  /**
   * Toggle slot between open and AI (host only).
   */
  async setSlotAI(gameId: string, seat: number, isAI: boolean, aiLevel?: string): Promise<LobbyResponse> {
    const response = await this.fetch(`/games/${gameId}/set-slot-ai`, {
      method: 'POST',
      body: JSON.stringify({
        playerId: this.playerId,
        seat,
        isAI,
        aiLevel,
      }),
    });

    return await this.parseResponse<LobbyResponse>(response);
  }

  /**
   * Leave/unclaim position in lobby (for non-hosts).
   */
  async leavePosition(gameId: string): Promise<LobbyResponse> {
    const response = await this.fetch(`/games/${gameId}/leave-position`, {
      method: 'POST',
      body: JSON.stringify({
        playerId: this.playerId,
      }),
    });

    return await this.parseResponse<LobbyResponse>(response);
  }

  /**
   * Kick a player from the lobby (host only).
   */
  async kickPlayer(gameId: string, seat: number): Promise<LobbyResponse> {
    const response = await this.fetch(`/games/${gameId}/kick-player`, {
      method: 'POST',
      body: JSON.stringify({
        playerId: this.playerId,
        seat,
      }),
    });

    return await this.parseResponse<LobbyResponse>(response);
  }

  /**
   * Update player options (color, role, etc.) in lobby.
   */
  async updatePlayerOptions(gameId: string, options: Record<string, unknown>): Promise<LobbyResponse> {
    const response = await this.fetch(`/games/${gameId}/player-options`, {
      method: 'POST',
      body: JSON.stringify({
        playerId: this.playerId,
        options,
      }),
    });

    return await this.parseResponse<LobbyResponse>(response);
  }

  /**
   * Update a specific slot's player options (host only).
   * Used for exclusive options that the host assigns to players.
   */
  async updateSlotPlayerOptions(gameId: string, seat: number, options: Record<string, unknown>): Promise<LobbyResponse> {
    const response = await this.fetch(`/games/${gameId}/slot-player-options`, {
      method: 'POST',
      body: JSON.stringify({
        playerId: this.playerId,
        seat,
        options,
      }),
    });

    return await this.parseResponse<LobbyResponse>(response);
  }

  /**
   * Update game options (host only).
   */
  async updateGameOptions(gameId: string, options: Record<string, unknown>): Promise<LobbyResponse> {
    const response = await this.fetch(`/games/${gameId}/game-options`, {
      method: 'POST',
      body: JSON.stringify({
        playerId: this.playerId,
        options,
      }),
    });

    return await this.parseResponse<LobbyResponse>(response);
  }

  /**
   * Health check.
   */
  async health(): Promise<{ status: string; environment: string }> {
    const response = await this.fetch('/health');
    return await response.json();
  }

  // ============================================
  // Player ID Management
  // ============================================

  /**
   * Get the current player ID.
   */
  getPlayerId(): string {
    return this.playerId;
  }

  /**
   * Set a custom player ID (useful for persistence).
   */
  setPlayerId(playerId: string): void {
    this.playerId = playerId;
  }

  // ============================================
  // Private Helpers
  // ============================================

  /**
   * The ONE shared throw-vs-return chokepoint for every `{success}`-shaped
   * HTTP response. Checks `response.ok` first so a non-2xx non-JSON body
   * (e.g. an infrastructure-layer 502) produces an actionable `HTTP {status}`
   * error instead of an unrelated `SyntaxError` from `.json()`. On a 2xx
   * response with `data.success === false`, throws a `MeepleClientError`
   * carrying the server `error` message and an OPTIONAL `errorCode` (never
   * fabricated client-side — see F25 scope boundary). `health()` is
   * deliberately NOT routed through this helper — it has no `{success}`
   * field, it's a pure status probe.
   */
  private async parseResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText || 'Request failed'}`);
    }

    const data = await response.json();

    if (data && data.success === false) {
      throw new MeepleClientError(data.error || 'Request failed', data.errorCode);
    }

    return data as T;
  }

  private async fetch(path: string, options: RequestInit = {}): Promise<Response> {
    const url = path.startsWith('http') ? path : `${this.config.baseUrl}${path}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        signal: controller.signal,
      });

      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  private generatePlayerId(): string {
    // The playerId is the per-seat capability/identity proof (see types/protocol.ts),
    // so it MUST be cryptographically unguessable — never Math.random().
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }

    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    }

    throw new Error(
      'No cryptographically secure RNG available to mint a playerId. ' +
        'Provide an explicit playerId in MeepleClientConfig, or run in an environment ' +
        'with the Web Crypto API (modern browser or Node 19+).'
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
