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
} from './types.js';

export class MeepleClient {
  private config: Required<MeepleClientConfig>;
  private playerId: string;

  constructor(config: MeepleClientConfig) {
    this.config = {
      baseUrl: config.baseUrl.replace(/\/$/, ''), // Remove trailing slash
      autoReconnect: config.autoReconnect ?? true,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 5,
      reconnectDelay: config.reconnectDelay ?? 1000,
      requestTimeout: config.requestTimeout ?? 10000,
    };

    // Generate a unique player ID for this client
    this.playerId = this.generatePlayerId();
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

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to join matchmaking');
    }

    return {
      matched: data.matched,
      gameId: data.gameId,
      playerPosition: data.playerPosition,
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
    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to get match status');
    }

    return {
      status: data.status,
      gameType: data.gameType,
      playerCount: data.playerCount,
      gameId: data.gameId,
      playerPosition: data.playerPosition,
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

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to leave matchmaking');
    }
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
          playerPosition: status.playerPosition,
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
      playerPosition: options?.playerPosition,
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
      playerPosition: matchResult.playerPosition,
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

    return await response.json();
  }

  /**
   * Get game state via HTTP (useful when not using WebSocket).
   */
  async getGameState(gameId: string, playerPosition?: number): Promise<{
    flowState: FlowState;
    state: PlayerState;
  }> {
    const url = playerPosition !== undefined
      ? `/games/${gameId}?player=${playerPosition}`
      : `/games/${gameId}`;

    const response = await this.fetch(url);
    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to get game state');
    }

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

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Action failed');
    }

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
    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to get history');
    }

    return {
      actionHistory: data.actionHistory,
      createdAt: data.createdAt,
    };
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
    // Generate a random ID with timestamp prefix for uniqueness
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    return `${timestamp}-${random}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
