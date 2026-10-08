/**
 * A step holds a seat while it has a pending follow-up (#494).
 *
 * The rule, in both kinds of step:
 *
 * - a follow-up belongs to the seat whose action returned it, and each seat
 *   has its own: another seat's action never replaces it;
 * - a step never ends a seat's part (turn-based) or marks it done
 *   (simultaneous) while that seat holds a follow-up;
 * - there is no explicit decline: the seat drops its follow-up only by taking
 *   another action the step offers it.
 *
 * Each case is driven through the session-free GameRunner, the live session
 * host (`SnapshotSessionHost`)
 * and the stateless op executor, so every host reads the same per-seat state.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  Game,
  Player,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  simultaneousActionStep,
  sequence,
  enumerateLegalMoves,
  type FlowNode,
  type FlowState,
  type GameOptions,
  type GameStateSnapshot,
} from '../engine/index.js';
import { _clearShownWarnings } from '../utils/dev.js';
import { GameRunner } from '../runtime/runner.js';
import { MCTSBot } from '../bot/mcts-bot.js';
import { createHeadlessSession } from './headless-session.js';
import { executeOp, type GameDefinitionLike, type StateEnvelope } from './stateless-ops.js';
import { ErrorCode } from '../types/protocol.js';
import { boundaryKeyOf } from './testing/boundary-stamp.js';
import { historyLabels } from './testing/history-labels.js';
import { succeeded } from './op-result.test-helper.js';

type Shape = 'turn' | 'simultaneous';

/**
 * `scout` (once per seat) returns a follow-up into `loot`, which the step does
 * not list. `rest` is listed only by the decline variants: taking it is how a
 * seat drops its follow-up.
 */
class RaidGame extends Game<RaidGame, Player> {
  scouted: number[] = [];
  looted: number[] = [];
  rested: number[] = [];
  /** Where `loot` may look; empty makes the follow-up impossible. */
  sites = ['north', 'south'];

  constructor(options: GameOptions) {
    super(options);
    this.registerActions(
      Action.create<RaidGame>('scout')
        .prompt('Scout')
        .condition({ 'has not scouted': (ctx) => !(ctx.game as RaidGame).scouted.includes(ctx.player.seat) })
        .execute((_a, ctx) => {
          (ctx.game as RaidGame).scouted.push(ctx.player.seat);
          return { success: true, followUp: { action: 'loot', args: { by: ctx.player.seat } } };
        }),
      // Two selections, so a player collects it as a pending action. Its
      // condition is false for everyone: a follow-up bypasses it.
      Action.create<RaidGame>('loot')
        .prompt('Loot')
        .condition({ 'only as a follow-up': () => false })
        .chooseFrom('where', { choices: (ctx) => (ctx.game as RaidGame).sites })
        .chooseFrom('what', { choices: ['gold', 'gems'] })
        .execute((args, ctx) => {
          const by = (args as Record<string, unknown>).by;
          if (by !== ctx.player.seat) throw new Error(`loot carried by ${String(by)}`);
          (ctx.game as RaidGame).looted.push(ctx.player.seat);
        }),
      Action.create<RaidGame>('rest')
        .prompt('Rest')
        .condition({ 'has not rested': (ctx) => !(ctx.game as RaidGame).rested.includes(ctx.player.seat) })
        .execute((_a, ctx) => {
          (ctx.game as RaidGame).rested.push(ctx.player.seat);
        }),
    );
  }
}

/** The raid goes on until every seat has scouted or rested. */
function raiding(ctx: { game: unknown }): boolean {
  const game = ctx.game as RaidGame;
  return game.players.some((p) => !game.scouted.includes(p.seat) && !game.rested.includes(p.seat));
}

function flowFor(shape: Shape, actions: string[], timeLimitMs?: number): FlowNode<RaidGame> {
  return shape === 'turn'
    ? loop({ maxIterations: 3, while: raiding, do: eachPlayer({ do: actionStep({ actions, turnScope: 'restart', timeLimitMs }) }) })
    : loop({ maxIterations: 3, while: raiding, do: simultaneousActionStep({ actions, timeLimitMs }) });
}

