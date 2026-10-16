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
    );
    this.setFlow({
      root: loop({ maxIterations: 10, do: eachPlayer({ do: actionStep({ actions: ['steal', 'draw'] }) }) }),
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
});
