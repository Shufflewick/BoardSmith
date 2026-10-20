/**
 * A granted element nested below a concealed zone's child (#961): the granted
 * seat's view carries it as a child of the concealed zone, after the zone's
 * placeholders, and the containers between stay hidden (no id, name or count).
 * `isVisibleTo` says exactly what each seat's view shows.
 */
import { describe, it, expect } from 'vitest';
import { Game, Piece, Player, Deck, Hand, Space, type ElementJSON, type GameElement, type GameOptions } from '../index.js';
import type { VisibilityState } from './visibility.js';
import { isHiddenPlaceholder } from './hidden-placeholder.js';
import { nameableFor } from './concealed-refs.js';
import { seatIdOf } from './seat-placeholders.js';
import { getElementCount } from '../../ui/composables/useGameViewHelpers.js';
import type { GameViewElement } from '../../ui/types.js';

class Card extends Piece<TestGame> {}
class Box extends Space<TestGame> {}
/** A box whose `secret` only its owner is sent (`visibleAttributes`). */
class SecretBox extends Box {
  static override visibleAttributes = [];
  secret = 'gold';
}
class TestGame extends Game<TestGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Card, Box, SecretBox]);
  }
}

const SEATS = [1, 2, 3, null] as const;

/** Whether `seat`'s view (null: spectator) carries `element` under its real id, unhidden. */
function revealedIn(view: ElementJSON, element: GameElement): boolean {
  const find = (node: ElementJSON): ElementJSON | undefined =>
    node.id === element.id ? node : node.children?.map(find).find((n) => n !== undefined);
  const node = find(view);
  return node !== undefined && !isHiddenPlaceholder(node) && node.name === element.name;
}

/** Every id anywhere in a view. */
function idsIn(node: ElementJSON): number[] {
  return [node.id, ...(node.children ?? []).flatMap(idsIn)];
}

function setup() {
  const game = new TestGame({ playerCount: 3, elementIdKey: '0000000000000961' });
  const deck = game.create(Deck, 'deck');
  const hand = game.create(Hand, 'hand');
  hand.player = game.getPlayer(1)!;
  return { game, deck, hand };
}

/** A box holding a granted gem and an ungranted stone, inside `zone`. */
function nest(zone: Space<TestGame>) {
  const crate = zone.create(Box, 'crate');
  const gem = crate.create(Card, 'gem');
  const stone = crate.create(Card, 'stone');
  return { crate, gem, stone };
}

const zoneIn = (game: TestGame, seat: number | null, name: string) =>
  game.toJSONForPlayer(seat).children!.find((c) => c.name === name)!;

