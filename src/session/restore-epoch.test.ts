/**
 * B17: `restoreEpoch` — the broadcast "the runner was replaced" signal.
 *
 * A checkpoint restore (undo, rewind) invalidates every piece of state holding
 * element ids from the old runner. Clients hold state of exactly that kind (an
 * open pick's `validElements`) and need to be told. These run on the live
 * session host (`SnapshotSessionHost` over `executeOp`); the stateful
 * GameSession they once drove was removed (#529).
 *
 * These tests prove the fact is now STATED, and stated in one place:
 *   1. Every seat's broadcast state carries `restoreEpoch`, starting at 0.
 *   2. Undo bumps it. Rewind bumps it. Each restore bumps it again.
 *   3. It is durable: it survives a JSON round-trip cold restart, so a
 *      stateless host (which rebuilds the runner per request) reports the same
 *      epoch rather than resetting to 0 on every op.
 *   4. Plain rehydration (`fromSnapshot` — a cold restart, a stateless request)
 *      does NOT bump it. Only a checkpoint restore does, so a client comparing
 *      epochs can never mistake a reload for an undo.
 *   5. A READ-ONLY time-travel preview does not move the live epoch.
 */

import { describe, it, expect } from 'vitest';
import { GameRunner } from '../runtime/index.js';
import { createHeadlessSession, type HeadlessSession } from './headless-session.js';
import { SnapshotSessionHost, type SnapshotHostState } from './snapshot-session-host.js';
import { executeOp, type GameDefinitionLike } from './stateless-ops.js';
import type { PlayerGameState } from './types.js';
import { MoveGame } from './move-game.test-helper.js';
import { boundaryKeyOfHost } from './testing/boundary-stamp.js';

const definition: GameDefinitionLike & { gameClass: typeof MoveGame } = {
  gameClass: MoveGame,
  gameType: 'move',
  minPlayers: 2,
  maxPlayers: 2,
};
const tableOptions = { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'b17-seed' };

async function newSession(): Promise<HeadlessSession<MoveGame>> {
  const session = createHeadlessSession(definition, tableOptions);
  await session.start();
  return session;
}

/** Seat (0 = the spectator)'s state of record. */
function stateOf(session: HeadlessSession<MoveGame>, seat: number): PlayerGameState {
  return seat === 0 ? (session.spectatorViews.at(-1) as { state: PlayerGameState }).state : session.playerState(seat);
}

/** Seat 1 moves the pawn to the room at `index`. */
async function move(session: HeadlessSession<MoveGame>, index: number) {
  const destination = session.readGame().rooms[index].id;
  const result = await session.send(1, { type: 'action', actionName: 'move', player: 1, args: { destination } });
  expect(result.success).toBe(true);
}

async function undo(session: HeadlessSession<MoveGame>) {
  expect((await session.send(1, { type: 'undo', player: 1 })).success).toBe(true);
}

describe('B17: restoreEpoch is broadcast on every seat', () => {
  it('starts at 0 for every seat, including spectators', async () => {
    const session = await newSession();
    for (const seat of [0, 1, 2]) {
      expect(stateOf(session, seat).restoreEpoch).toBe(0);
    }
  });

  it('bumps on undo, and again on every further restore', async () => {
    const session = await newSession();

    await move(session, 1);
    expect(session.readGame().pawnRoom()).toBe('engine');
    // A completed action does NOT look like a restore.
    expect(stateOf(session, 1).restoreEpoch).toBe(0);

    await undo(session);
    expect(session.readGame().pawnRoom()).toBe('bridge');
    // The pawn is back where it started AND every seat is told the runner was
    // replaced — the two facts the client needs to keep its open pick honest.
    for (const seat of [0, 1, 2]) {
      expect(stateOf(session, seat).restoreEpoch).toBe(1);
    }

    await move(session, 2);
    // Playing on does not bump it again — only restores do.
    expect(stateOf(session, 1).restoreEpoch).toBe(1);

    await undo(session);
    expect(stateOf(session, 1).restoreEpoch).toBe(2);
  });

  it('bumps on rewind, not just undo', async () => {
    const session = await newSession();
    await move(session, 1);
    await move(session, 2);
    expect(stateOf(session, 1).restoreEpoch).toBe(0);

    const rewind = await session.send(1, { type: 'debugRewind', actionIndex: 0 });
    expect(rewind.success).toBe(true);
    expect(stateOf(session, 1).restoreEpoch).toBe(1);
  });

  it('survives a cold restart, and a plain restore does not bump it', async () => {
    const session = await newSession();
    await move(session, 1);
    await undo(session);
    expect(stateOf(session, 1).restoreEpoch).toBe(1);

    // Cold restart from the persisted JSON: the epoch is part of the snapshot,
    // so a host that rebuilds the runner per request reports the same number
    // instead of resetting to 0 (which every client would misread as
    // "restored" on the first op and again on the next).
    const loaded = JSON.parse(JSON.stringify(session.host.durableState())) as SnapshotHostState;
    const published: unknown[][] = [];
    const restored = SnapshotSessionHost.restore(
      {
        playerCount: 2,
        executeOp: (snap, pend, op) => executeOp(definition, tableOptions, snap, pend, op),
        record: (views) => published.push(views.players),
        push: () => {},
      },
      { ...loaded, botSeats: [] },
    );
    // The restored host's next op rebuilds the runner from that JSON, and
    // what it publishes still says 1.
    const destination = session.readGame().rooms[2].id;
    const played = await restored.handleOp(1, {
      type: 'action', actionName: 'move', player: 1, args: { destination }, boundaryKey: boundaryKeyOfHost(restored),
    });
    expect(played.success).toBe(true);
    expect((published.at(-1)![0] as { state: PlayerGameState }).state.restoreEpoch).toBe(1);

    // Rehydrating the SAME snapshot repeatedly is not a restore.
    const again = GameRunner.fromSnapshot(loaded.snapshot!, MoveGame);
    expect(again.restoreEpoch).toBe(1);
  });

  it('is not moved by a read-only time-travel preview', async () => {
    const session = await newSession();
    await move(session, 1);

    const at0 = await session.send(1, { type: 'debugStateAt', actionIndex: 0, player: 1 });
    expect(at0.success).toBe(true);

    // Browsing history is not a restore of the live timeline: the live epoch is
    // untouched, so a client scrubbing the log never tears down its open pick.
    expect(stateOf(session, 1).restoreEpoch).toBe(0);
  });
});
