/**
 * `atId` answers from the game's id index (#632), and never differently from
 * a walk of the tree.
 *
 * The index is derived: the tree stays the one source of truth, and the index
 * answers only when the element it holds is still under the element asked.
 * These cases pin every way an element enters, moves within, or leaves a
 * tree (create, move, remove to the pile, in-place restore, world adoption
 * and eviction), and a seeded run of random operations compares every lookup
 * with a plain walk after each one.
 */
import { describe, it, expect } from 'vitest';
import { Game, GameElement, Space, Piece, Player, type ElementJSON, type GameOptions } from '../index.js';
import { TEST_WORLD_ELEMENT_ID_KEY } from './world-element-id-key.test-helper.js';

class IndexGame extends Game<IndexGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Card, Zone]);
  }
}
class Card extends Piece<IndexGame> {}
class Zone extends Space<IndexGame> {}

/** The answer a walk gives: the first element in tree order with this id, as `atId` always answered. */
function walk(from: GameElement, id: number): GameElement | undefined {
  if (from._t.id === id) return from;
  for (const child of from._t.children) {
    const found = walk(child, id);
    if (found) return found;
  }
  return undefined;
}

/** Every element from `root` down, in tree order. */
function subtree(root: GameElement): GameElement[] {
  return [root, ...root._t.children.flatMap(subtree)];
}

/**
 * The elements in the game's tree the id index does not hold. A lookup of any
 * of them still answers right, by walking, so only this shows the index
 * falling behind.
 */
function unindexed(game: IndexGame): string[] {
  return subtree(game)
    .filter((element) => game._ctx._elementsById.get(element._t.id) !== element)
    .map((element) => `${element.name ?? element.constructor.name}#${element._t.id}`);
}

/** The game's state restored into a new game, as GameRunner.fromSnapshot and the bot's search do. */
function restoredFresh(game: IndexGame): IndexGame {
  const fresh = new IndexGame({ ...game.getConstructorOptions(), playerCount: 2 } as GameOptions);
  fresh.loadSerializedState(game.toJSON());
  // The runner puts the id counter back from the snapshot, after the tree.
  fresh._ctx.sequence = game._ctx.sequence;
  return fresh;
}

function table() {
  const game = new IndexGame({ playerCount: 2, seed: 'id-index' });
  const deck = game.create(Zone, 'deck');
  const hand = game.create(Zone, 'hand');
  deck.createMany(52, Card, 'card');
  return { game, deck, hand };
}

describe('atId looks an element up instead of walking the tree', () => {
  it('finds an element created after the game started', () => {
    const { game, hand } = table();
    const card = hand.create(Card, 'late');
    expect(game.atId(card.id)).toBe(card);
  });

  it('finds a moved element from the game and from its new parent, and not from its old one', () => {
    const { game, deck, hand } = table();
    const card = deck._t.children[3] as Card;
    card.putInto(hand);

    expect(game.atId(card.id)).toBe(card);
    expect(hand.atId(card.id)).toBe(card);
    expect(deck.atId(card.id)).toBeUndefined();
  });

  it('does not find a removed element in the tree, and getElementById finds it in the pile', () => {
    const { game, deck } = table();
    const card = deck._t.children[0] as Card;
    card.remove();

    expect(game.atId(card.id)).toBeUndefined();
    expect(game.pile.atId(card.id)).toBe(card);
    expect(game.getElementById(card.id)).toBe(card);
  });
});

describe('atId after an in-place restore (the undo path)', () => {
  it('answers with the rebuilt element, not the one the restore discarded', () => {
    const { game, deck } = table();
    const before = deck._t.children[5] as Card;
    game.loadSerializedState(game.toJSON());

    const rebuilt = game.atId(before.id);
    expect(rebuilt).toBe(walk(game, before.id));
    expect(rebuilt).not.toBe(before);
    expect(rebuilt?.name).toBe(before.name);
  });

  it('does not find an element created after the state it went back to', () => {
    const { game, hand } = table();
    const state = game.toJSON();
    const later = hand.create(Card, 'later');
    game.loadSerializedState(state);

    expect(game.atId(later.id)).toBeUndefined();
    expect(game.getElementById(later.id)).toBeUndefined();
  });

  it('finds a card removed after the state it went back to in the tree, and not in the pile', () => {
    // A restore puts the pile back as the state saved it (#655), so the card is only where the state put it.
    const { game, deck } = table();
    const state = game.toJSON();
    const card = deck._t.children[0] as Card;
    card.remove();
    game.loadSerializedState(state);

    expect(game.atId(card.id)).toBe(walk(game, card.id));
    expect(game.atId(card.id)).not.toBe(card);
    expect(game.pile.atId(card.id)).toBeUndefined();
  });
});

