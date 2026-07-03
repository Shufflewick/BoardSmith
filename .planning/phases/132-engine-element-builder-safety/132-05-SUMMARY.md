---
phase: 132-engine-element-builder-safety
plan: 05
subsystem: engine/action
tags: [engine, action-builder, registration, pit-of-success]
dependency-graph:
  requires: [132-01]
  provides: [ENG-08-registration-guard]
  affects: [src/engine/element/game.ts, src/engine/action/action-builder.ts]
tech-stack:
  added: []
  patterns:
    - "undoable?-style optional boolean marker on ActionDefinition, cleared by the terminal builder method that supplies the real value"
key-files:
  created: []
  modified:
    - src/engine/action/types.ts
    - src/engine/action/action-builder.ts
    - src/engine/element/game.ts
    - src/engine/element/game.test.ts
decisions:
  - "handlerless flag set true in the Action constructor (mirrors the existing no-op execute default) and cleared inside .execute(fn), not set inside .build() — .build() just returns whatever definition.handlerless currently holds, so it accurately reflects whether .execute() was ever called regardless of call order"
  - "Throw lives inside registerAction() itself, not inside startFlow()'s existing #validateActionReachability/PIT-02 validators — new registration-time validation per 132-PATTERNS.md Pitfall 4, fires even in unit tests that never call startFlow()"
metrics:
  duration: "~15 minutes"
  completed: 2026-07-03
---

# Phase 132 Plan 05: Handler-less Action Registration Guard (ENG-08) Summary

Actions built via `.build()` without ever calling `.execute(fn)` now throw an actionable, action-named error at `registerAction()` time instead of silently registering as a no-op.

## What Was Built

Closed F28/ENG-08: `Action`'s private constructor seeded `execute: () => {}` as a default, and `registerAction()` performed zero validation — a `.build()`-terminated action chain (handler never supplied) registered silently and, if ever triggered by a player, did nothing. Per `132-CONTEXT.md`/`132-PATTERNS.md` Pitfall 4, `.build()` must stay available for inspection but `registerAction()` must reject handler-less definitions loudly, at registration time (not deferred to `startFlow()`'s existing validators).

### Task 1 (RED): Regression test

Added `describe('ENG-08 handler-less registration', ...)` to `game.test.ts` with two cases:
- **Test A:** `game.registerAction(<action ending in .build()>)` throws, with the message containing both the action name (`noop-action`) and the fix hint `.execute(`. The test calls only `registerAction` — no `startFlow()` — proving the throw is registration-time, not flow-time.
- **Test B (control):** `game.registerAction(<action ending in .execute(fn)>)` does not throw.

Recorded RED output (captured before any fix):
```
FAIL  src/engine/element/game.test.ts > ENG-08 handler-less registration > throws naming the action and pointing to .execute( when registering a .build()-terminated (handler-less) action, without ever calling startFlow()
AssertionError: expected [Function] to throw an error
- Expected: null
+ Received: undefined
```
Confirms `registerAction()` did not throw on unpatched code — exactly the F28 defect.

### Task 2 (GREEN): Handler-less flag + registerAction throw

- `src/engine/action/types.ts`: added `handlerless?: boolean` to `ActionDefinition`, documented alongside the existing `undoable?: boolean` field (same optional-flag shape/style).
- `src/engine/action/action-builder.ts`:
  - Constructor now seeds `handlerless: true` next to the no-op `execute` default.
  - `.execute(fn)` sets the real handler and `delete`s `handlerless`, clearing the flag.
  - `.build()` is unchanged in behavior (still returns `this.definition` for inspection) but its JSDoc now documents that the returned definition stays flagged `handlerless` unless `.execute(fn)` was called first.
- `src/engine/element/game.ts`: `registerAction()` now checks `action.handlerless` before storing and throws `Error("Action '<name>' has no execute handler — end the chain with .execute(fn) before registering it. .build() alone produces a handler-less definition for inspection only; it must not be registered directly.")`. The throw is entirely inside `registerAction()` — no changes to `startFlow()`, `#validateActionReachability()`, or the PIT-02 element-class check, keeping this a genuinely new, earlier, stricter registration-time gate per 132-RESEARCH.md Pitfall 4.

Verified no `docs/` file documents `.build()` as a registration path (`grep -rn "\.build()" docs/` returned zero matches) — no DOCX-04 doc update needed.

## Deviations from Plan

None — plan executed exactly as written.

## Verification

- `npx vitest run src/engine/element/game.test.ts src/engine/action/action.test.ts src/engine/action/action-typed-args.test.ts` — 3 files, 138 tests, all green.
- `npm test` (full suite) — 168 files, 2144 tests, all green.
- `grep -n "handlerless\|handler-less\|has no execute" src/engine/element/game.ts` confirms the throw lives inside `registerAction()` (lines 920-923).
- `npx tsc --noEmit` shows pre-existing, unrelated test-file looseness errors (documented repo-wide tech debt per PROJECT.md); zero errors in any file touched by this plan (`action-builder.ts`, `action/types.ts`, `element/game.ts`, `element/game.test.ts`).

## Self-Check: PASSED

- FOUND: src/engine/action/types.ts (handlerless field present)
- FOUND: src/engine/action/action-builder.ts (constructor flag + .execute clear + .build() doc)
- FOUND: src/engine/element/game.ts (registerAction throw)
- FOUND: src/engine/element/game.test.ts (ENG-08 describe block)
- FOUND commit a1c83d66 (RED test)
- FOUND commit abed4582 (GREEN fix)
