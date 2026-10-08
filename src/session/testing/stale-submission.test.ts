/**
 * BSMITH-05 — an hours-apart submission must be REFUSED, not silently accepted
 * into whatever round the game happens to be in now.
 *
 * The specification these cases hold is
 * `docs/simultaneous-and-interrupt-semantics.md`, written and committed BEFORE
 * this file. Read it first: it defines "interrupt", states the refusal rule,
 * the message contract, and the authorization rule (the key may only REJECT,
 * never widen).
 *
 * Every case is driven through `executeOp` directly rather than through
 * `createHeadlessSession`, because the harness stamps the CURRENT boundary key
 * on a caller's behalf (it is an in-process driver acting NOW), and the whole
 * point of these cases is to submit a key that is NOT current.
 */

import { describe, it, expect } from 'vitest';
import {
  executeOp,
  type ExecutableOp,
  type GameDefinitionLike,
  type OpOfType,
  type OpResult,
  type StateEnvelope,
} from '../stateless-ops.js';
import { ErrorCode } from '../../types/protocol.js';
import { simultaneousRoundsFixtureDefinition } from './fixtures/simultaneous-rounds-fixture.js';
import { collectTurnsFixtureDefinition } from './fixtures/collect-turns-fixture.js';
import { boundaryKeyOf } from './boundary-stamp.js';
import { succeeded, refused } from '../op-result.test-helper.js';

const OPTIONS = { playerCount: 2, seed: 'stale-submission' };

/**
 * The exact sentence `docs/simultaneous-and-interrupt-semantics.md` §3 commits
 * to. Asserted verbatim, not by a loose regex: "actionable" is a claim about
 * the words a player actually reads.
 */
const STALE_MESSAGE = 'The round you acted in has closed; reload to see the current round.';

function run<T extends ExecutableOp['type']>(
  def: GameDefinitionLike,
  snapshot: unknown,
  op: OpOfType<T>,
  pending: Record<string, unknown> | null = null,
) {
  return executeOp(def, OPTIONS, snapshot, pending, op);
}

function keyOf(result: StateEnvelope): string {
  return boundaryKeyOf(result.snapshot);
}

/**
 * Seat's `committed` flag as reported by the op result's OWN views.
 *
 * A refusal produces no views at all, which is exactly "nothing landed" — so
 * that case answers `false`. When the op
 * DID land, this reads the flag it wrote, which is what makes case 1's failure
 * legible as "the action landed in round 2" rather than merely "no error".
 */
function committed(result: OpResult, seat: number): boolean {
  if (!result.success || !('playerViews' in result)) return false;
  const view = result.playerViews[0] as { state: { players: Array<{ seat: number; committed: boolean }> } } | undefined;
  if (!view) return false;
  return view.state.players.find((p) => p.seat === seat)?.committed ?? false;
}

/** Drive the multi-round simultaneous fixture until round 2 is open. */
async function simultaneousAtRoundTwo() {
  const def = simultaneousRoundsFixtureDefinition;
  const started = succeeded(await run(def, null, { type: 'start' }));
  const roundOneKey = keyOf(started);

  const seatOne = succeeded(await run(def, started.snapshot, {
    type: 'action', actionName: 'commit', player: 1, args: {}, boundaryKey: roundOneKey,
  }));
  expect(seatOne.success).toBe(true);

  const seatTwo = succeeded(await run(def, seatOne.snapshot, {
    type: 'action', actionName: 'commit', player: 2, args: {}, boundaryKey: roundOneKey,
  }));

  const roundTwoKey = keyOf(seatTwo);
  // Without this the whole file would be vacuous: if the fixture did not
  // actually cross a boundary, a "stale" key would be the current key.
  expect(roundTwoKey).not.toBe(roundOneKey);
  // And round 2 really is open with seat 1 owing a commit again.
  expect(committed(seatTwo, 1)).toBe(false);

  return { def, roundOneKey, roundTwoKey, roundTwo: seatTwo };
}

