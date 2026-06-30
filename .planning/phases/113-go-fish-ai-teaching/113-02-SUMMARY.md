---
phase: 113-go-fish-ai-teaching
plan: "02"
subsystem: go-fish/tests
tags: [integration-test, demo, narration, ai-vs-ai, gfai-02]
dependency_graph:
  requires: [113-01-SUMMARY]
  provides: [GFAI-02]
  affects: []
tech_stack:
  added: []
  patterns: [substrate-demo-test, fake-timers, narrate-before-execute]
key_files:
  created:
    - ~/BoardSmithGames/go-fish/tests/demo.test.ts
  modified: []
decisions:
  - tutorialSetup:true used for deterministic hands (P1:7H,7D,QH; P2:7S) — canned ask { target:2, rank:'7' } legal without randomness
  - aiSuggest stubbed to avoid MCTS setImmediate / vi.useFakeTimers conflict; real 'action' op always delegated to executeOp
  - narrateMove hook added in test adapters (not src/) to produce informative text 'Player N asks for Xs'; allows rank arg to be asserted in narration text
  - findIndex-based ordering assertion for narrationIdx < execStateIdx — not hardcoded index comparison
  - Both seats set as aiSeats for semantic AI-vs-AI; runDemoLoop builds allSeats from playerCount regardless
metrics:
  duration: "~5 minutes"
  completed: "2026-06-30"
  tasks_completed: 1
  tasks_total: 1
  files_created: 1
  files_modified: 0
---

# Phase 113 Plan 02: Go Fish AI-vs-AI Narrated Demo Integration Test Summary

**One-liner:** Integration test proves go-fish AI-vs-AI demo substrate narrates each ask before executing it and stops cleanly with zero orphaned timers.

## What Was Built

Created `~/BoardSmithGames/go-fish/tests/demo.test.ts` — an honest integration test for GFAI-02 that wires `SnapshotSessionHost` to go-fish's real `gameDefinition` via `executeOp` and verifies the three core contracts of the v4.1 demo substrate:

1. **Narrate-before-execute ordering**: A `findIndex`-based scan finds the first narration broadcast (isDemoRunning=true, narration.text set) and asserts it appears at a strictly earlier log index than the first post-execution broadcast (narration cleared). Non-trivially: if `runDemoLoop` executed before narrating, the content assertions at those indices would fail.

2. **Narrated args === executed args**: The 'action' op captures `op.args` into `capturedActionArgs`; the test asserts `capturedActionArgs[0]` deep-equals `CANNED_ARGS`. This proves `runDemoLoop` uses the same `suggestedArgs` object for both `buildNarration()` and the `'action'` op (no narrate/execute mismatch).

3. **Clean demoStop — no orphaned state**: With `delay: 5000`, the loop parks at the pace-gate timer. After `demoStop`, the test asserts `vi.getTimerCount() === 0` immediately (CR-02 synchronous cancel), then drains microtasks and asserts `host.demoRunning === false`, final broadcast has `isDemoRunning: undefined` and `narration: undefined`.

### Test harness design (mirrors Phase 110-03 substrate test)

- `makeDemoAdapters({ maxSuggestions? })`: stubs `aiSuggest` to return `{ aiPlayer:1, suggestedAction:'ask', suggestedArgs:{ target:2, rank:'7' } }`. After `maxSuggestions` calls, returns a failure to let the loop self-terminate. All other ops (including `'action'`) delegate to the real `executeOp(gameDefinition, GO_FISH_OPTIONS, ...)`.
- `broadcastState(log, idx, seat)`: extracts `views[seat-1].state` from a log entry.
- `tutorialSetup: true` game options: P1 holds 7H,7D,QH; P2 holds 7S. The canned ask `{ target:2, rank:'7' }` is legal — P1 has rank '7', P2 has 7S to give.
- `narrateMove` hook in adapters (not in src/): produces `"Player N asks for Xs"` so the assertion can verify the rank arg was captured by the hook (proving args were passed through).

## Deviations from Plan

None — plan executed exactly as written.

The `narrateMove` hook is in the test adapter (not a src/ file change) as permitted by the plan. The hook makes the narration text include the rank being asked for, which makes the narration assertion meaningful and allows verification that args flow through correctly.

## Known Stubs

None — `aiSuggest` is stubbed for the MCTS/fake-timer reason documented in the plan and the substrate test. The 'action' op is never stubbed; genuine go-fish state advances on each execution.

## Self-Check

Files created:
- `~/BoardSmithGames/go-fish/tests/demo.test.ts` — EXISTS (committed as 175b986 in go-fish repo)

Commits in go-fish repo:
- `175b986`: test(113-02): add GFAI-02 narrated AI-vs-AI demo integration test

Test results:
- `npm test -- demo` (go-fish): 2 tests passed
- `npm test -- --run` (go-fish full suite): 63/63 passed
- `npm test -- --run` (BoardSmith): 1708/1708 passed (no src/ changes, expected)

## Self-Check: PASSED
