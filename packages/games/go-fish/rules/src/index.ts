// Go Fish game package
export { GoFishGame, type GoFishOptions } from './game.js';
export { Card, Hand, Pond, Books, GoFishPlayer } from './elements.js';
export { createAskAction } from './actions.js';
export { createGoFishFlow } from './flow.js';
export { getGoFishObjectives } from './ai.js';

import { GoFishGame } from './game.js';
import { getGoFishObjectives } from './ai.js';

/**
 * Game definition for the worker to register this game.
 * Contains all metadata needed to run Go Fish.
 */
export const gameDefinition = {
  gameClass: GoFishGame,
  gameType: 'go-fish',
  displayName: 'Go Fish',
  minPlayers: 2,
  maxPlayers: 6,
  ai: {
    objectives: getGoFishObjectives,
  },
} as const;
