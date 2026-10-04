/**
 * `boardsmith dev` closes a timed step the way the platform does (#302).
 *
 * A step that declares `timeLimitMs` reports it on the turn boundary (#300).
 * The dev host arms ONE timer per boundary key on its own clock, stamps every
 * `game_state` frame with `deadlineAt` and `serverNow` (#301's contract), and
 * when the window elapses submits the manifest's `idleAction` for every seat
 * still due that is not a bot, stamped with the key it armed under. The clock
 * here is a hand-driven stand-in for `createNodeWorldClock`, so nothing waits
 * on real time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Action,
  Game,
  Player,
  defineFlow,
  dueSeats,
  loop,
  simultaneousActionStep,
  type GameOptions,
  type SeatActivityState,
} from '../../engine/index.js';
import {
  executeOp,
  STALE_SUBMISSION_MESSAGE,
  type GameDefinitionLike,
  type Op,
  type OpResult,
} from '../../session/index.js';
import {
  fixedDeployDefinition,
  untimedDeployDefinition,
} from '../../session/testing/fixtures/timed-step-fixture.js';
import type { WorldHostClock } from './node-world-clock.js';
import { MultiplayerHost, type HostOutbound, type MultiplayerHostOptions } from './multiplayer-host.js';
import { createDevHostClientMemory } from './test-client-memory.js';

const clients = createDevHostClientMemory();
beforeEach(() => clients.reset());

/** The fixture's window: 120 s, every round. */
const WINDOW_MS = 120_000;
const START = 1_700_000_000_000;

interface FakeClock extends WorldHostClock {
  advance(ms: number): void;
  /** Every `fire` ever armed, in order, so a test can call a superseded one. */
  readonly fires: Array<() => void>;
  /** The delay of the timer currently armed, or null when disarmed. */
  readonly armedDelay: number | null;
}

function fakeClock(): FakeClock {
  let now = START;
  let timer: { at: number; delay: number; fire: () => void } | null = null;
  const fires: Array<() => void> = [];
  return {
    now: () => now,
    yieldTurn: async () => {},
    arm(delayMs, fire) {
      if (delayMs === null) {
        timer = null;
        return;
      }
      fires.push(fire);
      timer = { at: now + delayMs, delay: delayMs, fire };
    },
    advance(ms) {
      now += ms;
      if (timer && timer.at <= now) {
        const due = timer;
        timer = null;
        due.fire();
      }
    },
    fires,
    get armedDelay() {
      return timer?.delay ?? null;
    },
  };
}

/** A simultaneous timed step whose idle action (`wait`) never marks a seat done. */
class StuckGame extends Game<StuckGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create('wait').execute(() => ({ success: true })));
    this.setFlow(
      defineFlow<StuckGame>({
        root: loop({
          maxIterations: 3,
          do: simultaneousActionStep<StuckGame>({
            name: 'stuck',
            actions: ['wait'],
            playerDone: () => false,
            timeLimitMs: 10_000,
          }),
        }),
      }),
    );
  }
}
const stuckDefinition: GameDefinitionLike = { gameClass: StuckGame, gameType: 'stuck', minPlayers: 2, maxPlayers: 2 };

/**
 * A timed simultaneous step offering only `scout`, once per seat. `scout`
 * returns a follow-up into `loot`, which the step does not list, so a seat that
 * scouted is held for its follow-up with nothing else offered: not even the
 * idle action, `commit` (#494).
 */
class HeldGame extends Game<HeldGame, Player> {
  scouted: number[] = [];
  constructor(options: GameOptions) {
    super(options);
    this.registerActions(
      Action.create<HeldGame>('scout')
        .condition({ 'has not scouted': (ctx) => !(ctx.game as HeldGame).scouted.includes(ctx.player.seat) })
        .execute((_a, ctx) => {
          (ctx.game as HeldGame).scouted.push(ctx.player.seat);
          return { success: true, followUp: { action: 'loot' } };
        }),
      Action.create<HeldGame>('loot').chooseFrom('where', { choices: ['north', 'south'] }).execute(() => {}),
      Action.create<HeldGame>('commit').execute(() => ({ success: true })),
    );
    this.setFlow(
      defineFlow<HeldGame>({
        root: loop({
          maxIterations: 3,
          while: (ctx) => (ctx.game as HeldGame).scouted.length < 2,
          do: simultaneousActionStep<HeldGame>({ name: 'raid', actions: ['scout'], timeLimitMs: 10_000 }),
        }),
      }),
    );
  }
}
const heldDefinition: GameDefinitionLike = { gameClass: HeldGame, gameType: 'held', minPlayers: 2, maxPlayers: 2 };

