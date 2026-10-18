// @vitest-environment jsdom
/**
 * A hand another seat cannot see draws its cards through CardBack, the one
 * card-back drawing shared with CardRenderer and DeckRenderer (#1125). The hand
 * is a real seat's view from the engine, so the test sees what that seat is sent.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { Game, Card, Hand, Player } from '../../../../engine/index.js';
import HandRenderer from './HandRenderer.vue';
import CardBack from './CardBack.vue';

type ViewElement = { name?: string; children?: ViewElement[]; childCount?: number };

class TableGame extends Game<TableGame, Player> {
  constructor(options: { playerCount: number }) {
    super(options);
    this.registerElements([Hand, Card]);
    const short = this.create(Hand, 'short');
    const long = this.create(Hand, 'long');
    // A count-only hand reaches the seat as a placeholder with only a childCount.
    for (const hand of [short, long]) hand.setVisibility('count-only');
    for (let i = 0; i < 5; i++) short.create(Card, `s${i}`);
    for (let i = 0; i < 13; i++) long.create(Card, `l${i}`);
  }
}

const view = new TableGame({ playerCount: 2 }).toJSONForPlayer(1) as ViewElement;
// The placeholder drops the hand's name, so the hands are told apart by size.
const handView = (count: number) => view.children!.find((c) => c.childCount === count)!;
const mountHand = (count: number) => mount(HandRenderer, { props: { element: handView(count) as never } });

describe('HandRenderer face-down cards (#1125)', () => {
  it('is handed a count, not cards', () => {
    expect(handView(5).children).toBeUndefined();
  });

  // 13 cards splits the hand into two rows, which draws its backs in a second place.
  it.each([5, 13])('draws each of a hand\'s %i hidden cards as a CardBack', (count) => {
    const backs = mountHand(count).findAllComponents(CardBack);

    expect(backs).toHaveLength(count);
    // The back is itself the hand's card slot, so it lays out, fans and zooms like any hand card.
    for (const back of backs) expect(back.classes()).toEqual(expect.arrayContaining(['hand-card', 'card-back']));
  });
});
