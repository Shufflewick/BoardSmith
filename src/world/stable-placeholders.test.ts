/**
 * A world names a hidden card by a stable placeholder of the asking seat's own
 * (#715): a card keeps it until it is shuffled or moved into another hidden
 * place, a placeholder names only that card, another seat's placeholder and a hidden card's real id
 * are refused, and a card in a fully hidden zone can be picked blind.
 */
import { describe, it, expect } from 'vitest';
import { Card, Game, Space, type GameOptions } from '../engine/index.js';
import type { ElementJSON } from '../engine/element/types.js';
import { createTestWorld } from '../testing/test-world.js';
import { worldAction, type WorldDefinition } from './index.js';

class Pouch extends Space<PouchWorld> {}
class Stash extends Space<PouchWorld> {}
class Deck extends Space<PouchWorld> {}
class Commons extends Space<PouchWorld> {}

class PouchWorld extends Game<PouchWorld> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Pouch, Stash, Deck, Commons, Card]);
  }
}

const inPouch = ({ game }: { game: PouchWorld }) => game.first(Pouch)!.all(Card);
const commons = (card: Card) => card.game.first(Commons)!;

const filch = worldAction<PouchWorld>('filch').chooseElement('card', {
  needs: () => ['commons'],
  elements: inPouch,
}).execute(({ card }) => {
  card.putInto(commons(card));
});

const peek = worldAction<PouchWorld>('peek').chooseElement('card', {
  needs: () => ['commons'],
  elements: inPouch,
}).chooseFrom('how', {
  needs: () => ['commons'],
  choices: () => ['gently'],
}).execute(() => {});

const stash = worldAction<PouchWorld>('stash').chooseElement('card', {
  needs: () => ['commons'],
  elements: inPouch,
}).execute(({ card }) => {
  card.putInto(commons(card).first(Stash)!);
});

const shake = worldAction<PouchWorld>('shake').needs(() => ['commons']).execute((_args, { game }) => {
  game.first(Pouch)!.shuffle();
});

const drawBlind = worldAction<PouchWorld>('drawBlind').chooseElement('card', {
  needs: () => ['commons'],
  elements: ({ game }) => game.first(Deck)!.all(Card),
}).execute(({ card }) => {
  card.putInto(commons(card));
});

const world: WorldDefinition = {
  maxPlayers: 3,
  actions: [filch, peek, stash, shake, drawBlind],
  view: () => ['commons'],
  genesis: (game: Game) => {
    const room = game.create(Commons, 'commons');
    const pouch = room.create(Pouch, 'pouch');
    pouch.contentsCountOnly();
    pouch.create(Card, 'AS');
    pouch.create(Card, 'KH');
    room.create(Stash, 'stash').contentsCountOnly();
    const deck = room.create(Deck, 'deck');
    deck.contentsHidden();
    for (const name of ['2C', '3C', '4C']) deck.create(Card, name);
    return { commons: room };
  },
} as WorldDefinition;

function find(node: ElementJSON, name: string): ElementJSON | undefined {
  if (node.name === name) return node;
  for (const child of node.children ?? []) {
    const found = find(child, name);
    if (found) return found;
  }
  return undefined;
}

async function started() {
  return createTestWorld({ definition: { gameClass: PouchWorld, world } });
}

/** The ids `seat` is offered for the pouch's cards, in pouch order. */
async function pouchIds(test: Awaited<ReturnType<typeof started>>, seat: number): Promise<number[]> {
  const pick = await test.resolvePick(seat, 'filch', 'card', {});
  return pick.validElements!.map((e) => e.id);
}

/** The names of the cards in the commons, as seat 1 sees them. */
async function commonsCards(test: Awaited<ReturnType<typeof started>>): Promise<string[]> {
  const view = await test.getPlayerView(1);
  return (find(view.state as ElementJSON, 'commons')!.children ?? [])
    .filter((c) => c.className === 'Card')
    .map((c) => c.name!);
}

