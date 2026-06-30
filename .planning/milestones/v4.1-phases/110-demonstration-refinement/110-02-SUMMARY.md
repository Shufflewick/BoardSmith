---
phase: "110-demonstration-refinement"
plan: "02"
subsystem: session
tags: [teaching, hint, heatmap, mcts, bridge, stateless-ops, transient-state]

dependency_graph:
  requires:
    - phase: 110-01
      provides: transientTeachingState, broadcastCurrent, mergeTransientState substrate in SnapshotSessionHost
  provides:
    - handleHint op handler (stateless-ops.ts): MCTS bot.play() + DEST_ARGS target extraction → hintAnnotation
    - handleHeatmapToggle op handler (stateless-ops.ts): bot.playWithStats() + cell-dedup → heatmapUpdate; visible=false short-circuits without bot
    - hint/heatmapToggle Op union variants
    - hintAnnotation/heatmapUpdate on OpResult
    - ai?: AIConfig on GameDefinitionLike
    - SnapshotSessionHost.handleOp: hint/heatmapToggle branch stores into transientTeachingState + calls broadcastCurrent()
    - hint clears on seat's next successful action; all clears on undo/debugRewind
    - demoRunning guard: rejects hint/heatmap while demo is running with actionable error
    - bridge.ts: hint + heatmap-toggle WireOp, translateOp, shapeResult cases
    - dev.ts: ai: gameDefinition.ai threaded into gameDef
  affects: [snapshot-session-host, stateless-ops, bridge, dev-host, 110-03-demo-loop]

tech-stack:
  added: []
  patterns:
    - three-file-wire-op (bridge.ts + stateless-ops.ts + snapshot-session-host.ts)
    - visible=false-short-circuit (no MCTS for heatmap off)
    - cell-dedup-by-key (id:/notation:/name: key, highest normalizedValue wins, one isBest=true)
    - transient-store-then-broadcastCurrent (teaching ops bypass apply, use broadcastCurrent)
    - demoRunning-guard (concurrent MCTS protection, load-bearing once Plan 03 lands)

key-files:
  created: []
  modified:
    - src/session/stateless-ops.ts
    - src/session/stateless-ops.test.ts
    - src/cli/commands/dev.ts
    - src/session/snapshot-session-host.ts
    - src/session/snapshot-session-host.test.ts
    - src/cli/dev-host/bridge.ts
    - src/cli/dev-host/bridge.test.ts

key-decisions:
  - "heatmapToggle visible=false short-circuits immediately (no bot call) — mirrors game-session.ts:1041-1043"
  - "hint/heatmapToggle use broadcastCurrent() not apply() — these ops don't change game state, only transient annotations"
  - "demoRunning guard added now (harmless until Plan 03): fail-loud with actionable error to prevent concurrent MCTS if demo is running"
  - "hintTargetFromMove added to BotGame test fixture (direction → notation) so heatmap entries are extractable in tests"
  - "shapeResult for hint/heatmap-toggle returns only {success,error} — results flow via game_state broadcasts (RESEARCH Pitfall 7)"

requirements-completed: [DEMO-01]

duration: ~12min
completed: "2026-06-29"
---

# Phase 110 Plan 02: Hint + Heatmap Ops Summary

**hint op runs MCTS bot.play() + extracts board target; heatmapToggle runs playWithStats() + deduplicates by cell key; both store results in SnapshotSessionHost transientTeachingState and re-broadcast; hint clears on next action, all clears on undo**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-06-29
- **Completed:** 2026-06-29
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments

- `handleHint` + `handleHeatmapToggle` op handlers in `stateless-ops.ts` with fail-loud guards and MCTS integration
- `SnapshotSessionHost.handleOp` extended with teaching-op branch: store → broadcastCurrent; clear-on-action; clear-on-undo
- `bridge.ts` hint + heatmap-toggle wired end-to-end (WireOp → translateOp → shapeResult)

## Task Commits

1. **Task 1: hint + heatmap op handlers in stateless-ops.ts + dev.ts ai threading** - `d6a03c3` (feat)
2. **Task 2: handleOp transient-store + clear-on-action/undo in SnapshotSessionHost** - `6a8c72b` (feat)
3. **Task 3: bridge.ts hint + heatmap-toggle wire ops + bridge tests** - `be5bdd6` (feat)

## Files Created/Modified

