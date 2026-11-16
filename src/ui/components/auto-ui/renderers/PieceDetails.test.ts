// @vitest-environment jsdom
/**
 * A piece AutoUI draws in a row with room for it (a space, a top-level row)
 * names itself in full and lists the game's own attributes beside its token,
 * so a player sees the state their actions change without hovering or tapping
 * anything (#1628). A piece in a hand fan, a deck stack or a board cell keeps
 * its bare token, which is all those layouts have room for.
 */
import { describe, it, expect } from 'vitest';
import { computed } from 'vue';
import { mount } from '@vue/test-utils';
import '../builtin-renderers.js';
import ElementRenderer from './ElementRenderer.vue';
import { GAME_VIEW_KEY, type GameElement } from '../auto-ui-helpers.js';

const hall: GameElement = { id: 20, className: 'Room', name: 'hall', attributes: { $type: 'space' }, children: [] };
const cellar: GameElement = { id: 21, className: 'Room', name: 'cellar', attributes: { $type: 'space' }, children: [] };

const caravan: GameElement = {
  id: 7,
  className: 'Sitting',
  name: 'caravan',
  attributes: {
    name: 'caravan', $type: 'piece', $direction: 'vertical', _t: 'x', row: 2, column: 3, notation: 'c3',
    player: { __playerRef: 1, seat: 1, color: '#ff0000', name: 'Ann' },
    leg: 2, wear: 0, exits: ['hall', 'cellar'],
    leader: { __playerRef: 2, seat: 2, name: 'Bo' },
    follower: { __playerRef: 3, seat: 3 },
    door: { __elementId: 21 },
    home: { __elementRef: '0' },
    lost: { __elementRef: 'pile/removed' },
    tally: { owner: { __playerRef: 2, seat: 2, name: 'Bo' }, count: 2 },
  },
};

const root: GameElement = { id: 1, className: 'Game', attributes: {}, children: [hall, cellar, caravan] };

function render(element: GameElement, details: boolean) {
  const wrapper = mount(ElementRenderer, {
    props: { element, details },
    global: { provide: { [GAME_VIEW_KEY as symbol]: computed(() => root) } },
  });
  return {
    wrapper,
    name: wrapper.find('.piece-name').exists() ? wrapper.find('.piece-name').text() : undefined,
    rows: wrapper.findAll('.piece-attributes > div').map((row) => [row.find('dt').text(), row.find('dd').text()]),
  };
}

describe('PieceDetails beside a piece in a row with room (#1628)', () => {
  it('shows the full name and only the game\'s own attributes, with references named', () => {
    const { name, rows } = render(caravan, true);
    expect({ name, rows }).toEqual({
      name: 'caravan',
      rows: [
        ['leg', '2'], ['wear', '0'], ['exits', 'hall, cellar'],
        ['leader', 'Bo'], ['follower', 'Seat 3'],
        ['door', 'cellar'], ['home', 'hall'], ['lost', 'unseen'],
        ['tally', 'owner Bo, count 2'],
      ],
    });
  });

  it('leaves out a player\'s identity fields but shows the game\'s own fields on it', () => {
    const player: GameElement = {
      id: 3, className: 'CrossingPlayer', name: 'Player 1',
      attributes: { name: 'Player 1', $type: 'player', seat: 1, status: 'active', color: '#f00', colorLabel: 'Red', score: 4 },
    };
    const { name, rows } = render(player, true);
    expect({ name, rows }).toEqual({ name: 'Player 1', rows: [['score', '4']] });
  });

  it('keeps the bare token as the root where the row asks for no details (hand, deck, board cell)', () => {
    const { wrapper, name } = render(caravan, false);
    expect(name).toBeUndefined();
    expect(wrapper.find('.piece-with-details').exists()).toBe(false);
    expect(wrapper.find('.piece').exists()).toBe(true);
  });

  it('adds nothing to an element that is not drawn as a piece', () => {
    const zone: GameElement = { id: 30, className: 'Space', name: 'supply', attributes: { $type: 'space', capacity: 5 }, children: [caravan] };
    const { wrapper, name } = render(zone, true);
    expect(wrapper.find('.space-container > .piece-details').exists()).toBe(false);
    expect(name).toBe('caravan');
  });
});
