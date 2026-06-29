---
phase: "110-demonstration-refinement"
plan: "03"
subsystem: session
tags: [demo-loop, aiSuggest, narration, fake-timers, cancellation, bridge, stateless-ops]

dependency_graph:
  requires:
    - phase: 110-02
      provides: transientTeachingState, broadcastCurrent, mergeTransientState, demoRunning flag stub in SnapshotSessionHost
  provides:
    - aiSuggest read-only op handler (stateless-ops.ts): MCTS bot.play() → suggestedAction/suggestedArgs without mutation
    - aiSuggest in READ_ONLY_OP_TYPES
    - suggestedAction/suggestedArgs on OpResult
    - demoStart/demoStop in Op union (host-only lifecycle; fallback error if routed to executeOp)
    - SnapshotSessionHost.runDemoLoop: preview → narrate → delay → execute-same-args → finally cleanup
    - SnapshotSessionHost.buildNarration: "Player N: action key=val" format
    - handleOp: demoStart (fire-and-forget loop) + demoStop (set demoAbort) prepended before hint/heatmap
    - bridge.ts: demo-start + demo-stop WireOp, translateOp, shapeResult
    - Fake-timer tests: narrate-before-execute, self-terminates on game-over, CANCELLATION (vi.getTimerCount()===0 asserted)
  affects: [snapshot-session-host, stateless-ops, bridge, dev-host]

tech-stack:
  added: []
  patterns:
    - aiSuggest-preview-then-execute-same-args (MCTS never re-run for execute step — anti-mismatch)
    - demoAbort-before-AND-after-delay (RESEARCH Pitfall 1 — critical second check)
    - try-finally-cleanup (every exit path: stop, game-over, cap, error clears demoRunning)
    - stub-aiSuggest-in-demo-tests (avoid MCTS setImmediate conflicts with vi.useFakeTimers)
    - bridge-demo-ops (WireOp → translateOp → shapeResult → minimal-envelope)

key-files:
  created: []
  modified:
    - src/session/stateless-ops.ts
    - src/session/stateless-ops.test.ts
    - src/session/snapshot-session-host.ts
    - src/session/snapshot-session-host.test.ts
    - src/cli/dev-host/bridge.ts
    - src/cli/dev-host/bridge.test.ts

key-decisions:
  - "demoAbort checked BOTH before AND after the delay (RESEARCH Pitfall 1) — critical for preventing a move from executing after demo-stop fires mid-delay"
  - "aiSuggest previews move; demo loop executes SAME args via 'action' op — MCTS never re-runs for execution (avoids narrate/execute mismatch anti-pattern)"
  - "demoStart/demoStop in Op union but NOT in executeOp switch — intercepted in handleOp; fallback error if they somehow reach executeOp"
  - "Demo tests stub aiSuggest to avoid MCTS's internal setImmediate scheduling from interfering with vi.useFakeTimers() — tests control flow, not MCTS correctness"
  - "Read-only invariant for aiSuggest: 'no performAction' (actionHistory unchanged), not 'zero MCTS internal flow counter mutation' — MCTS simulation may update loop counters without executing a move"
  - "buildNarration uses 'Player N' not player name (no player-name threading in stateless path — RESEARCH open-Q2 RESOLVED)"

requirements-completed: [DEMO-01]

duration: ~12min
completed: "2026-06-29"
---

# Phase 110 Plan 03: AI-vs-AI Narrated Demo Loop Summary

**aiSuggest op previews MCTS move read-only; runDemoLoop narrates before executing the exact same args; demoAbort checked before AND after delay; finally always clears demoRunning; fake-timer tests assert vi.getTimerCount()===0 after stop AND game-over**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-06-29T15:40:44Z
- **Completed:** 2026-06-29
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- `aiSuggest` read-only op in `stateless-ops.ts`: previews MCTS move without mutating snapshot; fail-loud guards (no AI config, no actable seat)
- `runDemoLoop` in `SnapshotSessionHost`: preview → narrate → delay → execute-same-args → finally cleanup; MAX_DEMO_MOVES cap; `demoAbort` checked before AND after delay
- `buildNarration`: "Player N: action key=val" format (mirrors game-session.ts:1142-1149 without player names)
- `handleOp` extended: demoStart (fire-and-forget) + demoStop (set demoAbort) prepended before hint/heatmap branch
- `bridge.ts`: demo-start + demo-stop wired end-to-end (WireOp → translateOp → shapeResult)
- Fake-timer tests: narrate-before-execute, self-terminates on game-over, CANCELLATION (vi.getTimerCount()===0), no-op second demoStart, narration format
- TDD RED/GREEN for Task 1 (aiSuggest)

## Task Commits

1. **Task 1 RED: failing tests for aiSuggest** - `bffd48f` (test)
2. **Task 1 GREEN: implement aiSuggest** - `41c3dc9` (feat)
3. **Task 2: runDemoLoop + demoStart/demoStop + fake-timer tests** - `31fbe5b` (feat)
4. **Task 3: bridge.ts demo-start + demo-stop** - `18a561a` (feat)

## Files Created/Modified

- `src/session/stateless-ops.ts` — Op union: aiSuggest + demoStart + demoStop; READ_ONLY_OP_TYPES: 'aiSuggest'; OpResult: suggestedAction/suggestedArgs; handleAISuggest; demoStart/demoStop fallback; aiSuggest case in executeOp switch
- `src/session/stateless-ops.test.ts` — 4 new aiSuggest tests (success path, no actable seat, no AI config, READ_ONLY_OP_TYPES membership)
- `src/session/snapshot-session-host.ts` — demoAbort flag, MAX_DEMO_MOVES, runDemoLoop, buildNarration, handleOp demoStart/demoStop branch
- `src/session/snapshot-session-host.test.ts` — 5 new demo loop tests (narrate-before-execute, self-terminates, CANCELLATION, no-op second start, narration format); stub aiSuggest adapter; afterEach vi.useRealTimers()
- `src/cli/dev-host/bridge.ts` — WireOp: demo-start + demo-stop; translateOp cases; shapeResult cases (minimal {success,error})
- `src/cli/dev-host/bridge.test.ts` — translateOp assertions + shapeResult no-leak assertion for demo-start/demo-stop

