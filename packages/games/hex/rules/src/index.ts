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
  gameOptions: {
    boardSize: {
      type: 'number' as const,
      label: 'Board Size',
      description: 'Size of the hex board (NxN)',
      min: 5,
      max: 19,
      step: 1,
      default: 11,
    },
  },
  presets: [
    {
      name: 'Quick Game',
      description: '7x7 board',
      options: { boardSize: 7 },
    },
    {
      name: 'Standard',
      description: '11x11 board',
      options: { boardSize: 11 },
    },
    {
      name: 'vs AI',
      description: 'Play against AI',
      options: { boardSize: 9 },
      players: [
        { isAI: false },
        { isAI: true, aiLevel: 'medium' },
      ],
    },
  ],
};
