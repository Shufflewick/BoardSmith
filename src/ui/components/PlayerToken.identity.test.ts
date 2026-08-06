// @vitest-environment jsdom
/**
 * PlayerToken — the shape is a STABLE IDENTITY, not a render position.
 *
 * The regression this guards: `PlayerToken` derived its shape from a v-for
 * index, and two consumers passed indices into two DIFFERENT arrays — the
 * players panel iterates turn order (`panelPlayers`), the action panel's turn
 * indicator looks up seat order (`players`). Once the panel started ordering by
 * turn, the same player was drawn as two different shapes in one screenshot,
 * and a player's shape changed mid-game whenever the running order rotated.
 *
 * Shape exists to be the identity glyph that survives colour-blindness and
 * colourless games. Anything positional cannot serve that role, so the property
 * under test is invariance: a seat's shape must not depend on where — or in
 * which list — it is rendered.
 */

import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PlayerToken from './PlayerToken.vue';
import PlayersPanel, { type Player } from './PlayersPanel.vue';

const SEAT_ORDER: Player[] = [
  { seat: 0, name: 'Alice' },
  { seat: 1, name: 'Bob' },
  { seat: 2, name: 'Carol' },
];

/** The shape class (`sh-*`) each seat's token renders with, keyed by seat. */
function shapesBySeat(players: Player[], props: Record<string, unknown> = {}): Record<number, string> {
  const wrapper = mount(PlayersPanel, {
    props: { players, playerSeat: 0, currentPlayerSeat: 1, ...props },
  });
  const cards = wrapper.findAll('.player-card');
  expect(cards).toHaveLength(players.length);
  const out: Record<number, string> = {};
  cards.forEach((card, i) => {
    // Cards render in the order they were passed, so card i is players[i].
    const cls = card.find('.tok').classes().find(c => c.startsWith('sh-'));
    expect(cls, `seat ${players[i].seat} rendered no shape class`).toBeTruthy();
    out[players[i].seat] = cls!;
  });
  return out;
}

describe('PlayerToken shape is derived from seat, not render position', () => {
  it('gives a seat the same shape no matter where it sits in the rendered list', () => {
    const seatOrdered = shapesBySeat(SEAT_ORDER);
    const turnOrdered = shapesBySeat([...SEAT_ORDER].reverse());

    expect(turnOrdered).toEqual(seatOrdered);
    // ...and the shapes are actually distinct, so "equal" isn't vacuously true
    // because every token collapsed to one shape.
    expect(new Set(Object.values(seatOrdered)).size).toBe(SEAT_ORDER.length);
  });

  it('agrees with a token mounted standalone for the same seat (panel vs turn indicator)', () => {
    // The action panel's turn indicator mounts PlayerToken directly with the
    // acting player's seat. It must land on the same glyph the panel drew.
    const panelShapes = shapesBySeat([...SEAT_ORDER].reverse());
    for (const player of SEAT_ORDER) {
      const standalone = mount(PlayerToken, { props: { name: player.name, seat: player.seat } });
      const cls = standalone.find('.tok').classes().find(c => c.startsWith('sh-'));
      expect(cls).toBe(panelShapes[player.seat]);
    }
  });

  it('keeps the seat strip in step with the full cards for the same seat', () => {
    const cardShapes = shapesBySeat(SEAT_ORDER);
    const strip = mount(PlayersPanel, {
      props: { players: [...SEAT_ORDER].reverse(), playerSeat: 0, currentPlayerSeat: 1, seatStrip: true },
    });
    const toks = strip.findAll('.strip-tokens .tok');
    expect(toks).toHaveLength(SEAT_ORDER.length);
    const reversed = [...SEAT_ORDER].reverse();
    toks.forEach((tok, i) => {
      const cls = tok.classes().find(c => c.startsWith('sh-'));
      expect(cls).toBe(cardShapes[reversed[i].seat]);
    });
  });

  it('wraps around the shape set by seat, so a 9th seat reuses the first shape', () => {
    const first = mount(PlayerToken, { props: { name: 'A', seat: 0 } });
    const ninth = mount(PlayerToken, { props: { name: 'I', seat: 8 } });
    const shapeOf = (w: typeof first) => w.find('.tok').classes().find(c => c.startsWith('sh-'));
    expect(shapeOf(ninth)).toBe(shapeOf(first));
  });
});
