---
phase: 107-ai-assisted-teaching
plan: "03"
subsystem: session
tags: [ai, mcts, demo-mode, narration, tdd, teaching, session-layer]
dependency_graph:
  requires:
    - phase: 107-02
      provides: [#narrationText field on GameSession, broadcast injection, teaching.test.ts fixture]
  provides:
    - onBeforeMove optional 4th param on AIController.checkAndPlay() — narration seam between MCTS compute and move execution
    - GameSession.startDemo(options?) — all-seats AI override with narration hook + configurable delay
    - GameSession.stopDemo() — restore original AIController, clear narration, broadcast
    - GameSession.isDemoRunning getter (boolean)
    - ai-controller.test.ts — 6 tests covering call order, timing, error propagation, default path
  affects:
    - src/ui/components/GameShell.vue (Plan 107-04 — calls stopDemo on game-over/unmount)
    - src/ui/components/ControlsMenu.vue (Plan 107-04 — emits 'demo-toggle')
tech-stack:
  added: []
  patterns:
    - onBeforeMove hook pattern — optional async callback between MCTS compute and move execution; errors propagate through finally so #thinking always resets
    - Demo mode save/restore pattern — #savedAIController preserves original controller for clean stopDemo() restore
    - Transient narration clear pattern — #narrationText set by onBeforeMove hook, cleared in onMove callback after move broadcasts (one-cycle transient)
key-files:
  created:
    - src/session/ai-controller.test.ts
  modified:
    - src/session/ai-controller.ts
    - src/session/game-session.ts
    - src/session/teaching.test.ts
key-decisions:
  - "onBeforeMove as optional 4th param (not a config option) — stays zero-cost to non-demo AI turns; type signature matches existing onMove pattern"
  - "narrationText cleared in onMove callback (after move) not in onBeforeMove (before) — ensures announcement shows during the delay window and disappears once the move lands"
  - "Demo mode uses existing AI level from storedState.aiConfig (or 'medium' default) — reuses existing MCTS, zero new training/weights"
  - "stopDemo() broadcasts immediately after clearing state — clients see clean state synchronously; no stale narration on the next broadcast cycle"
requirements-completed: [AI-02]
duration: ~8 minutes
completed: "2026-06-26"
---

# Phase 107 Plan 03: Demo Mode + onBeforeMove Hook Summary

**`onBeforeMove` narration seam in AIController + GameSession all-seats demo mode with configurable delay and narrator, cleanly restoring the original controller on stop.**

## Performance

- **Duration:** ~8 minutes
- **Started:** 2026-06-26T16:46:00Z
- **Completed:** 2026-06-26T16:49:20Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 2 (ai-controller.ts, game-session.ts)
- **Files created:** 1 (ai-controller.test.ts); modified: 1 (teaching.test.ts)
- **Tests added:** 6 (ai-controller.test.ts) + 6 (teaching.test.ts demo suite) = 12
- **Tests total:** 228

## Accomplishments

- Added `onBeforeMove?(action, player, args)` optional 4th parameter to `AIController.checkAndPlay()`: awaited between `bot.play()` and `onMove()`; default path (no hook) byte-for-byte unchanged; `#thinking` resets in `finally` on error
- Implemented `GameSession.startDemo(options?)`: saves `#aiController`, replaces with all-seats `AIController`, builds narration closure (custom `narrator` fn or default `"Name: action key=val"`), sets `#narrationText` + broadcasts before the delay, awaits `#demoDelay` (default 1200ms), then move executes
- Implemented `GameSession.stopDemo()`: restores saved controller, clears narration hook and text, sets `#demoMode = false`, broadcasts clean state
- Wired `this.#onBeforeMove` as the 4th `checkAndPlay` arg in `#checkAITurn()`; `#narrationText` cleared in `onMove` callback after the move lands (transient one-cycle announcement)
- Narration text is plain string (no HTML, built from engine-controlled `actionName + args`); rendered via Vue text interpolation — T-107-06 mitigated

## Task Commits

1. **Task 1: onBeforeMove hook in AIController.checkAndPlay()** — `8e379a0` (feat)
2. **Task 2: GameSession demo mode (startDemo/stopDemo) + narration wiring** — `f69f83f` (feat)

## Files Created/Modified

- `src/session/ai-controller.ts` — Added optional `onBeforeMove?` 4th param to `checkAndPlay()`; inserted `if (onBeforeMove) await onBeforeMove(...)` between `bot.play()` and `onMove()`
- `src/session/ai-controller.test.ts` — New: 6 tests (call count, call order, delay ordering, error + thinking reset, default path, args forwarding)
- `src/session/game-session.ts` — Added `#demoMode`, `#savedAIController`, `#demoDelay`, `#onBeforeMove` fields; `startDemo()`, `stopDemo()`, `isDemoRunning` getter; wired `#onBeforeMove` in `#checkAITurn()`; clear `#narrationText` post-move
- `src/session/teaching.test.ts` — Added 6 demo mode tests (isDemoRunning default/start/stop, narration format, stopDemo restore + clear)

## Decisions Made

1. **`onBeforeMove` as optional 4th param (not config)** — Matches the `onMove` callback pattern already in `checkAndPlay`. Zero overhead for non-demo turns (undefined check is a single branch). Type is explicit and composable.

2. **Narration cleared in `onMove` callback** — The announcement needs to be visible during the delay window and disappear once the move lands on the board. Clearing in `onBeforeMove` would hide it immediately. Clearing in `onMove` (post-move) ensures the transient display is one broadcast cycle: announce → delay → move + clear.

3. **Demo uses existing AI level** — `storedState.aiConfig?.level ?? 'medium'` reuses whatever MCTS difficulty was configured, falling back to medium. No new training, no new weights — AI-02 constraint satisfied.

4. **`stopDemo()` broadcasts synchronously** — After clearing `#narrationText` and restoring `#aiController`, a broadcast flushes the clean state immediately. Avoids a race where a stale narration could appear on the next unrelated broadcast.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — `startDemo`/`stopDemo`/`isDemoRunning` are fully wired. UI layer (GameShell calling `stopDemo` on game-over, ControlsMenu demo-toggle) is deferred to Plan 107-04 per the plan dependency graph.

## Threat Flags

No new threat surface beyond what was planned.

- T-107-06 (XSS via narration): narration text is built from engine-controlled `actionName` + serialized `args` values (strings/numbers). Rendered as plain text (`state.narration = { text: ... }`), never via `v-html`. Plan 04 BoardMessage renders this via Vue text interpolation only.
- T-107-07 (demo override not restored): `stopDemo()` always restores `#savedAIController` and clears `#onBeforeMove`. `#demoMode` flag is the guard; `isDemoRunning` getter exposes it for GameShell unmount (Plan 04).

## Self-Check: PASSED

| Item | Status |
|------|--------|
| src/session/ai-controller.ts — onBeforeMove signature + call site (>=2) | FOUND |
| src/session/ai-controller.test.ts | FOUND |
| src/session/game-session.ts — startDemo | FOUND |
| src/session/game-session.ts — stopDemo | FOUND |
| src/session/game-session.ts — isDemoRunning getter | FOUND |
| src/session/game-session.ts — #onBeforeMove wired in #checkAITurn | FOUND |
| src/session/teaching.test.ts — demo suite (6 tests) | FOUND |
| commit 8e379a0 (Task 1) | FOUND |
| commit f69f83f (Task 2) | FOUND |
| 228 tests pass | VERIFIED |
| No new dependencies | VERIFIED |
