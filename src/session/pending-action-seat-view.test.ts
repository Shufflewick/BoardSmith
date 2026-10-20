/**
 * A seat's own pending action says which picks it holds, never what they hold
 * (#1204): the engine keeps a held element as the real element, so a card
 * picked blind by its placeholder (#715) would otherwise reach the seat's page
 * whole. The persisted pending state keeps the values; completing needs them.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Space, Card, Action, actionStep, type GameOptions } from '../engine/index.js';
import { createHeadlessSession } from '../testing/headless-session.js';
import { executeOp, type GameDefinitionLike } from './stateless-ops.js';
import { succeeded } from './op-result.test-helper.js';
import { boundaryKeyOf } from './testing/boundary-stamp.js';

class Pouch extends Space<PouchGame> {}
class Tray extends Space<PouchGame> {}
class Coin extends Card<PouchGame> {
  secret = 'gold';
}

class PouchGame extends Game<PouchGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    const pouch = this.create(Pouch, 'pouch');
    pouch.contentsCountOnly();
    pouch.create(Coin, 'AS');
    pouch.create(Coin, 'KH');
    this.create(Tray, 'tray').create(Coin, 'QD');
    const inPouch = (ctx: { game: PouchGame }) => ctx.game.first(Pouch)!.all(Coin);
    const onTray = (ctx: { game: PouchGame }) => ctx.game.first(Tray)!.all(Coin);
    this.registerActions(
      Action.create<PouchGame>('fish')
        .chooseElement<'card', Coin>('card', { elements: inPouch })
        .chooseElements<'more', Coin>('more', { elements: (ctx) => [...inPouch(ctx), ...onTray(ctx)].filter((c) => c !== ctx.args.card), multiSelect: { min: 1 } })
        .chooseFrom('how', { choices: ['gently', 'quickly'] })
        .execute(() => {}),
      // A card the seat sees, put face down into the pouch and shuffled in as it is picked.
      Action.create<PouchGame>('hide')
        .chooseElement<'card', Coin>('card', {
          elements: onTray,
          onSelect: (card) => {
            card.putInto(this.first(Pouch)!);
            this.first(Pouch)!.shuffle();
          },
        })
        .chooseFrom('how', { choices: ['gently', 'quickly'] })
        .execute(() => {}),
      // Blind picks, one per step, each turned face up onto the tray as it is taken.
      Action.create<PouchGame>('grab')
        .chooseElement<'cards', Coin>('cards', {
          elements: inPouch,
          repeat: { until: () => false, onEach: (_ctx, card) => (card as Coin).putInto(this.first(Tray)!) },
        })
        .chooseFrom('how', { choices: ['gently', 'quickly'] })
        .execute(() => {}),
    );
    this.setFlow({ root: actionStep({ actions: ['fish', 'hide', 'grab'], player: (ctx) => ctx.game.getPlayer(1)! }) });
  }
}

const definition: GameDefinitionLike = { gameClass: PouchGame, gameType: 'pouch-1204', minPlayers: 2, maxPlayers: 2 };
const options = { playerCount: 2, seed: 'bs1204' };

type Node = { id: number; name?: string; children?: Node[] };
function idsByName(node: Node, out = new Map<string, number>()): Map<string, number> {
  if (node.name) out.set(node.name, node.id);
  for (const child of node.children ?? []) idsByName(child, out);
  return out;
}

describe("a seat's own pending action (#1204)", () => {
  async function fishTwoPicks() {
    const session = createHeadlessSession(definition, { ...options, playerNames: ['Ann', 'Bob'] });
    await session.start();
    const choices = await session.send(1, { type: 'resolveChoices', actionName: 'fish', selectionName: 'card', player: 1, args: {} });
    if (!choices.success) throw new Error(choices.error);
    const [blind] = choices.validElements!.map((e) => e.id);
    expect(blind).toBeLessThan(0);
    const first = await session.send(1, { type: 'selectionStep', player: 1, selectionName: 'card', value: blind, actionName: 'fish' });
    if (!first.success) throw new Error(first.error);
    const more = await session.send(1, { type: 'resolveChoices', actionName: 'fish', selectionName: 'more', player: 1, args: { card: blind } });
    if (!more.success) throw new Error(more.error);
    const queen = idsByName((session.playerState(1) as unknown as { view: Node }).view).get('QD')!;
    const otherBlind = more.validElements!.map((e) => e.id).find((id) => id < 0)!;
    const second = await session.send(1, { type: 'selectionStep', player: 1, selectionName: 'more', value: [otherBlind, queen], actionName: 'fish' });
    if (!second.success) throw new Error(second.error);
    return session;
  }

  it('names the picks it holds and carries none of their values', async () => {
    const session = await fishTwoPicks();

    const pending = session.playerState(1).pendingAction!;
    expect(pending.actionName).toBe('fish');
    expect(pending.heldPicks).toEqual(['card', 'more']);
    expect(pending).not.toHaveProperty('collectedArgs');
    const wire = JSON.stringify(pending);
    expect(wire).not.toContain('gold');
    expect(wire).not.toContain('"AS"');
    expect(wire).not.toContain('"KH"');
  });

  it('answers debugFlowState the same way, from a pending state that crossed JSON', async () => {
    const start = succeeded(await executeOp(definition, options, null, null, { type: 'start' }));
    const choices = succeeded(await executeOp(definition, options, start.snapshot, null, {
      type: 'resolveChoices', actionName: 'fish', selectionName: 'card', player: 1, args: {},
    }));
    const [blind] = choices.validElements!.map((e) => e.id);
    const step = succeeded(await executeOp(definition, options, start.snapshot, null, {
      type: 'selectionStep', player: 1, selectionName: 'card', value: blind, actionName: 'fish', boundaryKey: boundaryKeyOf(start.snapshot),
    }));
    const persisted = JSON.parse(JSON.stringify(step.pendingState));
    const flow = succeeded(await executeOp(definition, options, step.snapshot, persisted, { type: 'debugFlowState', player: 1 }, { debug: true }));
    expect(flow.pendingAction!.heldPicks).toEqual(['card']);
    expect(JSON.stringify(flow.pendingAction)).not.toContain('gold');
  });

  it("names a repeat's pick while it is open, without the cards it took", async () => {
    const session = createHeadlessSession(definition, { ...options, playerNames: ['Ann', 'Bob'] });
    await session.start();
    const res = await session.send(1, { type: 'resolveChoices', actionName: 'grab', selectionName: 'cards', player: 1, args: {} });
    if (!res.success) throw new Error(res.error);
    const one = await session.send(1, { type: 'selectionStep', player: 1, selectionName: 'cards', value: res.validElements![0].id, actionName: 'grab' });
    if (!one.success) throw new Error(one.error);

    const pending = session.playerState(1).pendingAction!;
    expect(pending.repeating).toEqual({ selectionName: 'cards', iterationCount: 1 });
    expect(JSON.stringify(pending)).not.toContain('gold');
  });

  it('is shown only to its own seat', async () => {
    const session = await fishTwoPicks();
    expect(session.playerState(2).pendingAction).toBeUndefined();
  });
});
