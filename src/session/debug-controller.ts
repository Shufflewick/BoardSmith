/**
 * DebugController class for debug deck manipulation commands.
 *
 * Encapsulates:
 * - executeDebugCommand(): Execute arbitrary debug commands
 * - moveCardToTop(): Move a card to top of its deck
 * - reorderCard(): Move a card to specific position
 * - transferCard(): Transfer a card to different deck
 * - shuffleDeck(): Shuffle a deck
 *
 * NOTE: These changes are NOT persisted to action history.
 * They are intended for debug/development use only.
 */

import type { Game, GameCommand } from '../engine/index.js';
import { executeCommand } from '../engine/index.js';
import type { GameRunner } from '../runtime/index.js';

// ============================================
// Types
// ============================================

/**
 * Callbacks for DebugController to interact with GameSession
 */
export interface DebugControllerCallbacks {
  /** Broadcast state to all clients */
  broadcast: () => void;
}

// ============================================
// DebugController Class
// ============================================

/**
 * Manages debug deck manipulation commands.
 */
export class DebugController<G extends Game = Game> {
  #getRunner: () => GameRunner<G>;
  #callbacks: DebugControllerCallbacks;

  constructor(
    getRunner: () => GameRunner<G>,
    callbacks: DebugControllerCallbacks
  ) {
    this.#getRunner = getRunner;
    this.#callbacks = callbacks;
  }

  /**
   * Execute a debug command against the game state.
   * Used for deck manipulation and other debug operations.
   * NOTE: These changes are NOT persisted to action history.
   *
   * @param command The command to execute
   * @returns Result with success status and error message if failed
   */
  executeDebugCommand(command: GameCommand): { success: boolean; error?: string } {
    const result = executeCommand(this.#getRunner().game, command);
    if (result.success) {
      // Broadcast the updated state to all clients
      this.#callbacks.broadcast();
    }
    return result;
  }

  /**
   * Move a card to the top of its current deck (debug only).
   * The card remains in the same parent but is moved to position 0.
   *
   * @param cardId ID of the card to move
   * @returns Result with success status
   */
  moveCardToTop(cardId: number): { success: boolean; error?: string } {
    return this.executeDebugCommand({
      type: 'REORDER_CHILD',
      elementId: cardId,
      targetIndex: 0,
    });
  }

  /**
   * Move a card to a specific position within its current deck (debug only).
   *
   * @param cardId ID of the card to move
   * @param targetIndex Target position (0-based)
   * @returns Result with success status
   */
  reorderCard(cardId: number, targetIndex: number): { success: boolean; error?: string } {
    return this.executeDebugCommand({
      type: 'REORDER_CHILD',
      elementId: cardId,
      targetIndex,
    });
  }

  /**
   * Transfer a card to a different deck (debug only).
   *
   * @param cardId ID of the card to transfer
   * @param targetDeckId ID of the destination deck
   * @param position Where to place the card in the destination ('first' or 'last')
   * @returns Result with success status
   */
  transferCard(cardId: number, targetDeckId: number, position: 'first' | 'last' = 'first'): { success: boolean; error?: string } {
    return this.executeDebugCommand({
      type: 'MOVE',
      elementId: cardId,
      destinationId: targetDeckId,
      position,
    });
  }

  /**
   * Shuffle a deck (debug only).
   *
   * @param deckId ID of the deck to shuffle
   * @returns Result with success status
   */
  shuffleDeck(deckId: number): { success: boolean; error?: string } {
    return this.executeDebugCommand({
      type: 'SHUFFLE',
      spaceId: deckId,
    });
  }
}
