// @vitest-environment jsdom
/**
 * A Space is drawn as a space whether or not it holds anything, never as a
 * piece that turns into a space once something lands in it, and it lists the
 * game's own attributes either way, without engine fields such as `sealed`
 * (#1667). The elements are a real seat's view from the engine.
 */
import { describe, it, expect } from 'vitest';
import { computed } from 'vue';
import { mount } from '@vue/test-utils';
import {
  Game, Space, Piece, Deck, Hand, DicePool, Grid, GridCell, HexGrid, HexCell, Player,
} from '../../../../engine/index.js';
import { SPACE_TYPES } from '../../../../engine/element/engine-attributes.js';
import '../builtin-renderers.js';
import { resolveRenderer } from '../renderer-registry.js';
import { GAME_VIEW_KEY, type GameElement } from '../auto-ui-helpers.js';
import ElementRenderer from './ElementRenderer.vue';
import PieceRenderer from './PieceRenderer.vue';
import SpaceRenderer from './SpaceRenderer.vue';

class Caravan extends Space<CaravanGame> {
  leg = 1;
  wear = 0;
}

class CaravanGame extends Game<CaravanGame, Player> {
  constructor(options: { playerCount: number }) {
    super(options);
    this.registerElements([Caravan, Space, Piece, DicePool, HexCell]);
    this.create(Caravan, 'caravan').seal();
    const loaded = this.create(Caravan, 'loaded');
    loaded.seal();
    loaded.create(Piece, 'crate');
    this.create(DicePool, 'tray');
    this.create(HexCell, 'ford');
    this.create(Piece, 'token');
  }
}

const view = new CaravanGame({ playerCount: 1 }).toJSONForPlayer(1) as GameElement;
const element = (name: string) => view.children!.find((c) => c.name === name)!;

function spaceRows(name: string) {
  const wrapper = mount(ElementRenderer, {
    props: { element: element(name) },
    global: { provide: { [GAME_VIEW_KEY as symbol]: computed(() => view) } },
  });
  return wrapper.findAll('.space-header dl > div').map((row) => [row.find('dt').text(), row.find('dd').text()]);
}

describe('an empty Space resolves to SpaceRenderer (#1667)', () => {
  it.each(['caravan', 'tray', 'ford'])('draws the empty %s as a space', (name) => {
    expect(element(name).children ?? []).toHaveLength(0);
    expect(resolveRenderer(element(name))).toBe(SpaceRenderer);
  });

  it('still draws an empty piece as a piece', () => {
    expect(resolveRenderer(element('token'))).toBe(PieceRenderer);
  });

  it('marks every built-in Space with a $type the UI reads as a space', () => {
    const game = new CaravanGame({ playerCount: 1 });
    for (const Class of [Space, Deck, Hand, DicePool, Grid, GridCell, HexGrid, HexCell, Caravan]) {
      expect(SPACE_TYPES, Class.name).toContain(game.create(Class as typeof Space, 'probe').$type);
    }
  });
});

describe('a Space lists the game\'s own attributes (#1667)', () => {
  it.each(['caravan', 'loaded'])('lists them on the %s, empty or not, without the engine\'s sealed flag', (name) => {
    expect(spaceRows(name)).toEqual([['leg', '1'], ['wear', '0']]);
  });
});
