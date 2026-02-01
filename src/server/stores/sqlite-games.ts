/**
 * SQLite-backed game store for persistent game storage
 */

import Database from 'better-sqlite3';
import { GameSession, type BroadcastAdapter, type GameDefinition, type SessionInfo } from '../../session/index.js';
import type { GameStore, GameRegistry, CreateGameOptions } from '../types.js';
import { SqliteStorageAdapter, initSqliteSchema } from './sqlite-storage.js';

// ============================================
// SQLite Game Store
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
 * SQLite-backed game store for persistent game storage.
 * Games survive server restarts and are reloaded with current rules.
 */
export class SqliteGameStore<TSession extends SessionInfo = SessionInfo> implements GameStore {
  readonly #db: Database.Database;
  readonly #registry: GameRegistry;
  readonly #broadcasterFactory: BroadcasterFactory<TSession>;
  /** In-memory cache of active sessions (restored on demand) */
  readonly #games: Map<string, GameSessionWithBroadcaster<TSession>> = new Map();

  constructor(
    dbPath: string,
    registry: GameRegistry,
    broadcasterFactory: BroadcasterFactory<TSession>
  ) {
    this.#db = new Database(dbPath);
    this.#registry = registry;
    this.#broadcasterFactory = broadcasterFactory;

    // Initialize database schema
    initSqliteSchema(this.#db);
  }

  async getGame(gameId: string): Promise<GameSession | null> {
    // Check in-memory cache first
    const cached = this.#games.get(gameId);
    if (cached) {
      return cached.session;
    }

    // Try to load from SQLite
    const storage = new SqliteStorageAdapter(this.#db, gameId);
    const storedState = await storage.load();
    if (!storedState) {
      return null;
    }

    // Get current game definition (uses latest rules!)
    const definition = this.#registry.get(storedState.gameType);
    if (!definition) {
      console.error(`Cannot restore game ${gameId}: unknown game type ${storedState.gameType}`);
      return null;
    }

    // Restore the game with current rules
    let session: GameSession;
    try {
      session = GameSession.restore(
        storedState,
        definition.gameClass,
        storage,
        definition.ai
      );
    } catch (err) {
      // Game can't be restored (likely due to rule changes)
      console.error(`  Failed to restore game ${gameId}: ${err instanceof Error ? err.message : err}`);
      console.error(`  This game may be incompatible with current rules. Removing from database.`);
      // Delete the invalid game from database
      const deleteStmt = this.#db.prepare('DELETE FROM games WHERE game_id = ?');
      deleteStmt.run(gameId);
      return null;
    }

    // Create and attach broadcaster
    const broadcaster = this.#broadcasterFactory();
    session.setBroadcaster(broadcaster);

    // Cache in memory
    this.#games.set(gameId, { session, broadcaster });

    console.log(`  Restored game ${gameId} from SQLite (using current rules)`);

    return session;
  }

  async createGame(gameId: string, options: CreateGameOptions): Promise<GameSession> {
    const definition = this.#registry.get(options.gameType);
    if (!definition) {
      throw new Error(`Unknown game type: ${options.gameType}`);
    }

    // Create storage adapter for this game
    const storage = new SqliteStorageAdapter(this.#db, gameId);

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
      // SQLite storage for persistence
      storage,
      // Pass AI config (objectives and threat response) from game definition
      botAIConfig: definition.ai,
      // Pass player count limits for lobby slot management
      minPlayers: definition.minPlayers,
      maxPlayers: definition.maxPlayers,
    });

    // Create and attach broadcaster
    const broadcaster = this.#broadcasterFactory();
    session.setBroadcaster(broadcaster);

    // Cache in memory
    this.#games.set(gameId, { session, broadcaster });

    return session;
  }

  async deleteGame(gameId: string): Promise<void> {
    // Remove from memory cache
    this.#games.delete(gameId);

    // Remove from SQLite
    const stmt = this.#db.prepare('DELETE FROM games WHERE game_id = ?');
    stmt.run(gameId);
  }

  /**
   * Get the broadcaster for a game (for adding WebSocket sessions)
   */
  getBroadcaster(gameId: string): BroadcastAdapter<TSession> | undefined {
    return this.#games.get(gameId)?.broadcaster;
  }

  /**
   * Update the game registry (for hot reloading)
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

  /**
   * List all game IDs in the database, ordered by most recently updated
   */
  listGames(): string[] {
    const stmt = this.#db.prepare('SELECT game_id FROM games ORDER BY updated_at DESC');
    const rows = stmt.all() as Array<{ game_id: string }>;
    return rows.map(row => row.game_id);
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.#db.close();
  }
}
