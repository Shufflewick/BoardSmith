/**
 * A table names a hidden card by a stable placeholder of the asking seat's own
 * (#715): a card keeps it until its pile is shuffled or a card enters or
 * leaves the pile, a placeholder names only that card, another seat's placeholder and a hidden card's real id
 * are refused at every entry point, and a card in a fully hidden zone can be
 * picked blind.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Space, Card, Action, simultaneousActionStep, actionStep, eachPlayer, loop, type GameOptions } from '../engine/index.js';
import { executeOp, type GameDefinitionLike } from './stateless-ops.js';
import { succeeded, suggestedMoveOp } from './op-result.test-helper.js';
import { boundaryKeyOf } from './testing/boundary-stamp.js';

class Pouch extends Space<PouchGame> {}
class Stash extends Space<PouchGame> {}
class Deck extends Space<PouchGame> {}

class PouchGame extends Game<PouchGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    const pouch = this.create(Pouch, 'pouch');
    pouch.contentsCountOnly();
    pouch.create(Card, 'AS');
    pouch.create(Card, 'KH');
    this.create(Stash, 'stash').contentsCountOnly();
    const deck = this.create(Deck, 'deck');
    deck.contentsHidden();
    for (const name of ['2C', '3C', '4C']) deck.create(Card, name);
    for (const player of this.all(Player)) {
      const hand = this.create(Space, `hand-${player.seat}`);
      hand.player = player;
      hand.contentsVisibleToOwner();
    }

    const inPouch = (ctx: { game: PouchGame }) => ctx.game.first(Pouch)!.all(Card);
    const handOf = (player: Player) => this.first(Space, `hand-${player.seat}`)!;
    this.registerActions(
      Action.create<PouchGame>('filch')
        .chooseElement<'card', Card>('card', { elements: inPouch })
        .execute(({ card }, { player }) => {
          card.putInto(handOf(player));
        }),
      Action.create<PouchGame>('peek')
        .chooseElement<'card', Card>('card', { elements: inPouch })
        // Reads the card it was handed, so a pick that resolved a hidden card would say which.
        .chooseFrom('how', { choices: ({ args }) => [args.card instanceof Card ? args.card.name! : 'no card'] })
        .execute(() => {}),
      Action.create<PouchGame>('stash')
        .chooseElement<'card', Card>('card', { elements: inPouch })
        .execute(({ card }) => {
          card.putInto(this.first(Stash)!);
        }),
      Action.create<PouchGame>('shake').execute(() => {
        this.first(Pouch)!.shuffle();
      }),
      Action.create<PouchGame>('drawBlind')
        .chooseElement<'card', Card>('card', { elements: (ctx) => ctx.game.first(Deck)!.all(Card) })
        .execute(({ card }, { player }) => {
          card.putInto(handOf(player));
        }),
    );
    this.setFlow({
      root: simultaneousActionStep({
        actions: ['filch', 'peek', 'stash', 'shake', 'drawBlind'],
        playerDone: () => false,
      }),
    });
  }
}

/** The pouch game where a filch is the only move, so a bot has to pick a card it cannot see. */
class FilchGame extends PouchGame {
  constructor(options: GameOptions) {
    super(options);
    this.setFlow({ root: loop({ maxIterations: 4, do: eachPlayer({ do: actionStep({ actions: ['filch'] }) }) }) });
  }
}

const definition: GameDefinitionLike = { gameClass: PouchGame, gameType: 'pouch', minPlayers: 3, maxPlayers: 3 };
const options = { playerCount: 3, seed: 'bs715-stable' };
const NO_LONGER_AVAILABLE =
  'That choice is no longer available. Things changed while you were choosing, so please choose again.';

type Node = { id: number; name?: string; className: string; children?: Node[] };
type Envelope = { snapshot: Parameters<typeof boundaryKeyOf>[0]; playerViews: unknown[] };

function findByName(node: Node, name: string): Node | undefined {
  if (node.name === name) return node;
  for (const child of node.children ?? []) {
    const found = findByName(child, name);
    if (found) return found;
  }
  return undefined;
}

