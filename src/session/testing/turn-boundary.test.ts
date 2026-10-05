/**
 * The contract for `meta.turnBoundary` — the engine's AUTHORITATIVE statement,
 * on every broadcast, of which seats owe a move and which boundary they owe it
 * in.
 *
 * Why this file exists: the platform used to answer "who is up?" by reaching
 * into `playerViews[0].flowState` and casting it — a per-seat payload used as a
 * whole-game answer, with the reason it happens to work held in a COMMENT
 * rather than in a type. Before that it read `state.currentPlayer`, which is
 * `undefined` for the entire life of a simultaneous step, and so a simultaneous
 * game reported "nobody is up" every round forever (BUG-006).
 *
 * The answer is computed inside the engine, so the regression lives inside the
 * engine too. Case 1 is BUG-006.
 */

import { describe, it, expect } from 'vitest';
import { createHeadlessSession } from '../headless-session.js';
import { SnapshotSessionHost } from '../snapshot-session-host.js';
import { executeOp, type OpResult } from '../stateless-ops.js';
import type { GameStateSnapshot } from '../../engine/index.js';
import { flowBoundaryKey, type BoundaryKeyState } from '../../engine/flow/boundary-key.js';
import { dueSeats, type SeatActivityState } from '../../engine/flow/seat-activity.js';
import { simultaneousFixtureDefinition } from './fixtures/simultaneous-fixture.js';
import {
  simultaneousRoundsFixtureDefinition,
  TOTAL_ROUNDS,
} from './fixtures/simultaneous-rounds-fixture.js';
import { collectTurnsFixtureDefinition } from './fixtures/collect-turns-fixture.js';
import { botGameDef, botGameOptions } from './fixtures/bot-game-fixture.js';

const twoSeats = { playerCount: 2, seed: 'turn-boundary' };

/** The `turnBoundary` of the most recent broadcast. */
function lastBoundary(session: { metas: Array<{ turnBoundary: { key: string; dueSeats: number[] } }> }) {
  const meta = session.metas[session.metas.length - 1];
  expect(meta, 'no broadcast has been captured yet').toBeDefined();
  return meta.turnBoundary;
}

function commit(session: { send: (seat: number, op: never) => Promise<unknown> }, seat: number) {
  return session.send(seat, { type: 'action', actionName: 'commit', player: seat, args: {} } as never);
}

