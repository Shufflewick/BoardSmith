---
phase: 132-engine-element-builder-safety
plan: 03
subsystem: engine
tags: [action-execution, resolveArgs, followUp-args, pit-of-success, eng-05]

# Dependency graph
requires:
  - phase: 132-01
    provides: PROC-01 verification gate — F12/ENG-05 independently re-confirmed LEGITIMATE against current source before this fix was written
provides:
  - resolveArgs second pass (non-selection followUp args) narrowed to only resolve genuine {id, className}-shaped serialized-element objects
  - Red-first regression test (3 cases: bare-number non-coercion, serialized-object resolution, first-pass selection control) in action.test.ts
affects: [132-04, 132-05, 138-GAMES]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "resolveArgs two-pass split: first pass (selection-typed element/elements/choice args) keeps looser looksLikeSerializedElement/bare-number resolution; second pass (non-selection followUp args) requires the stricter isSerializedElement shape gate — no implicit numeric-id coercion outside declared selections"

key-files:
  created: []
  modified:
    - src/engine/action/action.ts
    - src/engine/action/action.test.ts
    - docs/common-pitfalls.md
    - src/session/testing/fixtures/collect-fixture.ts
    - src/session/testing/fixtures/collect-turns-fixture.ts

key-decisions:
  - "No new helper added — reused the existing isSerializedElement (id:number AND className:string); looksLikeSerializedElement remains scoped to the first pass only"
  - "Fixtures that relied on the removed bare-number auto-coercion (collect-fixture.ts, collect-turns-fixture.ts) now resolve followUp ids explicitly via game.getElementById in their execute() handlers, matching the newly documented pattern"

requirements-completed: [ENG-05, PROC-02]

# Metrics
duration: 5min
completed: 2026-07-03
---

# Phase 132 Plan 3: resolveArgs Second-Pass Bare-Number Coercion Removal (ENG-05) Summary

**Non-selection followUp args (e.g. `turnCount`, `sectorId`) no longer get silently rewritten into a `GameElement` when their numeric value happens to collide with a live element's id — `resolveArgs`'s second pass now only resolves genuine `{id, className}`-shaped serialized-element objects via the existing `isSerializedElement` check.**

## Performance

- **Duration:** ~5 min (task-commit timestamps 00:23:09 → 00:25:16, plus post-fix full-suite triage)
- **Started:** 2026-07-03T00:23:09-05:00
- **Completed:** 2026-07-03T00:25:16-05:00 (core plan); additional fixture fix + full-suite verification followed
- **Tasks:** 2/2 completed
- **Files modified:** 5

## Accomplishments
- Removed the ambiguous bare-number-to-GameElement coercion from `resolveArgs`'s second pass (non-selection/followUp args) — a plain numeric business value can no longer be silently swapped for an unrelated element that happens to share its id
- First pass (named `element`/`elements`/`choice` selections) is fully untouched — bare numeric ids sent for declared selection args still resolve exactly as before
- Red-first regression test added inside the existing `executeAction` describe block, covering all three required cases (bare-number survives as number, `{id,className}` object still resolves, first-pass selection control unaffected)
- Documented the new behavior in `docs/common-pitfalls.md` (§10 followUp Args), replacing the stale "auto-resolves numeric IDs" description with the correct, narrower behavior and a recipe for opting into resolution via the serialized-element shape
- Found and fixed 2 test fixtures (`collect-fixture.ts`, `collect-turns-fixture.ts`) that depended on the removed coercion — full `npm test` is green (2141/2141) after the fix

## Task Commits

Each task was committed atomically:

1. **Task 1: RED — regression test proving bare numbers are not coerced** - `9c812391` (test)
2. **Task 2: GREEN — narrow resolveArgs second pass to isSerializedElement** - `dad4fb1b` (fix)
3. **[Rule 1 auto-fix] Update collect fixtures for the fix's downstream effect** - `bae1203c` (fix)

**Plan metadata:** committed alongside this summary

_TDD flow: RED (`9c812391`) → GREEN (`dad4fb1b`). No REFACTOR commit was needed — the fix itself is the minimal, final shape._

