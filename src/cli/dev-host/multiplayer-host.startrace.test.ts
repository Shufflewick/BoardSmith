/**
 * D15/DEVHOST-03 regression: a client that disconnects WHILE `startGame`'s
 * `await session.start()` is still pending must not permanently orphan its
 * seat. `startGame` captures `humanSeats` (and seeds `this.botSeats`) BEFORE
 * the await, so a mid-await disconnect leaves the seat human-but-vanished
 * post-await unless something reconciles it — the flow loop then stalls
 * forever on a seat nobody can drive.
 *
 * Deterministic interleave technique (PROC-01): `executeOp` is stubbed so the
 * `start` op suspends on a manually-controlled deferred. Because none of the
 * intervening layers (`hello` → `startGame` → `session.start()` →
 * `host.start()` → the `executeOp` closure) contains a genuine async gap
 * before that stub, calling `host.handleMessage('A', { type: 'hello' })`
 * synchronously drives execution all the way down into the gated stub within
 * the SAME synchronous turn — so the test can call `host.disconnect('A')`
 * (and, in the Task 3 extension, `host.handleMessage('B', { type: 'join' }))`
 * immediately after, still inside the `await session.start()` window, with no
 * manual microtask-flushing required.
 */
import { beforeEach, describe, it, expect } from 'vitest';
import { Game, Player, Action, defineFlow, actionStep, loop, eachPlayer, type GameOptions } from '../../engine/index.js';
import { executeOp, type GameDefinitionLike, type Op, type OpResult } from '../../session/index.js';
import { MultiplayerHost, type HostOutbound } from './multiplayer-host.js';
import { createDevHostClientMemory } from './test-client-memory.js';

/** This suite's stand-in browser memory — see test-client-memory.ts. */
const clients = createDevHostClientMemory();
const rememberRendered = clients.remember;
/** The boundary key `clientId` would echo on its next submission. */
const clientKey = (clientId: string) => clients.key(clientId);

beforeEach(() => clients.reset());


/** Every seat must `pass` once per round, seat 1 before seat 2; several rounds
 *  so a reclaimed seat 1 has a SECOND turn to prove the bot yields (Task 3),
 *  not just a one-shot completion that can't distinguish reclaim from replay. */
class RaceGame extends Game<RaceGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow(
      defineFlow({
        root: loop({ maxIterations: 5, do: eachPlayer({ do: actionStep({ actions: ['pass'] }) }) }),
      }),
    );
  }
}

const raceDef: GameDefinitionLike = {
  gameClass: RaceGame as new (...args: unknown[]) => unknown,
  gameType: 'race',
  minPlayers: 2,
  maxPlayers: 2,
};

/** A deferred promise the test resolves manually, to gate the `start` op. */
function makeDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * Builds a host whose `start` op suspends on `gate.promise` when `gate` is
 * supplied — the deterministic interleave hook. Every other op (botTurn,
 * action, ...) runs immediately against the real pure executor.
 */
function makeRaceHost(gate: { promise: Promise<void> } | null) {
  const sent: Array<{ clientId: string; msg: HostOutbound }> = [];
  const host = new MultiplayerHost({
    playerCount: 2,
    minPlayers: 2,
    maxPlayers: raceDef.maxPlayers,
    makeSeed: () => 'race',
    executeOp: async (
      gameOptions: { playerCount: number; [key: string]: unknown },
      snap: unknown,
      pend: Record<string, unknown> | null,
      op: Op,
      hostOptions?: { teachingDisabled?: boolean },
    ): Promise<OpResult> => {
      if (op.type === 'start' && gate) await gate.promise;
      return executeOp(raceDef, gameOptions, snap, pend, op, hostOptions);
    },
    send: (clientId, msg) => { sent.push({ clientId, msg }); rememberRendered(clientId, msg); },
  });
  const to = (clientId: string) => sent.filter((e) => e.clientId === clientId).map((e) => e.msg);
  const lastOfType = (clientId: string, type: HostOutbound['type']) =>
    [...to(clientId)].reverse().find((m) => m.type === type) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const lastLobby = () => [...sent].reverse().find((e) => e.msg.type === 'lobby')?.msg as
    | { seats: Array<{ seat: number; clientId: string | null; connected: boolean }> }
    | undefined;
  return { host, sent, to, lastOfType, lastLobby, clear: () => (sent.length = 0) };
}

