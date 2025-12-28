export { DemoGame, DemoPlayer } from './game.js';
export * from './elements.js';
export * from './actions.js';
export { createGameFlow } from './flow.js';

import { DemoGame } from './game.js';

export const gameDefinition = {
  gameClass: DemoGame,
  gameType: 'demoComplexUiInteractions',
  displayName: 'Demo: Complex UI Interactions',
  minPlayers: 2,
  maxPlayers: 4,
} as const;
