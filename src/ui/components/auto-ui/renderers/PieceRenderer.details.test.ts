// @vitest-environment jsdom
/**
 * A piece AutoUI draws on its own, not on a board cell, names itself in full
 * and lists the game's own attributes beside its token, so a player sees the
 * state their actions change without hovering or tapping anything (#1628).
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PieceRenderer from './PieceRenderer.vue';
import { STANDS_ON_KEY, type GameElement } from '../auto-ui-helpers.js';

const caravan: GameElement = {
  id: 7,
  className: 'Sitting',
  name: 'caravan',
  attributes: {
    name: 'caravan', $type: 'space', $direction: 'vertical', _t: 'x', row: 2, column: 3,
    player: { __playerRef: 1, seat: 1, color: '#ff0000', name: 'Ann' },
    leg: 2, wear: 0, sessionKey: '', exits: ['hall', 'cellar'], leader: { __playerRef: 2, seat: 2, name: 'Bo' },
  },
};

function details(element: GameElement, standsOn?: { id: number }) {
  const wrapper = mount(PieceRenderer, {
    props: { element },
    global: { provide: { [STANDS_ON_KEY as symbol]: () => standsOn } },
  });
  return {
    name: wrapper.find('.piece-name').exists() ? wrapper.find('.piece-name').text() : undefined,
    rows: wrapper.findAll('.piece-attributes > div').map((row) => [row.find('dt').text(), row.find('dd').text()]),
  };
}

describe('PieceRenderer details beside a free-standing piece (#1628)', () => {
  it('shows the full name and only the game\'s own attributes, in a readable form', () => {
    expect(details(caravan)).toEqual({
      name: 'caravan',
      rows: [['leg', '2'], ['wear', '0'], ['sessionKey', ''], ['exits', 'hall, cellar'], ['leader', 'Bo']],
    });
  });

  it('leaves out a player\'s identity fields but shows the game\'s own fields on it', () => {
    const player: GameElement = {
      id: 3, className: 'CrossingPlayer', name: 'Player 1',
      attributes: { name: 'Player 1', $type: 'player', seat: 1, status: 'active', color: '#f00', colorLabel: 'Red', score: 4 },
    };
    expect(details(player)).toEqual({ name: 'Player 1', rows: [['score', '4']] });
  });

  it('shows no details for a piece standing on a board cell, which has no room for them', () => {
    expect(details(caravan, { id: 99 })).toEqual({ name: undefined, rows: [] });
  });
});
