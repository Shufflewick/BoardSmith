import {
  loop,
  eachPlayer,
  actionStep,
  execute,
  ifThen,
  sequence,
  setVar,
  type FlowDefinition,
} from '@boardsmith/engine';
import type { GoFishGame } from './game.js';
import { Card } from './elements.js';

/**
 * Create the Go Fish game flow
 *
 * Flow structure:
 * 1. Main game loop (while not all 13 books formed)
 * 2. Each player takes a turn
 * 3. Player turn: ask action, then repeat if got extra turn
 * 4. Skip players who have no cards in hand
 */
export function createGoFishFlow(): FlowDefinition {
  // A single turn where the player asks for cards
  const playerTurn = sequence(
    // Reset turn state at start of each turn
    setVar('extraTurn', false),
    setVar('turnEnded', false),

    // The turn loop - keep playing as long as player gets extra turns
    loop({
      name: 'turn-loop',
      while: (ctx) => {
        // Continue while turn hasn't ended
        if (ctx.get('turnEnded')) return false;

        // Check if game is finished
        const game = ctx.game as GoFishGame;
        if (game.isFinished()) return false;

        // Check if player can still act
        const player = ctx.player;
        if (!player) return false;

        const hand = game.getPlayerHand(player as any);
        if (hand.count(Card) === 0) {
          // Player has no cards - try to draw
          const drawnCard = game.drawFromPond(player as any);
          if (!drawnCard) {
            // No cards in pond either - turn ends
            return false;
          }
          game.message(`${player.name} has no cards, drew from pond.`);
          game.checkForBooks(player as any);
        }

        return true;
      },
      maxIterations: 52, // Safety limit
      do: sequence(
        // Reset extra turn flag for this ask
        setVar('extraTurn', false),

        // Player takes the ask action
        actionStep({
          name: 'ask-step',
          actions: ['ask'],
          prompt: 'Ask another player for a rank you hold',
          skipIf: (ctx) => {
            // Skip if game is over
            const game = ctx.game as GoFishGame;
            return game.isFinished();
          },
        }),

        // Check if turn should continue based on action result
        execute((ctx) => {
          const extraTurn = ctx.lastActionResult?.data?.extraTurn;
          if (!extraTurn) {
            ctx.set('turnEnded', true);
          }
        }),
      ),
    }),
  );

  return {
    root: loop({
      name: 'game-loop',
      while: (ctx) => {
        const game = ctx.game as GoFishGame;
        return !game.isFinished();
      },
      maxIterations: 1000, // Safety limit for very long games
      do: eachPlayer({
        name: 'player-turns',
        filter: (player, ctx) => {
          // Skip players who can't act
          const game = ctx.game as GoFishGame;
          const hand = game.getPlayerHand(player as any);
          // Even if hand is empty, they can draw - only skip if both are empty
          return hand.count(Card) > 0 || game.pond.count(Card) > 0;
        },
        do: playerTurn,
      }),
    }),

    isComplete: (ctx) => {
      const game = ctx.game as GoFishGame;
      return game.isFinished();
    },

    getWinners: (ctx) => {
      const game = ctx.game as GoFishGame;
      return game.getWinners();
    },
  };
}