const classes = new Map<string, typeof RaidGame>();
function raidClass(shape: Shape, decline: boolean, timed = false): typeof RaidGame {
  const key = `${shape}:${decline}:${timed}`;
  let cls = classes.get(key);
  if (!cls) {
    const actions = decline ? ['scout', 'rest'] : ['scout'];
    cls = class extends RaidGame {
      constructor(options: GameOptions) {
        super(options);
        this.setFlow(defineFlow({ root: flowFor(shape, actions, timed ? 30_000 : undefined) }));
      }
    };
    classes.set(key, cls);
  }
  return cls;
}

const gameOptions = { playerCount: 3, seed: 'follow-up-hold' };
const NOT_YOURS = "'loot' is not one of your actions right now.";

function runner(shape: Shape, decline = false): GameRunner<RaidGame> {
  const r = new GameRunner({ GameClass: raidClass(shape, decline), gameType: 'raid', gameOptions });
  r.start();
  return r;
}

/** Take seat's own loot through the pending (pick by pick) path. */
function lootByPicks(r: GameRunner<RaidGame>, seat: number) {
  r.startPendingAction('loot', seat);
  const first = r.processSelectionStep(seat, 'where', 'north');
  if (!first.success) return first;
  return r.processSelectionStep(seat, 'what', 'gold');
}

describe('GameRunner', () => {
  it('simultaneous: two seats each hold their own follow-up; each takes its own, neither the other', () => {
    const r = runner('simultaneous');
    expect(r.performAction('scout', 1, {}).success).toBe(true);
    expect(r.performAction('scout', 2, {}).success).toBe(true);

    expect(r.getFlowState()?.followUps).toEqual([
      { action: 'loot', args: { by: 1 }, seat: 1 },
      { action: 'loot', args: { by: 2 }, seat: 2 },
    ]);
    // Both are held: nothing else is listed for them, yet neither is done.
    const awaiting = r.getFlowState()!.awaitingPlayers!;
    expect(awaiting.find((p) => p.playerIndex === 1)).toMatchObject({ completed: false, availableActions: [] });
    expect(awaiting.find((p) => p.playerIndex === 2)).toMatchObject({ completed: false, availableActions: [] });

    // Neither may take the other's (seat 3 holds none at all).
    r.startPendingAction('loot', 3);
    expect(r.processSelectionStep(3, 'where', 'north')).toMatchObject({ success: false, error: NOT_YOURS });

    expect(lootByPicks(r, 2)).toMatchObject({ success: true, actionComplete: true });
    expect(lootByPicks(r, 1)).toMatchObject({ success: true, actionComplete: true });
    expect(r.game.looted).toEqual([2, 1]);
    expect(r.getFlowState()?.followUps).toBeUndefined();
    const after = r.getFlowState()!.awaitingPlayers!;
    expect(after.find((p) => p.playerIndex === 1)?.completed).toBe(true);
    expect(after.find((p) => p.playerIndex === 2)?.completed).toBe(true);
  });

  it('simultaneous: the step does not end while the last seat holds a follow-up', () => {
    const r = runner('simultaneous');
    r.performAction('scout', 1, {});
    lootByPicks(r, 1);
    r.performAction('scout', 2, {});
    lootByPicks(r, 2);
    r.performAction('scout', 3, {});

    const state = r.getFlowState()!;
    expect(state.awaitingInput).toBe(true);
    expect(state.awaitingPlayers?.find((p) => p.playerIndex === 3)?.completed).toBe(false);
    expect(lootByPicks(r, 3)).toMatchObject({ success: true });
    expect(r.game.looted).toEqual([1, 2, 3]);
  });

  it('turn-based: the turn stays with the seat until it takes its follow-up', () => {
    const r = runner('turn');
    expect(r.performAction('scout', 1, {}).success).toBe(true);

    const held = r.getFlowState()!;
    expect(held.currentPlayer).toBe(1);
    expect(held.availableActions).toEqual([]);
    expect(held.followUps).toEqual([{ action: 'loot', args: { by: 1 }, seat: 1 }]);
    expect(r.refusalToAct('loot', 2)).toMatchObject({ errorCode: 'NOT_YOUR_TURN' });

    expect(lootByPicks(r, 1)).toMatchObject({ success: true, actionComplete: true });
    expect(r.getFlowState()?.currentPlayer).toBe(2);
    expect(r.getFlowState()?.followUps).toBeUndefined();
  });

  for (const shape of ['turn', 'simultaneous'] as const) {
    it(`${shape}: taking another action the step offers drops the follow-up`, () => {
      const r = runner(shape, true);
      r.performAction('scout', 1, {});
      expect(r.refusalToAct('loot', 1)).toBeUndefined();

      expect(r.performAction('rest', 1, {}).success).toBe(true);

      expect(r.getFlowState()?.followUps).toBeUndefined();
      expect(r.refusalToAct('loot', 1)).toBeDefined();
      expect(r.game.looted).toEqual([]);
    });

    it(`${shape}: a refused action leaves the follow-up held`, () => {
      const r = runner(shape);
      r.performAction('scout', 1, {});

      expect(r.performAction('scout', 1, {}).success).toBe(false);

      expect(r.getFlowState()?.followUps).toEqual([{ action: 'loot', args: { by: 1 }, seat: 1 }]);
    });

    it(`${shape}: the owner may take its follow-up as one whole action, with its own args`, () => {
      const r = runner(shape);
      r.performAction('scout', 1, {});

      expect(r.performAction('loot', 2, { where: 'north', what: 'gold' }).success).toBe(false);
      expect(r.performAction('loot', 1, { where: 'north', what: 'gold' }).success).toBe(true);
      expect(r.game.looted).toEqual([1]);
      expect(historyLabels(r.actionHistory)).toEqual(['scout:1', 'loot:1']);
    });

    it(`${shape}: legal moves for the owner are its follow-up, with its args bound`, () => {
      const r = runner(shape);
      r.performAction('scout', 1, {});

      const moves = enumerateLegalMoves(r.game, 1);
      expect(moves).toHaveLength(4);
      for (const move of moves) {
        expect(move.action).toBe('loot');
        expect(move.args.by).toBe(1);
      }
      expect(enumerateLegalMoves(r.game, 2).some((m) => m.action === 'loot')).toBe(false);
    });

    it(`${shape}: the hold survives a snapshot restore`, () => {
      const r = runner(shape);
      r.performAction('scout', 1, {});

      const restored = GameRunner.fromSnapshot(JSON.parse(JSON.stringify(r.getSnapshot())), raidClass(shape, false));

      expect(restored.getFlowState()?.followUps).toEqual([{ action: 'loot', args: { by: 1 }, seat: 1 }]);
      expect(lootByPicks(restored, 1)).toMatchObject({ success: true, actionComplete: true });
    });
  }
});

