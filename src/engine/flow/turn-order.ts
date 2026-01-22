import type { Player } from '../player/player.js';
import type { FlowContext } from './types.js';

/**
 * Configuration options for eachPlayer that can be spread into the eachPlayer() call
 */
export interface TurnOrderConfig {
  direction?: 'forward' | 'backward';
  filter?: (player: Player, context: FlowContext) => boolean;
  startingPlayer?: (context: FlowContext) => Player;
}

/**
 * Turn order presets for common patterns.
 * Use by spreading into eachPlayer():
 *
 * @example
 * ```typescript
 * eachPlayer({
 *   ...TurnOrder.DEFAULT,
 *   do: actionStep({ actions: ['play'] })
 * })
 * ```
 *
 * Note: eachPlayer iterates from startingPlayer to the end of the list,
 * it does NOT wrap around. For full round-robin from a specific player,
 * use CONTINUE or manually structure your flow.
 */
export const TurnOrder = {
  /**
   * Standard round-robin from player 0, going forward through all players
   */
  DEFAULT: {
    direction: 'forward' as const,
  } satisfies TurnOrderConfig,

  /**
   * Round-robin going backward (from last player to first)
   */
  REVERSE: {
    direction: 'backward' as const,
  } satisfies TurnOrderConfig,

  /**
   * Continue from the current player to the end of the player list.
   * Note: This goes from current player to end, it doesn't wrap around.
   * For a full round starting from a specific player, structure your
   * flow to handle wrap-around explicitly.
   */
  CONTINUE: {
    direction: 'forward' as const,
    startingPlayer: (ctx: FlowContext) => ctx.game.currentPlayer,
  } satisfies TurnOrderConfig,

  /**
   * Only players who haven't been eliminated (checks player.eliminated if it exists)
   */
  ACTIVE_ONLY: {
    direction: 'forward' as const,
    filter: (player: Player) => !(player as any).eliminated,
  } satisfies TurnOrderConfig,

  /**
   * Start from a specific player position and go forward to the end.
   * Note: Does NOT wrap around - goes from startPlayer to last player only.
   *
   * @example
   * ```typescript
   * // Start from player 1, will visit players 1, 2, ... (not 0)
   * eachPlayer({
   *   ...TurnOrder.START_FROM(1),
   *   do: actionStep({ actions: ['bet'] })
   * })
   *
   * // Start from the dealer
   * eachPlayer({
   *   ...TurnOrder.START_FROM(ctx => ctx.game.dealer),
   *   do: actionStep({ actions: ['bet'] })
   * })
   * ```
   */
  START_FROM: (getPlayer: number | ((ctx: FlowContext) => Player)): TurnOrderConfig => ({
    direction: 'forward' as const,
    startingPlayer: (ctx: FlowContext) => {
      if (typeof getPlayer === 'number') {
        // Position is 1-indexed
        return ctx.game.getPlayerOrThrow(getPlayer);
      }
      return getPlayer(ctx);
    },
  }),

  /**
   * Only include specific players by position (1-indexed).
   * Players are still visited in their natural order (1, 2, 3...).
   *
   * @example
   * ```typescript
   * // Only players 1 and 3 participate
   * eachPlayer({
   *   ...TurnOrder.ONLY([1, 3]),
   *   do: actionStep({ actions: ['bid'] })
   * })
   * ```
   */
  ONLY: (positions: number[]): TurnOrderConfig => ({
    direction: 'forward' as const,
    filter: (player: Player) => positions.includes(player.seat),
  }),

  /**
   * Start from the player after a "dealer" position.
   * Common pattern for card games where play starts left of dealer.
   *
   * @example
   * ```typescript
   * // In game class: dealerPosition: number = 1; (1-indexed)
   *
   * eachPlayer({
   *   ...TurnOrder.LEFT_OF_DEALER(ctx => ctx.game.dealerPosition),
   *   do: actionStep({ actions: ['bet', 'fold'] })
   * })
   *
   * // At end of hand - use nextAfter to handle wrap-around:
   * execute(ctx => {
   *   const dealer = ctx.game.players.get(ctx.game.dealerPosition);
   *   ctx.game.dealerSeat = ctx.game.players.nextAfter(dealer).seat;
   * })
   * ```
   */
  LEFT_OF_DEALER: (getDealerPosition: (ctx: FlowContext) => number): TurnOrderConfig => ({
    direction: 'forward' as const,
    startingPlayer: (ctx: FlowContext) => {
      const dealerPos = getDealerPosition(ctx);
      const dealer = ctx.game.getPlayerOrThrow(dealerPos);
      return ctx.game.nextAfter(dealer);
    },
  }),

  /**
   * Skip certain players based on a condition.
   * Players who don't match the filter are skipped.
   *
   * @example
   * ```typescript
   * // Skip players who have folded
   * eachPlayer({
   *   ...TurnOrder.SKIP_IF(player => player.hasFolded),
   *   do: actionStep({ actions: ['bet', 'raise', 'call'] })
   * })
   * ```
   */
  SKIP_IF: (shouldSkip: (player: Player, ctx: FlowContext) => boolean): TurnOrderConfig => ({
    direction: 'forward' as const,
    filter: (player: Player, ctx: FlowContext) => !shouldSkip(player, ctx),
  }),

  /**
   * Combine multiple turn order configs.
   * Useful for combining filters with starting positions.
   *
   * @example
   * ```typescript
   * eachPlayer({
   *   ...TurnOrder.combine(
   *     TurnOrder.LEFT_OF_DEALER(ctx => ctx.game.dealerPosition),
   *     TurnOrder.SKIP_IF(p => p.hasFolded)
   *   ),
   *   do: actionStep({ actions: ['bet'] })
   * })
   * ```
   */
  combine: (...configs: TurnOrderConfig[]): TurnOrderConfig => {
    const combined: TurnOrderConfig = { direction: 'forward' };

    for (const config of configs) {
      if (config.direction) combined.direction = config.direction;
      if (config.startingPlayer) combined.startingPlayer = config.startingPlayer;

      if (config.filter) {
        const existingFilter = combined.filter;
        if (existingFilter) {
          // Combine filters with AND
          const newFilter = config.filter;
          combined.filter = (player, ctx) => existingFilter(player, ctx) && newFilter(player, ctx);
        } else {
          combined.filter = config.filter;
        }
      }
    }

    return combined;
  },
};
