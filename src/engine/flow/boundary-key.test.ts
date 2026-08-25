/**
 * The contract that DEFINES `flowBoundaryKey`.
 *
 * These six cases are the specification. The implementation satisfies them, not
 * the other way round. Case 4 in particular is written so that a seat-set
 * comparison — the thing the platform does today — is VISIBLY unable to pass
 * it: `dueSeats` is asserted to be `[1, 2]` on both sides of a real round
 * boundary.
 */

import { describe, it, expect } from 'vitest';
import { flowBoundaryKey, type BoundaryKeyState } from './boundary-key.js';
// Imported a SECOND time through the package root on purpose — see the
// reachability test at the bottom of this file.
import { flowBoundaryKey as flowBoundaryKeyFromPackageRoot } from 'boardsmith';
import { dueSeats } from './seat-activity.js';
import { createHeadlessSession } from '../../session/headless-session.js';
import { executeOp } from '../../session/stateless-ops.js';
import {
  simultaneousRoundsFixtureDefinition,
  TOTAL_ROUNDS,
} from '../../session/testing/fixtures/simultaneous-rounds-fixture.js';
import { collectTurnsFixtureDefinition } from '../../session/testing/fixtures/collect-turns-fixture.js';

const twoSeats = { playerCount: 2, seed: 'boundary-key' };

function flowOf(host: { flowState: unknown }): BoundaryKeyState {
  return host.flowState as BoundaryKeyState;
}

async function startRounds() {
  const session = createHeadlessSession(simultaneousRoundsFixtureDefinition, twoSeats);
  await session.start();
  return session;
}

function commit(session: Awaited<ReturnType<typeof startRounds>>, seat: number) {
  return session.send(seat, { type: 'action', actionName: 'commit', player: seat, args: {} });
}

