// @vitest-environment jsdom
/**
 * A face-down deck is a stack, not "Empty" (#1056). The decks are a real seat's
 * view from the engine, so the test sees exactly what each visibility mode sends.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { Game, Deck, Card, Player } from '../../../../engine/index.js';
import DeckRenderer from './DeckRenderer.vue';

type ViewElement = { name?: string; children?: ViewElement[] };

class PondGame extends Game<PondGame, Player> {
  constructor(options: { playerCount: number }) {
    super(options);
    this.registerElements([Deck, Card]);
    const hidden = this.create(Deck, 'pond');
    hidden.contentsHidden();
    const counted = this.create(Deck, 'draw');
    for (let i = 0; i < 38; i++) {
      hidden.create(Card, `h${i}`);
      counted.create(Card, `c${i}`);
    }
    this.create(Deck, 'empty');
    this.create(Deck, 'drained').contentsHidden();
  }
}

const view = new PondGame({ playerCount: 2 }).toJSONForPlayer(1) as ViewElement;
const deckView = (name: string) => view.children!.find((c) => c.name === name)!;
const mountDeck = (name: string) => mount(DeckRenderer, { props: { element: deckView(name) as never } });

describe('DeckRenderer face-down decks (#1056)', () => {
  // 'drained' is empty: a hidden deck must look the same either way, or its emptiness leaks.
  it.each(['pond', 'drained'])('shows the %s deck, whose size is secret, as a face-down stack', (name) => {
    const deck = mountDeck(name);

    expect(deck.find('.deck-empty').exists()).toBe(false);
    expect(deck.findAll('.deck-stack .card-back')).toHaveLength(3);
    expect(deck.find('.deck-count').text()).toBe('Size hidden');
    expect(deck.attributes('aria-label')).toBe(`${name}, size hidden`);
  });

  it('shows a counted face-down deck as a stack with its count', () => {
    const deck = mountDeck('draw');

    expect(deck.find('.deck-empty').exists()).toBe(false);
    expect(deck.find('.deck-count').text()).toBe('38 cards');
  });

  it('keeps the name and count apart in the header text', () => {
    expect(mountDeck('draw').find('.deck-header').text()).toBe('draw 38 cards');
  });

  it('still says Empty for a deck the seat knows is empty', () => {
    expect(mountDeck('empty').find('.deck-empty').text()).toBe('Empty');
  });
});
