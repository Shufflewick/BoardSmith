/**
 * Demo Animation - Flow
 *
 * Single-player sandbox for demonstrating animation features.
 * Player 0 can take any animation action repeatedly.
 * Actions are named after the animation feature they demonstrate.
 */

import { loop, actionStep, type FlowDefinition } from '@boardsmith/engine';
import type { DemoGame } from './game.js';

export function createGameFlow(game: DemoGame): FlowDefinition {
  return {
    root: loop({
      name: 'game-loop',
      while: () => !game.isFinished(),
      maxIterations: 10000,
      do: actionStep({
        name: 'player-action',
        // Force the first player (position 1) to be active (single-player sandbox)
        player: () => game.getPlayer(1),
        // All animation demo actions available simultaneously
        // Each action is named after the animation composable it demonstrates
        actions: [
          'autoFlyUpUp',    // useAutoFlyingElements (A↔B, no flip)
          'autoFlyDownDown', // useAutoFlyingElements (C↔D, no flip)
          'autoFlyFlip',    // useAutoFlyingElements (A↔C, with flip)
          'flipReorder',    // useAutoFLIP (reorder within zone)
          'flyToStat',      // useAutoFlyToStat (card → score stat)
          'actionTrigger',  // useActionAnimations (action-triggered)
          'cardFlip',       // Card flip animation (in-place flip)
        ],
      }),
    }),
    isComplete: () => game.isFinished(),
    getWinners: () => game.getWinners(),
  };
}
