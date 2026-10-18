import { describe, it, expect } from 'vitest';
import { Action, Game, Piece, Player, Space, actionStep, loop, type GameOptions } from '../engine/index.js';
import { GameRunner } from '../runtime/index.js';
import { PendingActionManager } from './pending-action-manager.js';
import { executeOp, type GameDefinitionLike } from './stateless-ops.js';
import { SnapshotSessionHost, type SnapshotHostState, type SnapshotSessionAdapters } from './snapshot-session-host.js';
import { boundaryKeyOfHost } from './testing/boundary-stamp.js';
import { succeeded } from './op-result.test-helper.js';

// #1144: a pending (pick-by-pick) action's history was encoded after its
// onSelect/onEach had moved the picks, so it recorded where they ended up and
// replay could not make the same picks. A history entry names each pick where
// it was before the action (#1128), whatever the action's callbacks moved since.

class Token extends Piece<ShiftGame> {}

/**
 * `shift` picks tokens one at a time and onEach moves each to `to`; `stow`
 * picks two and the first's onSelect moves it; `conjure`'s first pick creates
 * a token its second pick may take.
 */
class ShiftGame extends Game<ShiftGame, Player> {
  from!: Space;
  to!: Space;
  constructor(options: GameOptions) {
    super(options);
    this.from = this.create(Space, 'from');
    this.to = this.create(Space, 'to');
    for (const name of ['first', 'second', 'third', 'fourth']) this.from.create(Token, name);
    this.registerActions(
      Action.create<ShiftGame>('shift')
        .chooseElement('tokens', {
          elementClass: Token,
          from: (ctx) => ctx.game.from,
          repeat: {
            onEach: (ctx, token) => (token as Token).putInto(ctx.game.to),
            until: (ctx) => (ctx.args.tokens as unknown[]).length === 2,
          },
        })
        .execute(() => ({ success: true })),
      Action.create<ShiftGame>('stow')
        .chooseElement('crate', {
          elementClass: Token,
          from: (ctx) => ctx.game.from,
          onSelect: (token) => token.putInto(this.to),
        })
        .chooseElement('next', { elementClass: Token, from: (ctx) => ctx.game.from })
        .execute((args, ctx) => {
          (args.next as Token).putInto(ctx.game.to);
          return { success: true };
        }),
      Action.create<ShiftGame>('conjure')
        .chooseElement('source', {
          elementClass: Token,
          from: (ctx) => ctx.game.from,
          onSelect: () => this.to.create(Token, 'conjured'),
        })
        .chooseElement('made', { elementClass: Token, from: (ctx) => ctx.game.to })
        .execute(() => ({ success: true })),
      Action.create<ShiftGame>('jostle')
        .chooseElement('tokens', {
          elementClass: Token,
          from: (ctx) => ctx.game.from,
          repeat: {
            onEach: (ctx, token) => {
              (token as Token).putInto(ctx.game.to);
              throw new Error('jostle threw after its move');
            },
            until: (ctx) => (ctx.args.tokens as unknown[]).length === 2,
          },
        })
        .execute(() => ({ success: true })),
    );
    this.setFlow({
      root: loop({
        maxIterations: 10,
        do: actionStep({ actions: ['shift', 'stow', 'conjure', 'jostle'], player: (ctx) => ctx.game.getPlayer(1)! }),
      }),
    });
  }
}

const gameOptions = { playerCount: 2, seed: 'shift' };
const options = { GameClass: ShiftGame, gameType: 'shift', gameOptions };
const definition: GameDefinitionLike = { gameClass: ShiftGame, gameType: 'shift', minPlayers: 2, maxPlayers: 2 };
const places = (game: ShiftGame) => [game.from, game.to].map((space) => space.all(Token).map((token) => token.name));

/** Each case: the action and its picks in order (a repeating pick once per pick), the tokens `first` then `second`. */
const cases = [
  ['a repeating pick whose onEach moves each token', 'shift', ['tokens', 'tokens']],
  ['an onSelect that moves an earlier pick', 'stow', ['crate', 'next']],
] as const;
const picked = ['first', 'second'];

/** The history args each case must record: each token where it was before the action. */
function argsBefore(picks: readonly string[]) {
  const game = new GameRunner(options).game;
  const ref = (name: string) => ({ __elementRef: game.from.first(Token, name)!.branch() });
  if (picks[0] === 'tokens') return { tokens: picked.map(ref) };
  return Object.fromEntries(picks.map((pick, i) => [pick, ref(picked[i]!)]));
}

const idOf = (game: ShiftGame, name: string) => game.first(Token, name)!.id;

function expectReplaysToLive(history: GameRunner['actionHistory'], live: ShiftGame, action: string, picks: readonly string[]) {
  expect(history).toEqual([{ name: action, player: 1, args: argsBefore(picks) }]);
  const replayed = GameRunner.replay(options, { actionHistory: history });
  expect(places(replayed.game)).toEqual(places(live));
}

/** A host whose every step runs on a fresh process, restored from what the last one persisted. */
function freshHostEachStep() {
  const persisted: SnapshotHostState[] = [];
  const seatOneViews: unknown[] = [];
  const adapters: SnapshotSessionAdapters = {
    playerCount: gameOptions.playerCount,
    executeOp: (snap, pend, op) => executeOp(definition, gameOptions, snap, pend, op),
    push: () => {},
    record: ({ players }) => seatOneViews.push(players[0]),
    // What a Durable Object's storage hands back: a JSON round trip.
    persist: (state) => {
      persisted.push(JSON.parse(JSON.stringify(state)) as SnapshotHostState);
    },
  };
  return {
    adapters,
    persisted,
    seatOneViews,
    restored: () => SnapshotSessionHost.restore(adapters, { ...persisted.at(-1)!, botSeats: [] }),
  };
}