- `src/session/stateless-ops.ts` — Added hint/heatmapToggle Op variants, hintAnnotation/heatmapUpdate on OpResult, ai?: AIConfig on GameDefinitionLike, handleHint + handleHeatmapToggle functions, executeOp cases
- `src/session/stateless-ops.test.ts` — Added AIConfig import + 4 test cases for hint/heatmap behavior (success + fail-loud guards + visible=false short-circuit)
- `src/cli/commands/dev.ts` — Added `ai: gameDefinition.ai` to gameDef object
- `src/session/snapshot-session-host.ts` — Extended handleOp with hint/heatmapToggle branch: demoRunning guard, executeOp delegation, transientTeachingState merge, broadcastCurrent, clear-on-action, clear-on-undo
- `src/session/snapshot-session-host.test.ts` — Added hintTargetFromMove to BotGame fixture + 6 new integration tests
- `src/cli/dev-host/bridge.ts` — Added hint/heatmap-toggle to WireOp union, translateOp cases, shapeResult cases
- `src/cli/dev-host/bridge.test.ts` — Added translateOp assertions for hint/heatmap-toggle + shapeResult no-leak assertion

## Decisions Made

- **heatmapToggle visible=false short-circuits** before checking for ai config or running the bot, mirroring `game-session.ts:1041-1043`. This means even games without AI config can toggle heatmap off cleanly.
- **broadcastCurrent() not apply()** for hint/heatmapToggle: these ops compute transient annotations but do NOT change game state. Using `apply()` would redundantly re-store the snapshot and run `persist`. `broadcastCurrent()` re-broadcasts the cached `lastPlayerViews` with the new transient state merged in.
- **demoRunning guard** added in Task 2 even though `demoRunning` is always `false` until Plan 03. The guard is harmless now and load-bearing once the demo loop lands.
- **BotGame test fixture gets hintTargetFromMove**: Without this, the `direction` arg ('left'/'right') is not in DEST_ARGS and no cell refs are extractable, so heatmap entries would always be empty. Adding `hintTargetFromMove: (move) => ({ notation: move.args.direction })` makes the tests meaningful.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test fixture: noAiDef still carried ai field via spread**
- **Found during:** Task 1 — first test run
- **Issue:** `const noAiDef: GameDefinitionLike = { ...botGameDef }` still has `ai: botGameAI` via spread, so the no-AI test would pass when it should fail
- **Fix:** Changed to destructured exclusion: `const { ai: _ai, ...noAiDef } = botGameDef`
- **Files modified:** src/session/stateless-ops.test.ts
- **Verification:** Test now correctly asserts `res.success === false` with protocol error
- **Committed in:** d6a03c3

**2. [Rule 1 - Bug] BotGame direction arg not in DEST_ARGS → heatmap entries empty**
- **Found during:** Task 1 — heatmapToggle visible=true test got 0 entries
- **Issue:** BotGame action uses `direction: 'left'/'right'` key. The DEST_ARGS fallback checks `['to','destination','target','square','cell','position']` — `direction` is not there. `playWithStats()` stats had no extractable cell refs, so byCell map was empty and entries=[]
- **Fix:** Added `hintTargetFromMove` to `botGameAI` (and the snapshot-session-host.test.ts BotGame fixture) that maps `move.args.direction` to `{ notation: dir }`
- **Files modified:** src/session/stateless-ops.test.ts, src/session/snapshot-session-host.test.ts
- **Verification:** heatmapToggle visible=true now returns entries.length > 0 with exactly one isBest
- **Committed in:** d6a03c3, 6a8c72b

---

**Total deviations:** 2 auto-fixed (both Rule 1 bugs in test fixtures)
**Impact on plan:** Both fixes were in tests, not production code. Production handlers are correct as designed.

## Issues Encountered

None — implementation followed the research and patterns exactly.

## Verification

- `npx vitest run src/session/stateless-ops.test.ts` — 23 tests pass
- `npx vitest run src/session/snapshot-session-host.test.ts` — 21 tests pass (14 existing + 7 new)
- `npx vitest run src/cli/dev-host/bridge.test.ts` — 9 tests pass
- Full session suite + bridge: `npx vitest run src/session src/cli/dev-host/bridge.test.ts` — 270 tests pass
- grep confirms: hint/heatmapToggle NOT in READ_ONLY_OP_TYPES
- grep confirms: shapeResult for hint/heatmap-toggle returns only {success,error} (no playerViews)

## Known Stubs

None. Hint and heatmap ops are fully wired end-to-end: bridge → executeOp → transientTeachingState → broadcastCurrent. The `demoRunning` guard is intentionally active but harmless until Plan 03 adds the demo loop.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. The hint and heatmap ops flow through the existing `SnapshotSessionHost.handleOp` path which already validates seat membership. Threat mitigations T-110-03 and T-110-04 from the plan's threat register are implemented:
- T-110-03 (Tampering — hint seat param): Range-check seat (1..playerCount) + canSeatAct guard before MCTS run
- T-110-04 (DoS — concurrent MCTS): demoRunning guard rejects hint/heatmap with actionable error

## Next Phase Readiness

- Plan 03 (demo loop) can now implement `demoStart`/`demoStop` in `SnapshotSessionHost` — the `demoRunning` flag, `narrationText`, and `broadcastCurrent()` infrastructure is ready
- The `demoRunning` guard in `handleOp` is already in place and will correctly block hint/heatmap during a running demo

## Self-Check: PASSED
