---
phase: 131-serialization-restore-fidelity
plan: 03
subsystem: session
tags: [gamesession, restore, persistence, security, debug-gating, teaching-lockout]

requires:
  - phase: 131-serialization-restore-fidelity
    plan: 01
    provides: audit re-verification (PROC-01) confirming F15/F16 LEGITIMATE with file:line evidence
provides:
  - StoredGameState.teachingDisabled/displayName persistence, mirroring aiConfig's round-trip
  - GameSession.restore() reads teachingDisabled/displayName from storedState instead of hardcoding undefined
  - GameSession.displayName / GameSession.teachingDisabled public getters
  - GameSessionOptions.debugEnabled opt-in (default false) gating registerDebug() customDebug broadcast
  - debugEnabled threaded into PendingActionManager and StateHistory constructors
affects: [session, restore-fidelity, security]

tech-stack:
  added: []
  patterns:
    - "Session-scoped host-policy fields (teachingDisabled, displayName) persist by mirroring the existing aiConfig round-trip: written into storedState at create(), read back in restore()'s constructor call — never via a new persistence mechanism."
    - "Constructor-time-only opt-in flags (teachingDisabled, debugEnabled) are threaded once through the private constructor and never mutated afterward; sub-managers (PendingActionManager, StateHistory) that independently call buildPlayerState receive the flag via an explicit constructor param rather than reaching back into GameSession."

key-files:
  created:
    - src/session/teaching-disabled-persistence.test.ts
    - src/session/debug-data-gating.test.ts
  modified:
    - src/session/types.ts
    - src/session/game-session.ts
    - src/session/pending-action-manager.ts
    - src/session/state-history.ts

key-decisions:
  - "debugEnabled is a GameSession-consumer-only constructor option, not persisted in StoredGameState and not wired to boardsmith dev/CLI (Pitfall 2 of 131-RESEARCH.md) — a restored session always defaults debugEnabled to false regardless of what the original session used."
  - "Added GameSession.displayName/teachingDisabled getters (not in the plan's must_haves artifacts list) because no existing accessor exposed the private fields — required to write a regression test that observes the persisted values without needing a live broadcaster/session setup."

requirements-completed: [RST-02, SEC-04, PROC-02]

duration: 20min
completed: 2026-07-03
---

# Phase 131 Plan 03: Session-Layer Restore Fidelity + Debug Gating Summary

**Persisted `teachingDisabled`/`displayName` through `GameSession.restore()` (mirroring `aiConfig`) and flipped `includeDebugData` to default-`false` across all 10 confirmed call sites with an explicit `debugEnabled` opt-in.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 2 completed (TDD: RED then GREEN)
- **Files modified:** 6 (4 source, 2 new test files)

## Accomplishments

- RST-02/F16 fixed: `StoredGameState.teachingDisabled` and `StoredGameState.displayName` are now written in `create()` and read back in `restore()`'s constructor call — the LOCK-01 anti-cheat lockout and the session display name no longer silently reset after a cold restore/process restart.
- SEC-04/F15 fixed: all 10 hardcoded `includeDebugData: true` call sites across `game-session.ts` (4), `pending-action-manager.ts` (4), and `state-history.ts` (2) now gate on a session-scoped `#debugEnabled` flag that defaults to `false`. `registerDebug()` payloads (`customDebug`) are no longer broadcast to every player/spectator by default.
- Added `GameSessionOptions.debugEnabled` opt-in, threaded through the private constructor into `PendingActionManager` and `StateHistory` (both independently call `buildPlayerState`).
- `stateless-ops.ts` confirmed untouched (Pitfall 1 — already safe, re-verified via `grep -c "includeDebugData" src/session/stateless-ops.ts` returning 0).

## Task Commits

Each task was committed atomically (RED-first TDD):

1. **Task 1: Red-first regression tests** - `f8cab49` (test) — 5 failing / 1 passing, confirmed RED before any fix.
2. **Task 2: Persist teachingDisabled/displayName + default-false debug gating** - `de1f97d` (feat) — both suites GREEN (6/6 passing), full repo suite green (2105/2105).

**Plan metadata:** (this commit, docs)

## RED Output (Task 1, captured before Task 2)

```
FAIL  src/session/debug-data-gating.test.ts > SEC-04 > getState() omits customDebug by default
  AssertionError: expected { secret: 'top-secret-deck-order' } to be undefined

FAIL  src/session/teaching-disabled-persistence.test.ts > teachingDisabled: true set at create() is still true after restore()
  AssertionError: promise resolved "undefined" instead of rejecting

FAIL  src/session/teaching-disabled-persistence.test.ts > displayName set at create() survives restore()
  AssertionError: expected undefined to be 'Locked Test Table'

FAIL  src/session/teaching-disabled-persistence.test.ts > documents the pre-fix behavior ...
  AssertionError: expected undefined to be true

Test Files  2 failed (2)
     Tests  5 failed | 1 passed (6)
```

