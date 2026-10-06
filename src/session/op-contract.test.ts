/**
 * The op contract between a host and `executeOp` (#530).
 *
 * `Op` is three kinds of op: the ones a platform executor runs (`ExecutorOp`),
 * the ones only `boardsmith dev` sends (`DevOp`), and the lifecycle ops a
 * `SnapshotSessionHost` handles itself and never hands to `executeOp`
 * (`HostOp`). `parseExecutorOp` is the one parser for the first kind, so a
 * platform validates what it receives over a wire against the engine's own
 * definition instead of restating it.
 *
 * The type-level cases are enforced by `boardsmith typecheck`: each
 * `@ts-expect-error` line fails the check if the error it expects goes away.
 */
import { describe, it, expect, expectTypeOf } from 'vitest';
import { parseExecutorOp } from './parse-executor-op.js';
import {
  executeOp,
  type DevOp,
  type ExecutableOp,
  type ExecutorOp,
  type HostOp,
  type Op,
} from './stateless-ops.js';
import { simultaneousRoundsFixtureDefinition } from './testing/fixtures/simultaneous-rounds-fixture.js';

const KEY = 'flow:p=1';

/** One well-formed op of every executor type. */
const EVERY_EXECUTOR_OP: ExecutorOp[] = [
  { type: 'start' },
  { type: 'action', actionName: 'commit', player: 1, args: {}, boundaryKey: KEY },
  { type: 'expireSeat', player: 2, idleAction: 'pass', args: { why: 'late' }, boundaryKey: KEY },
  { type: 'selectionStep', player: 1, selectionName: 'card', value: 7, boundaryKey: KEY },
  {
    type: 'selectionStep',
    player: 1,
    selectionName: 'card',
    value: [1, 2],
    actionName: 'play',
    initialArgs: { from: 3 },
    boundaryKey: KEY,
  },
  { type: 'resolveChoices', actionName: 'play', player: 1, selectionName: 'card', args: {} },
  { type: 'cancelAction', player: 1 },
  { type: 'undo', player: 2 },
  { type: 'botTurn', seats: [{ seat: 1 }, { seat: 2, level: 'hard' }] },
];

describe('the op kinds (#530)', () => {
  it('Op is exactly the three kinds, and executeOp takes only the first two', () => {
    expectTypeOf<Op>().toEqualTypeOf<ExecutorOp | DevOp | HostOp>();
    expectTypeOf<ExecutableOp>().toEqualTypeOf<ExecutorOp | DevOp>();
    expectTypeOf<ExecutorOp['type']>().toEqualTypeOf<
      'start' | 'action' | 'expireSeat' | 'selectionStep' | 'resolveChoices' | 'cancelAction' | 'undo' | 'botTurn'
    >();
    expectTypeOf<HostOp['type']>().toEqualTypeOf<'demoStart' | 'demoStop' | 'demoControl' | 'convertSeatToBot'>();
  });

  it('executeOp refuses a host lifecycle op at compile time', async () => {
    const def = simultaneousRoundsFixtureDefinition;
    const started = await executeOp(def, { playerCount: 2 }, null, null, { type: 'start' });
    expect(started.success).toBe(true);
    if (!started.success) return;
    // @ts-expect-error -- demoStart is a HostOp; only SnapshotSessionHost.handleOp runs it.
    const demo = await executeOp(def, { playerCount: 2 }, started.snapshot, null, { type: 'demoStart' });
    expect(demo.success).toBe(false);
  });
});

