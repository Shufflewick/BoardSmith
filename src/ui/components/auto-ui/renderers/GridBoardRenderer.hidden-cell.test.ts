// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import GridBoardRenderer from './GridBoardRenderer.vue';
import { Game, Grid, GridCell, Player } from '../../../../engine/index.js';
import type { GameElement } from '../auto-ui-helpers.js';

class Square extends GridCell<BoardGame> {
  rank!: number;
  file!: number;
}

class Board extends Grid<BoardGame> {
  $rowCoord = 'rank';
  $colCoord = 'file';
}

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
});
