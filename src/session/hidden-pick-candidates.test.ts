/**
 * A pick candidate the asking seat cannot see goes out as that seat's board
 * shows it (#715): the placeholder id its view carries and a neutral label,
 * never the real id and name. A submitted placeholder id names the real card.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  Game,
  Player,
  Space,
  Card,
  Action,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
} from '../engine/index.js';
import { executeOp, type GameDefinitionLike } from './stateless-ops.js';
import { succeeded } from './op-result.test-helper.js';
import { boundaryKeyOf } from './testing/boundary-stamp.js';

/** The game callbacks a blind chooseFrom ran, so a refused pick can show none did. */
const ran: string[] = [];

class BlindGame extends Game<BlindGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    for (const player of this.all(Player)) {
      const hand = this.create(Space, `hand-${player.seat}`);
      hand.player = player;
      hand.contentsVisibleToOwner();
    }
    const hand2 = this.first(Space, 'hand-2')!;
    hand2.create(Card, 'AS');
    hand2.create(Card, 'KH');
    const theirs = (ctx: { game: BlindGame }) => ctx.game.first(Space, 'hand-2')!.all(Card);
    const take = (card: Card) => {
      card.putInto(this.first(Space, 'hand-1')!);
      return { success: true };
    };
    this.registerActions(
      Action.create<BlindGame>('steal')
        .chooseElement<'card', Card>('card', { elements: theirs })
        .execute(({ card }) => take(card)),
      Action.create<BlindGame>('draw')
        .chooseFrom<'card', Card>('card', { choices: theirs, onSelect: () => { ran.push('onSelect'); } })
        .execute(({ card }) => {
          ran.push('execute');
          return take(card);
        }),
      Action.create<BlindGame>('drawTwo')
        .chooseFrom<'cards', Card>('cards', { choices: theirs, multiSelect: { min: 1, max: 2 } })
        .execute(() => {
          ran.push('execute');
          return { success: true };
        }),
      Action.create<BlindGame>('stealFirst')
        .chooseElement<'card', Card>('card', { elements: (ctx) => [theirs(ctx)[0]!] })
        .execute(({ card }) => take(card)),
      Action.create<BlindGame>('stealTwo')
        .chooseElements<'cards', Card>('cards', { elements: theirs, multiSelect: { min: 2, max: 2 } })
        .execute(({ cards }) => {
          for (const card of cards) take(card);
          return { success: true };
        }),
      Action.create<BlindGame>('stealUntilTwo')
        .chooseElement<'card', Card>('card', {
          elements: theirs,
          repeat: { until: (ctx) => theirs(ctx as { game: BlindGame }).length === 0, onEach: (_ctx, card) => take(card) },
        })
        .execute(() => ({ success: true })),
      // A blind pick, then a question that reads it.
      Action.create<BlindGame>('stealAndSay')
        .chooseElement<'card', Card>('card', { elements: theirs, onSelect: (card) => take(card) })
        .chooseFrom('where', { choices: ({ args }) => [(args.card as Card).name] })
        .execute(() => ({ success: true })),
      Action.create<BlindGame>('stealNowhere')
        .chooseElement<'card', Card>('card', { elements: theirs })
        .chooseFrom('where', { choices: () => [] as string[] })
        .execute(() => ({ success: true })),
    );
    this.setFlow({
      root: loop({
        maxIterations: 10,
        do: eachPlayer({
          do: actionStep({
            actions: ['steal', 'draw', 'drawTwo', 'stealFirst', 'stealTwo', 'stealUntilTwo', 'stealAndSay', 'stealNowhere'],
          }),
        }),
      }),
    });
  }
}

const NO_LONGER_AVAILABLE =
  'That choice is no longer available. Things changed while you were choosing, so please choose again.';

const definition: GameDefinitionLike = { gameClass: BlindGame, gameType: 'blind', minPlayers: 2, maxPlayers: 2 };
const options = { playerCount: 2, seed: 'bs715' };

type Node = { id: number; name?: string; className: string; children?: Node[] };

function findByName(node: Node, name: string): Node | undefined {
  if (node.name === name) return node;
  for (const child of node.children ?? []) {
    const found = findByName(child, name);
    if (found) return found;
  }
  return undefined;
}

async function started() {
  return succeeded(await executeOp(definition, options, null, null, { type: 'start' }));
}

/** The ids seat 1's board shows for the cards in seat 2's hand. */
function boardIdsOfHand2(envelope: { playerViews: unknown[] }): number[] {
  const view = envelope.playerViews[0] as { state: { view: Node } };
  return findByName(view.state.view, 'hand-2')!.children!.map((c) => c.id);
}

