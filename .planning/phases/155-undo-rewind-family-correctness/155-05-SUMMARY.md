---
requirements-completed: [UNDO-04, PROC-01]
---

# Plan 155-05 Summary — Client Watermark Reset on Detected Rewind (UNDO-04, PROC-01)

**Plan:** 155-05 (execute — client-side defense-in-depth half of UNDO-04: reset
`useAnimationEvents`'s `lastQueuedId`/`lastProcessedId` on a detected rewind)
**Completed:** 2026-07-20
**Result:** PASS — a new, always-published `state.actionCount` (`runner.actionHistory.length`,
unlike the seat-gated `turnStartActionIndex`) is watched by `useAnimationEvents` as a second
source; a DECREASE resets both watermarks to 0 before the incoming `animationEvents` batch is
filtered. Forward-play dedupe is unchanged, and the no-source path is byte-identical to today.
PROC-01's RED-before-GREEN gate satisfied. Full suite green (193/193 files, 2756/2756 tests).

## What was done

1. **Task 1:** Added `actionCount: number` to `PlayerGameState` (`src/session/types.ts`), populated
   unconditionally in `buildPlayerState` (`src/session/utils.ts`) as `runner.actionHistory.length` —
   present for spectators (position 0) and non-acting seats, unlike `turnStartActionIndex`
   (`isMyTurn ? ... : undefined`). Added an assertion in `build-player-state.test.ts` locking in the
   unconditional property across all three viewer types (active seat, non-active seat, spectator).
2. **Task 2 (RED→GREEN):** Wrote three cases in `useAnimationEvents.test.ts` FIRST against
   current, unfixed source: (1) events 1..5 delivered (watermark 5), then an `actionCount` decrease
   followed by a replayed batch of ids 3..4 — these must be delivered but were dropped by the stale
   watermark; (2) forward-play dedupe unaffected by an `actionCount` increase or no-change; (3) with
   no `actionCount` source supplied, behavior is unchanged. Ran and captured the real RED for case 1
   (verbatim below); cases 2 and 3 passed from the start (non-regression guards), as noted in the
   commit message. Implemented: `UseAnimationEventsOptions.actionCount?: () => number | undefined`;
   the `:372` watcher now checks for a decrease as the FIRST thing it does (before the `e.id >
   lastQueuedId` filter) and resets `lastQueuedId`/`lastProcessedId` to 0 on detection.
   `undefined` (source absent, or first observation) is explicitly never treated as a rewind.
3. **Task 3:** Wired the actual production `createAnimationEvents` call site
   (`src/ui/components/GameShell.vue`) with `actionCount: () => state.value?.state?.actionCount`.
   Full suite run green. See Deviations for why this differs from the plan's cited call sites.

## PROC-01 verbatim RED output (Task 2, before any fix)

```
 ❯ src/ui/composables/useAnimationEvents.test.ts (45 tests | 1 failed) 877ms
   × useAnimationEvents > rewind detection via actionCount > replays events after a detected actionCount decrease (would be dropped without the reset) 33ms
     → expected [ 1, 2, 3, 4, 5 ] to deeply equal [ 1, 2, 3, 4, 5, 3, 4 ]

AssertionError: expected [ 1, 2, 3, 4, 5 ] to deeply equal [ 1, 2, 3, 4, 5, 3, 4 ]

- Expected
+ Received

  Array [
    1,
    2,
    3,
    4,
    5,
-   3,
-   4,
  ]

 Test Files  1 failed (1)
      Tests  1 failed | 44 passed (45)
```
Case 1 failed for the real defect: the stale watermark (5) silently dropped the replayed batch's
ids 3 and 4, exactly the "undo eats my animations" symptom from a client's point of view — asserted
on beats delivered to the consumer, not raw watermark integers (PROC-01). Cases 2 and 3 (44 of 45
tests) already passed against the unfixed source, confirming they are non-regression guards, not
part of the RED.

## PROC-01 verbatim GREEN output (Task 2, after the watermark reset)

```
 ✓ src/ui/composables/useAnimationEvents.test.ts (45 tests) 876ms

 Test Files  1 passed (1)
      Tests  45 passed (45)
```

## Verification

- `npx vitest run src/ui/composables/useAnimationEvents.test.ts src/session/build-player-state.test.ts` — both pass (45 + 26 tests).
- `npm test` — **193 files / 2756 tests pass**, up from the pre-plan baseline (193/2752); zero
  regressions.
- `npx vue-tsc --noEmit -p .` — 47 pre-existing errors (baseline, confirmed via `git stash`),
  unchanged by this plan; the one error this plan's own change introduced (`PlayerState` missing
  `actionCount`) was fixed by adding the field to the client-side wire-format type
  (`src/client/types.ts`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Plan's cited `createAnimationEvents` call sites (`ActionPanel.vue:89`,
`AutoRenderer.vue:197`) do not call `createAnimationEvents` — they only `inject()` via
`useAnimationEvents()`**
- **Found during:** Task 3, before any edit.
- **Issue:** Grepped `createAnimationEvents(` across `src/` (excluding tests): the only production
  call site is `src/ui/components/GameShell.vue:353` (also `auto-ui/AutoRenderer.vue:194` has an
  explicit comment: "inject-only, never createAnimationEvents"). `ActionPanel.vue` lives at
  `src/ui/components/auto-ui/ActionPanel.vue`, not the plan's cited
  `src/ui/components/ActionPanel.vue` — both file path and call semantics in the plan's
  `<interfaces>` section are stale relative to current source.
