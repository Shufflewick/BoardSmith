/**
 * CheckpointManager - Auto-checkpoint management for HMR recovery.
 *
 * Creates periodic checkpoints during gameplay so that when HMR fails,
 * recovery can restore from the nearest checkpoint and replay only
 * recent actions instead of all actions from the beginning.
 *
 * Dev-only: checkpoints are kept in memory, not persisted.
 */

import type { Game, DevCheckpoint } from '../engine/index.js';
import { createCheckpoint } from '../engine/index.js';

/**
 * Options for creating a CheckpointManager.
 */
export interface CheckpointManagerOptions {
  /**
   * How often to create checkpoints (every N actions).
   * Default: 10 actions.
   */
  interval?: number;

  /**
   * Maximum number of checkpoints to keep (rolling window).
   * Older checkpoints are pruned when this limit is exceeded.
   * Default: 5 checkpoints.
   */
  maxCheckpoints?: number;
}

/**
 * CheckpointManager handles automatic checkpoint creation and retrieval
 * for fast HMR recovery in development.
 *
 * When HMR fails and dev state transfer cannot restore the game,
 * the CheckpointManager provides the nearest checkpoint so that only
 * a subset of actions need to be replayed instead of all actions.
 *
 * @example
 * ```typescript
 * const manager = new CheckpointManager({ interval: 10, maxCheckpoints: 5 });
 *
 * // After each action
 * if (manager.shouldCheckpoint(actionIndex)) {
 *   manager.capture(game, actionIndex);
 * }
 *
 * // During HMR fallback
 * const checkpoint = manager.findNearest(currentActionIndex);
 * if (checkpoint) {
 *   // Restore from checkpoint and replay only remaining actions
 * }
 * ```
 */
export class CheckpointManager<G extends Game = Game> {
  /** Checkpoints stored in memory, keyed by action index */
  #checkpoints: Map<number, DevCheckpoint> = new Map();

  /** How often to create checkpoints (every N actions) */
  #interval: number;

  /** Maximum number of checkpoints to keep (rolling window) */
  #maxCheckpoints: number;

  constructor(options?: CheckpointManagerOptions) {
    this.#interval = options?.interval ?? 10;
    this.#maxCheckpoints = options?.maxCheckpoints ?? 5;
  }

  /**
   * Check if a checkpoint should be created at this action index.
   * Called after each action completes.
   *
   * @param actionIndex - The current action index (1-indexed, after action completes)
   * @returns true if a checkpoint should be created
   */
  shouldCheckpoint(actionIndex: number): boolean {
    // Don't checkpoint at 0 or negative
    if (actionIndex <= 0) return false;
    // Checkpoint at intervals
    return actionIndex % this.#interval === 0;
  }

  /**
   * Create and store a checkpoint.
   *
   * @param game - The game instance to checkpoint
   * @param actionIndex - The action index at which this checkpoint is taken
   */
  capture(game: G, actionIndex: number): void {
    const checkpoint = createCheckpoint(game, actionIndex);
    this.#checkpoints.set(actionIndex, checkpoint);

    // Prune old checkpoints if over limit
    this.#pruneOldCheckpoints();

    console.log(`[HMR] Checkpoint saved at action ${actionIndex}`);
  }

  /**
   * Find the nearest checkpoint at or before the given action index.
   * Returns undefined if no suitable checkpoint exists.
   *
   * @param targetActionIndex - The action index to find a checkpoint for
   * @returns The nearest checkpoint, or undefined if none exists
   */
  findNearest(targetActionIndex: number): DevCheckpoint | undefined {
    let best: DevCheckpoint | undefined;
    let bestIndex = -1;

    for (const [index, checkpoint] of this.#checkpoints) {
      if (index <= targetActionIndex && index > bestIndex) {
        best = checkpoint;
        bestIndex = index;
      }
    }

    return best;
  }

  /**
   * Clear all checkpoints.
   * Use this after operations that invalidate all checkpoints (e.g., full game reset).
   */
  clear(): void {
    this.#checkpoints.clear();
  }

  /**
   * Clear checkpoints after a certain action index.
   * Use this after undo/rewind operations that invalidate future state.
   *
   * @param actionIndex - Clear all checkpoints after this index
   */
  clearAfter(actionIndex: number): void {
    for (const [index] of this.#checkpoints) {
      if (index > actionIndex) {
        this.#checkpoints.delete(index);
      }
    }
  }

  /**
   * Get the number of stored checkpoints (for testing).
   */
  get size(): number {
    return this.#checkpoints.size;
  }

  /**
   * Get the configured checkpoint interval (for testing).
   */
  get interval(): number {
    return this.#interval;
  }

  /**
   * Remove oldest checkpoints if over limit.
   */
  #pruneOldCheckpoints(): void {
    if (this.#checkpoints.size <= this.#maxCheckpoints) return;

    const sorted = [...this.#checkpoints.keys()].sort((a, b) => a - b);
    const toRemove = sorted.slice(0, sorted.length - this.#maxCheckpoints);

    for (const index of toRemove) {
      this.#checkpoints.delete(index);
    }
  }
}
