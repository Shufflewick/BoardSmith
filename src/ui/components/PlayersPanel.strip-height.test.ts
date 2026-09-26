// @vitest-environment jsdom
/**
 * THE SEAT STRIP IS AS TALL WITH NO SEAT ACTING AS WITH ONE (#431).
 *
 * The strip draws the acting seat's token larger than the others. On a phone
 * the strip is the shell's top bar, so its height is the board region's top
 * edge: when the game ended and no seat was acting any more, the largest token
 * went away, the bar lost 2 px, and the board region moved up and grew by
 * 2 px at the moment the game ended.
 *
 * So the token row reserves the acting token's height in every state. jsdom
 * does no layout, so this holds the reservation to the size the acting token
 * is actually drawn at; the box itself is measured in a browser.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PlayersPanel, { type Player } from './PlayersPanel.vue';

const PLAYERS: Player[] = [
  { seat: 0, name: 'Alice' },
  { seat: 1, name: 'Bob' },
];

function strip(dueSeats: number[]) {
  return mount(PlayersPanel, { props: { players: PLAYERS, playerSeat: 0, dueSeats, seatStrip: true } });
}

/** The height the acting seat's token is drawn at, read off the rendered token. */
function actingTokenHeight(): string {
  const wrapper = strip([1]);
  const acting = wrapper.find('.strip-tokens .pt.strip-active .tok');
  expect(acting.exists(), 'the acting seat draws a token').toBe(true);
  return (acting.element as HTMLElement).style.height;
}

describe('the seat strip keeps one height across game states (#431)', () => {
  it.each([
    ['a seat is acting', [1]],
    ['every seat is acting', [0, 1]],
    ['no seat is acting (the game is over)', []],
  ])('reserves the acting token height when %s', (_state, dueSeats) => {
    const row = strip(dueSeats).find('.strip-tokens').element as HTMLElement;

    expect(row.style.minHeight).toBe(actingTokenHeight());
  });
});