describe('pick candidates the seat cannot see (#715)', () => {
  beforeEach(() => {
    ran.length = 0;
  });

  it("offers a chooseElement candidate by seat 1's board id, without its name", async () => {
    const start = await started();
    const res = succeeded(await executeOp(definition, options, start.snapshot, null, {
      type: 'resolveChoices', actionName: 'steal', selectionName: 'card', player: 1, args: {},
    }));

    expect(res.validElements?.map((e) => e.id)).toEqual(boardIdsOfHand2(start));
    expect(res.validElements?.map((e) => e.display)).toEqual(['Card #1', 'Card #2']);
    expect(res.validElements?.map((e) => e.refs?.[0]?.ref.id)).toEqual(boardIdsOfHand2(start));
    expect(JSON.stringify(res)).not.toMatch(/"AS"|"KH"/);
  });

  it('offers a chooseFrom element candidate the same way', async () => {
    const start = await started();
    const res = succeeded(await executeOp(definition, options, start.snapshot, null, {
      type: 'resolveChoices', actionName: 'draw', selectionName: 'card', player: 1, args: {},
    }));

    expect(JSON.parse(JSON.stringify(res.choices))).toEqual(
      boardIdsOfHand2(start).map((id, i) => ({ value: { id, className: 'Card' }, display: `Card #${i + 1}` })),
    );
  });

  it.each([
    ['steal', (id: number) => id],
    ['draw', (id: number) => ({ id, className: 'Card' })],
  ])('%s: a submitted placeholder id takes the real card it stands for', async (actionName, sent) => {
    const start = await started();
    const [, secondId] = boardIdsOfHand2(start);

    const after = succeeded(await executeOp(definition, options, start.snapshot, null, {
      type: 'action', actionName, player: 1, args: { card: sent(secondId!) },
      boundaryKey: boundaryKeyOf(start.snapshot),
    }));

    // Seat 1 owns hand-1 and sees what it took.
    const seat1 = (after.playerViews[0] as { state: { view: Node } }).state.view;
    expect(findByName(seat1, 'hand-1')!.children!.map((c) => c.name)).toEqual(['KH']);
  });

  it('a selection step with a placeholder id takes the real card it stands for', async () => {
    const start = await started();
    const [firstId] = boardIdsOfHand2(start);

    const step = succeeded(await executeOp(definition, options, start.snapshot, null, {
      type: 'selectionStep', player: 1, selectionName: 'card', value: firstId!, actionName: 'steal',
      boundaryKey: boundaryKeyOf(start.snapshot),
    }));

    expect(step.done).toBe(true);
    const seat1 = (step.playerViews[0] as { state: { view: Node } }).state.view;
    expect(findByName(seat1, 'hand-1')!.children!.map((c) => c.name)).toEqual(['AS']);
  });

  it('refuses a placeholder for a hidden card that is not on offer', async () => {
    const start = await started();
    const [, kingId] = boardIdsOfHand2(start);

    const res = await executeOp(definition, options, start.snapshot, null, {
      type: 'action', actionName: 'stealFirst', player: 1, args: { card: kingId! },
      boundaryKey: boundaryKeyOf(start.snapshot),
    });

    expect(res.success).toBe(false);
    expect((res as { error: string }).error).toBe(NO_LONGER_AVAILABLE);
  });

  it('takes every hidden card a multi-select names by placeholder', async () => {
    const start = await started();

    const after = succeeded(await executeOp(definition, options, start.snapshot, null, {
      type: 'action', actionName: 'stealTwo', player: 1, args: { cards: boardIdsOfHand2(start) },
      boundaryKey: boundaryKeyOf(start.snapshot),
    }));

    const seat1 = (after.playerViews[0] as { state: { view: Node } }).state.view;
    expect(findByName(seat1, 'hand-1')!.children!.map((c) => c.name).sort()).toEqual(['AS', 'KH']);
  });

  it("offers a repeating pick's next hidden candidates by placeholder, without names", async () => {
    const start = await started();
    const [firstId, secondId] = boardIdsOfHand2(start);

    const step = succeeded(await executeOp(definition, options, start.snapshot, null, {
      type: 'selectionStep', player: 1, selectionName: 'card', value: firstId!, actionName: 'stealUntilTwo',
      boundaryKey: boundaryKeyOf(start.snapshot),
    }));

    expect(boardIdsOfHand2(step)).toEqual([secondId]);
    expect(step.nextChoices?.map((c) => [c.value, c.display])).toEqual([[secondId, 'Card #1']]);
  });

  // A hidden card's name is refused exactly as a card that is not there, so a
  // seat cannot probe the hand, and no callback ever sees the name.
  it.each([
    ['its secret name', 'draw', { card: 'AS' }],
    ['a partial object', 'draw', { card: { name: 'AS' } }],
    ['names in a multi-select', 'drawTwo', { cards: ['AS'] }],
    ['an absent card', 'draw', { card: 'QQ' }],
  ])('refuses a hidden chooseFrom candidate named by %s as no longer available', async (_, actionName, args) => {
    const start = await started();

    const res = await executeOp(definition, options, start.snapshot, null, {
      type: 'action', actionName, player: 1, args, boundaryKey: boundaryKeyOf(start.snapshot),
    });

    expect(res.success).toBe(false);
    expect((res as { error: string }).error).toBe(NO_LONGER_AVAILABLE);
    expect(ran).toEqual([]);
  });

  it('refuses a selection step naming a hidden chooseFrom candidate as no longer available', async () => {
    const start = await started();

    const res = await executeOp(definition, options, start.snapshot, null, {
      type: 'selectionStep', player: 1, selectionName: 'card', value: 'AS', actionName: 'draw',
      boundaryKey: boundaryKeyOf(start.snapshot),
    });

    expect(res.success).toBe(false);
    expect((res as { error: string }).error).toBe(NO_LONGER_AVAILABLE);
    expect(ran).toEqual([]);
  });

  it("names an earlier hidden pick neutrally when a later step has nothing to choose", async () => {
    const start = await started();
    const [firstId] = boardIdsOfHand2(start);

    const res = await executeOp(definition, options, start.snapshot, null, {
      type: 'resolveChoices', actionName: 'stealNowhere', selectionName: 'where', player: 1, args: { card: firstId! },
    });

    expect(res.success).toBe(false);
    expect(JSON.stringify(res)).not.toMatch(/\bAS\b|\bKH\b/);
    expect((res as { error: string }).error).toContain('card = a hidden Card');
  });

  it("answers a later step from the pick the pending action holds, not the placeholder the client sends", async () => {
    const start = await started();
    const [aceId, kingId] = boardIdsOfHand2(start);
    const step = succeeded(await executeOp(definition, options, start.snapshot, null, {
      type: 'selectionStep', player: 1, selectionName: 'card', value: aceId!, actionName: 'stealAndSay',
      boundaryKey: boundaryKeyOf(start.snapshot),
    }));
    // The ace is in seat 1's hand now, where seat 1 sees it, so its placeholder names nothing; the king kept its own.
    expect(boardIdsOfHand2(step)).toEqual([kingId]);

    const res = succeeded(await executeOp(definition, options, step.snapshot, step.pendingState ?? null, {
      type: 'resolveChoices', actionName: 'stealAndSay', selectionName: 'where', player: 1, args: { card: aceId! },
    }));

    expect(res.choices?.map((c) => c.value)).toEqual(['AS']);
  });
});

