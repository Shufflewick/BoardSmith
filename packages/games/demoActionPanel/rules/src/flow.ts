import {
  loop,
  actionStep,
  type FlowDefinition,
} from '@boardsmith/engine';
import type { TestActionPanelGame } from './game.js';

/**
 * Create the game flow
 *
 * Each action demonstrates a different ActionPanel feature:
 * - chooseFromDemo: chooseElement + dependsOn + multiSelect
 * - optionalDemo: optional selection (can skip)
 * - enterNumberDemo: number input with constraints
 * - enterTextDemo: text input with constraints
 * - repeatUntilDemo: repeat selection until terminator
 * - playerChoicesDemo: select a player using playerChoices helper
 * - endTurn: resets state for next turn
 */
export function createTestFlow(game: TestActionPanelGame): FlowDefinition {
  return {
    root: loop({
      name: 'game-loop',
      while: () => !game.isFinished(),
      maxIterations: 100,
      do: actionStep({
        name: 'player-action',
        player: () => game.players[0],
        actions: [
          'chooseFromDemo',
          'optionalDemo',
          'enterNumberDemo',
          'enterTextDemo',
          'repeatUntilDemo',
          'playerChoicesDemo',
          'endTurn',
        ],
      }),
    }),

    isComplete: () => game.isFinished(),

    getWinners: () => game.getWinners(),
  };
}
