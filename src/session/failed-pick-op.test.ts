/**
 * A pick-by-pick op that fails keeps nothing (#1169): the game and the seat's
 * open action are left as they were before that op, so the player can retry
 * the pick or cancel. A host saves nothing for a failed op; the in-memory
 * routes (the runner's own, and the session's on a long-lived runner) match it.
 * The two routes agree on a repeating pick whose action then fails (#983), and
 * another seat's move in between changes nothing about it (#1177).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Game, Player, Piece, Space, Action, simultaneousActionStep, type GameOptions } from '../engine/index.js';
import { GameRunner } from '../runtime/index.js';
import { PendingActionManager } from './pending-action-manager.js';
import { PickHandler } from './pick-handler.js';
import { executeOp, type GameDefinitionLike } from './stateless-ops.js';
import { boundaryKeyOf } from './testing/boundary-stamp.js';
import { succeeded } from './op-result.test-helper.js';
import { ErrorCode } from './types.js';

class Token extends Piece<UndoGame> {}
class Zone extends Space<UndoGame> {}

const crash = (): never => {
  throw new TypeError("Cannot read properties of undefined (reading 'suit')");
};

class UndoGame extends Game<UndoGame, Player> {
  from!: Zone;
  to!: Zone;
  taps = 0;

  constructor(options: GameOptions) {
    super(options);
    this.from = this.create(Zone, 'from');
    this.to = this.create(Zone, 'to');
    for (const name of ['one', 'two']) this.from.create(Token, name);
    const move = (name: string) => this.from.first(Token, name)?.putInto(this.to);
    const refuse = () => ({ success: false, error: 'Not today.' });
    const pair = (name: string, execute: () => unknown) =>
      Action.create(name)
        .chooseFrom('first', { choices: ['a'], onSelect: () => move('one'), onCancel: () => this.to.first(Token, 'one')?.putInto(this.from) })
        .chooseFrom('second', { choices: ['b'], onSelect: () => move('two') })
        .execute(execute as () => void);

    this.registerActions(
      Action.create('gather')
        .chooseFrom('items', {
          choices: ['one', 'two', 'done'],
          repeat: {
            onEach: (_ctx, item) => { move(item as string); if (item === 'two') crash(); },
            until: (_ctx, item) => item === 'done',
          },
        })
        .execute(() => {}),
      Action.create('gatherRefused')
        .chooseFrom('items', {
          choices: ['one', 'two'],
          repeat: { onEach: (_ctx, item) => move(item as string), until: (_ctx, item) => item === 'two' },
        })
        .execute(refuse as () => void),
      pair('pairRefused', refuse),
      pair('pairCrash', crash),
      Action.create('tap').execute(() => { this.taps++; }),
    );
    this.setFlow({
      root: simultaneousActionStep({
        actions: ['gather', 'gatherRefused', 'pairRefused', 'pairCrash', 'tap'],
        playerDone: () => false,
      }),
    });
  }
}

function runner(checkpoints = true): GameRunner<UndoGame> {
  const r = new GameRunner({
    GameClass: UndoGame, gameType: 'undo', gameOptions: { playerCount: 2, seed: 'undo' }, checkpoints: { enabled: checkpoints },
  });
  r.start();
  return r;
}

const moved = (game: UndoGame) => game.to.all(Token).map((token) => token.name);

/** One seat's pick-by-pick action on one in-memory route, as a player drives it. */
interface Route {
  game: UndoGame;
  pick(selection: string, value: unknown): Promise<{ success: boolean; errorCode?: ErrorCode }>;
  pending(): { currentSelectionIndex: number; collectedArgs: Record<string, unknown>; repeating?: { accumulated: unknown[] } } | undefined;
}

function runnerRoute(action: string, r = runner()): Route {
  r.startPendingAction(action, 1);
  return {
    game: r.game,
    pick: async (selection, value) => r.processSelectionStep(1, selection, value),
    pending: () => r.getPendingAction(1),
  };
}

function sessionRoute(action: string, r = runner()): Route & { cancel(): void } {
  const manager = new PendingActionManager(r, 2);
  return {
    game: r.game,
    pick: (selection, value) => manager.processSelectionStep(1, selection, value, action),
    pending: () => manager.getPendingAction(1),
    cancel: () => manager.cancelPendingAction(1),
  };
}

/** What a pending action holds, element picks by id, for comparing across routes. */
const held = (route: Route) => {
  const pending = route.pending();
  return pending && JSON.parse(JSON.stringify({
    at: pending.currentSelectionIndex,
    args: pending.collectedArgs,
    accumulated: pending.repeating?.accumulated,
  }));
};

const routes = { runner: runnerRoute, session: sessionRoute };

afterEach(() => vi.restoreAllMocks());