/** Seat 1's selection step on `host`, with the token's id read from the host's own game. */
function pickOn(host: SnapshotSessionHost, action: string, selectionName: string, token: string) {
  const value = idOf(GameRunner.fromSnapshot(host.snapshot!, ShiftGame).game, token);
  return host.handleOp(1, { type: 'selectionStep', player: 1, selectionName, value, actionName: action, boundaryKey: boundaryKeyOfHost(host) });
}

describe('a pending action records its picks where they were before the action (#1144)', () => {
  it.each(cases)('GameRunner: %s', (_name, action, picks) => {
    const live = new GameRunner(options);
    live.start();

    live.startPendingAction(action, 1);
    picks.forEach((name, i) => expect(live.processSelectionStep(1, name, idOf(live.game, picked[i]!)).error).toBeUndefined());

    expectReplaysToLive(live.actionHistory, live.game, action, picks);
  });

  it.each(cases)('PendingActionManager: %s', async (_name, action, picks) => {
    const live = new GameRunner(options);
    live.start();
    const manager = new PendingActionManager(live, 2);

    for (const [i, name] of picks.entries()) {
      expect((await manager.processSelectionStep(1, name, idOf(live.game, picked[i]!), action)).error).toBeUndefined();
    }

    expectReplaysToLive(live.actionHistory, live.game, action, picks);
  });

  it.each(cases)('a stateless host restored from storage at every step: %s', async (_name, action, picks) => {
    const { adapters, restored } = freshHostEachStep();
    let host = new SnapshotSessionHost(adapters);
    await host.start();

    for (const [i, name] of picks.entries()) {
      host = restored();
      succeeded(await pickOn(host, action, name, picked[i]!));
    }

    const live = GameRunner.fromSnapshot(host.snapshot!, ShiftGame);
    expectReplaysToLive(live.actionHistory, live.game, action, picks);
  });

  it('refuses to record a pick of an element an earlier pick created, which did not exist before the action', () => {
    const live = new GameRunner(options);
    live.start();

    live.startPendingAction('conjure', 1);
    expect(live.processSelectionStep(1, 'source', idOf(live.game, 'first')).error).toBeUndefined();
    expect(() => live.processSelectionStep(1, 'made', idOf(live.game, 'conjured'))).toThrow(
      /Cannot record action 'conjure': 'args.made' is "conjured", which an earlier pick's onSelect or onEach created/,
    );
    expect(live.actionHistory).toEqual([]);
  });

  it('refuses to complete a pending action saved without its record of what its picks moved', () => {
    const live = new GameRunner(options);
    live.start();

    const pending = live.startPendingAction('stow', 1)!;
    delete pending.branchesBeforePicks;
    expect(live.processSelectionStep(1, 'crate', idOf(live.game, 'first')).error).toBeUndefined();
    expect(() => live.processSelectionStep(1, 'next', idOf(live.game, 'second'))).toThrow(
      /started before the game was updated and cannot be finished\. Cancel it and take it again\./,
    );
    expect(live.actionHistory).toEqual([]);
  });

  it("keeps the record in the saved pending state and out of the seat's view and debug answer, since it names where face-down cards were", async () => {
    const { adapters, persisted, seatOneViews } = freshHostEachStep();
    const host = new SnapshotSessionHost(adapters);
    await host.start();
    succeeded(await pickOn(host, 'stow', 'crate', 'first'));

    const saved = persisted.at(-1)!.pendingStates['1']!;
    expect(Object.keys(saved.branchesBeforePicks as object).length).toBeGreaterThan(0);
    const shown = (seatOneViews.at(-1) as { state: { pendingAction?: Record<string, unknown> } }).state.pendingAction;
    expect(shown?.actionName).toBe('stow');
    expect(shown).not.toHaveProperty('branchesBeforePicks');

    const debug = succeeded(await executeOp(
      definition, gameOptions, persisted.at(-1)!.snapshot!, saved, { type: 'debugFlowState', player: 1 }, { debug: true },
    ));
    expect(debug.pendingAction?.actionName).toBe('stow');
    expect(debug.pendingAction).not.toHaveProperty('branchesBeforePicks');
  });

  it('tells the player a pending action saved by an older engine cannot be finished, and lets them cancel and take it again', async () => {
    const { adapters, persisted, restored } = freshHostEachStep();
    const first = new SnapshotSessionHost(adapters);
    await first.start();
    succeeded(await pickOn(first, 'stow', 'crate', 'first'));
    delete persisted.at(-1)!.pendingStates['1']!.branchesBeforePicks;

    const host = restored();
    const refused = await pickOn(host, 'stow', 'next', 'second');
    expect(refused).toMatchObject({
      success: false,
      error: 'This action was started before the game was updated and cannot be finished. Cancel it and take it again.',
    });

    succeeded(await host.handleOp(1, { type: 'cancelAction', player: 1 }));
    succeeded(await pickOn(host, 'stow', 'crate', 'third'));
    succeeded(await pickOn(host, 'stow', 'next', 'second'));
    expect(host.snapshot!.actionHistory.map((entry) => 'name' in entry && entry.name)).toEqual(['stow']);
  });

  it('undoes a pick callback that moved a token and threw, and its note of where the token was (#1169)', () => {
    const live = new GameRunner(options);
    live.start();
    const before = places(live.game);

    live.startPendingAction('jostle', 1);
    expect(live.processSelectionStep(1, 'tokens', idOf(live.game, 'first')).error).toMatch(/"jostle" action could not be/);

    expect(places(live.game)).toEqual(before);
    expect(live.getPendingAction(1)?.branchesBeforePicks).toEqual({});
  });
});