describe('meta.turnBoundary — the engine states the turn boundary', () => {
  // ── 1. BUG-006 ─────────────────────────────────────────────────────────────

  it('case 1 — BUG-006 REGRESSION: a SIMULTANEOUS opening step reports BOTH seats as due', async () => {
    const session = createHeadlessSession(simultaneousFixtureDefinition, twoSeats);
    await session.start();

    // The FIRST broadcast, not the last: BUG-006 was wrong from the opening
    // frame onward, so the opening frame is what has to be pinned.
    expect(session.metas.length).toBeGreaterThan(0);
    expect(session.metas[0].turnBoundary.dueSeats).toEqual([1, 2]);

    // The field whose reading caused BUG-006. `FlowEngine.getState()` used to
    // publish the seat of the last action step (here the seat the flow started
    // on, 1) for the whole life of a simultaneous step: a plausible, confident,
    // permanently WRONG answer that said "seat 1 is up" every round and never
    // told seat 2 it owed a move. Since #321 the engine publishes
    // `currentPlayer` only while an action step is awaiting, so here it is
    // absent. Seats due in a simultaneous step are read from `dueSeats`.
    const flowState = session.host.flowState as { currentPlayer?: number };
    expect(flowState.currentPlayer).toBeUndefined();

    // ...and the boundary is a real identity, not a placeholder.
    expect(session.metas[0].turnBoundary.key).toBe(flowBoundaryKey(session.host.flowState as never));
    expect(session.metas[0].turnBoundary.key).not.toBe('flow:unknown');
  });

  // ── 2. Sequential ──────────────────────────────────────────────────────────

  it('case 2 — SEQUENTIAL: dueSeats is the single acting seat, and it CHANGES after the turn', async () => {
    const session = createHeadlessSession(collectTurnsFixtureDefinition, twoSeats);
    await session.start();

    expect(lastBoundary(session).dueSeats).toEqual([1]);
    const keyAtSeatOne = lastBoundary(session).key;

    // A turn in this fixture is two actions, then the seat counter advances.
    await session.send(1, { type: 'action', actionName: 'pass', player: 1, args: {} });
    await session.send(1, { type: 'action', actionName: 'pass', player: 1, args: {} });

    expect(lastBoundary(session).dueSeats).toEqual([2]);
    expect(lastBoundary(session).key).not.toBe(keyAtSeatOne);
  });

  // ── 3. Boundary identity MOVES across a round close/re-open ────────────────

  it('case 3 — BOUNDARY IDENTITY MOVES: the key changes across a round boundary while dueSeats is [1,2] BOTH times', async () => {
    const session = createHeadlessSession(simultaneousRoundsFixtureDefinition, twoSeats);
    await session.start();

    const roundOne = lastBoundary(session);
    expect(roundOne.dueSeats).toEqual([1, 2]);

    // Both seats answer -> round 1 closes, round 2 opens (the fixture clears
    // every seat's `committed` flag at the top of each round).
    await commit(session, 1);
    await commit(session, 2);

    const roundTwo = lastBoundary(session);

    // The SAME seats are due again. This is what EVERY simultaneous game looks
    // like at a round boundary, and it is why a seat-set comparison cannot see
    // one -- the assertion is written this way on purpose.
    expect(roundTwo.dueSeats).toEqual([1, 2]);
    // ...and yet the boundary moved.
    expect(roundTwo.key).not.toBe(roundOne.key);
  });

  // ── 4. Boundary identity HOLDS mid-round ───────────────────────────────────

  it('case 4 — BOUNDARY IDENTITY HOLDS MID-ROUND: one seat commits, the key stands still, dueSeats shrinks to [2]', async () => {
    const session = createHeadlessSession(simultaneousRoundsFixtureDefinition, twoSeats);
    await session.start();

    const atRoundOpen = lastBoundary(session);
    expect(atRoundOpen.dueSeats).toEqual([1, 2]);

    await commit(session, 1);

    const midRound = lastBoundary(session);
    expect(midRound.key).toBe(atRoundOpen.key);
    expect(midRound.dueSeats).toEqual([2]);
  });

  // ── 5. A re-broadcast is not a new turn ────────────────────────────────────

  it('case 5 — RE-BROADCAST IS NOT A NEW TURN: broadcastCurrent() with no intervening op republishes the SAME boundary', async () => {
    const session = createHeadlessSession(simultaneousRoundsFixtureDefinition, twoSeats);
    await session.start();
    await commit(session, 1); // mid-round: the interesting position

    const fromApply = lastBoundary(session);
    // Guard against a vacuous pass: `toEqual` would happily compare two
    // `undefined`s. The boundary must be a real, populated value on BOTH sides
    // for the deep-equality assertion below to mean anything.
    expect(fromApply.key).toMatch(/^flow:/);
    expect(fromApply.dueSeats).toEqual([2]);
    const broadcastsBefore = session.metas.length;

    session.host.broadcastCurrent();

    expect(session.metas.length).toBe(broadcastsBefore + 1);
    // DEEP equality: a heatmap toggle, a demo re-broadcast or a reconnect frame
    // must not re-stamp the round clock or re-notify every seat.
    expect(lastBoundary(session)).toEqual(fromApply);
  });

  it('case 5b — the PRODUCTION re-broadcast path (a heatmapToggle op) republishes the same boundary', async () => {
    // `bot-game-fixture` rather than a simultaneous fixture: a heatmap needs a
    // real `bot` config to compute against, and this is the only fixture that
    // carries one. Its action-step frame stays open across moves, so the
    // boundary genuinely should stand still here.
    const session = createHeadlessSession(botGameDef, botGameOptions);
    await session.start();

    const fromApply = lastBoundary(session);
    expect(fromApply.key).toMatch(/^flow:/);
    expect(fromApply.dueSeats).toEqual([1]);
    const broadcastsBefore = session.metas.length;

    // `heatmapToggle` is a teaching op: it does NOT run through apply(), it
    // re-broadcasts via broadcastCurrent() (snapshot-session-host.ts's teaching
    // branch). This is the real caller Pitfall 3 names.
    const res = await session.host.handleOp(1, { type: 'heatmapToggle', seat: 1, visible: true });

    expect(res.success, `heatmapToggle failed: ${res.error ?? ''}`).toBe(true);
    expect(session.metas.length).toBeGreaterThan(broadcastsBefore);
    expect(lastBoundary(session)).toEqual(fromApply);
  });

  // ── 6. Complete ────────────────────────────────────────────────────────────

  it('case 6 — COMPLETE: nobody owes a move in a finished game, and the key is the terminal key', async () => {
    // The rounds fixture, played out: its loop runs `TOTAL_ROUNDS` rounds and
    // then `finish()`es, which is a flow that genuinely COMPLETES.
    // (`simultaneous-fixture`'s `endGame` calls `game.finish()` from INSIDE an
    // open simultaneous step, and -- measured -- the flow keeps reporting
    // `complete: false`, `awaitingInput: true` and both seats due. That is a
    // separate engine question, not this test's, and using it here would have
    // asserted the wrong thing.)
    const session = createHeadlessSession(simultaneousRoundsFixtureDefinition, twoSeats);
    await session.start();
    expect(lastBoundary(session).dueSeats).toEqual([1, 2]);

    for (let round = 0; round < TOTAL_ROUNDS; round++) {
      await commit(session, 1);
      await commit(session, 2);
    }

    const meta = session.metas[session.metas.length - 1];
    expect(meta.isComplete).toBe(true);
    expect(meta.turnBoundary.dueSeats).toEqual([]);
    expect(meta.turnBoundary.key).toBe(flowBoundaryKey({ complete: true }));
  });

  it('case 6b — COMPLETE BEATS AWAITING: the host never names due seats for a game it broadcasts as complete', async () => {
    // A CONTRACT test on the host, not an end-to-end one, and deliberately so.
    //
    // `meta` makes two statements at once -- `isComplete` and `turnBoundary` --
    // and they must agree, because a "finished" game that still names two seats
    // as owing a move is a game that notifies them, starts a turn clock for
    // them, and eventually expires them. Today the host gets that agreement for
    // free from a DIFFERENT module: `dueSeats()` returns [] whenever the flow is
    // not awaiting input. But nothing structurally ties `flowState.complete` to
    // `flowState.awaitingInput` --  `FlowEngine.advance()` breaks out of its
    // loop on `awaitingInput` and THEN evaluates the `isComplete` predicate
    // again without clearing it -- so the agreement is an invariant held across
    // a module boundary, not a property of this class.
    //
    // MEASURED: neither natural route reaches that state today. A predicate that
    // flips mid-step is never re-evaluated (a simultaneous resume returns
    // without re-running the loop), and one that is already true when a step
    // opens is caught by the in-loop check before the step is ever pushed. So
    // this is asserted against a hand-built OpResult: the host must hold its own
    // half of the contract whether or not the engine can currently break it.
    const completeButAwaiting: SeatActivityState & BoundaryKeyState = {
      complete: true,
      awaitingInput: true,
      position: { path: [0] },
      awaitingPlayers: [
        { playerIndex: 1, availableActions: ['commit'], completed: false },
        { playerIndex: 2, availableActions: ['commit'], completed: false },
      ],
    };
    // The premise, asserted rather than assumed: this really is a flow state the
    // raw predicate would name both seats for.
    expect(dueSeats(completeButAwaiting)).toEqual([1, 2]);

    const metas: Array<{ isComplete: boolean; turnBoundary: { key: string; dueSeats: number[] } }> = [];
    const host = new SnapshotSessionHost({
      playerCount: 2,
      executeOp: async () =>
        ({
          success: true,
          snapshot: { flowState: completeButAwaiting, winners: [1] },
          pendingState: null,
          flowState: completeButAwaiting,
          playerViews: [{}, {}],
          isComplete: true,
          winners: [1],
        }) as unknown as OpResult,
      push: () => {}, record: (_views, meta) => metas.push(meta),
    });
    await host.start();

    expect(metas.length).toBe(1);
    expect(metas[0].isComplete).toBe(true);
    expect(metas[0].turnBoundary.dueSeats).toEqual([]);
  });

  // ── 7. The restore hazard ──────────────────────────────────────────────────

  describe('case 7 — a host restored from a snapshot without its flow state cannot publish a lie', () => {
    /**
     * A fresh host that records every broadcast's meta and holds nothing yet,
     * plus a started game it has NOT been given -- what a restore starts from.
     */
    async function freshHostAndStartedGame() {
      const metas: Array<{ turnBoundary: { key: string; dueSeats: number[] } }> = [];
      const host = new SnapshotSessionHost({
        playerCount: 2,
        executeOp: (snap, pend, op) => executeOp(simultaneousRoundsFixtureDefinition, twoSeats, snap, pend, op),
        push: () => {}, record: (_views, meta) => {
          metas.push(meta);
        },
      });
      const started = await executeOp(simultaneousRoundsFixtureDefinition, twoSeats, null, null, { type: 'start' });
      return { host, metas, started, snapshot: started.snapshot as GameStateSnapshot };
    }

    it('the platform\'s old restore shape -- assigning `snapshot` alone -- is not spellable', async () => {
      const { host, started, snapshot } = await freshHostAndStartedGame();

      // This is verbatim what the platform's `reconstructHostIfNeeded` does
      // after a Durable Object eviction: hand the host a snapshot and NOTHING
      // else. It is now unspellable TWICE OVER -- `snapshot` is a getter with no
      // setter, so this is a compile error (the `@ts-expect-error` below fails
      // the typecheck if a setter is ever added back), and class getters are
      // strict-mode, so it also throws at runtime rather than silently no-opping
      // in a build that skipped typechecking.
      expect(() => {
        // @ts-expect-error -- `snapshot` has no setter; use restoreFrom({ snapshot, pendingStates }).
        host.snapshot = started.snapshot;
      }).toThrow(/only a getter/);
      expect(host.snapshot).toBeNull();

      // The sanctioned path checks the snapshot carries its flow state.
      host.restoreFrom({ snapshot, pendingStates: {} });
      expect(host.snapshot).toBe(started.snapshot);
      expect(host.flowState).toEqual(started.flowState);
    });

    it('restoreFrom REFUSES a snapshot without a flow state, naming what is missing', async () => {
      const { host, snapshot } = await freshHostAndStartedGame();
      const { flowState: _dropped, ...withoutFlow } = snapshot;

      expect(() => host.restoreFrom({ snapshot: withoutFlow as GameStateSnapshot, pendingStates: {} })).toThrow(
        /flow state/i,
      );
    });

    it('a restored host then broadcasts the REAL boundary, not an empty one', async () => {
      const { host, metas, started, snapshot } = await freshHostAndStartedGame();

      host.restoreFrom({ snapshot, pendingStates: {}, playerViews: started.playerViews });
      host.broadcastCurrent();

      expect(metas.length).toBe(1);
      expect(metas[0].turnBoundary.dueSeats).toEqual([1, 2]);
      expect(metas[0].turnBoundary.key).toBe(flowBoundaryKey(started.flowState as never));
    });
  });
});
