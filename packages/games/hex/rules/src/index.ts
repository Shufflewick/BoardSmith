// Hex game package
export { HexGame, type HexOptions } from './game.js';
export { Board, Cell, Stone, HexPlayer } from './elements.js';
export { createPlaceStoneAction } from './actions.js';
export { createHexFlow } from './flow.js';
export { getHexObjectives } from './ai.js';

import { HexGame } from './game.js';
import { getHexObjectives } from './ai.js';

/**
 * Game definition for the worker to register this game.
 * Contains all metadata needed to run Hex.
 */
export const gameDefinition = {
  gameClass: HexGame,
  gameType: 'hex',
  displayName: 'Hex',
  minPlayers: 2,
  maxPlayers: 2,
  ai: {
    objectives: getHexObjectives,
  },
} as const;