describe('flowBoundaryKey', () => {
  it('case 1 — PURE: stable across repeated calls and across a structuredClone', async () => {
    const session = await startRounds();
    const flowState = flowOf(session.host);

    const first = flowBoundaryKey(flowState);
    const second = flowBoundaryKey(flowState);
    expect(second).toBe(first);
    expect(first).toBeTypeOf('string');
    expect(first.length).toBeGreaterThan(0);

    // The platform DO, the browser client and the engine all call this on a
    // flow state that has crossed a structuredClone boundary.
    const overTheWire = structuredClone(flowState);
    expect(flowBoundaryKey(overTheWire)).toBe(first);
  });

  it('case 2 — SEQUENTIAL ADVANCE: the key changes when the acting seat changes', async () => {
    const session = createHeadlessSession(collectTurnsFixtureDefinition, twoSeats);
    await session.start();

    const atSeatOne = flowOf(session.host);
    expect(atSeatOne.currentPlayer).toBe(1);
    const keyAtSeatOne = flowBoundaryKey(atSeatOne);

    // A turn in this fixture is two actions, then the seat counter advances.
    await session.send(1, { type: 'action', actionName: 'pass', player: 1, args: {} });
    await session.send(1, { type: 'action', actionName: 'pass', player: 1, args: {} });

    const atSeatTwo = flowOf(session.host);
    expect(atSeatTwo.currentPlayer).toBe(2);
    expect(flowBoundaryKey(atSeatTwo)).not.toBe(keyAtSeatOne);
  });

  it('case 3 — SIMULTANEOUS, MID-ROUND: one seat submitting does NOT move the key', async () => {
    const session = await startRounds();
    const keyAtRoundOpen = flowBoundaryKey(flowOf(session.host));
    expect(dueSeats(flowOf(session.host))).toEqual([1, 2]);

    const result = await commit(session, 1);
    expect(result.success).toBe(true);

    // The round is still open — seat 2 has not answered.
    const midRound = flowOf(session.host);
    expect(dueSeats(midRound)).toEqual([2]);
    expect(midRound.complete).toBe(false);

    // This is the 16-seat re-notification bug in miniature: if the key moved
    // here, every seat would be re-stamped and re-notified mid-round.
    expect(flowBoundaryKey(midRound)).toBe(keyAtRoundOpen);
  });

  it('case 4 — SIMULTANEOUS, ROUND BOUNDARY: the key changes although the due-seat set does not', async () => {
    const session = await startRounds();

    const roundOne = flowOf(session.host);
    const dueBefore = dueSeats(roundOne);
    const keyRoundOne = flowBoundaryKey(roundOne);

    await commit(session, 1);
    await commit(session, 2);

    const roundTwo = flowOf(session.host);
    const dueAfter = dueSeats(roundTwo);
    const keyRoundTwo = flowBoundaryKey(roundTwo);

    // Stated explicitly so the failure of set comparison is VISIBLE: the seat
    // set is byte-identical across a real boundary. Nothing built on it can
    // see this transition.
    expect(dueBefore).toEqual([1, 2]);
    expect(dueAfter).toEqual([1, 2]);
    expect(dueAfter).toEqual(dueBefore);

    expect(keyRoundTwo).not.toBe(keyRoundOne);
  });

  it('case 5 — COMPLETE: a finished game yields a distinguished, stable terminal key', async () => {
    const session = await startRounds();

    const inPlayKeys = new Set<string>();
    for (let round = 1; round <= TOTAL_ROUNDS; round++) {
      inPlayKeys.add(flowBoundaryKey(flowOf(session.host)));
      await commit(session, 1);
      inPlayKeys.add(flowBoundaryKey(flowOf(session.host)));
      await commit(session, 2);
    }

    const finished = flowOf(session.host);
    expect(finished.complete).toBe(true);

    const terminal = flowBoundaryKey(finished);
    expect(terminal).toBeTypeOf('string');
    expect(terminal.length).toBeGreaterThan(0);
    // Distinct from every in-play key this game ever had.
    expect(inPlayKeys.size).toBeGreaterThan(1);
    expect(inPlayKeys.has(terminal)).toBe(false);
    // Stable across repeated reads.
    expect(flowBoundaryKey(finished)).toBe(terminal);
    expect(flowBoundaryKey(structuredClone(finished))).toBe(terminal);

    // DISTINGUISHED, not merely different-by-luck. A finished flow reports an
    // EMPTY `path` — and so does a flow that has not started yet. Any key that
    // derived the terminal case from position material alone would collide
    // "game over" with "game not begun", which is the worst possible pair to
    // confuse. The terminal key must come from `complete`, not from the path.
    expect(finished.position?.path).toEqual([]);
    const notStarted: BoundaryKeyState = { complete: false, position: { path: [] } };
    expect(flowBoundaryKey(notStarted)).not.toBe(terminal);
  });

  it('case 6 — DURABLE ACROSS RESTORE: a fresh runner built from the snapshot yields the same key', async () => {
    const session = await startRounds();
    await commit(session, 1);

    const midRound = flowOf(session.host);
    const keyBefore = flowBoundaryKey(midRound);

    // Restore a FRESH runner from the mid-round snapshot — what the platform DO
    // does every time it is evicted. `debugFlowState` is a read-only op: it
    // rebuilds the runner via runnerFromSnapshot and reports its flow state.
    const restored = await executeOp(
      simultaneousRoundsFixtureDefinition,
      twoSeats,
      session.host.snapshot,
      null,
      { type: 'debugFlowState', player: 1 },
    );
    expect(restored.success).toBe(true);

    // Byte-identical: a key that changed on restore would re-stamp the round
    // clock and re-notify every seat on every eviction.
    expect(flowBoundaryKey(restored.flowState as BoundaryKeyState)).toBe(keyBefore);
    // And the restored runner is genuinely mid-round, not re-started.
    expect(dueSeats(restored.flowState as BoundaryKeyState)).toEqual([2]);
  });

  it('negative contract — undefined and null yield defined, stable strings and never throw', () => {
    expect(() => flowBoundaryKey(undefined)).not.toThrow();
    expect(() => flowBoundaryKey(null)).not.toThrow();

    const forUndefined = flowBoundaryKey(undefined);
    const forNull = flowBoundaryKey(null);
    expect(forUndefined).toBeTypeOf('string');
    expect(forUndefined.length).toBeGreaterThan(0);
    expect(flowBoundaryKey(undefined)).toBe(forUndefined);
    expect(forNull).toBe(forUndefined);
  });

  it('REACHABILITY: resolves from the package root, not just by relative path', () => {
    // The platform Durable Object and the browser client both reach this via
    // `import { flowBoundaryKey } from 'boardsmith'`. This milestone has three
    // times shipped an engine surface that existed, was tested by relative
    // import, and never reached a consumer because the barrel re-export was
    // missing. A relative-path test cannot see that; this one can.
    expect(flowBoundaryKeyFromPackageRoot).toBe(flowBoundaryKey);
  });

  it('is not disturbed by game state: frameData and variables are excluded material', async () => {
    const session = await startRounds();
    const flowState = flowOf(session.host);
    const key = flowBoundaryKey(flowState);

    // A flow state carrying wholly different game state at the SAME position.
    const withOtherGameState = {
      ...structuredClone(flowState),
      position: {
        path: [...(flowState.position?.path ?? [])],
        frameData: { __frame_0: { anything: 'changed' } },
        variables: { anything: 'changed' },
        moveCount: 99,
      },
    } as BoundaryKeyState;

    expect(flowBoundaryKey(withOtherGameState)).toBe(key);
  });

  it('is not disturbed by position.iterations, which moves WITHOUT a boundary', async () => {
    // Measured against this fixture: round 1 opens reporting
    // `{__iter_1: 1}`; one seat then commits — no boundary crossed, `path`
    // correctly unmoved — and the SAME position reports
    // `{__iter_0: 0, __iter_1: 1, __iter_2: 0, __iter_3: 0}`. `iterations`
    // therefore records how a position was REACHED, not where it is, and any
    // key including it moves mid-round. This pins it out of the material.
    const session = await startRounds();
    const atOpen = flowOf(session.host);
    const openIterations = (atOpen.position as { iterations?: Record<string, number> })
      ?.iterations;

    await commit(session, 1);

    const midRound = flowOf(session.host);
    const midIterations = (midRound.position as { iterations?: Record<string, number> })
      ?.iterations;

    // The premise: the raw position really does report different iterations
    // on the two sides of a NON-boundary. If the engine ever stops doing this,
    // this test should be revisited rather than silently passing.
    expect(midIterations).not.toEqual(openIterations);
    expect(midRound.position?.path).toEqual(atOpen.position?.path);

    // The contract: the key does not notice.
    expect(flowBoundaryKey(midRound)).toBe(flowBoundaryKey(atOpen));
  });
});
