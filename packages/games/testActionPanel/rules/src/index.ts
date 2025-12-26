// Test Action Panel game package
export { TestActionPanelGame } from './game.js';
export { Battlefield, Unit, Enemy, TestPlayer } from './elements.js';
export { createAttackAction, createEndTurnAction } from './actions.js';
export { createTestFlow } from './flow.js';

import { TestActionPanelGame } from './game.js';

/**
 * Game definition for the worker to register this game.
 */
export const gameDefinition = {
  gameClass: TestActionPanelGame,
  gameType: 'test-action-panel',
  displayName: 'Test Action Panel',
  minPlayers: 1,
  maxPlayers: 2,
  presets: [
    {
      name: 'Solo Test',
      description: 'Test multiSelect and other ActionPanel features',
      options: {},
      players: [
        { isAI: false },
      ],
    },
  ],
};
