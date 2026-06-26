/**
 * AI controller for managing AI player moves
 */

import { dueSeats, canSeatAct, type Game, type SerializedAction } from '../engine/index.js';
import type { GameRunner } from '../runtime/index.js';
import { createBot, parseAILevel } from '../ai/index.js';
import type { AIConfig as BotAIConfig } from '../ai/index.js';
import type { GameClass, AIConfig } from './types.js';

/**
 * Controller for AI player moves
 *
 * Manages which players are AI-controlled and handles their turn execution.
 * Works with both turn-based and simultaneous action flows.
 */
export class AIController<G extends Game = Game> {
  readonly #aiPlayers: Set<number>;
  readonly #aiLevel: string;
  readonly #GameClass: GameClass<G>;
  readonly #gameType: string;
  readonly #botAIConfig?: BotAIConfig;
  #thinking = false;

  constructor(
    GameClass: GameClass<G>,
    gameType: string,
    playerCount: number,
    config: AIConfig,
    botAIConfig?: BotAIConfig
  ) {
    this.#GameClass = GameClass;
    this.#gameType = gameType;
    this.#aiLevel = config.level;
    this.#aiPlayers = new Set(
      config.players.filter(p => p >= 1 && p <= playerCount)  // 1-indexed positions
    );
    this.#botAIConfig = botAIConfig;
  }

  /**
   * Check if any AI players are configured
   */
  hasAIPlayers(): boolean {
    return this.#aiPlayers.size > 0;
  }

  /**
   * Check if a specific player is AI-controlled
   */
  isAIPlayer(playerIndex: number): boolean {
    return this.#aiPlayers.has(playerIndex);
  }

  /**
   * Check if the AI is currently thinking
   */
  isThinking(): boolean {
    return this.#thinking;
  }

  /**
   * Check if an AI player should act and make a move if so.
   *
   * @param runner - The game runner
   * @param actionHistory - History of actions for MCTS
   * @param onMove - Callback to execute the move (should return true if successful)
   * @returns The move made, or null if no AI action was taken
   */
  async checkAndPlay(
    runner: GameRunner<G>,
    actionHistory: SerializedAction[],
    onMove: (action: string, player: number, args: Record<string, unknown>) => Promise<boolean>,
    onBeforeMove?: (action: string, player: number, args: Record<string, unknown>) => Promise<void>
  ): Promise<{ action: string; player: number; args: Record<string, unknown> } | null> {
    // Prevent concurrent AI thinking
    if (this.#thinking) {
      return null;
    }

    const flowState = runner.getFlowState();

    if (!flowState?.awaitingInput || flowState.complete) {
      return null;
    }

    // Find which AI player should act. dueSeats() handles both simultaneous
    // and sequential steps, so we just pick the first due seat that is an AI.
    const aiPlayer = dueSeats(flowState).find(seat => this.#aiPlayers.has(seat));

    // No AI player needs to act
    if (aiPlayer === undefined) {
      return null;
    }

    this.#thinking = true;

    try {
      // Small delay so humans can see the state change
      await new Promise(resolve => setTimeout(resolve, 300));

      // Re-validate that it's still this player's turn after the delay
      // (another action might have changed the game state)
      const currentFlowState = runner.getFlowState();

      if (!currentFlowState?.awaitingInput || currentFlowState.complete) {
        return null;
      }

      // Check if the acting seat is still due after the delay
      if (!canSeatAct(currentFlowState, aiPlayer)) {
        // Turn changed during the delay - skip this AI check
        return null;
      }

      // Create bot for this player
      const difficulty = parseAILevel(this.#aiLevel);
      const bot = createBot(
        runner.game,
        this.#GameClass,
        this.#gameType,
        aiPlayer,
        actionHistory,
        difficulty,
        this.#botAIConfig
      );

      // Get the AI's move
      const move = await bot.play();

      // Announce the move before it executes (optional narration seam)
      if (onBeforeMove) await onBeforeMove(move.action, aiPlayer, move.args);

      // Execute the move via callback
      const success = await onMove(move.action, aiPlayer, move.args);

      if (success) {
        return { action: move.action, player: aiPlayer, args: move.args };
      }
    } catch (error) {
      console.error(`AI error for player ${aiPlayer}:`, error);
      throw error;
    } finally {
      this.#thinking = false;
    }

    return null;
  }
}
