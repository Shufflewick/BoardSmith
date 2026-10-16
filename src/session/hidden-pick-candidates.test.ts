/**
 * A pick candidate the asking seat cannot see goes out as that seat's board
 * shows it (#715): the placeholder id its view carries and a neutral label,
 * never the real id and name. A submitted placeholder id names the real card.
 */
import { describe, it, expect } from 'vitest';
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
        .chooseFrom<'card', Card>('card', { choices: theirs })
        .execute(({ card }) => take(card)),
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
            actions: ['steal', 'draw', 'stealFirst', 'stealTwo', 'stealUntilTwo', 'stealAndSay', 'stealNowhere'],
          }),
        }),
      }),
    });
  }
}

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
    const [firstId] = boardIdsOfHand2(start);

    const step = succeeded(await executeOp(definition, options, start.snapshot, null, {
      type: 'selectionStep', player: 1, selectionName: 'card', value: firstId!, actionName: 'stealUntilTwo',
      boundaryKey: boundaryKeyOf(start.snapshot),
    }));

    expect(boardIdsOfHand2(step)).toEqual([-1]);
    expect(step.nextChoices?.map((c) => [c.value, c.display])).toEqual([[-1, 'Card #1']]);
  });

  it('does not take a hidden chooseFrom candidate by its secret name', async () => {
    const start = await started();

    const res = await executeOp(definition, options, start.snapshot, null, {
      type: 'action', actionName: 'draw', player: 1, args: { card: 'AS' },
      boundaryKey: boundaryKeyOf(start.snapshot),
    });

    expect(res.success).toBe(false);
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

  it("answers a later step from the pick the pending action holds, not a placeholder that has since moved", async () => {
    const start = await started();
    const [aceId] = boardIdsOfHand2(start);
    const step = succeeded(await executeOp(definition, options, start.snapshot, null, {
      type: 'selectionStep', player: 1, selectionName: 'card', value: aceId!, actionName: 'stealAndSay',
      boundaryKey: boundaryKeyOf(start.snapshot),
    }));
    // The ace left seat 2's hand, so -1 now stands for the king.
    expect(boardIdsOfHand2(step)).toEqual([-1]);

    const res = succeeded(await executeOp(definition, options, step.snapshot, step.pendingState ?? null, {
      type: 'resolveChoices', actionName: 'stealAndSay', selectionName: 'where', player: 1, args: { card: aceId! },
    }));

    expect(res.choices?.map((c) => c.value)).toEqual(['AS']);
  });
});