/** Seat 2's hand, with one card shown to seat 1 by a grant on the card itself (#758). */
class PeekGame extends Game<PeekGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    const hand = this.create(Space, 'hand-2');
    hand.player = this.getPlayer(2)!;
    hand.contentsVisibleToOwner();
    hand.create(Card, 'AS');
    hand.create(Card, 'KH').addVisibleTo(1);
    this.registerActions(
      Action.create<PeekGame>('steal')
        .chooseElement<'card', Card>('card', { elements: (ctx) => ctx.game.first(Space, 'hand-2')!.all(Card) })
        .execute(() => ({ success: true })),
    );
    this.setFlow({ root: loop({ maxIterations: 10, do: eachPlayer({ do: actionStep({ actions: ['steal'] }) }) }) });
  }
}

describe('a card granted to the seat inside a zone it cannot see (#758)', () => {
  it('is offered under its real id and name, matching the board, while the rest stay placeholders', async () => {
    const peek: GameDefinitionLike = { gameClass: PeekGame, gameType: 'peek', minPlayers: 2, maxPlayers: 2 };
    const start = succeeded(await executeOp(peek, options, null, null, { type: 'start' }));
    const res = succeeded(await executeOp(peek, options, start.snapshot, null, {
      type: 'resolveChoices', actionName: 'steal', selectionName: 'card', player: 1, args: {},
    }));

    const board = (start.playerViews[0] as { state: { view: Node } }).state.view;
    const shown = findByName(board, 'hand-2')!.children!;
    expect(shown.map((c) => c.name)).toEqual([undefined, 'KH']);
    expect(res.validElements?.map((e) => e.id)).toEqual(shown.map((c) => c.id));
    expect(res.validElements?.map((e) => e.display)).toEqual(['Card #1', 'KH']);
  });
});
