/**
 * Demo Complex UI Interactions - Flow
 *
 * Simple turn-based flow where all actions are available each turn.
 * This lets us demonstrate how the UI can show which action is being filled in.
 */

import { loop, eachPlayer, actionStep, type FlowDefinition } from '@boardsmith/engine';
import type { DemoGame } from './game.js';

export function createGameFlow(game: DemoGame): FlowDefinition {
  return {
    root: loop({
      name: 'game-loop',
      while: () => !game.isFinished(),
      maxIterations: 1000,
      do: eachPlayer({
        name: 'player-turns',
        do: actionStep({
          name: 'player-action',
          // All actions available simultaneously!
          actions: ['collect', 'discard', 'trade', 'gift', 'score'],
        }),
      }),
    }),
    isComplete: () => game.isFinished(),
    getWinners: () => game.getWinners(),
  };
}