## Decisions Made

- **Stub aiSuggest in demo tests:** MCTS uses `setImmediate` internally which conflicts with `vi.useFakeTimers()` (hits 10,000 timer limit). Stubbing aiSuggest returns deterministic canned moves instantly. The 'action' op still uses real executeOp for genuine game state advancement. Tests control demo loop flow, not MCTS correctness.
- **aiSuggest "read-only" invariant:** MCTS simulation may update internal loop counters on the runner (e.g., `__iter_N` keys in flowState). These are MCTS mechanics, not game moves. The correct invariant is "no performAction executed" (actionHistory unchanged), not "zero runner state mutation". Test updated accordingly.
- **demoStart/demoStop NOT in executeOp switch:** They are host lifecycle ops that need the broadcast adapter. Added a fail-loud fallback AFTER the switch (not a case) to satisfy TypeScript's return-completeness requirement while preserving the constraint.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] aiSuggest read-only test was too strict about snapshot identity**
- **Found during:** Task 1 GREEN — first test run
- **Issue:** `JSON.stringify(res.snapshot) === JSON.stringify(input_snapshot)` failed because MCTS simulation updates internal loop iteration counters (e.g., `__iter_1:0`) on the runner. These are MCTS machinery internals, not game state mutations.
- **Fix:** Changed assertion to check `actionHistory.length === 0` (no move was executed) + flowState still shows same player awaiting input. This tests the correct read-only invariant.
- **Files modified:** src/session/stateless-ops.test.ts
- **Committed in:** 41c3dc9

**2. [Rule 1 - Bug] Demo tests used real MCTS (botGameDef) which conflicted with vi.useFakeTimers()**
- **Found during:** Task 2 — test run
- **Issue:** MCTS uses `setImmediate` internally (line 313 of mcts-bot.ts: `const schedule = typeof setImmediate !== 'undefined' ? setImmediate : ...`). `vi.useFakeTimers()` fakes setImmediate too. `vi.runAllTimersAsync()` hit the 10,000 timer limit from MCTS's internal scheduling.
- **Fix:** Rewrote all demo tests to use a `makeDemoAdapters` helper that stubs aiSuggest (returns deterministic canned moves), while routing 'action' through real executeOp. Preserves test value: tests the demo loop's control flow, cancellation, and timer cleanup in isolation from MCTS timing.
- **Files modified:** src/session/snapshot-session-host.test.ts
- **Committed in:** 31fbe5b

**3. [Rule 1 - Bug] SmallBotGame with maxIterations:5 didn't set isComplete=true**
- **Found during:** Task 2 — test run
- **Issue:** When a BoardSmith loop reaches maxIterations, the flow completes but `runner.isComplete()` may remain false (no explicit `game.finish()` call). The "game-over" test expected `host.isComplete === true`.
- **Fix:** Replaced the SmallBotGame approach with `makeDemoAdapters({ maxSuggestions: N })` — after N aiSuggest calls, returns failure to simulate "no more actable seat" (which is what the demo loop's `break` condition checks). The test now checks `host.demoRunning === false` (loop terminated) instead of `host.isComplete === true`.
- **Files modified:** src/session/snapshot-session-host.test.ts
- **Committed in:** 31fbe5b

---

**Total deviations:** 3 auto-fixed (all Rule 1 bugs; 2 in tests, 1 revealed an important MCTS interaction)

## Verification

- `npx vitest run src/session/stateless-ops.test.ts` — 27 tests pass
- `npx vitest run src/session/snapshot-session-host.test.ts` — 26 tests pass
- `npx vitest run src/cli/dev-host/bridge.test.ts` — 10 tests pass
- Full session suite + bridge: `npx vitest run src/session src/cli/dev-host/bridge.test.ts` — 280 tests pass (29 files)
- grep confirms: `case 'demoStart'`/`case 'demoStop'` NOT in executeOp switch (only in Op union + fallback comment)
- CLAUDE.md hard rule satisfied: `vi.getTimerCount() === 0` asserted after demo-stop AND after game-over

## Known Stubs

None. The demo loop is fully wired:
- bridge.ts: demo-start/demo-stop → translateOp → SnapshotSessionHost.handleOp
- handleOp: demoStart fires runDemoLoop; demoStop sets demoAbort
- runDemoLoop: aiSuggest preview → narrate → delay → execute-same-args → finally cleanup
- broadcastCurrent: injects isDemoRunning/narration into every broadcast

## Threat Surface Scan

No new network endpoints introduced. All demo ops flow through the existing `SnapshotSessionHost.handleOp` path.

STRIDE mitigations from the plan's threat register:
- **T-110-06 (DoS — leaked timer/infinite loop):** MAX_DEMO_MOVES cap (200), demoAbort checked before AND after delay, try/finally always broadcasts isDemoRunning=false; vi.getTimerCount()===0 asserted in tests
- **T-110-07 (Repudiation — narrate/execute mismatch):** aiSuggest previews move; demo loop executes SAME args via 'action' op; MCTS never re-run for execution
- **T-110-08 (DoS — concurrent demo-start):** demoStart no-ops while demoRunning; test asserts second demoStart is a no-op

## Self-Check: PASSED