describe('a bot holding a follow-up', () => {
  for (const shape of ['turn', 'simultaneous'] as const) {
    it(`${shape}: plays it, so the step does not stall on a bot seat`, async () => {
      const r = runner(shape);
      r.performAction('scout', 1, {});

      const bot = new MCTSBot(
        r.game,
        raidClass(shape, false),
        'raid',
        1,
        r.actionHistory,
        { iterations: 8, playoutDepth: 2, seed: 'hold', async: false, usePNS: false },
        { objectives: () => ({ loot: { weight: 1, checker: (game) => (game as RaidGame).looted.length } }) },
      );
      const move = await bot.play();

      expect(move?.action).toBe('loot');
      expect(r.performAction(move!.action, 1, move!.args).success).toBe(true);
      expect(r.game.looted).toEqual([1]);
    });
  }
});

describe('a held follow-up with no valid choices warns in development', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    _clearShownWarnings();
  });

  for (const shape of ['turn', 'simultaneous'] as const) {
    it(`${shape}: names the step, the seat and the follow-up`, () => {
      _clearShownWarnings();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const r = runner(shape);
      r.game.sites = [];

      r.performAction('scout', 1, {});

      const messages = warn.mock.calls.map((c) => String(c[0]));
      expect(messages.some((m) => /seat 1/.test(m) && /'loot'/.test(m) && /no valid choice/.test(m))).toBe(true);
    });
  }
});

