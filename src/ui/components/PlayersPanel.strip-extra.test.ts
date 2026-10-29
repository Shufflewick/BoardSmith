// @vitest-environment jsdom
/**
 * THE SEAT STRIP CARRIES A GAME'S PER-SEAT CONTENT UNDER EACH TOKEN (#1513).
 *
 * The collapsed panel (desktop rail, phone strip) drew only tokens, so a number a
 * player needs at a glance (HP) vanished with the panel. `#player-strip-extra`
 * renders under every seat's token, reachable by assistive tech, and outside the
 * live region so a changing number does not re-read the status sentence.
 */
import { describe, it, expect } from 'vitest';
import { h } from 'vue';
import { mount } from '@vue/test-utils';
import PlayersPanel, { type Player } from './PlayersPanel.vue';

const PLAYERS: Player[] = [
  { seat: 0, name: 'Alice' },
  { seat: 1, name: 'Bob' },
];

const hp = ({ player }: { player: Player }) => h('span', { class: 'hp' }, `HP ${player.seat}`);

function strip(slots: { 'player-strip-extra'?: typeof hp } = {}) {
  return mount(PlayersPanel, { props: { players: PLAYERS, playerSeat: 0, dueSeats: [1], seatStrip: true }, slots });
}

describe('the seat strip #player-strip-extra slot (#1513)', () => {
  it('renders under each seat\'s token with that seat\'s player', () => {
    const seats = strip({ 'player-strip-extra': hp }).findAll('.strip-tokens .pt');

    expect(seats.map((seat) => seat.find('.hp').text())).toEqual(['HP 0', 'HP 1']);
    for (const seat of seats) expect(seat.element.lastElementChild!.classList.contains('hp')).toBe(true);
  });

  it('leaves the slot content reachable by assistive tech', () => {
    const content = strip({ 'player-strip-extra': hp }).findAll('.hp');

    expect(content).toHaveLength(PLAYERS.length);
    for (const el of content) {
      expect(el.element.closest('[aria-hidden="true"]')).toBeNull();
    }
  });

  it('keeps the slot content out of the live region, which holds only the status sentence', () => {
    const wrapper = strip({ 'player-strip-extra': hp });
    const live = wrapper.findAll('[role="status"]');

    expect(live).toHaveLength(1);
    expect(live[0]!.text()).toBe(wrapper.find('.strip-status').text());
    expect(live[0]!.find('.hp').exists()).toBe(false);
  });

  it.each([[[1]], [[]]])('keeps the content at one height with acting seats %j, as the strip keeps one height (#431)', (dueSeats) => {
    const wrapper = mount(PlayersPanel, {
      props: { players: PLAYERS, playerSeat: 0, dueSeats, seatStrip: true },
      slots: { 'player-strip-extra': hp },
    });
    const acting = mount(PlayersPanel, { props: { players: PLAYERS, playerSeat: 0, dueSeats: [1], seatStrip: true } });
    const actingHeight = (acting.find('.pt.strip-active .tok').element as HTMLElement).style.height;

    for (const seat of wrapper.findAll('.strip-tokens .pt')) {
      expect((seat.element as HTMLElement).style.gridTemplateRows).toBe(actingHeight);
    }
  });

  it('adds nothing to a seat when the game gives no content', () => {
    for (const seat of strip().findAll('.strip-tokens .pt')) {
      expect(seat.element.children).toHaveLength(1);
      expect((seat.element as HTMLElement).style.gridTemplateRows).toBe('');
    }
  });
});
