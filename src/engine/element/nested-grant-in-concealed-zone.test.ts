/**
 * A granted element nested below a concealed zone's child (#961): the granted
 * seat's view carries it as a child of the concealed zone, after the zone's
 * placeholders, and the containers between stay hidden (no id, name or count).
 * `isVisibleTo` says exactly what each seat's view shows.
 */
import { describe, it, expect } from 'vitest';
import { Game, Piece, Player, Deck, Hand, Space, type ElementJSON, type GameElement, type GameOptions } from '../index.js';
import { isHiddenPlaceholder } from './hidden-placeholder.js';
import { nameableFor } from './concealed-refs.js';

class Card extends Piece<TestGame> {}
class Box extends Space<TestGame> {}
class TestGame extends Game<TestGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Card, Box]);
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
      expect(json.children!.map((c) => c.id)).toEqual([-1, -2, gem.id]);
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
    expect(json.children!.map((c) => c.id)).toEqual([-1, gem.id]);
    expect('childCount' in json).toBe(false);
    expect(zoneIn(game, 3, 'hand').children!.map((c) => c.id)).toEqual([-1]);
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

  it('sends a granted container with its own visible contents, and nothing below a grant twice', () => {
    const { game, deck } = setup();
    deck.contentsHidden();
    const crate = deck.create(Box, 'crate');
    const chest = crate.create(Box, 'chest');
    chest.showToAll();
    chest.contentsVisible();
    const coin = chest.create(Card, 'coin');

    const children = zoneIn(game, 2, 'deck').children!;
    expect(children.map((c) => c.id)).toEqual([chest.id]);
    expect(children[0]!.children!.map((c) => c.id)).toEqual([coin.id]);
    expect(coin.isVisibleTo(2)).toBe(true);
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

  it('for every element and seat, across 200 trees four levels deep', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const next = random(seed);
      const pick = <T,>(list: T[]): T => list[Math.floor(next() * list.length)]!;
      const game = new TestGame({ playerCount: 3, elementIdKey: '0000000000000961' });
      const elements: GameElement[] = [];
      const grow = (parent: Game | Box, depth: number) => {
        for (let i = 0; i < 2; i++) {
          const leaf = depth === 4 || next() < 0.3;
          const element: GameElement = leaf ? parent.create(Card, `e${elements.length}`) : parent.create(Box, `e${elements.length}`);
          if (next() < 0.3) element.player = game.getPlayer(1 + Math.floor(next() * 3))!;
          pick(owns)(element);
          elements.push(element);
          if (!leaf) {
            pick(zones)(element as Box);
            grow(element as Box, depth + 1);
          }
        }
      };
      grow(game, 1);
      for (const seat of SEATS) {
        const view = game.toJSONForPlayer(seat);
        for (const element of elements) {
          expect(element.isVisibleTo(seat ?? -1), `${element.name} for seat ${seat}, seed ${seed}`).toBe(
            revealedIn(view, element),
          );
        }
      }
    }
  });
});