type Executed = { op: Op; result: OpResult };

function makeHost(
  def: GameDefinitionLike,
  extra: Partial<MultiplayerHostOptions> & { stallBots?: boolean } = {},
) {
  const { stallBots, ...options } = extra;
  const clock = fakeClock();
  const sent: Array<{ clientId: string; msg: HostOutbound }> = [];
  const executed: Executed[] = [];
  const host = new MultiplayerHost({
    playerCount: 2,
    minPlayers: 2,
    maxPlayers: 2,
    makeSeed: () => 'deadline',
    clock,
    idleAction: { name: 'commit' },
    executeOp: async (gameOptions, snap, pend, op, hostOptions) => {
      // A bot that never moves: the pump asks with no seats, so it is told
      // `botMoved: false` by the real engine rather than by a hand-built result.
      const asked = stallBots && op.type === 'botTurn' ? { ...op, seats: [] } : op;
      const result = await executeOp(def, gameOptions, snap, pend, asked, hostOptions);
      executed.push({ op, result });
      return result;
    },
    send: (clientId, msg) => {
      sent.push({ clientId, msg });
      clients.remember(clientId, msg);
    },
    ...options,
  });
  const frames = (clientId: string) =>
    sent
      .filter((e) => e.clientId === clientId && e.msg.type === 'game_state')
      .map((e) => e.msg as Extract<HostOutbound, { type: 'game_state' }>);
  const lastFrame = (clientId: string) => frames(clientId).at(-1)!;
  const errors = (clientId: string) =>
    sent.filter((e) => e.clientId === clientId && e.msg.type === 'error').map((e) => (e.msg as { message: string }).message);
  /** Whether `op` is a seat's move or the host closing that seat's timed step. */
  const closesSeat = (op: Op): op is Extract<Op, { type: 'action' | 'expireTimedSeat' }> =>
    op.type === 'action' || op.type === 'expireTimedSeat';
  const actionsFor = (seat: number) =>
    executed.filter((e) => closesSeat(e.op) && e.op.player === seat);
  const commit = (clientId: string, requestId: string) =>
    host.handleMessage(clientId, {
      type: 'server_request',
      requestId,
      op: 'action',
      payload: { actionName: 'commit', args: {}, boundaryKey: clients.key(clientId) },
    });
  /**
   * Seat both players as humans, A in seat 1 and B in seat 2, in a game that
   * started with both seated. The first hello starts the game with seat 2 as a
   * bot, which commits for it at once, so the table is restarted once B sits.
   * Setup must say nothing on the console: a bot whose only move never ends its
   * turn spins the pump to its 500-move cap, which is seconds of real work
   * (#332). Such a game seats its bot with `stallBots`.
   */
  const seatBoth = async () => {
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('B', { type: 'hello' });
    await host.handleMessage('B', { type: 'join', seat: 2 });
    await host.handleMessage('A', { type: 'restart' });
    expect(error).not.toHaveBeenCalled();
    executed.length = 0;
  };
  const actions = () => executed.filter((e) => closesSeat(e.op));
  /** Every timed-seat close the host submitted, in order. */
  const expiries = () => executed.filter((e) => e.op.type === 'expireTimedSeat');
  /** The one error the host reported to seat 1's client, once it arrives. */
  const reported = async () => {
    await vi.waitFor(() => expect(errors('A')).toHaveLength(1));
    return errors('A')[0];
  };
  /** Call a superseded timer's callback and prove it submits nothing. */
  const firesNothing = async (fire: () => void) => {
    fire();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(actions()).toHaveLength(0);
  };
  const due = (clientId: string) =>
    dueSeats((lastFrame(clientId).view as { flowState: SeatActivityState }).flowState);
  return { host, clock, lastFrame, errors, actions, actionsFor, expiries, reported, firesNothing, commit, seatBoth, due };
}

