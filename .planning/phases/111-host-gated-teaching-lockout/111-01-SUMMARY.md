---
phase: 111
plan: "01"
subsystem: session
tags: [teaching-lockout, session, types, tdd]
dependency_graph:
  requires: []
  provides: [GameSessionOptions.teachingDisabled, PlayerGameState.teachingDisabled, session-lockout-guards]
  affects: [src/session/game-session.ts, src/session/types.ts, src/session/teaching.test.ts]
tech_stack:
  added: []
  patterns: [fail-loud guards, post-buildPlayerState broadcast injection, TDD red-green]
key_files:
  created: []
  modified:
    - src/session/game-session.ts
    - src/session/types.ts
    - src/session/teaching.test.ts
decisions:
  - "D-01: teachingDisabled is a top-level GameSessionOptions field, not inside gameOptions, preventing name collision with game-defined options"
  - "D-05: guards throw 'Teaching features are disabled for this session.' (singular literal string — discoverable as the lockout error)"
  - "D-06: exitTutorial/advanceTutorial/skipTutorial not guarded — exiting is always safe"
  - "D-03: state.teachingDisabled injected unconditionally (both true and false) post-buildPlayerState, keeping buildPlayerState pure"
metrics:
  duration: "3 minutes"
  completed: "2026-06-30"
  tasks_completed: 2
  files_modified: 3
---

# Phase 111 Plan 01: Host-Gated Teaching Lockout — Session Layer Summary

**One-liner:** Session-level `teachingDisabled` boolean threads from `GameSessionOptions` through constructor to four fail-loud op guards and unconditional broadcast reflection into `PlayerGameState`.

## What Was Built

### Task 1: teachingDisabled config threading + fail-loud guards (TDD RED → GREEN)

**RED commit:** `be2c651` — 7 failing tests for guards and broadcast reflection.

**GREEN commit:** `4984fc2` — implementation passing all 34 tests.

**`src/session/GameSessionOptions`** — new `teachingDisabled?: boolean` field (separate from `gameOptions`, D-01).

**`GameSession` private field** — `#teachingDisabled = false`, set in constructor from the option (`teachingDisabled ?? false`), never toggled mid-session.

**Constructor threading** — `create()` destructures `teachingDisabled` and passes it as the 11th constructor argument (mirrors `botAIConfig` pattern). `restore()` is unchanged (flag is session-creation policy, not persisted state).

**Four fail-loud guards** — each throws `'Teaching features are disabled for this session.'` at method entry, before any state mutation:
- `requestHint(seat)` — before the flowState/canSeatAct check
- `setHeatmapVisible(seat, visible)` — before the `!visible` early-return (so crafted `visible:false` is also rejected, T-111-01)
- `startDemo()` — before the `#demoMode` idempotency check and before saving/replacing the AI controller
- `startTutorial(seat)` — before `#tutorialController.start(seat)`

**Intentionally NOT guarded** — `exitTutorial`, `advanceTutorial`, `skipTutorial` (D-06).

### Task 2: broadcast reflection + cross-layer trace test

**`PlayerGameState.teachingDisabled?: boolean`** added to `src/session/types.ts` alongside the other transient teaching fields (`hint`, `heatmap`, `narration`, `isDemoRunning`, `hasTutorial`).

**Broadcast injection seam** — `state.teachingDisabled = this.#teachingDisabled` injected unconditionally after all other teaching fields in `GameSession.broadcast()` (D-03). Both `true` and `false` are emitted so reconnecting clients and second windows always read the authoritative session value.

**Cross-layer trace tests** — two tests confirm the config → session → broadcast chain:
1. `makeLockedSession()` → broadcast → every seat's `state.teachingDisabled === true`
2. `makeSession()` (no flag) → broadcast → `state.teachingDisabled === false`

## Verification

```
npm test -- src/session/teaching.test.ts   # 34 tests, all pass (was 27; +7 new)
npm test -- src/session/                   # 301 tests, all pass across 29 files
npx eslint src/session/game-session.ts src/session/types.ts  # clean
```

## Deviations from Plan

None — plan executed exactly as written.

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes introduced. The fail-loud guards are the mitigation for T-111-01 (server-side enforcement of host policy). `state.teachingDisabled` in broadcast is the mitigation for T-111-02 (single source of truth for client gating). Both were in scope and planned.

## Self-Check: PASSED

- `src/session/game-session.ts` — modified (contains `teachingDisabled`)
- `src/session/types.ts` — modified (contains `teachingDisabled`)
- `src/session/teaching.test.ts` — modified (7 new tests)
- Commits: `be2c651` (test RED), `4984fc2` (feat GREEN) — both confirmed in `git log`