async function realIdOf(test: Awaited<ReturnType<typeof started>>, name: string): Promise<number> {
  return (await test.unredactedElements()).find((e) => e.name === name)!.id;
}

describe("a world's stable per-seat placeholders (#715)", () => {
  it('refuses a placeholder whose card another seat took since, rather than taking the card left', async () => {
    const test = await started();
    const [ace] = await pouchIds(test, 1);
    const [seat2Ace] = await pouchIds(test, 2);
    await test.take(2, 'filch', { card: seat2Ace });

    await expect(test.take(1, 'filch', { card: ace })).rejects.toThrow();
    expect(await commonsCards(test)).toEqual(['AS']);
    await test.close();
  });

  it("refuses another seat's placeholder", async () => {
    const test = await started();
    const [, seat2King] = await pouchIds(test, 2);

    expect(await pouchIds(test, 1)).not.toContain(seat2King);
    await expect(test.take(1, 'filch', { card: seat2King })).rejects.toThrow();
    expect(await commonsCards(test)).toEqual([]);
    await test.close();
  });

  it('refuses the real id of a card the seat cannot see, in a command and in a pick', async () => {
    const test = await started();
    const king = await realIdOf(test, 'KH');

    await expect(test.take(1, 'filch', { card: king })).rejects.toThrow();
    // Refused as an answer it could not have been offered, the same as a card that is not there.
    await expect(test.resolvePick(1, 'peek', 'how', { card: king })).rejects.toMatchObject({ code: 'stale-draft' });
    await expect(test.resolvePick(1, 'peek', 'how', { card: 12345 })).rejects.toMatchObject({ code: 'stale-draft' });
    expect(await commonsCards(test)).toEqual([]);
    await test.close();
  });

  it('reissues a card moved into another hidden pile, keeps the rest, and keeps them through a wake', async () => {
    const test = await started();
    const [ace, king] = await pouchIds(test, 1);
    await test.take(1, 'stash', { card: ace });

    const stashed = () => test.getPlayerView(1).then((view) => find(view.state as ElementJSON, 'stash')!.children!.map((c) => c.id));
    const [moved] = await stashed();
    expect(moved).toBeLessThan(0);
    expect([ace, king]).not.toContain(moved);
    await expect(test.take(1, 'filch', { card: ace })).rejects.toThrow();
    await test.wake();
    expect(await pouchIds(test, 1)).toEqual([king]);
    expect(await stashed()).toEqual([moved]);
    await test.close();
  });

  it('reissues placeholders when the cards are shuffled, refuses the old ones, and keeps the new ones through a wake', async () => {
    const test = await started();
    const before = await pouchIds(test, 1);
    await test.take(1, 'shake');

    const after = await pouchIds(test, 1);
    expect(after).toHaveLength(2);
    expect(after.filter((id) => before.includes(id))).toEqual([]);
    await test.wake();
    expect(await pouchIds(test, 1)).toEqual(after);
    await expect(test.take(1, 'filch', { card: before[0] })).rejects.toThrow();
    await test.take(1, 'filch', { card: after[0] });
    expect(await commonsCards(test)).toHaveLength(1);
    await test.close();
  });

  it('offers a fully hidden deck by placeholders under neutral labels, and a blind pick takes one', async () => {
    const test = await started();
    const view = await test.getPlayerView(1);
    expect(find(view.state as ElementJSON, 'deck')!.children).toBeUndefined();

    const pick = await test.resolvePick(1, 'drawBlind', 'card', {});
    const ids = pick.validElements!.map((e) => e.id);
    expect(pick.validElements!.map((e) => e.display)).toEqual(['Card #1', 'Card #2', 'Card #3']);
    expect(ids.every((id) => id < 0)).toBe(true);
    expect(JSON.stringify(pick)).not.toMatch(/2C|3C|4C/);

    await test.take(1, 'drawBlind', { card: ids[1] });
    expect(await commonsCards(test)).toEqual(['3C']);
    await test.close();
  });
});
