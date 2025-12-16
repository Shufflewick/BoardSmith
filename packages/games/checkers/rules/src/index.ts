// Checkers game package
export { CheckersGame, type CheckersOptions } from './game.js';
export { Board, Square, CheckerPiece, CheckersPlayer, type CheckersMove } from './elements.js';
export { createMoveAction } from './actions.js';
export { createCheckersFlow } from './flow.js';
export { getCheckersObjectives } from './ai.js';

import { CheckersGame } from './game.js';
import { getCheckersObjectives } from './ai.js';

/**
 * Game definition for the worker to register this game.
 * Contains all metadata needed to run Checkers.
 */
export const gameDefinition = {
  gameClass: CheckersGame,
  gameType: 'checkers',
  displayName: 'Checkers',
  minPlayers: 2,
  maxPlayers: 2,
  ai: {
    objectives: getCheckersObjectives,
  },
  playerOptions: {
    color: {
      type: 'select' as const,
      label: 'Checker Color',
      choices: [
        { value: 'red', label: 'Red' },
        { value: 'black', label: 'Black' },
        { value: 'white', label: 'White' },
      ],
      default: 'red',
    },
  },
  presets: [
    {
      name: 'Classic',
      description: 'Red vs Black',
      options: {},
      players: [
        { color: 'red' },
        { color: 'black' },
      ],
    },
    {
      name: 'vs AI',
      description: 'Play against AI',
      options: {},
      players: [
        { isAI: false, color: 'red' },
        { isAI: true, aiLevel: 'medium', color: 'black' },
      ],
    },
  ],
};
