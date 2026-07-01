---
phase: 120-authoring-pit-of-success-guards
plan: 03
subsystem: engine
tags: [pit-of-success, element-registration, startFlow, validation, typescript]

# Dependency graph
requires:
  - phase: 120-02
    provides: "startFlow() with #validateActionReachability() call already in place before FlowEngine construction"
provides:
  - "Per-game recording of element classes queried through GameElement's all/first/firstN/last/lastN during the first startFlow() traversal"
  - "startFlow() throws a named, actionable error for a class queried but never registered (typo / dead class reference)"
affects: [engine, authoring-guardrails]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Recording hook lives at the GameElement finder call site (not ElementCollection), because ElementCollection has no _ctx/game linkage and an unregistered-class query returns an empty collection — there's nothing inside it to reach context from."
    - "Recording state (flag + Set) held on the per-game ElementContext (_ctx), never a module-level global, so concurrent games/tests never cross-contaminate."
    - "try/finally around the first FlowEngine.start() call guarantees recording deactivates even if start() throws."

key-files:
  created: []
  modified:
    - src/engine/element/types.ts
    - src/engine/element/game-element.ts
    - src/engine/element/game.ts
    - src/engine/element/game.test.ts

key-decisions:
  - "Followed the plan's corrected mechanism exactly: hooked the 5 GameElement finder methods (all/first/firstN/last/lastN), not ElementCollection._finder() (RESEARCH's original suggestion, verified not viable)."
  - "Reused the isElementClass guard pattern from ElementCollection by duplicating it locally in game-element.ts (not imported) — ElementCollection remains untouched, confirmed via grep."
  - "Two new fields added to ElementContext are prefixed _pit02* and documented as internal/non-public to keep them out of the authoring-facing API surface."

patterns-established:
  - "Internal cross-cutting validation state that must be per-game and leak-free belongs on the shared ElementContext (_ctx), not a module-level variable."

requirements-completed: [PIT-02]

# Metrics
duration: 25min
completed: 2026-07-01
---

# Phase 120 Plan 03: Element-Class Registration Validation (PIT-02) Summary

**startFlow() now throws a named, actionable error when an element class is queried via game.all/first/firstN/last/lastN during the first traversal but was never registered — catching typos and dead class references that previously failed silently by returning an empty collection.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-01T04:06:00Z (approx)
- **Completed:** 2026-07-01T04:31:23Z
- **Tasks:** 2 completed
- **Files modified:** 4 (types.ts, game-element.ts, game.ts, game.test.ts)

## Accomplishments
- Added two optional internal fields to `ElementContext` (`_pit02RecordingActive`, `_pit02RecordedClasses`) to hold per-game recording state.
- Hooked all 5 `GameElement` finder methods (`all`, `first`, `firstN`, `last`, `lastN`) to record class-typed query args into `_ctx` when recording is active, with zero allocation/overhead when inactive.
- Wired a first-traversal recording window into `startFlow()`: sets the flag, runs `FlowEngine.start()` in a try/finally, then diffs recorded classes against `_ctx.classRegistry`, throwing on the first unregistered class found.
- Added a `describe('PIT-02', ...)` block to `game.test.ts` with 4 tests: unregistered-class throw (naming the class + "registerElements"), correctly-registered positive case, post-start scope-off case, and two-game `_ctx` isolation case.
- Confirmed `element-collection.ts` was not touched (`grep -n "_ctx"` returns nothing).

## Task Commits

Each task was committed atomically:

1. **Task 1: Record class-typed finder args in the 5 GameElement finder methods** - `f4c914a` (feat) — *landed inside a concurrently-running process's commit; see Deviations.*
2. **Task 2: Wire the first-traversal recording window into startFlow() + PIT-02 tests** - `98c379f` (feat)

_No TDD RED/GREEN split was used for Task 2's plan-level `tdd="true"` marker since the plan's `<behavior>` and `<action>` were combined into a single implement-then-test pass per the task's own instructions (write action code + `describe('PIT-02', ...)` together); all 4 behavior tests pass._