- **Fix:** Wired `actionCount` at the one real `createAnimationEvents` call site
  (`GameShell.vue`). Since `ActionPanel.vue` and `AutoRenderer.vue` both `inject()` the SAME
  instance `GameShell.vue` provides via `provideAnimationEvents`, wiring the single provide point
  gives both consumers the rewind-reset watermark automatically — a single source of truth with no
  drift risk between two call sites (a stronger guarantee than the plan's two-call-site wiring
  would have given, and consistent with the codebase's existing provide/inject architecture for
  this composable).
- **Files modified:** `src/ui/components/GameShell.vue`.
- **Commit:** `bfcb32c5`.

**2. [Rule 2 - Missing functionality] Client-side wire-format `PlayerState` (`src/client/types.ts`)
had no `actionCount` field, causing a type error at the `GameShell.vue` call site**
- **Found during:** Task 3, `vue-tsc --noEmit` after wiring the call site.
- **Issue:** `GameShell.vue`'s `state` ref is typed against `src/client/types.ts`'s `PlayerState`
  (a separate, hand-maintained mirror of the server's `PlayerGameState`), which did not declare
  `actionCount`.
- **Fix:** Added `actionCount?: number` to `PlayerState` with a doc comment pointing back to the
  server-side source of truth. Kept optional (unlike the server-side field, which is required) to
  match this interface's existing convention — every other field here is optional, and this type
  is also used for client-side mocks/fixtures that predate this plan.
- **Files modified:** `src/client/types.ts`.
- **Commit:** `bfcb32c5`.

**Total deviations:** 2 auto-fixed (both Rule 2/3 — a stale plan reference to file paths that no
longer call `createAnimationEvents`, and a missing client-side type field). Neither touches the
mechanism specified in Tasks 1-2; both are necessary for the wiring in Task 3 to type-check and
actually reach both UI consumers.

### Auth gates

None encountered.

## Known Stubs

None — no stub patterns introduced.

## Threat Flags

None — this plan implements exactly the mitigations specified in its own threat model
(T-155-16 through T-155-18); no new, unlisted security-relevant surface was introduced.
`state.actionCount` is published unconditionally by design (T-155-16, disposition: accept — a
count, not content).

## Phase 155 PROC-01 Evidence Table (consolidated, all five plans)

| Defect | Requirement | Plan | Regression test | Pre-fix RED (verbatim, captured by running) | Post-fix GREEN | Adversarial attempt |
|--------|-------------|------|------------------|------|------|------|
| D1 — `.notUndoable()` silently ignored server-side | UNDO-01 | 155-01 | `notundoable-enforcement.test.ts` | `expected true to be false` (undo silently succeeded after a `.notUndoable()` action, 2/2 tests) | 4/4 tests pass | Raw `{type:'undo'}` op + direct `undoToTurnStart()` call, bypassing `canUndo` — both refused |
| D2 (finished-phase half) — undo silently rolls back a finished game | UNDO-02 | 155-01 | `finished-phase-undo.test.ts` | `expected true to be false` (undo succeeded after `game.phase === 'finished'`, 2/2 tests) | 2/2 tests pass | Raw `{type:'debugRewind'}` op + direct `rewindToAction()` call — both refused |
| D2 (execute-barrier half) — undo/rewind silently discards a committed `execute()` side effect | UNDO-02 | 155-02 | `execute-barrier-undo.test.ts` | `expected true to be false` / `expected +0 to be 1` (undo crossed a committed `execute()` node and reverted its side effect, 6/8 tests; 2 negative controls passed) | 8/8 tests pass | Raw `{type:'undo'}`/`{type:'debugRewind'}` ops + direct `undoToTurnStart()`/`rewindToAction()` calls — all four refused |
| D5 — solo undo wipes the entire game history | UNDO-03 | 155-03 | `solo-undo-authoritative.test.ts` | `expected +0 to be 2` (one undo reverted THREE actions' worth of score instead of one, 6/6 tests) | 6/6 tests pass | N/A (this defect is a fail-open logic bug, not a client-bypassable authorization gate; closed by deleting the fallback entirely — verified via `grep -c 'Scan backwards'` → 0) |
| D6 — animation-event watermark regresses across undo/rewind, server side | UNDO-04 | 155-04 | `rewind-animation-watermark.test.ts` | `expected 5 to be greater than 5` / `expected 4 to be greater than 4` (restored checkpoint's stale seq collided with an id the client watermark had already passed, 2/2 tests) | 22/22 tests pass (25/25 after the adversarial `toJSON()` fix) | 5x repeated `undo -> act -> undo -> act` within one turn + direct `GameSession.rewindToAction()` call — both monotonic; surfaced and fixed a real latent `toJSON()` seq-loss bug along the way |
| D6 — client carries a stale watermark into a reconnected/rewound session | UNDO-04 | 155-05 (this plan) | `useAnimationEvents.test.ts` (`rewind detection via actionCount` describe block) | `expected [1,2,3,4,5] to deeply equal [1,2,3,4,5,3,4]` (stale `lastQueuedId=5` silently dropped a replayed batch's ids 3-4, 1/45 tests) | 45/45 tests pass | N/A (client-side defense-in-depth, not a server authorization gate; the no-source and no-decrease non-regression cases (2 of 3 RED-phase cases) function as the adversarial guard — proving the reset never fires spuriously) |

All four phase-scoped defects (D1/D2/D5/D6) now have: (a) a fix, (b) a regression test with a
captured pre-fix RED run against real unfixed source, and (c) a recorded adversarial or
non-regression attempt that failed to defeat the fix. Phase 155's PROC-01 close-out is complete.

## Self-Check: PASSED

- `src/session/types.ts` (`actionCount: number`) — FOUND
- `src/session/utils.ts` (`actionCount: runner.actionHistory.length`) — FOUND
- `src/ui/composables/useAnimationEvents.ts` (`actionCount` option + watermark reset) — FOUND
- `src/ui/components/GameShell.vue` (`actionCount: () => state.value?.state?.actionCount`) — FOUND
- `src/client/types.ts` (`PlayerState.actionCount`) — FOUND
- Commit `97f30a5b` (Task 1) — FOUND in `git log`
- Commit `8b31f420` (Task 2 RED) — FOUND in `git log`
- Commit `6072891e` (Task 2 GREEN) — FOUND in `git log`
- Commit `bfcb32c5` (Task 3) — FOUND in `git log`