describe('live session host', () => {
  /** A started live-host table of `GameClass`, with the moves these cases make. */
  async function session(GameClass: typeof RaidGame) {
    const table = createHeadlessSession(
      { gameClass: GameClass, gameType: 'raid', minPlayers: 2, maxPlayers: 3 },
      { ...gameOptions, playerNames: ['A', 'B', 'C'] },
    );
    await table.start();
    return {
      table,
      act: (seat: number, actionName: string) => table.send(seat, { type: 'action', actionName, player: seat, args: {} }),
      pick: (seat: number, selectionName: string, value: string, actionName?: string, initialArgs?: Record<string, unknown>) =>
        table.send(seat, { type: 'selectionStep', player: seat, selectionName, value, actionName, initialArgs }),
      undo: (seat: number) => table.send(seat, { type: 'undo', player: seat }),
    };
  }

  it('simultaneous: two seats each hold their own follow-up; each takes its own, neither the other', async () => {
    const s = await session(raidClass('simultaneous', false));
    const one = succeeded(await s.act(1, 'scout'));
    const two = succeeded(await s.act(2, 'scout'));
    expect(one.followUp).toMatchObject({ action: 'loot', args: { by: 1 } });
    expect(two.followUp).toMatchObject({ action: 'loot', args: { by: 2 } });

    // Seat 3 is refused as seat 2, then seats 1 and 2 each take their own.
    expect(await s.pick(3, 'where', 'north', 'loot', { by: 2 })).toMatchObject({
      success: false,
      error: NOT_YOURS,
    });
    expect((await s.pick(1, 'where', 'north', 'loot', { by: 1 })).success).toBe(true);
    expect(await s.pick(1, 'what', 'gold')).toMatchObject({ success: true, actionComplete: true });
    expect((await s.pick(2, 'where', 'south', 'loot', { by: 2 })).success).toBe(true);
    expect(await s.pick(2, 'what', 'gems')).toMatchObject({ success: true, actionComplete: true });
    expect(s.table.readGame().looted).toEqual([1, 2]);
  });

  for (const shape of ['turn', 'simultaneous'] as const) {
    it(`${shape}: undo to the turn start takes the follow-up back with the action that returned it`, async () => {
      const s = await session(raidClass(shape, false));
      expect((await s.act(1, 'scout')).success).toBe(true);
      expect(s.table.host.flowState?.followUps).toHaveLength(1);

      const undone = await s.undo(1);

      expect(undone.success).toBe(true);
      expect(s.table.host.flowState?.followUps).toBeUndefined();
      expect(s.table.readGame().scouted).toEqual([]);
    });
  }

  it('publishes a held follow-up in its own seat\'s state only, so a reloaded page can resume it', async () => {
    const s = await session(raidClass('simultaneous', false));
    expect((await s.act(1, 'scout')).success).toBe(true);

    expect(s.table.playerState(1).followUp).toMatchObject({
      action: 'loot',
      args: { by: 1 },
      metadata: { name: 'loot' },
    });
    expect(s.table.playerState(2).followUp).toBeUndefined();
    expect((s.table.spectatorViews.at(-1) as { state: { followUp?: unknown } }).state.followUp).toBeUndefined();
  });

  it('turn-based: undo to the turn start reaches back over a whole follow-up chain (#495)', async () => {
    // Two moves a turn, so the seat is still up after scout + loot (one move).
    class TwoMoveRaid extends RaidGame {
      constructor(options: GameOptions) {
        super(options);
        this.setFlow(defineFlow({
          root: loop({
            maxIterations: 3,
            while: raiding,
            do: eachPlayer({ do: actionStep({ actions: ['scout', 'rest'], maxMoves: 2, turnScope: 'restart' }) }),
          }),
        }));
      }
    }
    const s = await session(TwoMoveRaid);
    expect((await s.act(1, 'scout')).success).toBe(true);
    expect((await s.pick(1, 'where', 'north', 'loot', { by: 1 })).success).toBe(true);
    expect(await s.pick(1, 'what', 'gold')).toMatchObject({ success: true, actionComplete: true });
    expect(s.table.host.flowState).toMatchObject({ currentPlayer: 1, moveCount: 2, movesRemaining: 1 });

    const undone = await s.undo(1);

    expect(undone.success).toBe(true);
    expect(s.table.readGame().scouted).toEqual([]);
    expect(s.table.readGame().looted).toEqual([]);
    expect(s.table.host.flowState).toMatchObject({ currentPlayer: 1, moveCount: 0 });
  });

  it('turn-based: the turn stays with the seat until it takes its follow-up', async () => {
    const s = await session(raidClass('turn', false));
    expect((await s.act(1, 'scout')).success).toBe(true);
    expect(s.table.host.flowState?.currentPlayer).toBe(1);

    expect((await s.pick(1, 'where', 'north', 'loot', { by: 1 })).success).toBe(true);
    expect(await s.pick(1, 'what', 'gold')).toMatchObject({ success: true, actionComplete: true });
    expect(s.table.host.flowState?.currentPlayer).toBe(2);
  });
});

