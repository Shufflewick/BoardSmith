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
} as const;