describe('a failed pick-by-pick op keeps nothing (#1169)', () => {
  for (const [name, route] of Object.entries(routes)) {
    it(`undoes an onEach that moved an element and threw, and keeps the action open, on the ${name} route`, async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const seat = route('gather');
      expect((await seat.pick('items', 'one')).success).toBe(true);
      const before = held(seat);

      expect(await seat.pick('items', 'two')).toMatchObject({ success: false, errorCode: ErrorCode.ENGINE_ERROR });

      expect(moved(seat.game)).toEqual(['one']);
      expect(held(seat)).toEqual(before);
      expect(await seat.pick('items', 'done')).toMatchObject({ success: true, actionComplete: true });
    });

    for (const action of ['pairRefused', 'pairCrash']) {
      it(`undoes the completing op of '${action}' and keeps the action open at its last good pick, on the ${name} route`, async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const seat = route(action);
        expect((await seat.pick('first', 'a')).success).toBe(true);
        const before = held(seat);

        expect((await seat.pick('second', 'b')).success).toBe(false);

        expect(moved(seat.game)).toEqual(['one']);
        expect(held(seat)).toEqual(before);
      });
    }
  }

  it('lets the player cancel the open action after a failed op, undoing its earlier picks', async () => {
    const seat = sessionRoute('pairRefused');
    await seat.pick('first', 'a');
    expect((await seat.pick('second', 'b')).success).toBe(false);

    seat.cancel();

    expect(moved(seat.game)).toEqual([]);
    expect(seat.pending()).toBeUndefined();
  });

  it('says a failed op could not be undone when checkpoints are off, and closes the action as before', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const seat = sessionRoute('pairCrash', runner(false));
    await seat.pick('first', 'a');

    const failed = await seat.pick('second', 'b') as { error?: string };

    expect(failed.error).toMatch(/may still hold its partial changes/);
    expect(moved(seat.game)).toEqual(['one', 'two']);
    expect(seat.pending()).toBeUndefined();
  });

  it('hands a long-lived PickHandler back the pending action as it was before the failed op', async () => {
    const r = runner();
    const picks = new PickHandler(r, 2);
    const first = await picks.processSelectionStep(1, 'first', 'a', 'pairRefused');
    const failed = await picks.processSelectionStep(1, 'second', 'b', 'pairRefused', undefined, first.pendingState);

    expect(failed.success).toBe(false);
    expect(failed.pendingState).toEqual(first.pendingState);
    expect(moved(r.game)).toEqual(['one']);
  });
});

describe('a repeating pick whose action then fails (#983)', () => {
  it('ends in the same state on the session and session-free routes: the last pick undone, the action open', async () => {
    const ends = [];
    for (const route of Object.values(routes)) {
      const seat = route('gatherRefused');
      expect((await seat.pick('items', 'one')).success).toBe(true);
      const before = held(seat);
      expect(await seat.pick('items', 'two')).toMatchObject({ success: false, errorCode: ErrorCode.ACTION_EXECUTION_ERROR });
      expect(held(seat)).toEqual(before);
      ends.push({ moved: moved(seat.game), held: held(seat) });
    }
    expect(ends[0]).toEqual({ moved: ['one'], held: expect.anything() });
    expect(ends[1]).toEqual(ends[0]);
  });
});

describe("another seat's move between a seat's picks (#1177)", () => {
  for (const [name, route] of Object.entries(routes)) {
    it(`undoes only the failed op, keeping the other seat's move and the earlier picks, on the ${name} route`, async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const r = runner();
      const seat = route('pairCrash', r);
      expect((await seat.pick('first', 'a')).success).toBe(true);
      expect(r.performAction('tap', 2, {}).success).toBe(true);
      const before = held(seat);

      expect((await seat.pick('second', 'b')).success).toBe(false);

      expect(moved(r.game)).toEqual(['one']);
      expect(r.game.taps).toBe(1);
      expect(r.actionHistory).toHaveLength(1);
      expect(held(seat)).toEqual(before);
    });
  }
});

describe('the platform route (a failed op returns an error and no state)', () => {
  const def: GameDefinitionLike = { gameClass: UndoGame, gameType: 'undo', minPlayers: 2, maxPlayers: 2 };
  const options = { playerCount: 2, seed: 'undo' };

  it('answers a failed completing op exactly as before', async () => {
    const start = succeeded(await executeOp(def, options, null, null, { type: 'start' }));
    const first = succeeded(await executeOp(def, options, start.snapshot, null, {
      type: 'selectionStep', player: 1, selectionName: 'first', value: 'a', actionName: 'pairRefused', boundaryKey: boundaryKeyOf(start.snapshot),
    }));

    const failed = await executeOp(def, options, first.snapshot, first.pendingState, {
      type: 'selectionStep', player: 1, selectionName: 'second', value: 'b', actionName: 'pairRefused', boundaryKey: boundaryKeyOf(first.snapshot),
    });

    expect(failed).toEqual({ success: false, error: 'Not today.', errorCode: ErrorCode.ACTION_EXECUTION_ERROR, category: 'bundle' });
  });

  it('answers a failed onEach op exactly as before', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const start = succeeded(await executeOp(def, options, null, null, { type: 'start' }));
    const first = succeeded(await executeOp(def, options, start.snapshot, null, {
      type: 'selectionStep', player: 1, selectionName: 'items', value: 'one', actionName: 'gather', boundaryKey: boundaryKeyOf(start.snapshot),
    }));

    const failed = await executeOp(def, options, first.snapshot, first.pendingState, {
      type: 'selectionStep', player: 1, selectionName: 'items', value: 'two', actionName: 'gather', boundaryKey: boundaryKeyOf(first.snapshot),
    });

    expect(failed).toMatchObject({ success: false, errorCode: ErrorCode.ENGINE_ERROR });
    expect(Object.keys(failed).sort()).toEqual(['category', 'error', 'errorCode', 'success']);
  });
});