## Files Created/Modified
- `src/engine/element/types.ts` - Added `_pit02RecordingActive?: boolean` and `_pit02RecordedClasses?: Set<ElementClass>` optional internal fields to `ElementContext`.
- `src/engine/element/game-element.ts` - Added local `isElementClass` guard + `recordQueriedClassIfActive` helper; called from all 5 finder methods (all/first/firstN/last/lastN) before building the query collection.
- `src/engine/element/game.ts` - `startFlow()` now opens a recording window around the first `FlowEngine.start()` call (try/finally) and throws a named, actionable error after diffing recorded classes against `classRegistry`.
- `src/engine/element/game.test.ts` - Added `PIT-02` describe block (4 tests) alongside the existing `PIT-03` block.

## Deviations from Plan

### Auto-fixed Issues

None — no bugs found, no missing critical functionality beyond what the plan specified.

### Process Deviation (not a code deviation)

**Task 1's commit was absorbed into a concurrently-running process's commit.** While staging and committing Task 1 (`game-element.ts` + `types.ts`), a separate concurrent process (evidently another agent/orchestrator working in the same non-worktree checkout on unrelated 120-02/120-05 work) ran `git add` + `git commit` between my `git add` and `git commit` calls. The result: my staged Task 1 content was committed as part of that other process's commit `f4c914a` ("docs(120-02): record PIT-03 decision in STATE.md"), rather than under my own message. I verified via `git show f4c914a -- src/engine/element/game-element.ts src/engine/element/types.ts` that the exact diff I intended is present and correct in that commit — no content was lost or altered. Task 2's commit (`98c379f`) landed cleanly with no interference. This is a git-index race from running multiple agents against the same working directory rather than isolated worktrees; it did not affect code correctness, only commit attribution/granularity for Task 1.

## Verification Results

```
npx vitest run src/engine/element/game.test.ts -t "PIT-02"
✓ src/engine/element/game.test.ts (8 tests | 4 skipped)
Tests  4 passed | 4 skipped (8)

npx vitest run src/engine/element
Test Files  11 passed (11)
Tests  172 passed (172)

npx vitest run src/engine
Test Files  27 passed (27)
Tests  567 passed (567)

grep -n "_ctx" src/engine/element/element-collection.ts
(no output — confirmed untouched)

npx tsc --noEmit -p .
(no errors in game.ts / game-element.ts / types.ts)
```

## Known Stubs

None.

## Deferred / Documented Limitations (added post-review, WR-02)

PIT-02 coverage is bounded to the `GameElement` finder methods
(`all`/`first`/`firstN`/`last`/`lastN`/`has`) during the first `startFlow()`
traversal. Two classes of queries are NOT covered and intentionally will
not trigger the unregistered-class throw:
1. Queries made directly on an `ElementCollection` (e.g.
   `board.children.all(Foo)`) — `ElementCollection` has no `_ctx`/game
   linkage, so it cannot call into the recording hook. Instrumenting
   `ElementCollection` was considered and rejected for this reason.
2. Post-`startFlow()` / async queries — recording is switched off once the
   first traversal completes.

This is now documented in code comments on `recordQueriedClassIfActive`
(game-element.ts) and the `startFlow()` PIT-02 block (game.ts). No runtime
behavior changed.

## Threat Flags

None — this plan's `<threat_model>` already covers the surface introduced (DoS via recording overhead, cross-game state leak, throw-message information disclosure), and no additional network/auth/schema surface was introduced.

## Self-Check: PASSED

- `src/engine/element/types.ts` — FOUND, contains `_pit02RecordingActive` and `_pit02RecordedClasses`.
- `src/engine/element/game-element.ts` — FOUND, contains `recordQueriedClassIfActive` calls in all 5 finder methods.
- `src/engine/element/game.ts` — FOUND, `startFlow()` contains the recording window + diff/throw.
- `src/engine/element/game.test.ts` — FOUND, `describe('PIT-02', ...)` block present with 4 tests.
- Commit `f4c914a` — FOUND in `git log --oneline --all` (contains Task 1's diff).
- Commit `98c379f` — FOUND in `git log --oneline --all` (Task 2).
