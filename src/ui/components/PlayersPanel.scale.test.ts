// @vitest-environment jsdom
/**
 * R1 (#170 §8): the chrome's per-seat cost.
 *
 * The world backend runs 500-seat worlds, and the engine spent #169 removing
 * the O(world) term from the view. The shared shell must not put it back in the
 * sidebar: measured on 2026-09-06, 500 seat cards are 4,505 DOM nodes, ~84 ms to
 * mount and ~7.5 ms to re-patch on EVERY state push, in jsdom with no layout and
 * no paint. A real browser pays more.
 *
 * The fix is not virtualisation. A 500-row scroller is a list nobody reads to
 * the end of; the panel's job is seat IDENTITY, and past a dozen rows it stops
 * doing that job whether or not it is cheap. So the panel CAPS, keeps the rows
 * that answer "who am I and who is acting", and says how many it left out.
 *
 * The cap is on by default. A panel that is only bounded when a caller
 * remembers to bound it is the 500-row sidebar with an extra step.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PlayersPanel, { type Player } from './PlayersPanel.vue';

function seats(n: number): Player[] {
  return Array.from({ length: n }, (_, i) => ({ seat: i, name: `Player ${i}` }));
}

function mountPanel(props: Record<string, unknown>) {
  return mount(PlayersPanel, { props: { playerSeat: 0, ...props } });
}

describe('R1: the seat list is bounded by default', () => {
  it('renders every seat when the roster is small', () => {
    const wrapper = mountPanel({ players: seats(8) });
    expect(wrapper.findAll('.player-card')).toHaveLength(8);
    expect(wrapper.find('.players-overflow').exists()).toBe(false);
  });

  it('caps a 500-seat roster without being asked to', () => {
    const wrapper = mountPanel({ players: seats(500) });
    const cards = wrapper.findAll('.player-card');
    expect(cards.length).toBeLessThanOrEqual(12);
    expect(wrapper.element.querySelectorAll('*').length).toBeLessThan(200);
  });

  it('says how many seats it left out rather than hiding them silently', () => {
    const wrapper = mountPanel({ players: seats(500) });
    const shown = wrapper.findAll('.player-card').length;
    expect(wrapper.find('.players-overflow').text()).toContain(String(500 - shown));
  });

  it('always keeps the viewer, whatever their seat number', () => {
    const wrapper = mountPanel({ players: seats(500), playerSeat: 499 });
    expect(wrapper.text()).toContain('Player 499');
    expect(wrapper.find('.player-card .you-badge').exists()).toBe(true);
  });

  it('always keeps the acting seat', () => {
    const wrapper = mountPanel({ players: seats(500), playerSeat: 0, currentPlayerSeat: 400 });
    expect(wrapper.text()).toContain('Player 400');
  });

  it('keeps every awaiting seat it can fit', () => {
    const wrapper = mountPanel({
      players: seats(500),
      playerSeat: 0,
      awaitingPlayerSeats: [310, 320],
    });
    expect(wrapper.text()).toContain('Player 310');
    expect(wrapper.text()).toContain('Player 320');
  });

  it('keeps the rows in the order it was given them', () => {
    const wrapper = mountPanel({ players: seats(500), playerSeat: 40, currentPlayerSeat: 12 });
    const shownSeats = wrapper.findAll('.player-card .player-name').map(n => Number(n.text().split(' ')[1]));
    expect([...shownSeats].sort((a, b) => a - b)).toEqual(shownSeats);
  });

  it('caps the mobile seat strip too', () => {
    const wrapper = mountPanel({ players: seats(500), seatStrip: true });
    expect(wrapper.findAll('.strip-tokens .pt').length).toBeLessThanOrEqual(12);
    expect(wrapper.find('.players-overflow').text()).toContain('488');
  });
});

describe('R1: presence is a marking on the seat row', () => {
  it('marks present and absent seats when the host has a live claim', () => {
    const wrapper = mountPanel({ players: seats(4), presentSeats: [0, 2] });
    const marks = wrapper.findAll('.conn-status');
    expect(marks).toHaveLength(4);
    expect(marks[0]!.classes()).toContain('is-online');
    expect(marks[1]!.classes()).toContain('is-offline');
    expect(marks[2]!.classes()).toContain('is-online');
  });

  it('marks nothing when presence is not known — null is not an empty room', () => {
    const wrapper = mountPanel({ players: seats(4), presentSeats: null });
    expect(wrapper.findAll('.conn-status')).toHaveLength(0);
  });

  it('marks nothing when the backend has no presence at all', () => {
    const wrapper = mountPanel({ players: seats(4) });
    expect(wrapper.findAll('.conn-status')).toHaveLength(0);
  });

  it('lets a table\'s own per-player connection flag win over the world\'s set', () => {
    const players = seats(2);
    players[0]!.connected = false;
    const wrapper = mountPanel({ players, presentSeats: [0, 1] });
    expect(wrapper.findAll('.conn-status')[0]!.classes()).toContain('is-offline');
  });

  it('prefers seats that are here when it has to choose which to show', () => {
    const present = [400, 401, 402];
    const wrapper = mountPanel({ players: seats(500), playerSeat: 0, presentSeats: present });
    for (const s of present) expect(wrapper.text()).toContain(`Player ${s}`);
  });
});
