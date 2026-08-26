/**
 * bot controller for managing bot player moves
 */

import { dueSeats, canSeatAct, type Game, type SerializedAction } from '../engine/index.js';
import type { GameRunner } from '../runtime/index.js';
import { createBot, parseBotLevel } from '../bot/index.js';
import type { BotStrategy } from '../bot/index.js';
import type { GameClass, BotSeatConfig } from './types.js';

/**
 * Controller for bot player moves
 *
 * Manages which players are bot-controlled and handles their turn execution.
 * Works with both turn-based and simultaneous action flows.
 */
export class BotController<G extends Game = Game> {
  readonly #botPlayers: Set<number>;
  readonly #botLevel: string;
  readonly #GameClass: GameClass<G>;
  readonly #gameType: string;
  readonly #botStrategy?: BotStrategy;
  #thinking = false;

  constructor(
    GameClass: GameClass<G>,
    gameType: string,
    playerCount: number,
    config: BotSeatConfig,
    botStrategy?: BotStrategy
  ) {
    this.#GameClass = GameClass;
    this.#gameType = gameType;
    this.#botLevel = config.level;
    this.#botPlayers = new Set(
      config.players.filter(p => p >= 1 && p <= playerCount)  // 1-indexed positions
    );
    this.#botStrategy = botStrategy;
  }

  /**
   * Check if any bot players are configured
   */
  hasBotPlayers(): boolean {
    return this.#botPlayers.size > 0;
  }

  /**
   * Check if a specific player is bot-controlled
   */
  isBotPlayer(playerIndex: number): boolean {
    return this.#botPlayers.has(playerIndex);
  }

  /**
   * Check if the bot is currently thinking
   */
  isThinking(): boolean {
    return this.#thinking;
  }

  /**
   * Check if a bot player should act and make a move if so.
   *
   * @param runner - The game runner
   * @param actionHistory - History of actions for MCTS
   * @param onMove - Callback to execute the move (should return true if successful)
   * @returns The move made, or null if no bot action was taken
   */
  async checkAndPlay(
    runner: GameRunner<G>,
    actionHistory: SerializedAction[],
    onMove: (action: string, player: number, args: Record<string, unknown>) => Promise<boolean>,
    onBeforeMove?: (action: string, player: number, args: Record<string, unknown>) => Promise<void>
  ): Promise<{ action: string; player: number; args: Record<string, unknown> } | null> {
    // Prevent concurrent bot thinking
    if (this.#thinking) {
      return null;
    }

    const flowState = runner.getFlowState();

    if (!flowState?.awaitingInput || flowState.complete) {
      return null;
    }

    // Find which bot player should act. dueSeats() handles both simultaneous
    // and sequential steps, so we just pick the first due seat that is a bot.
    const botPlayer = dueSeats(flowState).find(seat => this.#botPlayers.has(seat));

    // No bot player needs to act
    if (botPlayer === undefined) {
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
      if (!canSeatAct(currentFlowState, botPlayer)) {
        // Turn changed during the delay - skip this bot check
        return null;
      }

      // Create bot for this player
      const difficulty = parseBotLevel(this.#botLevel);
      const bot = createBot(
        runner.game,
        this.#GameClass,
        this.#gameType,
        botPlayer,
        actionHistory,
        difficulty,
        this.#botStrategy
      );

      // Get the bot's move. `null` means this seat has nothing it can search
      // from its own information state (#29) — a stall for this seat, not an
      // error for the table. Report it and leave the seat unmoved.
      const move = await bot.play();
      if (!move) {
        console.warn(`[BoardSmith] Bot for seat ${botPlayer} did not move: ${bot.lastStallReason}`);
        return null;
      }

      // Announce the move before it executes (optional narration seam)
      if (onBeforeMove) await onBeforeMove(move.action, botPlayer, move.args);

      // Execute the move via callback
      const success = await onMove(move.action, botPlayer, move.args);

      if (success) {
        return { action: move.action, player: botPlayer, args: move.args };
      }
    } catch (error) {
      console.error(`bot error for player ${botPlayer}:`, error);
      throw error;
    } finally {
      this.#thinking = false;
    }

    return null;
  }
}
