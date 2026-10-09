/**
 * ONE TYPED PROP CONTRACT FOR A BOARD, SHARED BY BOTH SHELLS (#516).
 *
 * What a board component receives was written down three times, in GameShell's
 * template, in WorldShell's and in the docs, and none of them was a type a game
 * could import. These pin the exported types: what both shells give, what only
 * a table gives, what only a world gives, and that the functions each shell
 * builds its bound object with return exactly that type.
 */
import { describe, it, expectTypeOf } from 'vitest';
import type { BoardBaseProps, TableBoardProps, WorldBoardProps } from './index.js';
import { tableBoardProps, worldBoardProps } from './board-props.js';
import { TABLE_BOARD_PROP_NAMES, WORLD_BOARD_PROP_NAMES } from './board-props.test-helper.js';

describe('the board prop contract (#516)', () => {
  it('names the fields both shells give in one base type', () => {
    expectTypeOf<keyof BoardBaseProps>().toEqualTypeOf<
      'gameView' | 'players' | 'myPlayer' | 'playerSeat' | 'isMyTurn' | 'availableActions' | 'actionController' | 'disabledActions'
    >();
    expectTypeOf<TableBoardProps>().toMatchTypeOf<BoardBaseProps>();
    expectTypeOf<WorldBoardProps>().toMatchTypeOf<BoardBaseProps>();
  });

  it('adds the table-only fields to a table board, and nothing else', () => {
    expectTypeOf<Exclude<keyof TableBoardProps, keyof BoardBaseProps>>().toEqualTypeOf<
      'state' | 'isViewingHistory' | 'canUndo' | 'undo' | 'setBoardPrompt'
    >();
  });

  it('adds the world-only fields to a world board, and no prompt setter a world cannot show', () => {
    expectTypeOf<Exclude<keyof WorldBoardProps, keyof BoardBaseProps>>().toEqualTypeOf<
      'presence' | 'events' | 'worldName' | 'phase'
    >();
  });

  it('drops the props no board needs', () => {
    type Dropped = 'actionArgs' | 'isActionHelpVisible' | 'flowState';
    expectTypeOf<Extract<keyof TableBoardProps, Dropped>>().toBeNever();
    expectTypeOf<Extract<keyof WorldBoardProps, Dropped>>().toBeNever();
  });

  it('builds each shell\'s bound object as exactly its type', () => {
    expectTypeOf(tableBoardProps).returns.toEqualTypeOf<TableBoardProps>();
    expectTypeOf(worldBoardProps).returns.toEqualTypeOf<WorldBoardProps>();
  });

  it('keeps the shell test\'s name lists equal to the types', () => {
    expectTypeOf<(typeof TABLE_BOARD_PROP_NAMES)[number]>().toEqualTypeOf<keyof TableBoardProps>();
    expectTypeOf<(typeof WORLD_BOARD_PROP_NAMES)[number]>().toEqualTypeOf<keyof WorldBoardProps>();
  });
});