let info: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  info = vi.spyOn(console, 'info').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('MultiplayerHost step deadlines (#302)', () => {
  it('stamps every game_state frame with the deadline and the host clock', async () => {
    const h = makeHost(fixedDeployDefinition);
    await h.seatBoth();

    expect(h.clock.armedDelay).toBe(WINDOW_MS);
    const frame = h.lastFrame('A');
    expect(frame.deadlineAt).toBe(START + WINDOW_MS);
    expect(frame.serverNow).toBe(START);
    expect(h.lastFrame('B').deadlineAt).toBe(START + WINDOW_MS);
  });

  it('sends deadlineAt null on a step with no window, and arms nothing', async () => {
    const h = makeHost(untimedDeployDefinition);
    await h.seatBoth();

    expect(h.lastFrame('A').deadlineAt).toBeNull();
    expect(h.lastFrame('A').serverNow).toBe(START);
    expect(h.clock.fires).toHaveLength(0);
  });

  it('lands the idle action for the silent seat when the window elapses, and leaves the seat that acted alone', async () => {
    const h = makeHost(fixedDeployDefinition);
    await h.seatBoth();
    await h.commit('A', 'a1');
    const armedKey = clients.key('B');
    expect(h.actionsFor(1)).toHaveLength(1);

    h.clock.advance(WINDOW_MS);

    await vi.waitFor(() => expect(h.actionsFor(2)).toHaveLength(1));
    const [idle] = h.actionsFor(2);
    expect(idle.op).toEqual({ type: 'expireTimedSeat', idleAction: 'commit', args: {}, player: 2, boundaryKey: armedKey });
    expect(idle.result.success).toBe(true);
    // Seat 1 had already committed, so nothing more was submitted for it.
    expect(h.actionsFor(1)).toHaveLength(1);
    // The round closed: a new key, and a fresh window measured from now.
    await vi.waitFor(() => expect(clients.key('A')).not.toBe(armedKey));
    expect(h.lastFrame('A').deadlineAt).toBe(START + 2 * WINDOW_MS);
    expect(error).not.toHaveBeenCalled();
  });

  it('closes seats held for a follow-up when the window elapses, though the step offers them no idle action (#494)', async () => {
    const h = makeHost(heldDefinition);
    await h.seatBoth();
    for (const [client, requestId] of [['A', 's1'], ['B', 's2']] as const) {
      await h.host.handleMessage(client, {
        type: 'server_request',
        requestId,
        op: 'action',
        payload: { actionName: 'scout', args: {}, boundaryKey: clients.key(client) },
      });
    }
    expect(h.due('A')).toEqual([1, 2]);

    h.clock.advance(10_000);

    await vi.waitFor(() => expect(h.expiries()).toHaveLength(2));
    for (const idle of h.expiries()) {
      expect(idle.op).toMatchObject({ type: 'expireTimedSeat', idleAction: 'commit' });
      expect(idle.result.success).toBe(true);
    }
    await vi.waitFor(() => expect(h.lastFrame('A').view).toMatchObject({ flowState: { complete: true } }));
    expect(error).not.toHaveBeenCalled();
  });

  it('refuses the timer op as stale when a human closed the round first, instead of landing it on the next round', async () => {
    const h = makeHost(fixedDeployDefinition);
    await h.seatBoth();
    await h.commit('B', 'b1');
    const armedKey = clients.key('A');

    // Seat 1's own commit is already queued when the window elapses.
    const human = h.commit('A', 'a1');
    h.clock.advance(WINDOW_MS);
    await human;

    await vi.waitFor(() => expect(h.actionsFor(1)).toHaveLength(2));
    const [humanCommit, timerCommit] = h.actionsFor(1);
    expect(humanCommit.op.type).toBe('action');
    expect(humanCommit.result.success).toBe(true);
    expect(timerCommit.op).toMatchObject({ type: 'expireTimedSeat', boundaryKey: armedKey });
    expect(timerCommit.result).toMatchObject({ success: false, error: STALE_SUBMISSION_MESSAGE });
    // Seat 1 still owes a move in the new round: nothing was spent on its behalf.
    expect(clients.key('A')).not.toBe(armedKey);
    expect(h.due('A')).toContain(1);
    await vi.waitFor(() => expect(info).toHaveBeenCalledWith(expect.stringContaining('moved on')));
    expect(error).not.toHaveBeenCalled();
    expect(h.errors('A')).toEqual([]);
  });

  it('never submits for a bot seat, and says so loudly when the round does not move', async () => {
    const h = makeHost(fixedDeployDefinition, { stallBots: true });
    await h.host.handleMessage('A', { type: 'hello' });

    h.clock.advance(WINDOW_MS);

    await vi.waitFor(() => expect(h.actionsFor(1)).toHaveLength(1));
    expect(h.actionsFor(2)).toHaveLength(0);
    expect(await h.reported()).toMatch(/did not move/);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('did not move'));
  });

  it('reports an idle action the game refuses in the terminal and to every client', async () => {
    const h = makeHost(fixedDeployDefinition, { idleAction: { name: 'surrender' } });
    await h.seatBoth();

    h.clock.advance(WINDOW_MS);

    expect(await h.reported()).toMatch(/"surrender" was refused for seat 1/);
    expect(h.errors('B')).toEqual(h.errors('A'));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('"surrender" was refused'));
  });

  it('reports an idle action that is accepted but leaves the round open', async () => {
    // `wait` never ends a turn, so a bot holding seat 2 during setup would wait forever.
    const h = makeHost(stuckDefinition, { idleAction: { name: 'wait' }, stallBots: true });
    await h.seatBoth();

    h.clock.advance(10_000);

    expect(await h.reported()).toMatch(/did not move/);
    expect(h.actionsFor(1)).toHaveLength(1);
    expect(h.actionsFor(2)).toHaveLength(1);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('reports a timed step in a game that declares no idleAction', async () => {
    const h = makeHost(fixedDeployDefinition, { idleAction: undefined });
    await h.seatBoth();

    h.clock.advance(WINDOW_MS);

    expect(await h.reported()).toMatch(/no "idleAction"/);
    expect(h.actions()).toHaveLength(0);
  });

  it('fires the deadline now when a client asks, and refuses when no window is open', async () => {
    const h = makeHost(fixedDeployDefinition);
    await h.seatBoth();
    const armedKey = clients.key('A');

    await h.host.handleMessage('A', { type: 'fireDeadline' });

    expect(h.actionsFor(1)).toHaveLength(1);
    expect(h.actionsFor(2)).toHaveLength(1);
    expect(clients.key('A')).not.toBe(armedKey);

    const untimed = makeHost(untimedDeployDefinition);
    await untimed.seatBoth();
    await untimed.host.handleMessage('A', { type: 'fireDeadline' });
    expect(untimed.errors('A')).toEqual(['No step deadline is open right now, so there is nothing to fire.']);
  });

  it('clears the timer on restart, so the old window can never fire into the new game', async () => {
    const h = makeHost(fixedDeployDefinition);
    await h.seatBoth();
    const oldFire = h.clock.fires.at(-1)!;

    h.clock.advance(WINDOW_MS / 2);
    await h.host.handleMessage('A', { type: 'restart' });

    // The new game's window is measured from the restart, not from the old one.
    expect(h.clock.armedDelay).toBe(WINDOW_MS);
    expect(h.lastFrame('A').deadlineAt).toBe(START + WINDOW_MS / 2 + WINDOW_MS);
    await h.firesNothing(oldFire);
  });

  it('clears the timer when a New game is configured from the lobby', async () => {
    const h = makeHost(fixedDeployDefinition);
    await h.seatBoth();
    const oldFire = h.clock.fires.at(-1)!;

    await h.host.handleMessage('A', { type: 'configure', gameOptions: {} });

    await h.firesNothing(oldFire);
    expect(h.clock.armedDelay).toBe(WINDOW_MS);
  });

  it('a reloaded page is re-sent the same deadline and does not re-arm the window', async () => {
    const h = makeHost(fixedDeployDefinition);
    await h.seatBoth();
    const armed = h.clock.fires.length;

    h.clock.advance(30_000);
    // A reload's new socket says hello before the old one closes.
    await h.host.handleMessage('A', { type: 'hello' });

    expect(h.clock.fires).toHaveLength(armed);
    expect(h.lastFrame('A')).toMatchObject({ deadlineAt: START + WINDOW_MS, serverNow: START + 30_000 });
  });

  it('a session restored mid-window arms that window', async () => {
    const opened = await executeOp(fixedDeployDefinition, { playerCount: 2, seed: 'seed' }, null, null, { type: 'start' });
    const h = makeHost(fixedDeployDefinition, {
      seedSnapshot: opened.snapshot as NonNullable<MultiplayerHostOptions['seedSnapshot']>,
    });
    await h.seatBoth();

    expect(h.clock.armedDelay).toBe(WINDOW_MS);
    expect(h.lastFrame('A').deadlineAt).toBe(START + WINDOW_MS);
  });
});
