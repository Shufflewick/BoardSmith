import { describe, it, expect, beforeEach } from 'vitest';
import { Game, Piece, Player, Deck, Hand, Space } from '../index.js';

// Regression test for audit finding F32: Deck and Hand must be secure-by-default.
// A freshly-created Deck hides its contents (faces AND order) from everyone, and a
// freshly-created Hand reveals its contents only to its owner. Designers can still
// opt into more visibility via the existing override methods.

class TestGame extends Game<TestGame, Player> {}

class Card extends Piece<TestGame> {
  suit!: string;
  rank!: string;
}

function findByName(children: any[] | undefined, name: string): any {
  return children?.find((c) => c.name === name);
}

describe('Deck/Hand secure-by-default visibility (F32)', () => {
  let game: TestGame;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
  });

  it('hides a fresh Deck\'s card faces but not its size (draw-pile default: count-only)', () => {
    const deck = game.create(Deck, 'draw-pile');
    deck.createMany(3, Card, 'card', (i) => ({ suit: 'H', rank: String(i + 1) }));

    // A draw pile on a real table: you cannot read the cards, but you can see
    // how many are left. Games depend on that — a card-back stack renders one
    // back per remaining card, and scoring UIs read "cards remaining".
    //
    // This asserted true concealment (no childCount) while 'hidden' and
    // 'count-only' were synonyms and Deck's default said 'hidden'. When D24
    // gave 'hidden' real true-concealment semantics, the default was not
    // revisited, and every game silently lost its deck count. Deck now defaults
    // to count-only; a pile whose SIZE is also secret opts in via
    // contentsHidden() (go-fish's pond does exactly that).
    const view = game.toJSONForPlayer(2);
    const deckJson = findByName(view.children, 'draw-pile');

    expect(deckJson).toBeDefined();
    expect(deckJson.childCount).toBe(3);
    // Faces stay concealed: placeholders only, carrying no identity.
    for (const child of deckJson.children ?? []) {
      expect(child.attributes?.__hidden).toBe(true);
      expect(child.attributes?.suit).toBeUndefined();
      expect(child.attributes?.rank).toBeUndefined();
    }
  });

  it('a Deck opted into contentsHidden() conceals its size too (SPACE-03/D24: true concealment)', () => {
    const deck = game.create(Deck, 'secret-bag');
    deck.createMany(3, Card, 'card', (i) => ({ suit: 'H', rank: String(i + 1) }));
    // The mode still exists and still means what D24 says: a non-owner cannot
    // even distinguish empty from full. It is now opt-in rather than the
    // default, which is what a "bag" wants and a "draw pile" does not.
    deck.contentsHidden();

    const deckJson = findByName(game.toJSONForPlayer(2).children, 'secret-bag');

    expect(deckJson).toBeDefined();
    expect('childCount' in deckJson).toBe(false);
    expect('children' in deckJson).toBe(false);
  });

  it('reveals a fresh Hand contents only to its owner', () => {
    const hand = game.create(Hand, 'hand-1');
    hand.player = game.getPlayer(1)!;
    hand.createMany(2, Card, 'card', (i) => ({ suit: 'S', rank: String(i + 1) }));

    const ownerView = game.toJSONForPlayer(1);
    const opponentView = game.toJSONForPlayer(2);

    const ownerCards = findByName(ownerView.children, 'hand-1')?.children ?? [];
    const opponentCards = findByName(opponentView.children, 'hand-1')?.children ?? [];

    expect(ownerCards.length).toBe(2);
    for (const card of ownerCards) {
      expect(card.attributes.__hidden).toBeUndefined();
      expect(card.attributes.suit).toBe('S');
    }

    expect(opponentCards.length).toBe(2);
    for (const card of opponentCards) {
      expect(card.attributes.__hidden).toBe(true);
      expect(card.attributes.suit).toBeUndefined();
    }
  });

  it('still lets a designer opt into full visibility via contentsVisible()', () => {
    const deck = game.create(Deck, 'open-pile');
    deck.contentsVisible(); // explicit override after the secure constructor default
    deck.createMany(3, Card, 'card', (i) => ({ suit: 'H', rank: String(i + 1) }));

    const view = game.toJSONForPlayer(2);
    const cards = findByName(view.children, 'open-pile')?.children ?? [];

    expect(cards.length).toBe(3);
    for (const card of cards) {
      expect(card.attributes.__hidden).toBeUndefined();
      expect(card.attributes.suit).toBe('H');
    }
  });
});