describe('stateless ops', () => {
  async function play(shape: Shape) {
    const def: GameDefinitionLike = { gameClass: raidClass(shape, false), gameType: 'raid', minPlayers: 2, maxPlayers: 3 };
    let last: StateEnvelope = succeeded(await executeOp(def, gameOptions, null, {}, { type: 'start' }));
    const action = async (seat: number, actionName: string) => {
      const moved = succeeded(await executeOp(def, gameOptions, last.snapshot, null, {
        type: 'action', actionName, player: seat, args: {}, boundaryKey: boundaryKeyOf(last.snapshot),
      }));
      last = moved;
      return moved;
    };
    const loot = async (seat: number, by: number) => {
      const first = await executeOp(def, gameOptions, last.snapshot, null, {
        type: 'selectionStep', player: seat, selectionName: 'where', value: 'north', actionName: 'loot',
        initialArgs: { by }, boundaryKey: boundaryKeyOf(last.snapshot),
      });
      if (!first.success) return first;
      const second = succeeded(await executeOp(def, gameOptions, first.snapshot, first.pendingState, {
        type: 'selectionStep', player: seat, selectionName: 'what', value: 'gold', actionName: 'loot',
        initialArgs: { by, where: 'north' }, boundaryKey: boundaryKeyOf(first.snapshot),
      }));
      last = second;
      return second;
    };
    return { action, loot, get last() { return last; } };
  }

  it('simultaneous: two seats each hold their own follow-up; each takes its own, neither the other', async () => {
    const g = await play('simultaneous');
    expect((await g.action(1, 'scout')).followUp).toMatchObject({ action: 'loot', args: { by: 1 } });
    expect((await g.action(2, 'scout')).followUp).toMatchObject({ action: 'loot', args: { by: 2 } });

    const views = g.last.playerViews as Array<{ state: { followUp?: unknown } }>;
    expect(views[0]!.state.followUp).toMatchObject({ action: 'loot', args: { by: 1 } });
    expect(views[2]!.state.followUp).toBeUndefined();

    expect(await g.loot(3, 1)).toMatchObject({ success: false, error: NOT_YOURS });
    expect(await g.loot(1, 1)).toMatchObject({ success: true, actionComplete: true });
    expect(await g.loot(2, 2)).toMatchObject({ success: true, actionComplete: true });
  });

  for (const shape of ['turn', 'simultaneous'] as const) {
    it(`${shape}: a bot seat holding a follow-up takes it through the botTurn op`, async () => {
      const def: GameDefinitionLike = { gameClass: raidClass(shape, false), gameType: 'raid', minPlayers: 2, maxPlayers: 3 };
      const started = succeeded(await executeOp(def, gameOptions, null, {}, { type: 'start' }));
      const scouted = succeeded(await executeOp(def, gameOptions, started.snapshot, null, {
        type: 'action', actionName: 'scout', player: 1, args: {}, boundaryKey: boundaryKeyOf(started.snapshot),
      }));

      const turn = succeeded(await executeOp(def, gameOptions, scouted.snapshot, null, { type: 'botTurn', seats: [{ seat: 1, level: '8' }] }));

      expect(turn).toMatchObject({ success: true, botMoved: true, botPlayer: 1 });
      expect((turn.snapshot.flowState as FlowState).followUps).toBeUndefined();
    });
  }

  it('turn-based: the turn stays with the seat until it takes its follow-up', async () => {
    const g = await play('turn');
    await g.action(1, 'scout');
    expect((g.last.snapshot.flowState as FlowState).currentPlayer).toBe(1);

    expect(await g.loot(1, 1)).toMatchObject({ success: true, actionComplete: true });
    expect((g.last.snapshot.flowState as FlowState).currentPlayer).toBe(2);
  });
});

/**
 * Host deadlines always win (#494, ruled). When a host's deadline for a seat
 * passes, a step's own time limit or any deadline the host keeps itself, the
 * host submits one `expireSeat` op per seat still due, naming the game's idle
 * action. A seat holding a follow-up is closed like any other: with the idle
 * action when the step offers it (which drops the follow-up), else by dropping
 * the follow-up and ending the seat's part. That close runs no action, so the
 * history records it as a seat expiry: a replay re-applies it, and undo never
 * reaches behind it. A step needs no time limit for this: the deadline is the
 * host's, so the op closes a seat on any step.
 */
