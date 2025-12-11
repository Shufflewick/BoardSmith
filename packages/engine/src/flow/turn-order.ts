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
    startingPlayer: (ctx: FlowContext) => ctx.game.players.current,
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
        return ctx.game.players[getPlayer];
      }
      return getPlayer(ctx);
    },
  }),

  /**
   * Only include specific players by position.
   * Players are still visited in their natural order (0, 1, 2...).
   *
   * @example
   * ```typescript
   * // Only players 0 and 2 participate
   * eachPlayer({
   *   ...TurnOrder.ONLY([0, 2]),
   *   do: actionStep({ actions: ['bid'] })
   * })
   * ```
   */
  ONLY: (positions: number[]): TurnOrderConfig => ({
    direction: 'forward' as const,
    filter: (player: Player) => positions.includes(player.position),
  }),
};