describe('SPACE-03/D24: hidden-mode child-count no longer leaks (count-only unaffected)', () => {
  class SecretSpace extends Space<TestGame> {}
  class CountedSpace extends Space<TestGame> {}

  let game: TestGame;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
  });

  it('a hidden Space exposes neither childCount nor children to a non-owner', () => {
    const zone = game.create(SecretSpace, 'secret-zone');
    zone.contentsHidden();
    zone.createMany(4, Card, 'card', (i) => ({ suit: 'H', rank: String(i + 1) }));

    const view = game.toJSONForPlayer(2);
    const zoneJson = findByName(view.children, 'secret-zone');

    expect(zoneJson).toBeDefined();
    expect('childCount' in zoneJson).toBe(false);
    expect('children' in zoneJson).toBe(false);
  });

  it('a count-only Space still exposes childCount and anonymized placeholders to a non-owner', () => {
    const zone = game.create(CountedSpace, 'counted-zone');
    zone.contentsCountOnly();
    zone.createMany(4, Card, 'card', (i) => ({ suit: 'H', rank: String(i + 1) }));

    const view = game.toJSONForPlayer(2);
    const zoneJson = findByName(view.children, 'counted-zone');

    expect(zoneJson.childCount).toBe(4);
    const cards = zoneJson.children ?? [];
    expect(cards.length).toBe(4);
    for (const card of cards) {
      expect(card.attributes.__hidden).toBe(true);
      expect(card.attributes.suit).toBeUndefined();
      expect(card.id).toBeLessThan(0);
    }
  });

  it('the suppression is specific to hidden-mode zones, not the Space itself (default/all-visible control)', () => {
    // Concealment is per-mode, not per-owner: 'hidden' mode has no owner
    // concept (that is 'owner' mode's job -- see the pre-existing Hand test
    // above, which already proves the real owner still sees their own
    // 'owner'-mode contents unaffected by this change). This control proves
    // the SAME Space class reveals real children when zone visibility is
    // left at its default ('all'/unset), isolating the suppression above to
    // 'hidden' mode specifically.
    const zone = game.create(SecretSpace, 'visible-zone');
    zone.createMany(4, Card, 'card', (i) => ({ suit: 'H', rank: String(i + 1) }));

    const view = game.toJSONForPlayer(2);
    const zoneJson = findByName(view.children, 'visible-zone');
    const cards = zoneJson.children ?? [];

    expect(cards.length).toBe(4);
    for (const card of cards) {
      expect(card.attributes.__hidden).toBeUndefined();
      expect(card.attributes.suit).toBe('H');
    }
  });
});

describe('SPACE-03/F-09: addZoneVisibleTo grants reveal a hidden zone to the granted seat', () => {
  class SecretSpace extends Space<TestGame> {}
  let game: TestGame;

  beforeEach(() => {
    game = new TestGame({ playerCount: 3 });
  });

  it('a seat granted via addZoneVisibleTo sees the REAL children of a hidden zone', () => {
    const zone = game.create(SecretSpace, 'secret-zone');
    zone.contentsHidden();
    zone.addZoneVisibleTo(1); // grant seat 1 vision
    zone.createMany(3, Card, 'card', (i) => ({ suit: 'S', rank: String(i + 1) }));

    // Granted seat 1: real children, real attributes.
    const grantedView = game.toJSONForPlayer(1);
    const grantedZone = findByName(grantedView.children, 'secret-zone');
    const grantedCards = grantedZone.children ?? [];
    expect(grantedCards.length).toBe(3);
    for (const card of grantedCards) {
      expect(card.attributes.__hidden).toBeUndefined();
      expect(card.attributes.suit).toBe('S');
      expect(card.id).toBeGreaterThan(0); // real id, not an anonymized placeholder
    }

    // Non-granted seat 2: still fully concealed (no children/childCount).
    const otherView = game.toJSONForPlayer(2);
    const otherZone = findByName(otherView.children, 'secret-zone');
    expect('children' in otherZone).toBe(false);
    expect('childCount' in otherZone).toBe(false);
  });

  it('a seat granted on a count-only zone sees real children (grant overrides count-only)', () => {
    const zone = game.create(SecretSpace, 'counted-zone');
    zone.contentsCountOnly();
    zone.addZoneVisibleTo(1);
    zone.createMany(2, Card, 'card', (i) => ({ suit: 'D', rank: String(i + 1) }));

    const grantedZone = findByName(game.toJSONForPlayer(1).children, 'counted-zone');
    const cards = grantedZone.children ?? [];
    expect(cards.length).toBe(2);
    for (const card of cards) {
      expect(card.attributes.suit).toBe('D');
      expect(card.attributes.__hidden).toBeUndefined();
    }
  });
});

// #149: `drawTo` was a single generic signature, `drawTo<T extends Piece>(dest,
// count?, elementClass?): T[]`, whose body bridged the default with
// `Piece as unknown as ElementClass<T>`. Nothing tied `T` to what the deck
// actually holds, so `deck.drawTo<Card>(hand, 5)` -- naming no class at all --
// typed a pile of plain pieces as cards. It is two overloads now: name the
// class to get it back typed, or get `Piece[]`.
describe('Deck#drawTo only promises the element type it was asked for (#149)', () => {
  class Token extends Piece<TestGame> {}

  it('returns Piece[] when no class is named, and the named class when one is', () => {
    const game = new TestGame({ playerCount: 2 });
    const deck = game.create(Deck, 'deck');
    const hand = game.create(Hand, 'hand');
    deck.create(Card, 'card-1', { suit: 'hearts', rank: 'A' });
    // A Deck stacks, so the last piece created is the top one drawn first.
    deck.create(Token, 'token-1');

    const anyPiece = deck.drawTo(hand, 1);
    expect(anyPiece.map(p => p.name)).toEqual(['token-1']);
    // Typed `Piece[]`: reading a Card field off it must not compile.
    // @ts-expect-error - a Piece has no `suit`
    void anyPiece[0].suit;

    const cards: Card[] = deck.drawTo(hand, 1, Card);
    expect(cards[0]?.suit).toBe('hearts');
  });
});