describe('BSMITH-05: a submission composed against a closed boundary', () => {
  it('case 1: is REFUSED, and does not land in the round that has since opened', async () => {
    const { def, roundOneKey, roundTwo } = await simultaneousAtRoundTwo();

    // Seat 1's browser wakes six hours later and submits the commit it composed
    // in round 1. Every other guard passes: seat 1 is due, not completed, and
    // `commit` is available — in round 2.
    const stale = refused(await run(def, roundTwo.snapshot, {
      type: 'action', actionName: 'commit', player: 1, args: {}, boundaryKey: roundOneKey,
    }));

    // Asserted FIRST on purpose: this is the one that makes the RED legible as
    // "round 1's commit was applied to round 2", rather than merely "no error
    // was returned".
    expect(committed(stale, 1)).toBe(false);
    expect(stale.success).toBe(false);
    // Nothing landed anywhere: a refusal carries no snapshot to adopt.
    expect(stale).not.toHaveProperty('snapshot');
  });

  it('case 2: refuses with the actionable sentence the specification names', async () => {
    const { def, roundOneKey, roundTwo } = await simultaneousAtRoundTwo();

    const stale = refused(await run(def, roundTwo.snapshot, {
      type: 'action', actionName: 'commit', player: 1, args: {}, boundaryKey: roundOneKey,
    }));

    expect(stale.error).toBe(STALE_MESSAGE);
    // No internals leak into a sentence a human reads (T-68-14).
    expect(stale.error).not.toMatch(/flow:p=|\.ts|at Object|src\//);
  });

  it('case 3: leaves the seat a way forward — the same action succeeds against the current boundary', async () => {
    const { def, roundOneKey, roundTwoKey, roundTwo } = await simultaneousAtRoundTwo();

    const stale = refused(await run(def, roundTwo.snapshot, {
      type: 'action', actionName: 'commit', player: 1, args: {}, boundaryKey: roundOneKey,
    }));
    expect(stale.success).toBe(false);

    // The player reloads, sees round 2, and commits. A refusal costs a reload,
    // never the seat's turn.
    const retry = await run(def, roundTwo.snapshot, {
      type: 'action', actionName: 'commit', player: 1, args: {}, boundaryKey: roundTwoKey,
    });

    expect(retry.success).toBe(true);
    expect(committed(retry, 1)).toBe(true);
  });

  it('case 4: resolves an OpResult — never throws, and names the refusal with its own code (#535)', async () => {
    const { def, roundOneKey, roundTwo } = await simultaneousAtRoundTwo();

    const promise = run(def, roundTwo.snapshot, {
      type: 'action', actionName: 'commit', player: 1, args: {}, boundaryKey: roundOneKey,
    });

    await expect(promise).resolves.toMatchObject({ success: false });
    const stale = refused(await promise);
    // A stale refusal is the engine's own outcome, not a forwarded failure, so
    // it carries the engine's own code: a host tells it apart from every other
    // refusal by the code, never by the message, which is copy (#535).
    expect(stale.errorCode).toBe('STALE_SUBMISSION');
    expect(stale.errorCode).toBe(ErrorCode.STALE_SUBMISSION);
    expect(stale.category).toBe('protocol');
  });

  it('case 5: a CORRECT key never widens authorization — an ineligible seat is refused exactly as it is today', async () => {
    const def = simultaneousRoundsFixtureDefinition;
    const started = succeeded(await run(def, null, { type: 'start' }));
    const roundOneKey = keyOf(started);

    const first = succeeded(await run(def, started.snapshot, {
      type: 'action', actionName: 'commit', player: 1, args: {}, boundaryKey: roundOneKey,
    }));
    expect(first.success).toBe(true);
    // Round 1 is still open (seat 2 has not answered), so the key has not moved.
    expect(keyOf(first)).toBe(roundOneKey);

    // Seat 1 has already completed this round. Its key is perfectly current —
    // and buys it nothing.
    const again = await run(def, first.snapshot, {
      type: 'action', actionName: 'commit', player: 1, args: {}, boundaryKey: roundOneKey,
    });

    expect(again.success).toBe(false);
    // The engine's PRE-EXISTING refusal, unchanged by this phase. Note this is
    // GameRunner.performAction's `canPlayerAct` gate, which fires before
    // resumeSimultaneousAction's per-seat strings are ever reached.
    expect(again.error).toBe("Not Player 1's turn");
    expect(again.errorCode).toBe('NOT_YOUR_TURN');
    expect(again.errorCode).not.toBe(ErrorCode.STALE_SUBMISSION);
  });

  it('case 6: the rule is not simultaneous-only — a sequential game refuses a previous step key and accepts the current one', async () => {
    const def = collectTurnsFixtureDefinition;
    const started = succeeded(await run(def, null, { type: 'start' }));
    const firstStepKey = keyOf(started);

    // A caretaker passes for seat 1, closing the actionStep seat 1 was looking
    // at. Seat 1 is STILL due — the second actionStep of the same turn — so
    // every other guard would pass for a stale submission.
    const caretaker = succeeded(await run(def, started.snapshot, {
      type: 'action', actionName: 'pass', player: 1, args: {}, boundaryKey: firstStepKey,
    }));
    expect(caretaker.success).toBe(true);
    const secondStepKey = keyOf(caretaker);
    expect(secondStepKey).not.toBe(firstStepKey);

    const stale = refused(await run(def, caretaker.snapshot, {
      type: 'action', actionName: 'pass', player: 1, args: {}, boundaryKey: firstStepKey,
    }));
    expect(stale.success).toBe(false);
    expect(stale.errorCode).toBe(ErrorCode.STALE_SUBMISSION);
    expect(stale).not.toHaveProperty('snapshot');

    const retry = succeeded(await run(def, caretaker.snapshot, {
      type: 'action', actionName: 'pass', player: 1, args: {}, boundaryKey: secondStepKey,
    }));
    // The turn really did advance — the refusal did not consume seat 1's move.
    expect(keyOf(retry)).not.toBe(secondStepKey);
  });

  it('case 7: a mid-action selectionStep composed against a closed boundary is refused by the same guard', async () => {
    const def = collectTurnsFixtureDefinition;
    const started = succeeded(await run(def, null, { type: 'start' }));

    const explore = succeeded(await run(def, started.snapshot, {
      type: 'action', actionName: 'explore', player: 1, args: {}, boundaryKey: keyOf(started),
    }));
    expect(explore.success).toBe(true);
    const openKey = keyOf(explore);
    const followUpArgs = (explore.followUp as { args: Record<string, unknown> }).args;

    const choices = succeeded(await run(def, explore.snapshot, {
      type: 'resolveChoices', actionName: 'collect', player: 1, selectionName: 'item', args: {},
    }));
    const itemId = (choices.validElements as Array<{ id: number }>)[0].id;

    // Seat 1 goes to sleep holding an open pick. A caretaker passes for it, and
    // the actionStep it was picking inside closes.
    const caretaker = succeeded(await run(def, explore.snapshot, {
      type: 'action', actionName: 'pass', player: 1, args: {}, boundaryKey: openKey,
    }));
    expect(caretaker.success).toBe(true);
    expect(keyOf(caretaker)).not.toBe(openKey);

    const stale = refused(await run(def, caretaker.snapshot, {
      type: 'selectionStep', player: 1, selectionName: 'item', value: itemId,
      actionName: 'collect', initialArgs: followUpArgs, boundaryKey: openKey,
    }));

    expect(stale.success).toBe(false);
    expect(stale.errorCode).toBe(ErrorCode.STALE_SUBMISSION);
    // Before the fix this completes the action and moves the item into held-1.
    expect(stale).not.toHaveProperty('actionComplete');
    expect(stale).not.toHaveProperty('snapshot');
  });

  it('case 8: a malformed key is a plain mismatch — one refusal contract, no parse path, no throw', async () => {
    const { def, roundTwo } = await simultaneousAtRoundTwo();

    const malformed: unknown[] = [
      '',
      'flow:p=',
      'x'.repeat(100_000),
      42,
      null,
      { path: [1, 1, 2, 0] },
    ];

    for (const value of malformed) {
      const result = refused(await run(def, roundTwo.snapshot, {
        type: 'action', actionName: 'commit', player: 1, args: {},
        boundaryKey: value as string,
      }));
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe(ErrorCode.STALE_SUBMISSION);
      expect(committed(result, 1)).toBe(false);
    }
  });
});
