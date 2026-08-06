// @vitest-environment jsdom
/**
 * PlayersPanel seat card — the turn-change cue (B12) and the two levers a game
 * has over per-seat vertical cost (B13).
 *
 * B12: the panel's only turn cue was a static few-percent background shift on
 *   one card. In a 7-seat column that is missed — players do not notice their
 *   own turn starting. A one-shot pulse marks the TRANSITION. It has to replay
 *   on each turn change (not animate forever) and disappear under
 *   prefers-reduced-motion, where the standing high-contrast border carries the
 *   cue instead.
 *
 * B13: a game's per-seat content (portrait, role, rank) could only stack below
 *   the name row, so every card was tall, and the shell's turn-status sentence
 *   was unconditional even for a game whose own slot content already said it.
 *   Both fixes are shell-level because the card and its scoped styles belong to
 *   the shell — a game cannot reach them from #player-stats.
 */

import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import PlayersPanel, { type Player } from './PlayersPanel.vue';

const PLAYERS: Player[] = [
  { seat: 0, name: 'Alice' },
  { seat: 1, name: 'Bob' },
  { seat: 2, name: 'Carol' },
];

function mountPanel(props: Record<string, unknown> = {}, slots: Record<string, string> = {}) {
  return mount(PlayersPanel, {
    props: { players: PLAYERS, playerSeat: 0, currentPlayerSeat: 0, ...props },
    slots,
  });
}

describe('B12: turn-change attention pulse', () => {
  it('renders the pulse only on the active seat', () => {
    const wrapper = mountPanel({ currentPlayerSeat: 1 });
    const cards = wrapper.findAll('.player-card');
    expect(cards[0].find('.turn-pulse').exists()).toBe(false);
    expect(cards[1].find('.turn-pulse').exists()).toBe(true);
    expect(cards[2].find('.turn-pulse').exists()).toBe(false);
  });

  it('remounts the pulse on a turn change so the animation replays', async () => {
    const wrapper = mountPanel({ currentPlayerSeat: 0 });
    const before = wrapper.find('.turn-pulse').element;

    await wrapper.setProps({ currentPlayerSeat: 1 });
    await nextTick();

    const active = wrapper.findAll('.player-card')[1];
    expect(active.find('.turn-pulse').exists()).toBe(true);
    // A CSS animation only restarts on a genuinely NEW element. The keyed
    // `turnTick` is what forces one; were the key to stop changing, the pulse
    // would play once at mount and never again.
    expect(active.find('.turn-pulse').element).not.toBe(before);
  });

  it('replays even when the SAME seat becomes active again after another seat', async () => {
    const wrapper = mountPanel({ currentPlayerSeat: 0 });
    const first = wrapper.find('.turn-pulse').element;
    await wrapper.setProps({ currentPlayerSeat: 1 });
    await wrapper.setProps({ currentPlayerSeat: 0 });
    await nextTick();
    // Same seat, same card position — without the tick in the key Vue would
    // patch the existing node in place and the player would get no cue at all.
    expect(wrapper.find('.turn-pulse').element).not.toBe(first);
  });

  it('pulses for a seat made active by a simultaneous step, not just the turn seat', () => {
    const wrapper = mountPanel({ currentPlayerSeat: undefined, awaitingPlayerSeats: [2] });
    const cards = wrapper.findAll('.player-card');
    expect(cards[2].find('.turn-pulse').exists()).toBe(true);
    expect(cards[0].find('.turn-pulse').exists()).toBe(false);
  });
});

describe('B13: per-seat vertical cost', () => {
  it('renders #player-token-extra inside the token column, not the info column', () => {
    const wrapper = mountPanel(
      { currentPlayerSeat: 1 },
      { 'player-token-extra': '<img class="portrait" src="p.png" alt="" />' },
    );
    const card = wrapper.findAll('.player-card')[1];
    expect(card.find('.player-token-wrap .portrait').exists()).toBe(true);
    expect(card.find('.player-info .portrait').exists()).toBe(false);
  });

  it('gives the slot its player, so per-seat content can differ per seat', () => {
    const wrapper = mountPanel(
      {},
      { 'player-token-extra': '<template #default="{ player }"><i class="n">{{ player.name }}</i></template>' },
    );
    expect(wrapper.findAll('.player-token-wrap .n').map(n => n.text())).toEqual(['Alice', 'Bob', 'Carol']);
  });

  it('renders the turn-status sentence by default', () => {
    const wrapper = mountPanel({ currentPlayerSeat: 0 });
    expect(wrapper.find('.turn-status').text()).toBe('Your move');
  });

  it('suppresses the turn-status sentence when showTurnStatus is false', () => {
    const wrapper = mountPanel({ currentPlayerSeat: 0, showTurnStatus: false });
    expect(wrapper.find('.turn-status').exists()).toBe(false);
  });

  it('keeps every non-sentence turn cue when the sentence is suppressed', () => {
    // Suppressing a redundant line must not cost the seat its turn identity —
    // that would trade one game's tidiness for the panel's accessibility floor.
    const wrapper = mountPanel({ currentPlayerSeat: 1, showTurnStatus: false });
    const card = wrapper.findAll('.player-card')[1];
    expect(card.classes()).toContain('current');
    expect(card.attributes('aria-current')).toBe('true');
    expect(card.find('.turn-indicator-dot').exists()).toBe(true);
    expect(card.find('.turn-pulse').exists()).toBe(true);
  });
});
