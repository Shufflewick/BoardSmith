// Checkers game package
export { CheckersGame, type CheckersOptions } from './game.js';
export { Board, Square, CheckerPiece, CheckersPlayer, type CheckersMove } from './elements.js';
export { createMoveAction } from './actions.js';
export { createCheckersFlow } from './flow.js';
export { getCheckersObjectives } from './ai.js';

import { CheckersGame } from './game.js';
import { getCheckersObjectives } from './ai.js';
import { createColorOption, type ColorChoice } from '@boardsmith/session';

/**
 * Traditional checkers piece colors
 * Using hex codes that match the standard BoardSmith palette
 */
export const CHECKERS_COLORS: readonly ColorChoice[] = [
  { value: '#e74c3c', label: 'Red' },
  { value: '#2c3e50', label: 'Black' },
  { value: '#ecf0f1', label: 'White' },
  { value: '#e67e22', label: 'Orange' },
  { value: '#27ae60', label: 'Green' },
  { value: '#3498db', label: 'Blue' },
] as const;

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
    color: createColorOption(CHECKERS_COLORS, 'Checker Color'),
  },
  presets: [
    {
      name: 'Classic',
      description: 'Red vs Black',
      options: {},
      players: [
        { color: '#e74c3c' },
        { color: '#2c3e50' },
      ],
    },
    {
      name: 'vs AI',
      description: 'Play against AI',
      options: {},
      players: [
        { isAI: false, color: '#e74c3c' },
        { isAI: true, aiLevel: 'medium', color: '#2c3e50' },
      ],
    },
  ],
};
