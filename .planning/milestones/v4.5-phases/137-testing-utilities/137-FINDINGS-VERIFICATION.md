# Phase 137 — PROC-01 Findings Verification Gate

**Purpose:** Independent re-verification of the two in-scope Phase 137 audit findings — F36 (TST-01, `doAction` never throws) and F37 (TST-02, nondeterministic default seed) — against **today's post-Phase-136 source**, recorded BEFORE any fix task in Plans 02-03 runs. This is the project's "Prove Before Fix" rule applied as a hard phase gate.

**Verified against:** HEAD at Phase 137 planning time (post-Phase-136), 2026-07-03.

---

## Finding F36 / TST-01 — `TestGame.doAction` never throws; class-level example ignores the result

**Original audit claim:** `src/testing/test-game.ts:272` — `doAction` returns an `ActionExecutionResult` and never throws, even though the method's own class-level `@example` (and much of the test suite) calls it and ignores the result, silently swallowing action failures inside tests.

**Re-verification:**

1. **`doAction` body — confirmed never throws.** `src/testing/test-game.ts:272-278`:
   ```typescript
   doAction(
     playerSeat: number,
     actionName: string,
     args: Record<string, unknown> = {}
   ): ActionExecutionResult {
     return this.runner.performAction(actionName, playerSeat, args);
   }
   ```
   `this.runner.performAction(...)` returns a plain `ActionExecutionResult` (`{ success, error, ... }`); there is no `if (!result.success) throw` anywhere in the method. A failing action returns normally with `success: false` and the caller must remember to check it.

2. **Class-level `@example` models ignoring the result — confirmed.** `src/testing/test-game.ts:94-104`:
   ```typescript
   /**
    * @example
    * ```typescript
    * const testGame = TestGame.create(GoFishGame, {
    *   playerCount: 2,
    *   seed: 'deterministic',
    * });
    *
    * testGame.doAction(1, 'ask', { target: 2, rank: 'K' });
    * expect(testGame.isComplete()).toBe(false);
    * ```
    */
   ```
   Line 101's `testGame.doAction(1, 'ask', ...)` call discards the returned `ActionExecutionResult` entirely — if the `ask` action silently fails, the very next assertion (`isComplete()`) still runs against unintended game state with no indication the action never took effect. This is the flagship example on the class itself, so it is the first pattern any consumer copies.

   A second, method-level `@example` at lines 264-270 (attached to `doAction` directly) DOES model checking the result (`if (!result.success) { console.error(result.error); }`), but it does not counteract the class-level example above it, which is the one most visible when a consumer first opens the type.

**VERDICT: LEGITIMATE**

File:line evidence: `src/testing/test-game.ts:272-278` (never-throws body), `src/testing/test-game.ts:94-104` (class-level example ignoring the result). Both match today's source exactly as the original finding described; nothing has changed between the audit and Phase 136 completion. Plan 02/03 must (a) flip `doAction` to throw on failure with a rich actionable trace, (b) add a `tryAction()` escape hatch preserving today's never-throws behavior for the 5 call sites that intentionally branch on failure, and (c) fix the class-level example to either check the result or note that failure now throws.

---

## Finding F37 / TST-02 — Default seed is `test-${Date.now()}`, nondeterministic

