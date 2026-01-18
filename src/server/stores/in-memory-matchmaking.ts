/**
 * In-memory matchmaking store for local development
 */

import type { MatchmakingStore, QueueEntry, MatchInfo, WaitingInfo } from '../types.js';

/**
 * Entry with expiration timestamp
 */
interface ExpiringEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * In-memory matchmaking store for local development.
 * Stores queues, matches, and waiting info in Maps with optional TTL.
 */
export class InMemoryMatchmakingStore implements MatchmakingStore {
  readonly #queues: Map<string, QueueEntry[]> = new Map();
  readonly #matches: Map<string, ExpiringEntry<MatchInfo>> = new Map();
  readonly #waiting: Map<string, ExpiringEntry<WaitingInfo>> = new Map();

  /**
   * Generate queue key from game type and player count
   */
  #queueKey(gameType: string, playerCount: number): string {
    return `queue:${gameType}:${playerCount}`;
  }

  /**
   * Check if an entry has expired
   */
  #isExpired(entry: ExpiringEntry<unknown>): boolean {
    return entry.expiresAt !== 0 && Date.now() > entry.expiresAt;
  }

  async getQueue(gameType: string, playerCount: number): Promise<QueueEntry[]> {
    const key = this.#queueKey(gameType, playerCount);
    return this.#queues.get(key) ?? [];
  }

  async setQueue(gameType: string, playerCount: number, entries: QueueEntry[]): Promise<void> {
    const key = this.#queueKey(gameType, playerCount);
    this.#queues.set(key, entries);
  }

  async getMatch(playerId: string): Promise<MatchInfo | null> {
    const entry = this.#matches.get(playerId);
    if (!entry) return null;
    if (this.#isExpired(entry)) {
      this.#matches.delete(playerId);
      return null;
    }
    return entry.value;
  }

  async setMatch(playerId: string, match: MatchInfo, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0;
    this.#matches.set(playerId, { value: match, expiresAt });
  }

  async deleteMatch(playerId: string): Promise<void> {
    this.#matches.delete(playerId);
  }

  async getWaiting(playerId: string): Promise<WaitingInfo | null> {
    const entry = this.#waiting.get(playerId);
    if (!entry) return null;
    if (this.#isExpired(entry)) {
      this.#waiting.delete(playerId);
      return null;
    }
    return entry.value;
  }

  async setWaiting(playerId: string, info: WaitingInfo, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0;
    this.#waiting.set(playerId, { value: info, expiresAt });
  }

  async deleteWaiting(playerId: string): Promise<void> {
    this.#waiting.delete(playerId);
  }

  /**
   * Clean up expired entries (call periodically)
   */
  cleanup(): void {
    for (const [key, entry] of this.#matches) {
      if (this.#isExpired(entry)) {
        this.#matches.delete(key);
      }
    }
    for (const [key, entry] of this.#waiting) {
      if (this.#isExpired(entry)) {
        this.#waiting.delete(key);
      }
    }
  }
}
