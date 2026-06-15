/**
 * Server-layer error types.
 */

/**
 * Thrown by a {@link GameStore} when it refuses to create a new game because it
 * is already holding its maximum number of concurrent games.
 *
 * This is the guard against unbounded memory growth: without a cap, any client
 * can spam `POST /games` and exhaust server memory (the in-memory store keeps
 * every game in a Map forever). Handlers translate this into an actionable
 * 503 response rather than leaking it as an opaque 500.
 */
export class GameStoreCapacityError extends Error {
  /** Number of games the store is configured to hold at most. */
  readonly maxGames: number;

  constructor(maxGames: number) {
    super(
      `Server is at capacity (${maxGames} concurrent games). ` +
        `Delete finished games before creating new ones, or raise the store's maxGames limit.`
    );
    this.name = 'GameStoreCapacityError';
    this.maxGames = maxGames;
  }
}