describe('a granted element nested below a concealed child (#961)', () => {
  it('a contentsHidden zone sends the granted seat only the nested card, as its own child', () => {
    const { game, deck } = setup();
    deck.contentsHidden();
    const { crate, gem, stone } = nest(deck);
    gem.addVisibleTo(2);

    const granted = zoneIn(game, 2, 'deck');
    expect(granted.children!.map((c) => [c.id, c.name])).toEqual([[gem.id, 'gem']]);
    expect('childCount' in granted).toBe(false);
    const bytes = JSON.stringify(game.toJSONForPlayer(2));
    expect(bytes).not.toContain('crate');
    expect(bytes).not.toContain('stone');
    expect(idsIn(game.toJSONForPlayer(2))).not.toContain(crate.id);
    expect('children' in zoneIn(game, 3, 'deck')).toBe(false);

    expect(gem.isVisibleTo(2)).toBe(true);
    expect(gem.isVisibleTo(3)).toBe(false);
    expect(crate.isVisibleTo(2)).toBe(false);
    expect(stone.isVisibleTo(2)).toBe(false);
  });

  it("a count-only deck keeps one placeholder per direct child and puts the nested card after them", () => {
    const { game, deck } = setup();
    const { crate, gem } = nest(deck);
    const loose = deck.create(Card, 'loose');
    gem.showToAll();

    for (const seat of SEATS) {
      const json = zoneIn(game, seat, 'deck');
      expect(json.childCount).toBe(2);
      expect(json.children!.map((c) => c.id)).toEqual([...deck._t.children.map((c) => seatIdOf(c, seat ?? -1)), gem.id]);
      expect(json.children![2]!.name).toBe('gem');
      expect(idsIn(game.toJSONForPlayer(seat))).not.toContain(crate.id);
      expect(idsIn(game.toJSONForPlayer(seat))).not.toContain(loose.id);
    }
  });

  it("an owner-only hand shows another seat the nested card after the hand's placeholders", () => {
    const { game, hand } = setup();
    const { crate, gem, stone } = nest(hand);
    gem.addVisibleTo(2);

    const json = zoneIn(game, 2, 'hand');
    expect(json.children!.map((c) => c.id)).toEqual([seatIdOf(crate, 2), gem.id]);
    // The hand holds one card, the crate; the gem inside it is not a second (#1208).
    expect(json.childCount).toBe(1);
    expect(getElementCount(json as GameViewElement)).toBe(1);
    expect(zoneIn(game, 3, 'hand').children!.map((c) => c.id)).toEqual([seatIdOf(crate, 3)]);
    // The owner sees the hand as it is.
    expect(zoneIn(game, 1, 'hand').children!.map((c) => c.id)).toEqual([crate.id]);
    for (const seat of SEATS) {
      for (const element of [crate, gem, stone]) {
        expect(element.isVisibleTo(seat ?? -1), `${element.name} for seat ${seat}`).toBe(
          revealedIn(game.toJSONForPlayer(seat), element),
        );
      }
    }
  });

  it('reaches through hidden, count-only and individually hidden containers alike', () => {
    const { game, deck } = setup();
    deck.contentsHidden();
    const outer = deck.create(Box, 'outer');
    outer.hideFromAll();
    const inner = outer.create(Box, 'inner');
    inner.contentsCountOnly();
    const gem = inner.create(Card, 'gem');
    gem.showOnlyTo(3);

    expect(zoneIn(game, 3, 'deck').children!.map((c) => c.id)).toEqual([gem.id]);
    expect(gem.isVisibleTo(3)).toBe(true);
    expect([outer, inner].map((box) => box.isVisibleTo(3))).toEqual([false, false]);
    expect(JSON.stringify(game.toJSONForPlayer(3))).not.toMatch(/outer|inner/);
  });

  it("applies a granted container's own zone rule to its contents", () => {
    const { game, deck } = setup();
    deck.contentsHidden();
    const crate = deck.create(Box, 'crate');
    const chest = crate.create(Box, 'chest');
    chest.showToAll();
    chest.contentsVisible();
    const coin = chest.create(Card, 'coin');
    const ring = chest.create(Card, 'ring');
    ring.addVisibleTo(2);

    const children = zoneIn(game, 2, 'deck').children!;
    expect(children.map((c) => c.id)).toEqual([chest.id]);
    expect(children[0]!.children!.map((c) => c.id)).toEqual([coin.id, ring.id]);
    expect(coin.isVisibleTo(2)).toBe(true);
    expect(nameableFor(coin, game, 2)).toBe(coin);
  });

  it("sends a granted container with no zone rule of its own only its granted contents, as the rule they inherit sits on a hidden box", () => {
    const { game, deck } = setup();
    deck.contentsHidden();
    const crate = deck.create(Box, 'crate');
    crate.contentsVisible();
    const chest = crate.create(Box, 'chest');
    chest.showToAll();
    const coin = chest.create(Card, 'coin');
    const ring = chest.create(Card, 'ring');
    ring.addVisibleTo(2);

    const children = zoneIn(game, 2, 'deck').children!;
    expect(children.map((c) => c.id)).toEqual([chest.id]);
    expect(children[0]!.children!.map((c) => c.id)).toEqual([ring.id]);
    expect(coin.isVisibleTo(2)).toBe(false);
    expect(ring.isVisibleTo(2)).toBe(true);
    expect(nameableFor(coin, game, 2)).toBe(chest);
  });

  it('sends a granted count-only deck below a hidden child with its placeholders and childCount', () => {
    const { game } = setup();
    const vault = game.create(Box, 'vault');
    vault.contentsHidden();
    const crate = vault.create(Box, 'crate');
    const pile = crate.create(Deck, 'pile');
    pile.showToAll();
    const cards = [1, 2, 3].map((n) => pile.create(Card, `card${n}`));

    const json = zoneIn(game, 2, 'vault').children![0]!;
    expect(json.id).toBe(pile.id);
    expect(json.childCount).toBe(3);
    expect(json.children!.map(isHiddenPlaceholder)).toEqual([true, true, true]);
    expect(getElementCount(json as GameViewElement)).toBe(3);
    expect(pile.isVisibleTo(2)).toBe(true);
    expect(cards.map((card) => card.isVisibleTo(2))).toEqual([false, false, false]);
  });

  it("does not send a card with no grant of its own below a hidden box whose contents are visible", () => {
    const { game, deck } = setup();
    const crate = deck.create(Box, 'crate');
    crate.contentsVisible();
    const card = crate.create(Card, 'card');

    for (const seat of SEATS) {
      expect(idsIn(game.toJSONForPlayer(seat))).not.toContain(card.id);
      expect(card.isVisibleTo(seat ?? -1)).toBe(false);
    }
  });

  it("does not send another seat a card in seat 1's hand below a box that hides its contents only from seat 3", () => {
    const { game, hand } = setup();
    const crate = hand.create(Box, 'crate');
    crate.hideContentsFrom(3);
    const card = crate.create(Card, 'card');

    for (const seat of [2, 3, null]) {
      expect(idsIn(game.toJSONForPlayer(seat))).not.toContain(card.id);
      expect(card.isVisibleTo(seat ?? -1)).toBe(false);
    }
    expect(card.isVisibleTo(1)).toBe(true);
  });

  it('is not sent below an individually hidden card outside any concealed zone', () => {
    const { game } = setup();
    const table = game.create(Space, 'table');
    const covered = table.create(Card, 'covered');
    covered.hideFromAll();
    const under = covered.create(Card, 'under');
    under.showToAll();

    expect(revealedIn(game.toJSONForPlayer(2), under)).toBe(false);
    expect(under.isVisibleTo(2)).toBe(false);
  });

  it('is hidden again once the zone is shuffled, as a shuffle clears every grant below it (#962)', () => {
    const { game, deck } = setup();
    const { gem } = nest(deck);
    gem.addVisibleTo(2);
    deck.shuffle();

    expect(gem.isVisibleTo(2)).toBe(false);
    expect(revealedIn(game.toJSONForPlayer(2), gem)).toBe(false);
  });

  it('names the nested card in message text for the granted seat, and the zone for the rest (#1165)', () => {
    const { game, deck } = setup();
    deck.contentsHidden();
    const { gem } = nest(deck);
    gem.addVisibleTo(2);

    const top = deck.create(Card, 'top');
    top.addVisibleTo(2);

    expect(nameableFor(gem, game, 2)).toBe(gem);
    expect(nameableFor(gem, game, 3)).toBe(deck);
    expect(nameableFor(top, game, 2)).toBe(top);
  });

  it("still writes a reference to the nested card as the zone, since its place would show the hidden containers", () => {
    const { game, deck } = setup();
    deck.contentsHidden();
    const { gem } = nest(deck);
    gem.addVisibleTo(2);
    game.animate('peek', { gem });

    const view = game.toJSONForPlayer(2) as ElementJSON & { animationEvents?: { data: Record<string, unknown> }[] };
    expect(view.animationEvents![0]!.data.gem).toEqual({ __elementRef: deck.branch() });
  });
});