function viewOf(envelope: Envelope, seat: number): Node {
  return (envelope.playerViews[seat - 1] as { state: { view: Node } }).state.view;
}

/** The cards in `seat`'s own hand, which it can see. */
function handOf(envelope: Envelope, seat: number): string[] {
  return (findByName(viewOf(envelope, seat), `hand-${seat}`)!.children ?? []).map((c) => c.name!);
}

async function started(): Promise<Envelope> {
  return succeeded(await executeOp(definition, options, null, null, { type: 'start' })) as unknown as Envelope;
}

/** The ids `seat` is offered for the pouch's cards, in pouch order. */
async function pouchIds(envelope: Envelope, seat: number): Promise<number[]> {
  const res = succeeded(await executeOp(definition, options, envelope.snapshot as never, null, {
    type: 'resolveChoices', actionName: 'filch', selectionName: 'card', player: seat, args: {},
  }));
  return res.validElements!.map((e) => e.id);
}

async function act(envelope: Envelope, seat: number, actionName: string, args: Record<string, unknown> = {}) {
  return executeOp(definition, options, envelope.snapshot as never, null, {
    type: 'action', actionName, player: seat, args, boundaryKey: boundaryKeyOf(envelope.snapshot),
  });
}

function refusal(res: { success: boolean; error?: string }): string | undefined {
  expect(res.success).toBe(false);
  return res.error;
}

/** The real id of a card, read from the server's own state. */
function realIdOf(envelope: Envelope, name: string): number {
  const state = (envelope.snapshot as { actionCheckpoints?: { entries: { state: Node }[] }; state?: Node });
  const tree = state.state ?? state.actionCheckpoints!.entries.at(-1)!.state;
  return findByName(tree, name)!.id;
}

