import {
  loop,
  eachPlayer,
  actionStep,
  execute,
  sequence,
  setVar,
  type FlowDefinition,
} from '@boardsmith/engine';
import type { CheckersGame } from './game.js';
import type { CheckersPlayer } from './elements.js';

/**
 * Create the Checkers game flow
 *
 * Flow structure:
 * 1. Main game loop (while game not finished)
 * 2. Each player takes a turn
 * 3. Player turn: move action, with multi-jump continuation
 * 4. After a move (non-multi-jump), player can undo or confirm with endTurn
 * 5. Game ends when a player has no pieces or no valid moves
 */
export function createCheckersFlow(game: CheckersGame): FlowDefinition {
  // A single turn where the player moves a piece
  const playerTurn = sequence(
    // Reset turn state at start of each turn
    setVar('turnComplete', false),
    execute(() => {
      game.hasMovedThisTurn = false;
    }),

    // The turn loop - keeps going for multi-jump captures OR until endTurn
    loop({
      name: 'move-loop',
      while: (ctx) => {
        // Continue while turn hasn't ended
        if (ctx.get('turnComplete')) return false;

        // Check if game is finished
        if (game.isFinished()) return false;

        const player = ctx.player as CheckersPlayer;
        if (!player) return false;

        // Check if this player can make a move
        if (game.continuingPlayer && game.continuingPlayer !== player) {
          // Another player must continue their multi-jump
          return false;
        }

        // If player has moved and is not in multi-jump, they need to endTurn
        if (game.hasMovedThisTurn && !game.continuingPiece) {
          return true; // Keep loop going to offer endTurn action
        }

        if (game.continuingPiece) {
          // Multi-jump in progress - check if more captures available
          return game.getValidMovesForPiece(game.continuingPiece).length > 0;
        }

        return game.getValidMoves(player).length > 0;
      },
      maxIterations: 20, // Safety limit for multi-jumps
      do: sequence(
        // Player makes a move or ends turn
        actionStep({
          name: 'move-step',
          actions: ['move', 'endTurn'], // Both actions available
          skipIf: (ctx) => {
            // Skip if game is over
            return game.isFinished();
          },
        }),

        // Check if turn should continue (multi-jump), end, or await confirmation
        execute((ctx) => {
          // If endTurn was executed, turn is complete
          if (ctx.lastActionResult?.data?.turnEnded) {
            ctx.set('turnComplete', true);
            return;
          }

          // If move resulted in multi-jump, don't end turn yet
          const mustContinue = ctx.lastActionResult?.data?.mustContinue;
          if (mustContinue) {
            // Multi-jump: keep going
            return;
          }

          // If move can end turn but player hasn't confirmed, wait for endTurn
          // (turnComplete remains false, loop continues to offer endTurn)
        }),
      ),
    }),
  );

  return {
    root: loop({
      name: 'game-loop',
      while: (ctx) => {
        return !game.isFinished();
      },
      maxIterations: 500, // Safety limit for long games
      do: eachPlayer({
        name: 'player-turns',
        filter: (player, ctx) => {
          // Skip players who can't move
          // Also skip if another player is in a multi-jump
          if (game.continuingPlayer && game.continuingPlayer !== player) {
            return false;
          }
          return game.canCurrentPlayerMove(player as CheckersPlayer);
        },
        do: playerTurn,
      }),
    }),

    isComplete: (ctx) => {
      return game.isFinished();
    },

    getWinners: (ctx) => {
      return game.getWinners();
    },
  };
}