/** The owner `view` gives `element` (#1209): its own player, or its parent's when the view carries the parent, else none. */
function seenOwner(view: ElementJSON, element: GameElement): number | undefined {
  if (element.player) return element.player.seat;
  const parent = element._t.parent;
  return parent && revealedIn(view, parent) ? seenOwner(view, parent) : undefined;
}

/** Whether a visibility rule on `element` shows the seat whose view is `view`, written out apart from the engine's. */
function shows(rule: VisibilityState, element: GameElement, seat: number, view: ElementJSON): boolean {
  if (rule.addPlayers?.includes(seat)) return true;
  if (rule.exceptPlayers?.includes(seat)) return false;
  return rule.mode === 'all' || (rule.mode === 'owner' && seenOwner(view, element) === seat);
}

/** `element`'s ancestors, nearest first, up to the one whose zone rule it inherits, or to the top when none has one. */
function ancestorsToRule(element: GameElement): GameElement[] {
  const chain: GameElement[] = [];
  for (let at = element._t.parent; at; at = at._t.parent) {
    chain.push(at);
    if ('getZoneVisibility' in at && (at as Box).getZoneVisibility() !== undefined) break;
  }
  return chain;
}

/** Whether `element`'s parent is a zone whose contents the seat may not see. */
function inConcealedZone(element: GameElement, seat: number, view: ElementJSON): boolean {
  const parent = element._t.parent;
  const zone = parent && 'getZoneVisibility' in parent ? (parent as Box).getZoneVisibility() : undefined;
  return zone !== undefined && !shows(zone, parent!, seat, view);
}

