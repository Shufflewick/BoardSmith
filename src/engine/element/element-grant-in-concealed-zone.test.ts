/**
 * A grant on the element itself (`addVisibleTo`, `showOnlyTo`, `showToAll`)
 * gets through a concealed zone (#758): the granted seat's view carries that
 * card's identity, every other seat's does not, and `isVisibleTo` says exactly
 * what each seat's view shows.
 */
import { describe, it, expect } from 'vitest';
import { Game, Piece, Player, Deck, Hand, Space, type ElementJSON, type GameOptions } from '../index.js';
import { isHiddenPlaceholder } from './hidden-placeholder.js';

class Card extends Piece<TestGame> {}
class TestGame extends Game<TestGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Card]);
  }
}

/** Whether `seat`'s view (null: spectator) carries `card` under its real id, unhidden. */
function revealedIn(game: TestGame, seat: number | null, card: Card): boolean {
  const find = (node: ElementJSON): ElementJSON | undefined =>
    node.id === card.id ? node : node.children?.map(find).find((n) => n !== undefined);
  const node = find(game.toJSONForPlayer(seat));
  return node !== undefined && !isHiddenPlaceholder(node) && node.name === card.name;
}

/** Every seat, spectator included, is told by its view what isVisibleTo says. */
function expectViewsAgree(game: TestGame, cards: Card[]): void {
  for (const card of cards) {
    for (const seat of [1, 2, 3, null]) {
      expect(revealedIn(game, seat, card), `${card.name} for seat ${seat}`).toBe(card.isVisibleTo(seat ?? -1));
    }
  }
}

const options = { playerCount: 3, elementIdKey: '0000000000000758' };

function setup() {
  const game = new TestGame(options);
  const deck = game.create(Deck, 'deck');
  const hand = game.create(Hand, 'hand');
  hand.player = game.getPlayer(1)!;
  return { game, deck, hand };
}