## Files Created/Modified
- `src/engine/action/action.ts` — `resolveArgs` second-pass loop (~lines 239-256): deleted the bare-number `getElementById` branch, swapped `looksLikeSerializedElement` for `isSerializedElement`, updated the inline comment
- `src/engine/action/action.test.ts` — added `ENG-05 followUp arg resolution` nested describe (3 tests: A/B/C) inside `Action Executor > executeAction`
- `docs/common-pitfalls.md` — rewrote §10 "followUp Args Auto-Resolution" → "followUp Args Element Resolution" to document the narrowed, correct behavior
- `src/session/testing/fixtures/collect-fixture.ts` — `execute()` now resolves `combatantId`/`sectorId` explicitly via `ctx.game.getElementById(...)` instead of relying on auto-coercion
- `src/session/testing/fixtures/collect-turns-fixture.ts` — same explicit-resolution fix for `combatantId`

## Verification Evidence

**RED (Task 1), captured against unpatched `resolveArgs`:**
```
❯ src/engine/action/action.test.ts (125 tests | 1 failed) 30ms
   × Action Executor > executeAction > ENG-05 followUp arg resolution > does NOT coerce a bare-number non-selection followUp arg into a GameElement (Test A) 3ms
     → expected 'object' to be 'number' // Object.is equality
```
Test B and Test C passed even pre-fix (expected — Test B already used the isSerializedElement-compatible shape via looksLikeSerializedElement's looser match, Test C exercises the untouched first pass).

**GREEN (Task 2):** `npx vitest run src/engine/action/action.test.ts src/engine/action/action-typed-args.test.ts` → 126/126 passed.

**`looksLikeSerializedElement` scope check:** `grep -n "looksLikeSerializedElement" src/engine/action/action.ts` shows it used only at lines 126, 174, 200 (all inside the first pass) and its own definition — zero uses in the second pass.

**Full suite after fixture fix:** `npm test` → 168 test files, 2141/2141 tests passed. `npx tsc --noEmit` shows zero new errors attributable to files touched in this plan (remaining errors are pre-existing test-file looseness tracked in PROJECT.md).

## Decisions Made
- No new helper added — reused the existing `isSerializedElement`, per the plan's must_haves
- Fixture fix (Rule 1) kept the fixtures' original intent (plain numeric, structured-cloneable followUp args for snapshot/undo persistence testing) by moving resolution into the execute handler rather than reverting the engine fix or re-shaping the followUp args to `{id, className}` objects — this exercises the exact pattern now documented in `docs/common-pitfalls.md`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed 2 test fixtures broken by the resolveArgs fix**
- **Found during:** Post-Task-2 full-suite verification (`npm test`)
- **Issue:** `src/session/testing/fixtures/collect-fixture.ts` and `collect-turns-fixture.ts` cast `ctx.args.combatantId`/`ctx.args.sectorId` directly to `Held`/`Sector` element types, relying on the exact bare-number coercion this plan removes. 7 tests across `undo-authoritative.test.ts`, `stateful-undo-authoritative.test.ts`, `stateful-timetravel-authoritative.test.ts`, `parity-contract.test.ts`, and `runner.test.ts` failed after the ENG-05 fix.
- **Fix:** Updated both fixtures' `execute()` handlers to explicitly resolve the ids via `ctx.game.getElementById(...)` instead of relying on implicit resolveArgs coercion — preserves each fixture's stated intent (plain numeric, structured-cloneable followUp args) while complying with the new resolveArgs contract.
- **Files modified:** `src/session/testing/fixtures/collect-fixture.ts`, `src/session/testing/fixtures/collect-turns-fixture.ts`
- **Verification:** `npx vitest run` on all 5 affected test files green; full `npm test` green (2141/2141)
- **Committed in:** `bae1203c`

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug directly caused by this plan's engine change)
**Impact on plan:** Necessary follow-through of the ENG-05 fix; no scope creep. No games in `~/BoardSmithGames/` or MERC reference this bare-number followUp pattern for non-selection args as far as this plan's scope reaches — cross-repo migration is explicitly sequenced later, at Phase 138 (GAMES), per PROJECT.md.

## Issues Encountered
None beyond the fixture deviation above.

## Known Stubs
None.

## Threat Flags
None — this plan directly implements the plan's own `<threat_model>` mitigation (T-132-01); no new, undocumented security-relevant surface was introduced.

## Next Phase Readiness
- ENG-05 and PROC-02 requirements satisfied for this plan; 132-04 (F13/ENG-06 forEach) and 132-05 (F28/ENG-08 handler-less action guard) are unblocked and independent of this change
- Full `npm test` green at wave close (2141/2141) — no regressions carried forward

---
*Phase: 132-engine-element-builder-safety*
*Completed: 2026-07-03*