describe("a table's stable per-seat placeholders (#715)", () => {
  it('refuses a placeholder whose card another seat took since, rather than taking the card left', async () => {
    const start = await started();
    const [ace] = await pouchIds(start, 1);
    const [seat2Ace] = await pouchIds(start, 2);
    const taken = succeeded(await act(start, 2, 'filch', { card: seat2Ace })) as unknown as Envelope;
    expect(handOf(taken, 2)).toEqual(['AS']);

    expect(refusal(await act(taken, 1, 'filch', { card: ace }))).toBe(NO_LONGER_AVAILABLE);
    expect(await pouchIds(taken, 1)).toHaveLength(1);
  });

  it("refuses another seat's placeholder, as an action and as a selection step", async () => {
    const start = await started();
    const [, seat3King] = await pouchIds(start, 3);
    expect(await pouchIds(start, 1)).not.toContain(seat3King);

    expect(refusal(await act(start, 1, 'filch', { card: seat3King }))).toBe(NO_LONGER_AVAILABLE);
    expect(refusal(await executeOp(definition, options, start.snapshot as never, null, {
      type: 'selectionStep', player: 1, selectionName: 'card', value: seat3King!, actionName: 'filch',
      boundaryKey: boundaryKeyOf(start.snapshot),
    }))).toBe(NO_LONGER_AVAILABLE);
  });

  it('refuses the real id of a card the seat cannot see, at every entry point', async () => {
    const start = await started();
    const king = realIdOf(start, 'KH');

    expect(refusal(await act(start, 1, 'filch', { card: king }))).toBe(NO_LONGER_AVAILABLE);
    expect(refusal(await act(start, 1, 'filch', { card: { id: king, className: 'Card' } }))).toBe(NO_LONGER_AVAILABLE);
    expect(refusal(await executeOp(definition, options, start.snapshot as never, null, {
      type: 'selectionStep', player: 1, selectionName: 'card', value: king, actionName: 'filch',
      boundaryKey: boundaryKeyOf(start.snapshot),
    }))).toBe(NO_LONGER_AVAILABLE);
    const asked = await executeOp(definition, options, start.snapshot as never, null, {
      type: 'resolveChoices', actionName: 'peek', selectionName: 'how', player: 1, args: { card: king },
    });
    expect(JSON.stringify(asked)).not.toMatch(/KH/);

    const [, kingPlaceholder] = await pouchIds(start, 1);
    const how = succeeded(await executeOp(definition, options, start.snapshot as never, null, {
      type: 'resolveChoices', actionName: 'peek', selectionName: 'how', player: 1, args: { card: kingPlaceholder },
    }));
    expect(how.choices?.map((c) => c.value)).toEqual(['KH']);
  });

  it('reissues every card left in a hidden pile when one is moved out, in the board and the offer, and refuses a pick by a pre-move id', async () => {
    const start = await started();
    const [ace, king] = await pouchIds(start, 1);
    const moved = succeeded(await act(start, 2, 'stash', { card: (await pouchIds(start, 2))[0] })) as unknown as Envelope;

    const [stashed] = findByName(viewOf(moved, 1), 'stash')!.children!.map((c) => c.id);
    const [left] = findByName(viewOf(moved, 1), 'pouch')!.children!.map((c) => c.id);
    expect(stashed).toBeLessThan(0);
    expect(left).toBeLessThan(0);
    expect([ace, king]).not.toContain(stashed);
    expect([ace, king]).not.toContain(left);
    expect(await pouchIds(moved, 1)).toEqual([left]);
    expect(refusal(await act(moved, 1, 'filch', { card: king }))).toBe(NO_LONGER_AVAILABLE);
    const taken = succeeded(await act(moved, 1, 'filch', { card: left })) as unknown as Envelope;
    expect(handOf(taken, 1)).toEqual(['KH']);
  });

  it('reissues placeholders when the cards are shuffled, and refuses the old ones', async () => {
    const start = await started();
    const before = await pouchIds(start, 1);
    const shaken = succeeded(await act(start, 2, 'shake')) as unknown as Envelope;

    const after = await pouchIds(shaken, 1);
    expect(after).toHaveLength(2);
    expect(after.filter((id) => before.includes(id))).toEqual([]);
    expect(findByName(viewOf(shaken, 1), 'pouch')!.children!.map((c) => c.id)).toEqual(after);
    expect(refusal(await act(shaken, 1, 'filch', { card: before[0] }))).toBe(NO_LONGER_AVAILABLE);
    const taken = succeeded(await act(shaken, 1, 'filch', { card: after[0] })) as unknown as Envelope;
    expect(handOf(taken, 1)).toHaveLength(1);
  });

  it('offers a fully hidden deck by placeholders under neutral labels, and a blind pick takes one', async () => {
    const start = await started();
    expect(findByName(viewOf(start, 1), 'deck')!.children).toBeUndefined();

    const res = succeeded(await executeOp(definition, options, start.snapshot as never, null, {
      type: 'resolveChoices', actionName: 'drawBlind', selectionName: 'card', player: 1, args: {},
    }));
    const ids = res.validElements!.map((e) => e.id);
    expect(res.validElements!.map((e) => e.display)).toEqual(['Card #1', 'Card #2', 'Card #3']);
    expect(ids.every((id) => id < 0)).toBe(true);
    expect(JSON.stringify(res)).not.toMatch(/2C|3C|4C/);

    const drawn = succeeded(await act(start, 1, 'drawBlind', { card: ids[1] })) as unknown as Envelope;
    expect(handOf(drawn, 1)).toEqual(['3C']);
  });

  it("takes a bot's move, which names the hidden card by the bot seat's placeholder", async () => {
    const filchOnly: GameDefinitionLike = { gameClass: FilchGame, gameType: 'filch', minPlayers: 3, maxPlayers: 3 };
    const start = succeeded(await executeOp(filchOnly, options, null, null, { type: 'start' }));
    const found = succeeded(await executeOp(filchOnly, options, start.snapshot, null, { type: 'botSuggest', seats: [{ seat: 1, level: '2' }] }));

    expect(found.suggestedAction).toBe('filch');
    expect(found.suggestedArgs?.card).toBeLessThan(0);
    const after = succeeded(await executeOp(filchOnly, options, start.snapshot, null, suggestedMoveOp(start.snapshot, found)));
    expect(handOf(after as unknown as Envelope, 1)).toHaveLength(1);
  });
});
