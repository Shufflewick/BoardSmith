import type { TableBoardProps, WorldBoardProps } from './board-props.js';

/**
 * Every prop each shell hands its board, by name, for a test that compares
 * what a real shell bound with the exported contract. `board-props.test.ts`
 * holds each list equal to its type's keys, so neither can grow alone.
 */
export const TABLE_BOARD_PROP_NAMES = [
  'gameView', 'players', 'myPlayer', 'playerSeat', 'isMyTurn', 'availableActions', 'actionController',
  'disabledActions', 'state', 'isViewingHistory', 'canUndo', 'undo', 'setBoardPrompt',
] as const satisfies readonly (keyof TableBoardProps)[];

export const WORLD_BOARD_PROP_NAMES = [
  'gameView', 'players', 'myPlayer', 'playerSeat', 'isMyTurn', 'availableActions', 'actionController',
  'disabledActions', 'presence', 'events', 'worldName', 'phase',
] as const satisfies readonly (keyof WorldBoardProps)[];