**Original audit claim:** `src/testing/test-game.ts:127` — `TestGame.create`'s default seed falls back to `` `test-${Date.now()}` `` when no `seed` option is supplied, making no-seed test runs nondeterministic between invocations, contrary to the library's own deterministic-by-default doctrine (established precedent: `playUntilComplete`'s fixed `'playUntilComplete-default'` seed in `src/testing/simulate-action.ts`).

**Re-verification:**

`src/testing/test-game.ts:123-127` (`TestGame.create`):
```typescript
static create<G extends Game>(
  GameClass: new (options: GameOptions) => G,
  options: TestGameOptions
): TestGame<G> {
  const seed = options.seed ?? `test-${Date.now()}`;
```
Line 127 confirms the literal claim verbatim: with no `options.seed`, the seed is derived from wall-clock time via `Date.now()`, so two `TestGame.create(...)` calls with identical options at different moments produce different seeds, and therefore potentially different shuffles/random outcomes in any game that reads randomness from the seeded RNG. This directly contradicts the precedent already established elsewhere in the same module tree — `src/testing/simulate-action.ts` resolves `options?.seed ?? 'playUntilComplete-default'` (a fixed literal), making `playUntilComplete()` deterministic by default while `TestGame.create()` (the more foundational, more widely used entry point) is not.

Also confirmed: `TestGame` has no `seed` getter/property today — the resolved `seed` local (line 127) is used to build the `GameRunner` (lines 135-144) and then discarded; a consumer cannot retrieve the seed a `TestGame` was constructed with, even to log it for a flaky-test repro.

**VERDICT: LEGITIMATE**

File:line evidence: `src/testing/test-game.ts:127`. Matches today's source exactly as described; nothing has changed since the audit. Plan 02 must replace `` `test-${Date.now()}` `` with a fixed literal default (naming convention: `'test-seed'`, matching the `'playUntilComplete-default'` house style) and add a `readonly seed: string` instance property/getter so failure traces (including the new `doAction` throw from F36) can surface the seed for reproduction.

---

## Call-site classification (confirmed)

Re-confirmed against current source (`grep -n '\.doAction(' src/testing/*.ts`) — all six sites match 137-PATTERNS.md's classification with no drift:

| # | File:line | Current source snippet | Classification | Disposition |
|---|-----------|------------------------|-----------------|-------------|
| 1 | `src/testing/simulate-tutorial.ts:228` | `const result = testGame.doAction(moveSeat, move.action, move.args ?? {});` followed by a custom tutorial-step error message on `!result.success` | (b) checks failure, builds custom message | migrate to `tryAction()` — the tutorial-specific error (includes `activeStep.id`) is richer than the generic throw and must be preserved |
| 2 | `src/testing/random-simulation.ts:402` | `const result = testGame.doAction(actor.seat, move.name, move.args);` followed by `if (result.success) { ...continue } consecutiveFailures++;` | (b) expects/handles failure as a normal control-flow branch | migrate to `tryAction()` — a throw-flip would break the retry loop on the first rejected move |
| 3 | `src/testing/simulate-action.ts:55` (`simulateAction`) | `const result = testGame.doAction(playerSeat, actionName, args); return { ...result, action: actionName, playerSeat, args };` | (b) returns raw result for caller to assert on | migrate to `tryAction()` — `simulateAction`'s documented contract (docs/api/testing.md:176) is "return the result, don't throw" |
| 4 | `src/testing/simulate-action.ts:383` (`playUntilComplete` internal loop) | `const result = testGame.doAction(seat, move.action, move.args); if (result.success) {...} else { moveFailures.push(...) }` | (b) batches multi-seat failures before deciding dead-end | migrate to `tryAction()` — a throw-flip would report only the first seat's failure, losing the multi-seat `GameStuckError` diagnostic |
| 5 | `src/testing/action-builder.ts:92` (`ActionBuilder.execute()`) | `const result = this._testGame.doAction(this._seat, this._actionName, this._args); if (!result.success) { throw new Error(...) }` | (c) redundant with new default throw | simplify — drop the manual `!result.success` throw; the new `doAction` throw (with `debugActionAvailability` trace) is a strict superset of this hand-rolled message |
| 6 | `src/testing/assertions.test.ts:325` | `testGame.doAction(1, 'bid', {});` | (a) ignores result; action is expected to succeed (fixture setup in `makeBidGame()`) | no change — after the flip this remains correct with zero edits; if it ever silently failed before, it now surfaces loudly, which is the intended effect of TST-01 |

No fix code, no test code, and no source edits were made in this task. This document records verdicts and confirmed line traces only, gating all fix work in Plans 02-03.