describe('MultiplayerHost — D15 disconnect-mid-startGame-await race (DEVHOST-03)', () => {
  it('a disconnect landing INSIDE the `await session.start()` window leaves the seat bot-covered post-fix (pre-fix: orphaned, loop stalls)', async () => {
    const gate = makeDeferred();
    const { host, lastOfType } = makeRaceHost(gate);

    // A auto-seats into seat 1 and drives synchronously into the gated
    // `start` op — still inside `await session.start()` when this call
    // returns, because nothing between here and the stub yields control.
    const helloPromise = host.handleMessage('A', { type: 'hello' });

    // THE interleave: disconnect lands mid-await, not after.
    host.disconnect('A');

    gate.resolve();
    await helloPromise;

    // Post-fix: seat 1 is bot-covered, so `runBotTurns()` (called inside
    // `startGame` right after the await) drives it — round 1 completes for
    // both seats and the opening `game_state` sent to A during `startGame`'s
    // own reinit shows real progress, not a stalled game.
    const state = lastOfType('A', 'game_state');
    expect(state).toBeTruthy();
    expect((host as any).botSeats.some((s: { seat: number }) => s.seat === 1)).toBe(true); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(state.isComplete).toBe(false); // 5-round loop; round 1 alone doesn't finish it
  });

  it('BUG-12: a plain disconnect AFTER a normal start is bot-covered too — the away-seat rule is the same wherever the disconnect lands', async () => {
    const { host, lastLobby } = makeRaceHost(null); // no gate — normal, un-raced start
    await host.handleMessage('A', { type: 'hello' }); // auto-seats A -> seat 1, starts normally
    // B is here only so the post-disconnect lobby broadcast has a recipient to
    // observe (broadcastLobby sends to CONNECTED clients — A is gone by then).
    await host.handleMessage('B', { type: 'join', seat: 2, name: 'B' });

    // A disconnect landing AFTER startGame has committed gets the SAME cover as
    // one landing inside the await: nothing is driving seat 1 either way, and a
    // seat nothing drives stalls the flow the moment it comes due. (Before
    // BUG-12 this was deliberately left uncovered — "pause on away" — which is
    // what stranded `boardsmith dev` behind its own stale auto-opened tab.)
    host.disconnect('A');

    expect((host as any).botSeats.some((s: { seat: number }) => s.seat === 1)).toBe(true); // eslint-disable-line @typescript-eslint/no-explicit-any

    // Cover is loop-driver-only: the seat is still RESERVED for A's reconnect.
    const seat1 = lastLobby()?.seats.find((s) => s.seat === 1);
    expect(seat1?.clientId).toBe('A');
    expect(seat1?.connected).toBe(false);
  });

  it('NEGATIVE CONTROL: the FOLLOWER disconnecting is NOT bot-covered — follow-mode persists across reloads and keeps bot paused', async () => {
    const { host } = makeRaceHost(null);
    await host.handleMessage('A', { type: 'hello' }); // A -> seat 1
    await host.handleMessage('B', { type: 'join', seat: 2, name: 'B' }); // B -> seat 2 (human)
    await host.handleMessage('A', { type: 'follow', enabled: true });

    // A page reload / HMR drops the follower's socket. Follow-mode deliberately
    // survives it, and a follower covers EVERY seat — so handing any seat to a
    // bot here would steal the move the follower is coming back for.
    host.disconnect('A');

    expect((host as any).botSeats).toHaveLength(0); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it('reclaim: a reconnecting human takes back the bot-covered seat — the bot yields, proven by the human successfully acting on the very NEXT round (not just static state)', async () => {
    const gate = makeDeferred();
    const { host, lastLobby, to } = makeRaceHost(gate);

    const helloPromise = host.handleMessage('A', { type: 'hello' }); // A auto-seats -> seat 1, gated mid-await
    host.disconnect('A'); // A vanishes mid-await (the D15 interleave)
    // B claims seat 2 as a HUMAN (not bot) while still inside the gated await,
    // so `runBotTurns()` halts after round 1 seat 1 (bot-covered) instead of
    // auto-completing the whole game — leaving it genuinely mid-play so the
    // reclaim can be proven against a REAL upcoming turn, not just static state.
    host.handleMessage('B', { type: 'join', seat: 2, name: 'B' });
    gate.resolve();
    await helloPromise;

    // Round 1: seat 1 was bot-covered by the reconciliation and auto-played;
    // seat 2 (human B, not bot) is now due — the pump halted waiting on B.
    expect((host as any).botSeats.some((s: { seat: number }) => s.seat === 1)).toBe(true); // eslint-disable-line @typescript-eslint/no-explicit-any

    // The reservation was never released: A's clientId is still on seat 1.
    const preReconnectLobby = lastLobby();
    const seat1PreReconnect = preReconnectLobby?.seats.find((s) => s.seat === 1);
    expect(seat1PreReconnect?.clientId).toBe('A');
    expect(seat1PreReconnect?.connected).toBe(false);

    // A reconnects: reclaims the seat AND yields the bot.
    await host.handleMessage('A', { type: 'hello' });
    expect((host as any).botSeats.some((s: { seat: number }) => s.seat === 1)).toBe(false); // eslint-disable-line @typescript-eslint/no-explicit-any
    const postReconnectLobby = lastLobby();
    const seat1PostReconnect = postReconnectLobby?.seats.find((s) => s.seat === 1);
    expect(seat1PostReconnect?.clientId).toBe('A');
    expect(seat1PostReconnect?.connected).toBe(true);

    // B (still due for round 1) acts, advancing the flow into round 2 seat 1 —
    // the bot pump fires after B's action but must NOT auto-play seat 1 anymore
    // (it yielded on reconnect).
    await host.handleMessage('B', {
      type: 'server_request',
      requestId: 'b1',
      op: 'action',
      payload: { actionName: 'pass', args: {}, boundaryKey: clientKey('B') },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bResp = to('B').find((m) => m.type === 'server_response' && (m as any).requestId === 'b1') as any;
    expect(bResp?.result?.success).toBe(true);

    // Prove seat 1's round-2 turn is genuinely still open (not already
    // consumed by the bot) by having A — the reclaimed human — act on it.
    await host.handleMessage('A', {
      type: 'server_request',
      requestId: 'a2',
      op: 'action',
      payload: { actionName: 'pass', args: {}, boundaryKey: clientKey('A') },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const aResp = to('A').find((m) => m.type === 'server_response' && (m as any).requestId === 'a2') as any;
    expect(aResp?.result?.success).toBe(true);
  });

  it('WR-02: a `join` landing INSIDE the `await session.start()` window is reinitialized as part of startGame\'s own commit — no init/game_state until it, not waiting on an unrelated broadcast', async () => {
    const gate = makeDeferred();
    const { host, lastOfType } = makeRaceHost(gate);

    // A auto-seats -> seat 1, gated mid-await (same interleave technique as
    // the D15 tests above).
    const helloPromise = host.handleMessage('A', { type: 'hello' });
    // B joins seat 2 DURING the await — handleJoin has no `starting` guard by
    // design (the D15 reclaim test above already relies on this working), so
    // the seat assignment itself succeeds; the gap is that `startGame`'s own
    // reinit loop (below) only iterated the PRE-await `humanSeats` snapshot,
    // which does not include B (B joined after that snapshot was taken).
    host.handleMessage('B', { type: 'join', seat: 2, name: 'B' });
    gate.resolve();
    await helloPromise;

    // Pre-fix: B receives no `init`/`game_state` here — only a `joined` +
    // `lobby` message from handleJoin itself (phase was still 'lobby' at
    // join time, so handleJoin's own `if (phase==='playing') reinitSeat`
    // check reads false). Post-fix: startGame's reinit pass covers every
    // currently-seated connected client, not just the pre-await snapshot.
    expect(lastOfType('B', 'init')).toBeTruthy();
    expect(lastOfType('B', 'game_state')).toBeTruthy();
  });

  it('BUG-12: a MID-GAME disconnect on the away player\'s OWN due turn does not stall the game — the bot plays it and the flow advances', async () => {
    const { host, to } = makeRaceHost(null); // normal, un-raced start
    await host.handleMessage('A', { type: 'hello' }); // A -> seat 1, game starts normally
    await host.handleMessage('B', { type: 'join', seat: 2, name: 'B' }); // B -> seat 2, human

    // Seat 1 (round 1) is due; A disconnects mid-game — the exact stranded-seat
    // case: the game is idling on input from a client that is gone. Pre-fix
    // nothing drove seat 1 ever again and the game sat here forever, silently.
    host.disconnect('A');
    await Promise.resolve(); // let disconnect()'s fire-and-forget bot pump settle
    await new Promise((r) => setTimeout(r, 0));

    expect((host as any).botSeats.some((s: { seat: number }) => s.seat === 1)).toBe(true); // eslint-disable-line @typescript-eslint/no-explicit-any

    // The flow really advanced: seat 1's round-1 turn was consumed by the bot,
    // so B — who could NOT act while seat 1 was due — can act now.
    await host.handleMessage('B', {
      type: 'server_request',
      requestId: 'b-mid',
      op: 'action',
      payload: { actionName: 'pass', args: {}, boundaryKey: clientKey('B') },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bResp = to('B').find((m) => m.type === 'server_response' && (m as any).requestId === 'b-mid') as any;
    expect(bResp?.result?.success).toBe(true);

    // And the cover is reclaimable: A's reconnect yields the seat back.
    await host.handleMessage('A', { type: 'hello' });
    expect((host as any).botSeats.some((s: { seat: number }) => s.seat === 1)).toBe(false); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
});
