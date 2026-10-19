// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import HexBoardRenderer from './HexBoardRenderer.vue';
import { Game, HexCell, HexGrid, Player } from '../../../../engine/index.js';
import type { GameElement } from '../auto-ui-helpers.js';

class Tile extends HexCell<HexGame> {
  q!: number;
  r!: number;
}

class Map extends HexGrid<HexGame> {}

class HexGame extends Game<HexGame, Player> {
  map!: Map;

  constructor(options: { playerCount: number }) {
    super(options);
    this.map = this.create(Map, 'map');
    for (let q = 0; q < 3; q++) this.map.create(Tile, `t${q}`, { q, r: 0 });
  }
}

const mapView = (game: HexGame) => game.toJSONForPlayer(1).children!.find((c) => c.name === 'map') as GameElement;
const cellTransforms = (board: GameElement) =>
  mount(HexBoardRenderer, { props: { element: board } }).findAll('.hex-cell-group').map((g) => g.attributes('transform'));

describe('HexBoardRenderer with a cell hidden from the seat (#1198)', () => {
  it('draws the hidden cell where it is, not at (0,0)', () => {
    const game = new HexGame({ playerCount: 2 });
    const visible = cellTransforms(mapView(game));
    game.map.first(Tile, { q: 2, r: 0 })!.hideFromAll();

    expect(cellTransforms(mapView(game))).toEqual(visible);
  });

  it('refuses a cell with no coordinates rather than drawing it at (0,0)', () => {
    const board = mapView(new HexGame({ playerCount: 2 }));
    delete board.children![2].attributes!.q;

    expect(() => mount(HexBoardRenderer, { props: { element: board } })).toThrow(/cell "t2" has no numeric "q"/);
  });
});