describe('element grants inside concealed zones (#758)', () => {
  for (const zone of ['deck', 'hand'] as const) {
    it(`addVisibleTo(2) on a card in a ${zone} reveals it to seat 2 only`, () => {
      const s = setup();
      const [card, other] = s[zone].createMany(2, Card, 'card', (i) => ({ name: `c${i}` }));
      card!.addVisibleTo(2);

      expect(card!.isVisibleTo(2)).toBe(true);
      expect(card!.isVisibleTo(3)).toBe(false);
      expect(revealedIn(s.game, 2, card!)).toBe(true);
      expect(revealedIn(s.game, 3, card!)).toBe(false);
      expect(card!.isVisibleTo(1)).toBe(zone === 'hand');
      expectViewsAgree(s.game, [card!, other!]);
    });
  }

  it('showToAll on a card in an owner-only hand reveals it to every seat and spectators', () => {
    const { game, hand } = setup();
    const [card, other] = hand.createMany(2, Card, 'card', (i) => ({ name: `c${i}` }));
    card!.showToAll();

    for (const seat of [1, 2, 3, null]) expect(revealedIn(game, seat, card!)).toBe(true);
    expectViewsAgree(game, [card!, other!]);
  });

  it('a hideContentsFrom deck with one card granted back to the denied seat', () => {
    const { game } = setup();
    const pile = game.create(Space, 'pile');
    pile.hideContentsFrom(2, 3);
    const [card, other] = pile.createMany(2, Card, 'card', (i) => ({ name: `c${i}` }));
    card!.addVisibleTo(2);

    expect(card!.isVisibleTo(2)).toBe(true);
    expect(card!.isVisibleTo(3)).toBe(false);
    expectViewsAgree(game, [card!, other!]);
  });

  it('a contentsHidden zone sends only the granted card, still without its size', () => {
    const { game, deck } = setup();
    deck.contentsHidden();
    const [card, other] = deck.createMany(3, Card, 'card', (i) => ({ name: `c${i}` }));
    card!.showOnlyTo(2);

    const deckFor = (seat: number) => game.toJSONForPlayer(seat).children!.find((c) => c.name === 'deck')!;
    expect(deckFor(2).children?.map((c) => c.name)).toEqual(['c0']);
    expect('childCount' in deckFor(2)).toBe(false);
    expect('children' in deckFor(3)).toBe(false);
    expectViewsAgree(game, [card!, other!]);
  });

  it('the rest of a count-only deck keep their placeholders, count and order', () => {
    const { game, deck } = setup();
    const cards = deck.createMany(3, Card, 'card', (i) => ({ name: `c${i}` }));
    cards[1]!.addVisibleTo(2);

    const deckJson = game.toJSONForPlayer(2).children!.find((c) => c.name === 'deck')!;
    expect(deckJson.childCount).toBe(3);
    expect(deckJson.children!.map((c) => c.id)).toEqual([-1, cards[1]!.id, -2]);
  });

  it('isVisibleTo agrees with the view across zone and grant combinations', () => {
    const zones: Array<(space: Space<TestGame>) => void> = [
      (z) => z.contentsHidden(),
      (z) => z.contentsCountOnly(),
      (z) => z.contentsVisibleToOwner(),
      (z) => z.hideContentsFrom(1, 2),
      (z) => { z.contentsHidden(); z.addZoneVisibleTo(3); },
      () => {},
    ];
    const grants: Array<(card: Card) => void> = [
      (c) => c.addVisibleTo(2),
      (c) => c.addVisibleTo(1, 3),
      (c) => c.showOnlyTo(3),
      (c) => c.showToAll(),
      (c) => c.hideFromAll(),
      (c) => c.hideFrom(1),
      (c) => c.showToOwner(),
      () => {},
    ];
    for (const [z, applyZone] of zones.entries()) {
      for (const [g, grant] of grants.entries()) {
        const game = new TestGame({ playerCount: 3 });
        const zone = game.create(Space, `zone-${z}-${g}`);
        zone.player = game.getPlayer(1)!;
        applyZone(zone);
        const cards = zone.createMany(3, Card, 'card', (i) => ({ name: `c${i}` }));
        grant(cards[1]!);
        expectViewsAgree(game, cards);
      }
    }
  });

  it('a card peeked in the deck and drawn into a hand follows the hand, plus the peeking seat', () => {
    const { game, deck, hand } = setup();
    const [card, other] = deck.createMany(2, Card, 'card', (i) => ({ name: `c${i}` }));
    card!.addVisibleTo(2);
    card!.putInto(hand);

    expect(card!.isVisibleTo(1)).toBe(true);
    expect(card!.isVisibleTo(2)).toBe(true);
    expect(card!.isVisibleTo(3)).toBe(false);
    expectViewsAgree(game, [card!, other!]);
  });

  it('keeps a grant on a card with its own setting (hideFromAll, then addVisibleTo)', () => {
    const { game } = setup();
    const table = game.create(Space, 'table');
    const card = table.create(Card, 'c0');
    card.hideFromAll();
    card.addVisibleTo(3);

    expect([1, 2, 3].map((seat) => card.isVisibleTo(seat))).toEqual([false, false, true]);
    expectViewsAgree(game, [card]);
  });

  it('a grant survives a checkpoint round trip and still follows the zone after it', () => {
    const { game, deck } = setup();
    const card = deck.create(Card, 'c0');
    card.addVisibleTo(2);

    const restored = new TestGame(options);
    restored.loadSerializedState(game.toJSON());
    const restoredCard = restored.first(Card, 'c0')!;
    expect([1, 2, 3].map((seat) => restoredCard.isVisibleTo(seat))).toEqual([false, true, false]);
    restoredCard.putInto(restored.first(Hand, 'hand')!);
    expect([1, 2, 3].map((seat) => restoredCard.isVisibleTo(seat))).toEqual([true, true, false]);
  });

  it('projection signatures tell a granted seat from one that is not', () => {
    const game = new TestGame(options);
    game.create(Deck, 'deck').createMany(2, Card, 'card', (i) => ({ name: `c${i}` }))[0]!.addVisibleTo(2);

    const [granted, other] = game.projectionSignaturesFor([2, 3])!;
    expect(granted).not.toBe(other);
  });
});
