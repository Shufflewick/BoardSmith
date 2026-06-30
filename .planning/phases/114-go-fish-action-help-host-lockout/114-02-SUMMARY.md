---
phase: 114-go-fish-action-help-host-lockout
plan: "02"
subsystem: go-fish/authoring
tags: [host-lockout, teaching, go-fish, cross-repo, substrate-verification]
dependency_graph:
  requires: [v4.1-phase-111-teachingDisabled-substrate, 114-01-GFHELP-01]
  provides: [GFLOCK-01]
  affects: [go-fish host-lockout, GameSession.teachingDisabled, buildActionMetadata.help]
tech_stack:
  added: []
  patterns: ["makeLockedSession pattern (mirrors teaching.test.ts)", "construction-time teachingDisabled lockout verification"]
key_files:
  created:
    - ~/BoardSmithGames/go-fish/tests/host-lockout.test.ts
  modified: []
key_decisions:
  - "Lockout is construction-time: session created with teachingDisabled:true, never toggled mid-game (mirrors Pitfall 4 from RESEARCH.md)"
  - "HALF B uses createTestGame + buildActionMetadata directly — proves action help is independent of session lockout (D-06)"
  - "CONTROL uses requestHint on seat 2 (not awaiting) to get a different error, proving false-positive isolation"
  - "No BoardSmith src/ changes — lockout substrate is game-agnostic; go-fish benefits without modification"
metrics:
  duration: "~5 minutes"
  completed: "2026-06-30"
  tasks_completed: 1
  files_created: 1
  files_modified: 0
  tests_added: 7
---

# Phase 114 Plan 02: GFLOCK-01 — Host Teaching-Lockout Verification Summary

One-liner: Integration test asserting a `teachingDisabled:true` go-fish session fail-louds on `requestHint`/`startDemo`/`startTutorial` while action help remains unaffected — proving the lockout substrate generalizes to card games without disabling the `ask` help text.

## What Was Built

Created `tests/host-lockout.test.ts` in the go-fish repo. The file mirrors the structure of BoardSmith `src/session/teaching.test.ts:541-617` (`makeLockedSession`) and ControlsMenu LOCK-01-B ("action help survives lockout"). 7 tests:

- **HALF A (3 tests):** On a `teachingDisabled:true` go-fish session, `requestHint(1)` rejects and `startDemo()`/`startTutorial(1)` throw the exact fail-loud error `'Teaching features are disabled for this session.'` — proving the game-agnostic lockout substrate gates go-fish's teaching affordances.

- **HALF B (1 test):** Under the same construction-time lockout, `buildActionMetadata(game, player, ['ask'])['ask'].help` is still the authored non-empty string (the help text added in Plan 01). Proves D-06: action help is NOT a teaching affordance and is never gated by `teachingDisabled`.

- **CONTROL (3 tests):** An unlocked (default) go-fish session does not throw the lockout error for those ops — one fails for a different reason (seat-not-awaiting), one succeeds (demo starts), one catches a non-lockout error. Guards against false positives.

## Tasks

### Task 1: go-fish host-lockout test — ops throw + action help stays

Created `tests/host-lockout.test.ts` with a local `makeLockedSession()` helper and all HALF A / HALF B / CONTROL assertions. No BoardSmith `src/` changes required — the `teachingDisabled` guards are game-agnostic (verified by 7 green tests).

**Commit:** `0f11e87` (go-fish repo)

## Verification

```
cd ~/BoardSmithGames/go-fish && npm test -- lock
Test Files  1 passed (1)
Tests  7 passed (7)

cd ~/BoardSmithGames/go-fish && npm test
Test Files  8 passed (8)
Tests  72 passed (72)

cd /Users/jtsmith/BoardSmith && npm test
Test Files  123 passed (123)
Tests  1708 passed (1708)
```

## Deviations from Plan

None — plan executed exactly as written. The lockout substrate generalized to go-fish with no BoardSmith `src/` changes, as expected.

## Known Stubs

None.

## Threat Flags

None. Test-only additions; no new network endpoints, auth paths, or schema changes.

## Self-Check: PASSED

- [x] `go-fish/tests/host-lockout.test.ts` exists (go-fish repo commit `0f11e87`)
- [x] HALF A: `requestHint`/`startDemo`/`startTutorial` each throw `'Teaching features are disabled for this session.'`
- [x] HALF B: `buildActionMetadata` / `help` present in file; `metadata['ask']?.help` asserted non-empty
- [x] CONTROL: unlocked session assertions present (no lockout error thrown)
- [x] `npm test -- lock` (go-fish): 7/7 green
- [x] `npm test` (go-fish): 72/72 green
- [x] `npm test` (BoardSmith): 1708/1708 green; no `src/` changes