/** Whether the element's own setting, not one it inherits, shows it to the seat. */
function ownGrant(element: GameElement, seat: number, view: ElementJSON): boolean {
  const own = element._visibility;
  return own !== undefined && (own.explicit ? shows(own, element, seat, view) : own.addPlayers?.includes(seat) === true);
}

function forEachNode(node: ElementJSON, visit: (node: ElementJSON) => void): void {
  visit(node);
  for (const child of node.children ?? []) forEachNode(child, visit);
}

describe('isVisibleTo matches the seat view on random trees (#961)', () => {
  /** A seeded generator, so a failure names a tree that can be rebuilt. */
  function random(seed: number): () => number {
    let s = seed;
    return () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  }
  const owns: Array<(e: GameElement) => void> = [
    () => {},
    () => {},
    (e) => e.hideFromAll(),
    (e) => e.showToAll(),
    (e) => e.addVisibleTo(2),
    (e) => e.showOnlyTo(3),
    (e) => e.hideFrom(1),
    (e) => e.showToOwner(),
  ];
  const zones: Array<(s: Box) => void> = [
    () => {},
    () => {},
    (s) => s.contentsHidden(),
    (s) => s.contentsCountOnly(),
    (s) => s.contentsVisibleToOwner(),
    (s) => s.hideContentsFrom(2),
    (s) => s.contentsVisible(),
  ];

  /** A random tree, two children per level, four levels deep, each element given a random owner and setting. */
  function randomTree(seed: number): { game: TestGame; elements: GameElement[] } {
    const next = random(seed);
    const pick = <T,>(list: T[]): T => list[Math.floor(next() * list.length)]!;
    const game = new TestGame({ playerCount: 3, elementIdKey: '0000000000000961' });
    const elements: GameElement[] = [];
    const grow = (parent: Game | Box, depth: number) => {
      for (let i = 0; i < 2; i++) {
        const leaf = depth === 4 || next() < 0.3;
        const element: GameElement = leaf ? parent.create(Card, `e${elements.length}`) : parent.create(SecretBox, `e${elements.length}`);
        if (next() < 0.3) element.player = game.getPlayer(1 + Math.floor(next() * 3))!;
        pick(owns)(element);
        elements.push(element);
        if (leaf) continue;
        pick(zones)(element as Box);
        grow(element as Box, depth + 1);
      }
    };
    grow(game, 1);
    return { game, elements };
  }

  /** What the seat's view must and must not carry for one element. */
  function checkElement(view: ElementJSON, ids: Set<number>, element: GameElement, seat: number, where: string): void {
    expect(element.isVisibleTo(seat), where).toBe(revealedIn(view, element));
    // Checked without the rule under test: without its own grant, an element is shown only by a rule the seat can see, on an ancestor the view carries with all between.
    if (revealedIn(view, element) && !ownGrant(element, seat, view)) {
      for (const ancestor of ancestorsToRule(element)) expect(revealedIn(view, ancestor), `${where}, via ${ancestor.name}`).toBe(true);
    }
    // A hidden container keeps its real id only as a placeholder in a parent whose contents the seat sees.
    const hidden = !shows(element.getEffectiveVisibility(), element, seat, view);
    if (hidden && (inConcealedZone(element, seat, view) || !revealedIn(view, element._t.parent!))) expect(ids.has(element.id), where).toBe(false);
  }

  /**
   * Safety, judged by the element's real owner (`getEffectiveOwner`), not by how the view resolves owners:
   * an owner rule (`showToOwner`, `contentsVisibleToOwner`, `visibleAttributes`) shows only that owner,
   * and any other seat is shown the element only through a rule that names it.
   */
  function checkOwnerOnly(view: ElementJSON, element: GameElement, seat: number, where: string): void {
    const realOwner = element.getEffectiveOwner()?.seat;
    const rule = element.getEffectiveVisibility();
    if (revealedIn(view, element) && rule.mode === 'owner' && !rule.addPlayers?.includes(seat)) expect(seat, `${where}, by an owner rule`).toBe(realOwner);
    const find = (node: ElementJSON): ElementJSON | undefined =>
      node.id === element.id ? node : node.children?.map(find).find((n) => n !== undefined);
    if (find(view)?.attributes?.secret !== undefined) expect(seat, `${where}, its secret`).toBe(realOwner);
  }

  /** A node's `childCount`, where sent, is its element's real number of children. */
  function checkChildCount(game: TestGame, view: ElementJSON, node: ElementJSON, seat: number, where: string): void {
    const element = game.getElementById(node.id);
    const zone = element instanceof Space && !isHiddenPlaceholder(node) ? element.getZoneVisibility() : undefined;
    // A zone the view carries with one placeholder per child, as the seat cannot see into it, always says how many it holds (#1208).
    const mustCount = zone !== undefined && zone.mode !== 'hidden' && !shows(zone, element!, seat, view);
    if (mustCount || node.childCount !== undefined) expect(node.childCount, where).toBe(element!._t.children.length);
  }

  it('for every element and seat, across 200 trees four levels deep', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { game, elements } = randomTree(seed);
      for (const seat of SEATS) {
        const view = game.toJSONForPlayer(seat);
        const ids = new Set(idsIn(view));
        for (const element of elements) {
          const where = `${element.name} for seat ${seat}, seed ${seed}`;
          checkElement(view, ids, element, seat ?? -1, where);
          checkOwnerOnly(view, element, seat ?? -1, where);
        }
        forEachNode(view, (node) => checkChildCount(game, view, node, seat ?? -1, `${node.name} for seat ${seat}, seed ${seed}`));
      }
    }
  });

  /** Gives `element` each owner in turn, and checks the seat's view stays `view` while the element stays hidden from it. */
  function checkOwnerIrrelevant(game: TestGame, element: GameElement, seat: number | null, view: ElementJSON, where: string): void {
    const real = element.player;
    for (const owner of [undefined, ...game.all(Player)]) {
      element.player = owner;
      // Owning it may show the element itself to the seat, which is the element's own rule.
      if (!element.isVisibleTo(seat ?? -1)) expect(game.toJSONForPlayer(seat), `${where}, owned by ${owner?.seat}`).toEqual(view);
    }
    element.player = real;
  }

  it("never depends on the owner of an element the seat's view does not carry (#1209), across 60 trees", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const { game, elements } = randomTree(seed);
      for (const seat of SEATS) {
        const view = game.toJSONForPlayer(seat);
        const hidden = elements.filter((e) => !e.isVisibleTo(seat ?? -1));
        for (const element of hidden) checkOwnerIrrelevant(game, element, seat, view, `${element.name} for seat ${seat}, seed ${seed}`);
      }
    }
  });
});