describe('parseExecutorOp (#530)', () => {
  it('parses every executor op as given', () => {
    for (const op of EVERY_EXECUTOR_OP) {
      expect(parseExecutorOp(JSON.parse(JSON.stringify(op)))).toEqual({ ok: true, op });
    }
  });

  it('refuses a value that is not an object, naming what it got', () => {
    for (const value of [null, undefined, 'start', 7, [{ type: 'start' }]]) {
      const parsed = parseExecutorOp(value);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.error).toMatch(/must be an object with a "type"/);
    }
  });

  it('refuses an unknown type, and lists the types an executor runs', () => {
    const parsed = parseExecutorOp({ type: 'demoStart' });
    expect(parsed).toEqual({
      ok: false,
      error:
        'An executor op has type "demoStart", which an executor does not run. An executor op\'s type ' +
        'is one of: start, action, expireSeat, selectionStep, resolveChoices, cancelAction, undo, botTurn.',
    });
    expect(parseExecutorOp({}).ok).toBe(false);
    expect(parseExecutorOp({ type: 7 }).ok).toBe(false);
  });

  it('refuses a key the op does not declare, naming the key and the fields it does carry', () => {
    const parsed = parseExecutorOp({
      type: 'action', actionName: 'commit', player: 1, args: {}, boundaryKey: KEY, pendingState: null,
    });
    expect(parsed).toEqual({
      ok: false,
      error:
        'The "action" op has a field "pendingState" it does not declare. An "action" op carries ' +
        'type, actionName, player, args, boundaryKey; remove "pendingState".',
    });
  });

  it('refuses every submission op without its boundary key, saying what the key is for', () => {
    const submissions = EVERY_EXECUTOR_OP.filter((op) => 'boundaryKey' in op);
    expect(submissions.map((op) => op.type).sort()).toEqual(['action', 'expireSeat', 'selectionStep', 'selectionStep']);
    for (const op of submissions) {
      const { boundaryKey: _dropped, ...unstamped } = op as ExecutorOp & { boundaryKey: string };
      const parsed = parseExecutorOp(unstamped);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.error).toContain(`The "${op.type}" op has no "boundaryKey"`);
        expect(parsed.error).toMatch(/names the round this submission was composed in/);
      }
    }
    const empty = parseExecutorOp({ type: 'undo', player: 1, boundaryKey: KEY });
    expect(empty.ok).toBe(false);
  });

  it('refuses a field of the wrong kind, naming the field and what it must be', () => {
    const cases: Array<[unknown, RegExp]> = [
      [{ type: 'action', actionName: '', player: 1, args: {}, boundaryKey: KEY }, /"actionName" must be a non-empty string/],
      [{ type: 'action', actionName: 'go', player: 1.5, args: {}, boundaryKey: KEY }, /"player" must be a whole number/],
      [{ type: 'action', actionName: 'go', player: 1, args: [], boundaryKey: KEY }, /"args" must be an object/],
      [{ type: 'action', actionName: 'go', player: 1, args: {}, boundaryKey: 42 }, /"boundaryKey" must be a non-empty string/],
      [{ type: 'selectionStep', player: 1, selectionName: 's', boundaryKey: KEY }, /has no "value"/],
      [{ type: 'selectionStep', player: 1, selectionName: 's', value: 1, initialArgs: 3, boundaryKey: KEY }, /"initialArgs" must be an object/],
      [{ type: 'botTurn', seats: 'all' }, /"seats" must be a list of \{ seat, level\? \}/],
      [{ type: 'botTurn', seats: [{ seat: 1, extra: true }] }, /"seats" must be a list of \{ seat, level\? \}/],
      [{ type: 'botTurn', seats: [{ seat: 1, level: 3 }] }, /"seats" must be a list of \{ seat, level\? \}/],
    ];
    for (const [value, message] of cases) {
      const parsed = parseExecutorOp(value);
      expect(parsed.ok, JSON.stringify(value)).toBe(false);
      if (!parsed.ok) expect(parsed.error).toMatch(message);
    }
  });

  it('accepts optional fields left out, and any value for a selection', () => {
    expect(parseExecutorOp({ type: 'botTurn', seats: [{ seat: 2 }] }).ok).toBe(true);
    expect(parseExecutorOp({ type: 'selectionStep', player: 1, selectionName: 's', value: null, boundaryKey: KEY }).ok).toBe(true);
  });
});