describe('the id index holds every element in the game tree', () => {
  it('after elements are created and moved', () => {
    const { game, deck, hand } = table();
    for (const card of deck._t.children.slice(0, 10)) (card as Card).putInto(hand);
    hand.create(Card, 'late');
    expect(unindexed(game)).toEqual([]);
  });

  it('after an in-place restore', () => {
    const { game, deck, hand } = table();
    const state = game.toJSON();
    deck.createMany(5, Card, 'late');
    (deck._t.children[0] as Card).putInto(hand);
    game.loadSerializedState(state);
    expect(unindexed(game)).toEqual([]);
  });

  it('after a restore into a fresh game, where the ids construction mints can be ids already restored', () => {
    // Cards made in play, then moved in front of the ones the constructor
    // made: rebuilding them mints, in order, ids the state already gave out.
    const { game, deck, hand } = table();
    for (let i = 0; i < 20; i++) hand.create(Card, `late${i}`).putInto(deck, { position: 'first' });
    expect(unindexed(restoredFresh(game))).toEqual([]);
  });

  it('after a world adopts a partition', () => {
    const game = new IndexGame({ playerCount: 2, seed: 'id-index-adopt', worldMode: true, elementIdKey: TEST_WORLD_ELEMENT_ID_KEY });
    const room = game.create(Zone, 'room');
    room.createMany(10, Card, 'token');
    game.definePartition(room.id);
    const json = JSON.parse(JSON.stringify(room.toJSON())) as ElementJSON;
    game.evictSubtree(room.id);
    game.adoptSubtree(game.id, json);
    expect(unindexed(game)).toEqual([]);
  });
});

describe('atId in world mode', () => {
  function world() {
    const game = new IndexGame({ playerCount: 2, seed: 'id-index-world', worldMode: true, elementIdKey: TEST_WORLD_ELEMENT_ID_KEY });
    const room = game.create(Zone, 'room');
    const token = room.create(Card, 'token');
    game.definePartition(room.id);
    game.takeTouchedPartitions();
    return { game, room, token };
  }

  it('does not find an evicted partition, and does not keep it in memory', () => {
    const { game, room, token } = world();
    game.evictSubtree(room.id);

    expect(game.atId(room.id)).toBeUndefined();
    expect(game.atId(token.id)).toBeUndefined();
    const held = [...game._ctx._elementsById.values()];
    expect(held).not.toContain(room);
    expect(held).not.toContain(token);
  });

  it('finds an adopted partition, and marks it reached as a walk did', () => {
    const { game, room, token } = world();
    const json = JSON.parse(JSON.stringify(room.toJSON())) as ElementJSON;
    game.evictSubtree(room.id);
    const adopted = game.adoptSubtree(game.id, json);
    game.takeTouchedPartitions();

    const found = game.atId(token.id);
    expect(found).toBe(walk(game, token.id));
    expect(found).not.toBe(token);
    expect(found?._t.parent).toBe(adopted);
  });
});

/** A small seeded generator, so a failing sequence can be replayed from its seed. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('atId never answers differently from a walk', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`over a random run of creates, moves, removals, shuffles and restores (seed ${seed})`, () => {
      const random = mulberry32(seed);
      const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
      let game = new IndexGame({ playerCount: 2, seed: `id-index-${seed}` });
      const zones = [game.create(Zone, 'a'), game.create(Zone, 'b')];
      zones[0].createMany(6, Card, 'card');
      const seen = new Set<number>();
      const states: ReturnType<IndexGame['toJSON']>[] = [];

      for (let step = 0; step < 200; step++) {
        const spaces = [...game.all(Zone)];
        const cards = [...game.all(Card)];
        // Each operation, as often as it appears here.
        const operations = [
          () => pick(spaces).create(Card, `c${step}`),
          () => pick(spaces).create(Card, `c${step}`),
          () => pick(spaces).create(Zone, `z${step}`),
          () => cards.length > 0 && pick(cards).putInto(pick(spaces)),
          () => cards.length > 0 && pick(cards).putInto(pick(spaces)),
          () => cards.length > 0 && pick(cards).remove(),
          () => pick(spaces).shuffle(),
          () => states.push(game.toJSON()),
          () => states.length > 0 && game.loadSerializedState(pick(states)),
          () => (game = restoredFresh(game)),
        ];
        pick(operations)();

        expect(unindexed(game)).toEqual([]);
        for (const element of [...subtree(game), ...subtree(game.pile)]) seen.add(element._t.id);
        const askers = [game, ...subtree(game.pile), ...game.all(GameElement)];
        for (const id of [...seen, -1]) {
          expect(game.atId(id)).toBe(walk(game, id));
          expect(game.pile.atId(id)).toBe(walk(game.pile, id));
          const asker = pick(askers);
          expect(asker.atId(id)).toBe(walk(asker, id));
        }
      }
    });
  }
});
