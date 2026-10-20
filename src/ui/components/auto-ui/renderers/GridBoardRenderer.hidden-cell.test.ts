// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import GridBoardRenderer from './GridBoardRenderer.vue';
import { Game, Grid, GridCell, Piece, Player, Space } from '../../../../engine/index.js';
import type { GameElement } from '../auto-ui-helpers.js';

class Square extends GridCell<BoardGame> {
  rank!: number;
  file!: number;
}

class Board extends Grid<BoardGame> {
  $rowCoord = 'rank';
  $colCoord = 'file';
}

class Token extends Piece<BoardGame> {}

class BoardGame extends Game<BoardGame, Player> {
  board!: Board;

  constructor(options: { playerCount: number }) {
    super(options);
    this.board = this.create(Board, 'board');
    for (let rank = 1; rank <= 3; rank++) {
      for (let file = 1; file <= 3; file++) this.board.create(Square, `${file}${rank}`, { rank, file });
    }
  }
}

describe('GridBoardRenderer with a cell hidden from the seat (#1055)', () => {
  it('renders the seat view of the board, hidden cell included, without refusing it', () => {
    const game = new BoardGame({ playerCount: 2 });
    game.board.first(Square, { rank: 2, file: 2 })!.hideFromAll();
    const board = game.toJSONForPlayer(1).children!.find((c) => c.name === 'board') as GameElement;

    const wrapper = mount(GridBoardRenderer, { props: { element: board } });

    expect(wrapper.find('.grid-error-panel').exists()).toBe(false);
    expect(wrapper.findAll('.grid-cell')).toHaveLength(9);
  });

  it('leaves out a piece placed straight on the board and hidden, whose place it is not sent, and draws the rest (#1294)', () => {
    const game = new BoardGame({ playerCount: 2 });
    game.board.create(Token, 'stray').hideFromAll();
    const board = game.toJSONForPlayer(1).children!.find((c) => c.name === 'board') as GameElement;

    const wrapper = mount(GridBoardRenderer, { props: { element: board } });

    expect(wrapper.find('.grid-error-panel').exists()).toBe(false);
    expect(wrapper.findAll('.grid-cell')).toHaveLength(9);
  });

  it('draws a grid built of plain spaces with one hidden from the seat, whose place it is still sent (#1294)', () => {
    class Plot extends Space<PlotGame> {
      y!: number;
      x!: number;
    }
    class Field extends Grid<PlotGame> {
      $rowCoord = 'y';
      $colCoord = 'x';
    }
    class PlotGame extends Game<PlotGame, Player> {
      constructor(options: { playerCount: number }) {
        super(options);
        const field = this.create(Field, 'field');
        for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) field.create(Plot, `p${y}${x}`, { y, x });
        field.first(Plot, 'p11')!.hideFromAll();
      }
    }
    const field = new PlotGame({ playerCount: 2 }).toJSONForPlayer(1).children!.find((c) => c.name === 'field') as GameElement;

    const wrapper = mount(GridBoardRenderer, { props: { element: field } });

    expect(wrapper.find('.grid-error-panel').exists()).toBe(false);
    expect(wrapper.findAll('.grid-cell')).toHaveLength(4);
  });
});