describe('a host deadline that passed for a seat', () => {
  const SEAT_1_EXPIRED = { kind: 'seatExpiry', player: 1, undoable: false };

  async function scoutedTimed(shape: Shape, decline: boolean, timed = true) {
    const def: GameDefinitionLike = { gameClass: raidClass(shape, decline, timed), gameType: 'raid', minPlayers: 2, maxPlayers: 3 };
    const started = succeeded(await executeOp(def, gameOptions, null, {}, { type: 'start' }));
    const scouted = succeeded(await executeOp(def, gameOptions, started.snapshot, null, {
      type: 'action', actionName: 'scout', player: 1, args: {}, boundaryKey: boundaryKeyOf(started.snapshot),
    }));
    expect((scouted.snapshot.flowState as FlowState).followUps).toHaveLength(1);
    const expire = (snapshot: GameStateSnapshot, seat = 1, boundaryKey = boundaryKeyOf(snapshot)) => executeOp(def, gameOptions, snapshot, null, {
      type: 'expireSeat', player: seat, idleAction: 'rest', args: {}, boundaryKey,
    });
    const action = (snapshot: GameStateSnapshot, seat: number, actionName: string) => executeOp(def, gameOptions, snapshot, null, {
      type: 'action', actionName, player: seat, args: {}, boundaryKey: boundaryKeyOf(snapshot),
    });
    const undo = (snapshot: GameStateSnapshot, seat: number) => executeOp(def, gameOptions, snapshot, null, { type: 'undo', player: seat });
    const history = (result: StateEnvelope) => result.snapshot.actionHistory;
    return { def, scouted, expire, action, undo, history };
  }

  for (const shape of ['turn', 'simultaneous'] as const) {
    for (const timed of [true, false]) {
    const step = timed ? 'timed step' : 'step with no time limit';
    it(`${shape}, ${step}: the idle action the step offers closes the held seat and drops its follow-up`, async () => {
      const { scouted, expire, history } = await scoutedTimed(shape, true, timed);

      const closed = succeeded(await expire(scouted.snapshot));

      expect(closed.success).toBe(true);
      expect((closed.snapshot.flowState as FlowState).followUps).toBeUndefined();
      const runner = GameRunner.fromSnapshot(closed.snapshot as GameStateSnapshot, raidClass(shape, true, timed));
      expect(runner.game.rested).toEqual([1]);
      // The idle action ran as the seat's own action, so that is what the history holds.
      expect(historyLabels(history(closed))).toEqual(['scout:1', 'rest:1']);
    });

    it(`${shape}, ${step}: with no idle action offered, the held seat's follow-up is dropped and its part ends`, async () => {
      const { scouted, expire, action, history } = await scoutedTimed(shape, false, timed);

      // A player cannot do this: the idle action itself is refused.
      expect((await action(scouted.snapshot, 1, 'rest')).success).toBe(false);

      const closed = succeeded(await expire(scouted.snapshot));

      expect(closed.success).toBe(true);
      const state = closed.snapshot.flowState as FlowState;
      expect(state.followUps).toBeUndefined();
      if (shape === 'turn') {
        expect(state.currentPlayer).toBe(2);
      } else {
        expect(state.awaitingPlayers?.find((p) => p.playerIndex === 1)?.completed).toBe(true);
      }
      const runner = GameRunner.fromSnapshot(closed.snapshot as GameStateSnapshot, raidClass(shape, false, timed));
      expect(runner.game.rested).toEqual([]);
      expect(runner.game.looted).toEqual([]);
      expect(history(closed)).toEqual([expect.objectContaining({ name: 'scout', player: 1 }), SEAT_1_EXPIRED]);
    });

    it(`${shape}, ${step}: a history holding an expiry replays to the same position`, async () => {
      const { scouted, expire, action, history } = await scoutedTimed(shape, false, timed);
      const closed = succeeded(await expire(scouted.snapshot));
      const after = succeeded(await action(closed.snapshot, 2, 'scout'));
      expect(after.success).toBe(true);
      expect(historyLabels(history(after))).toEqual(['scout:1', 'seatExpiry:1', 'scout:2']);

      const replayed = GameRunner.replay(
        { GameClass: raidClass(shape, false, timed), gameType: 'raid', gameOptions },
        history(after),
      );

      expect(replayed.actionHistory).toEqual(history(after));
      expect(replayed.game.scouted).toEqual([1, 2]);
      expect(replayed.game.looted).toEqual([]);
      // The same seats owed, held and done, and the same counts. `position` is
      // left out: its `iterations` entries record how a position was reached,
      // not where it is (see boundary-key.ts), and its variables hold element ids.
      const live = GameRunner.fromSnapshot(after.snapshot as GameStateSnapshot, raidClass(shape, false, timed));
      const { position: _replayedPosition, ...replayedState } = replayed.getFlowState()!;
      const { position: _livePosition, ...liveState } = live.getFlowState()!;
      expect(replayedState).toEqual(liveState);
      expect(replayed.getFlowState()!.position.path).toEqual(live.getFlowState()!.position.path);
    });

    it(`${shape}, ${step}: a seat holding no follow-up and not offered the idle action is refused`, async () => {
      const { scouted, expire, history } = await scoutedTimed(shape, false, timed);

      // Seat 2 holds nothing, and the step offers no 'rest': there is no way to close it.
      const closed = await expire(scouted.snapshot, 2);

      expect(closed.success).toBe(false);
      expect(closed.error).toMatch(shape === 'turn' ? /Not Player 2's turn/ : /rest is not available/);
      expect(closed).not.toHaveProperty('snapshot');
      expect(historyLabels(history(scouted))).toEqual(['scout:1']);
    });
    }

    it(`${shape}: a player's action op cannot close a held seat, whatever it carries`, async () => {
      const { def, scouted, expire } = await scoutedTimed(shape, false);

      const refused = await executeOp(def, gameOptions, scouted.snapshot, null, {
        type: 'action', actionName: 'rest', player: 1, args: {}, boundaryKey: boundaryKeyOf(scouted.snapshot),
        // @ts-expect-error -- the action op has no timeout flag: closing a seat at a deadline is its own host-only op.
        onTimeout: true,
      });

      expect(refused.success).toBe(false);
      expect(refused.error).toMatch(/rest is not available/);
      // The seat is still held: the host can close it.
      expect((await expire(scouted.snapshot)).success).toBe(true);
    });

    it(`${shape}: a stale expiry is refused like any other submission`, async () => {
      const { scouted, expire, action } = await scoutedTimed(shape, false);
      const armedKey = boundaryKeyOf(scouted.snapshot);
      // Close the round the host armed its timer under: in a turn-based step the
      // next seat's turn, in a simultaneous step the next round, once every seat is done.
      let moved = succeeded(await expire(scouted.snapshot));
      if (shape === 'simultaneous') {
        for (const seat of [2, 3]) {
          moved = succeeded(await action(moved.snapshot, seat, 'scout'));
          moved = succeeded(await expire(moved.snapshot, seat));
        }
      }
      expect(moved.success).toBe(true);
      expect(boundaryKeyOf(moved.snapshot)).not.toBe(armedKey);

      const stale = await expire(moved.snapshot, 2, armedKey);

      expect(stale.success).toBe(false);
      expect(stale.errorCode).toBe(ErrorCode.STALE_SUBMISSION);
    });

    it(`${shape}: a replay refuses an expiry for a seat that holds no follow-up`, () => {
      expect(() => GameRunner.replay(
        { GameClass: raidClass(shape, false, true), gameType: 'raid', gameOptions },
        [{ kind: 'seatExpiry', player: 1, undoable: false }],
      )).toThrow(/Replay failed at seat 1's expiry: Seat 1 holds no follow-up/);
    });
  }

  it('simultaneous: the expiry counts in the step, and only the seats that acted after it can undo', async () => {
    const { scouted, expire, action, undo } = await scoutedTimed('simultaneous', false);
    expect((scouted.snapshot.flowState as FlowState).moveCount).toBe(1);

    const closed = succeeded(await expire(scouted.snapshot));
    expect((closed.snapshot.flowState as FlowState).moveCount).toBe(2);

    // The closed seat cannot take its own closure back.
    const refused = await undo(closed.snapshot, 1);
    expect(refused.success).toBe(false);
    expect(refused.error).toBe("Cannot undo: seat 1's time ran out and the host closed its part of the step, which cannot be taken back.");

    const after = succeeded(await action(closed.snapshot, 2, 'scout'));
    expect((after.snapshot.flowState as FlowState).moveCount).toBe(3);
    const undone = succeeded(await undo(after.snapshot, 2));
    expect(undone.success).toBe(true);
    expect((undone.snapshot as GameStateSnapshot).actionHistory).toHaveLength(2);
    expect((undone.snapshot.flowState as FlowState).awaitingPlayers?.find((p) => p.playerIndex === 1)?.completed).toBe(true);
  });

  it('turn-based: the next seat starts a fresh turn behind the expiry', async () => {
    const { scouted, expire, action, undo } = await scoutedTimed('turn', false);
    const closed = succeeded(await expire(scouted.snapshot));
    expect((closed.snapshot.flowState as FlowState)).toMatchObject({ currentPlayer: 2, moveCount: 0 });

    const after = succeeded(await action(closed.snapshot, 2, 'scout'));
    expect((after.snapshot.flowState as FlowState).moveCount).toBe(1);
    const undone = succeeded(await undo(after.snapshot, 2));
    expect(undone.success).toBe(true);
    expect((undone.snapshot as GameStateSnapshot).actionHistory).toEqual([
      expect.objectContaining({ name: 'scout', player: 1 }), SEAT_1_EXPIRED,
    ]);
    expect((undone.snapshot.flowState as FlowState).currentPlayer).toBe(2);
  });

  it('turn-based: a continuing turn counts the expiry, so undo cannot reach behind it', async () => {
    // One turn in two steps: a timed `scout` step, then a `wait` step that continues it.
    class TwoStepTurn extends RaidGame {
      constructor(options: GameOptions) {
        super(options);
        this.registerAction(Action.create<RaidGame>('wait').execute(() => {}));
        this.setFlow(defineFlow({
          root: loop({ maxIterations: 3, while: raiding, do: eachPlayer({ do: sequence(
            actionStep({ actions: ['scout'], turnScope: 'continue', timeLimitMs: 30_000 }),
            actionStep({ actions: ['wait'], turnScope: 'continue', maxMoves: 2 }),
          ) }) }),
        }));
      }
    }
    const def: GameDefinitionLike = { gameClass: TwoStepTurn, gameType: 'raid', minPlayers: 2, maxPlayers: 3 };
    const started = succeeded(await executeOp(def, gameOptions, null, {}, { type: 'start' }));
    const scouted = succeeded(await executeOp(def, gameOptions, started.snapshot, null, {
      type: 'action', actionName: 'scout', player: 1, args: {}, boundaryKey: boundaryKeyOf(started.snapshot),
    }));
    const closed = succeeded(await executeOp(def, gameOptions, scouted.snapshot, null, {
      type: 'expireSeat', player: 1, idleAction: 'rest', args: {}, boundaryKey: boundaryKeyOf(scouted.snapshot),
    }));
    expect(closed.success).toBe(true);
    // The same seat goes on with its turn in the next step, two entries in.
    expect(closed.snapshot.flowState as FlowState).toMatchObject({ currentPlayer: 1, availableActions: ['wait'], moveCount: 2 });

    const waited = succeeded(await executeOp(def, gameOptions, closed.snapshot, null, {
      type: 'action', actionName: 'wait', player: 1, args: {}, boundaryKey: boundaryKeyOf(closed.snapshot),
    }));
    expect(waited.snapshot.flowState as FlowState).toMatchObject({ currentPlayer: 1, moveCount: 3 });

    const refused = await executeOp(def, gameOptions, waited.snapshot, null, { type: 'undo', player: 1 });
    expect(refused.success).toBe(false);
    expect(refused.error).toContain("seat 1's time ran out");
  });
});

describe('a custom allDone ends the step and drops held follow-ups (#494, ruled)', () => {
  class OneScoutEnough extends RaidGame {
    constructor(options: GameOptions) {
      super(options);
      this.setFlow(defineFlow({
        root: simultaneousActionStep({ actions: ['scout'], allDone: (ctx) => (ctx.game as RaidGame).scouted.length >= 1 }),
      }));
    }
  }

  it('the step ends on its own allDone while a seat holds a follow-up', () => {
    const r = new GameRunner({ GameClass: OneScoutEnough, gameType: 'raid', gameOptions });
    r.start();

    expect(r.performAction('scout', 1, {}).success).toBe(true);

    expect(r.getFlowState()?.followUps).toBeUndefined();
    expect(r.isComplete()).toBe(true);
    expect(r.refusalToAct('loot', 1)).toBeDefined();
  });
});

describe('a pending action is settled only for the seat whose turn it is', () => {
  it('turn-based: settling it for another seat is refused loudly', () => {
    const r = runner('turn');
    expect(() => r.game.continueFlowAfterPendingAction({ success: true }, 2)).toThrow(/seat 2.*seat 1/i);
  });
});
