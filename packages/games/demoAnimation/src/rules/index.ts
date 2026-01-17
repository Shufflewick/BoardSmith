export { DemoGame, DemoPlayer } from './game.js';
export * from './elements.js';
export * from './actions.js';
export { createGameFlow } from './flow.js';

import { DemoGame } from './game.js';

export const gameDefinition = {
  gameClass: DemoGame,
  gameType: 'demoAnimation',
  displayName: 'Demo: Animation Showcase',
  minPlayers: 1,
  maxPlayers: 2,
} as const;