(The 1 passing test — `buildPlayerState() includes customDebug when the session is created with
debugEnabled: true` — passed incidentally even before the fix: the pre-fix code always defaulted
`includeDebugData` to `true` regardless of the (not-yet-existent) `debugEnabled` option, so a
session "created with debugEnabled: true" still got `customDebug` in its state — for the wrong
reason. It is not evidence the bug was absent; the other 4 assertions confirm the real defect,
including `buildPlayerState() omits customDebug by default`, which failed because the old code
unconditionally included debug data.)

## Files Created/Modified

- `src/session/types.ts` - Added `teachingDisabled?: boolean` / `displayName?: string` to `StoredGameState`.
- `src/session/game-session.ts` - `create()` writes both fields into `storedState`; `restore()` reads them instead of hardcoding `undefined` for constructor args 6/11; added `displayName`/`teachingDisabled` public getters; added `GameSessionOptions.debugEnabled`, `#debugEnabled` private field, threaded into the constructor and all 4 local `includeDebugData` sites and into `PendingActionManager`/`StateHistory` construction.
- `src/session/pending-action-manager.ts` - Added `debugEnabled` constructor param (default `false`), gated its 4 `includeDebugData: true` sites on it.
- `src/session/state-history.ts` - Added `debugEnabled` constructor param (default `false`), gated its 2 `includeDebugData: true` sites on it.
- `src/session/teaching-disabled-persistence.test.ts` - RST-02 regression suite (3 tests).
- `src/session/debug-data-gating.test.ts` - SEC-04 regression suite (3 tests).

## Decisions Made

- Threaded `debugEnabled` as a new trailing constructor parameter on `GameSession`'s private constructor (after `onPersistenceError`) rather than inserting it mid-list, since only two call sites exist (`create()`/`restore()`) and both are within this file — avoids any positional-argument risk to external callers (there are none; the constructor is private).
- `restore()` deliberately does NOT accept a `debugEnabled` parameter — `debugEnabled` is a create()-time-only opt-in for trusted local consumers (dev harness), consistent with Pitfall 2's narrowing that this fix stays a `GameSession`-consumer API and does not persist or get restored.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing accessor] Added `GameSession.displayName`/`GameSession.teachingDisabled` getters**
- **Found during:** Task 1 (writing the regression tests)
- **Issue:** Neither `#displayName` nor `#teachingDisabled` had any public accessor. `#displayName` was previously write-only (assigned in the constructor, only ever read by `LobbyManager` at `create()` time — never at `restore()` time even before this fix). Without a getter, the RST-02 regression test would have needed to indirectly probe teaching-lockout behavior via `requestHint()` (done) but had no way at all to observe `displayName` post-restore.
- **Fix:** Added two one-line getters mirroring the existing `gameType`/`playerCount`/`playerNames` accessor pattern.
- **Files modified:** `src/session/game-session.ts`
- **Commit:** `de1f97d` (part of Task 2)

---

**Total deviations:** 1 auto-fixed (Rule 2 — missing accessor, necessary for the fix to be testable/observable).
**Impact on plan:** No scope creep — the getters are a minimal, additive API surface required to prove the persistence fix, matching the plan's own "displayName set at create() survives GameSession.restore()" truth which has no other observable signal in the existing codebase.

## Issues Encountered

None. `requestHint()` is declared `async`, so the throw inside it (when `teachingDisabled` is true) surfaces as a promise rejection rather than a synchronous throw — the RST-02 test uses `await expect(...).rejects.toThrow(...)` accordingly.

## User Setup Required

None - no external service configuration required.

## Verification

- `grep -n "teachingDisabled\|displayName" src/session/types.ts` shows both fields on `StoredGameState`.
- `grep -rn "includeDebugData: true" src/session/` returns zero matches (was 10).
- `grep -c "includeDebugData" src/session/stateless-ops.ts` is 0 (file untouched).
- `GameSessionOptions.debugEnabled?: boolean` present.
- Both regression suites GREEN (6/6).
- Full repo test suite: 2105/2105 passing (164 test files).
- `npx tsc --noEmit` shows only pre-existing, unrelated errors (test-file looseness documented as tech debt in PROJECT.md) — none in the 6 files this plan touched.

## Next Phase Readiness

RST-02 and SEC-04 (F16, F15) are closed at the session layer. This plan's fix is independent of 131-02's zone-visibility/onEnter-onExit engine-layer fixes (same phase, different root cause per PROJECT.md's roadmap notes). Ready for 131-04/131-05 to continue the phase's remaining findings, and for the eventual GAMES migration phase (138) to re-vendor MERC / re-verify example games against any session-layer API surface changes (`GameSessionOptions.debugEnabled`, new getters — both additive, non-breaking).

---
*Phase: 131-serialization-restore-fidelity*
*Completed: 2026-07-03*

## Self-Check: PASSED

All created/modified files verified present; both task commits (`f8cab49`, `de1f97d`) verified in git log.
