import {
  loop,
  eachPlayer,
  actionStep,
  sequence,
  execute,
  type FlowDefinition,
} from '@boardsmith/engine';
import type { FlossBittiesGame } from './game.js';
import { Card, FlossBittiesPlayer } from './elements.js';

/**
 * Create the Floss Bitties game flow
 *
 * Turn structure:
 * 1. Play phase: Play one card (to expedition or discard)
 * 2. Draw phase: Draw one card (from deck or discard pile)
 *
 * Game ends immediately when the deck runs out.
 */
export function createGameFlow(game: FlossBittiesGame): FlowDefinition {
  const playerTurn = sequence(
    // Clear last discarded tracking at start of turn
    execute(() => {
      game.clearLastDiscarded();
    }),

    // Play phase: choose to play to expedition or discard
    actionStep({
      name: 'play-phase',
      actions: ['playToArea', 'discard'],
    }),

    // Draw phase: draw from deck or discard pile
    // Skip if deck is empty (game will end)
    actionStep({
      name: 'draw-phase',
      actions: ['drawFromDeck', 'drawFromDiscard'],
      skipIf: () => {
        // Skip draw phase if deck is empty
        // (game ends immediately when deck empties)
        return game.deck.count(Card) === 0;
      },
    }),
  );

  return {
    root: loop({
      name: 'game-loop',
      while: () => !game.isFinished(),
      maxIterations: 100, // 72 cards / 2 players = ~36 rounds max
      do: eachPlayer({
        name: 'player-turns',
        do: playerTurn,
      }),
    }),

    isComplete: () => game.isFinished(),

    getWinners: () => game.getWinners(),
  };
}
