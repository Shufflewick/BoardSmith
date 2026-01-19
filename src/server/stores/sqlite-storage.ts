/**
 * SQLite storage adapter for game persistence
 */

import type Database from 'better-sqlite3';
import type { StorageAdapter, StoredGameState } from '../../session/index.js';

/**
 * SQLite storage adapter that persists game state to a SQLite database.
 * Each game has its own adapter instance that manages its row.
 */
export class SqliteStorageAdapter implements StorageAdapter {
  readonly #db: Database.Database;
  readonly #gameId: string;
  readonly #saveStmt: Database.Statement;
  readonly #loadStmt: Database.Statement;

  constructor(db: Database.Database, gameId: string) {
    this.#db = db;
    this.#gameId = gameId;

    // Prepare statements for performance
    this.#saveStmt = this.#db.prepare(`
      INSERT OR REPLACE INTO games (game_id, state_json, updated_at)
      VALUES (?, ?, ?)
    `);

    this.#loadStmt = this.#db.prepare(`
      SELECT state_json FROM games WHERE game_id = ?
    `);
  }

  async save(state: StoredGameState): Promise<void> {
    this.#saveStmt.run(this.#gameId, JSON.stringify(state), Date.now());
  }

  async load(): Promise<StoredGameState | null> {
    const row = this.#loadStmt.get(this.#gameId) as { state_json: string } | undefined;
    if (!row) return null;

    try {
      return JSON.parse(row.state_json);
    } catch (e) {
      console.error(`Failed to parse game state for ${this.#gameId}:`, e);
      return null;
    }
  }
}

/**
 * Initialize the SQLite database schema for game storage.
 * Creates the games table if it doesn't exist.
 */
export function initSqliteSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      game_id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Create index on updated_at for listing games by recency
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_games_updated_at ON games (updated_at DESC)
  `);
}
