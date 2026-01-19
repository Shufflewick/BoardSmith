/**
 * In-memory game store for local development
 */

import { GameSession, type BroadcastAdapter, type GameDefinition, type SessionInfo } from '../../session/index.js';
import type { GameStore, GameRegistry, CreateGameOptions } from '../types.js';

// ============================================
// Simple Game Registry Implementation
// ============================================

/**
 * Simple in-memory game registry
 */
export class SimpleGameRegistry implements GameRegistry {
  readonly #definitions: Map<string, GameDefinition> = new Map();

  constructor(definitions?: GameDefinition[]) {
    if (definitions) {
      for (const def of definitions) {
        this.set(def);
      }
    }
  }

  get(gameType: string): GameDefinition | undefined {
    return this.#definitions.get(gameType);
  }

  getAll(): GameDefinition[] {
    return [...this.#definitions.values()];
  }

  set(definition: GameDefinition): void {
    this.#definitions.set(definition.gameType, definition);
  }
}

// ============================================
// In-Memory Game Store
// ============================================

/**
 * Session wrapper that includes broadcaster
 */
export interface GameSessionWithBroadcaster<TSession extends SessionInfo = SessionInfo> {
  session: GameSession;
  broadcaster: BroadcastAdapter<TSession>;
}

/**
 * Factory function to create a broadcaster for a new game
 */
export type BroadcasterFactory<TSession extends SessionInfo = SessionInfo> = () => BroadcastAdapter<TSession>;

/**
 * In-memory game store for local development.
 * Stores games in a Map, with optional broadcaster factory.
 */
export class InMemoryGameStore<TSession extends SessionInfo = SessionInfo> implements GameStore {
  readonly #games: Map<string, GameSessionWithBroadcaster<TSession>> = new Map();
  readonly #registry: GameRegistry;
  readonly #broadcasterFactory: BroadcasterFactory<TSession>;

  constructor(
    registry: GameRegistry,
    broadcasterFactory: BroadcasterFactory<TSession>
  ) {
    this.#registry = registry;
    this.#broadcasterFactory = broadcasterFactory;
  }

  async getGame(gameId: string): Promise<GameSession | null> {
    const data = this.#games.get(gameId);
    return data?.session ?? null;
  }

  async createGame(gameId: string, options: CreateGameOptions): Promise<GameSession> {
    const definition = this.#registry.get(options.gameType);
    if (!definition) {
      throw new Error(`Unknown game type: ${options.gameType}`);
    }

    const session = GameSession.create({
      gameType: options.gameType,
      GameClass: definition.gameClass,
      playerCount: options.playerCount,
      playerNames: options.playerNames ?? Array.from({ length: options.playerCount }, (_, i) => `Player ${i + 1}`),
      playerIds: options.playerIds,
      seed: options.seed,
      aiConfig: options.aiConfig,
      gameOptions: options.gameOptions,
      // Lobby options
      displayName: options.displayName ?? definition.displayName,
      playerConfigs: options.playerConfigs,
      creatorId: options.creatorId,
      useLobby: options.useLobby,
      // Pass player options definitions for initializing defaults on claim
      playerOptionsDefinitions: definition.playerOptions,
      // Pass game options definitions for host to modify in lobby
      gameOptionsDefinitions: definition.gameOptions,
      // Pass AI config (objectives and threat response) from game definition
      botAIConfig: definition.ai,
    });

    // Create and attach broadcaster
    const broadcaster = this.#broadcasterFactory();
    session.setBroadcaster(broadcaster);

    this.#games.set(gameId, { session, broadcaster });

    return session;
  }

  async deleteGame(gameId: string): Promise<void> {
    this.#games.delete(gameId);
  }

  /**
   * Get the broadcaster for a game (for adding WebSocket sessions)
   */
  getBroadcaster(gameId: string): BroadcastAdapter<TSession> | undefined {
    return this.#games.get(gameId)?.broadcaster;
  }

  /**
   * Update the game registry (for hot reloading)
   * Auto-reloads active games with the new definition
   */
  updateRegistry(definition: GameDefinition): void {
    this.#registry.set(definition);

    // Auto-reload active games with new definition
    for (const [gameId, gameData] of this.#games.entries()) {
      if (gameData.session.gameType === definition.gameType) {
        try {
          gameData.session.reloadWithCurrentRules(definition);
          console.log(`  Game ${gameId} reloaded with new rules`);
        } catch (err) {
          console.error(`  Game ${gameId} failed to reload:`, err);
        }
      }
    }
  }
}
