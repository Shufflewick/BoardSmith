/**
 * D15/DEVHOST-03 regression: a client that disconnects WHILE `startGame`'s
 * `await session.start()` is still pending must not permanently orphan its
 * seat. `startGame` captures `humanSeats` (and seeds `this.aiSeats`) BEFORE
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
import { describe, it, expect } from 'vitest';
import { Game, Player, Action, defineFlow, actionStep, loop, eachPlayer, type GameOptions } from '../../engine/index.js';
import { executeOp, type GameDefinitionLike, type Op, type OpResult } from '../../session/index.js';
import { MultiplayerHost, type HostOutbound } from './multiplayer-host.js';

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
 * supplied — the deterministic interleave hook. Every other op (aiTurn,
 * action, ...) runs immediately against the real pure executor.
 */
function makeRaceHost(gate: { promise: Promise<void> } | null) {
  const sent: Array<{ clientId: string; msg: HostOutbound }> = [];
  const host = new MultiplayerHost({
    playerCount: 2,
    minPlayers: 2,
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
    send: (clientId, msg) => sent.push({ clientId, msg }),
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
  it('a disconnect landing INSIDE the `await session.start()` window leaves the seat AI-covered post-fix (pre-fix: orphaned, loop stalls)', async () => {
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

    // Post-fix: seat 1 is AI-covered, so `runAITurns()` (called inside
    // `startGame` right after the await) drives it — round 1 completes for
    // both seats and the opening `game_state` sent to A during `startGame`'s
    // own reinit shows real progress, not a stalled game.
    const state = lastOfType('A', 'game_state');
    expect(state).toBeTruthy();
    expect((host as any).aiSeats.some((s: { seat: number }) => s.seat === 1)).toBe(true); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(state.isComplete).toBe(false); // 5-round loop; round 1 alone doesn't finish it
  });

  it('NEGATIVE CONTROL: a plain disconnect AFTER a normal start does NOT get reconciled (existing pause-on-away-turn path, unchanged)', async () => {
    const { host } = makeRaceHost(null); // no gate — normal, un-raced start
    await host.handleMessage('A', { type: 'hello' }); // auto-seats A -> seat 1, starts normally

    // A plain disconnect landing AFTER startGame has already committed must
    // NOT be reconciled — this documents that only the in-await interleave
    // triggers D15's fix, not every disconnect.
    host.disconnect('A');

    expect((host as any).aiSeats.some((s: { seat: number }) => s.seat === 1)).toBe(false); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
});
