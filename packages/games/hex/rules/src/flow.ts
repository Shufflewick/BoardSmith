import {
  loop,
  eachPlayer,
  actionStep,
  type FlowDefinition,
} from '@boardsmith/engine';
import type { HexGame } from './game.js';

/**
 * Create the game flow for Hex
 *
 * Flow:
 * - Players alternate placing stones
 * - Game ends when someone connects their two edges
 * - Simple alternating turns - no multi-step actions needed
 */
export function createHexFlow(game: HexGame): FlowDefinition {
  return {
    root: loop({
      name: 'game-loop',
      while: (ctx) => {
        return !game.isFinished();
      },
      maxIterations: 100, // 7x7 board = 49 cells max
      do: eachPlayer({
        name: 'player-turns',
        filter: (player, ctx) => {
          // Skip if game is over
          return !game.isFinished();
        },
        do: actionStep({
          name: 'place-stone',
          actions: ['placeStone'],
          skipIf: (ctx) => {
            return game.isFinished();
          },
        }),
      }),
    }),

    isComplete: (ctx) => {
      return game.isFinished();
    },

    getWinners: (ctx) => {
      return game.winner ? [game.winner] : [];
    },
  };
}
