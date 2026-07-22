---
phase: 155-undo-rewind-family-correctness
verified: 2026-07-20T23:45:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
---

# Phase 155: Undo / Rewind Family Correctness Verification Report

**Phase Goal:** The undo/rewind subsystem is correct: a non-undoable action cannot be undone
server-side, undo cannot cross a completed `execute()` barrier or leave a `finished` phase, a
solo undo rewinds exactly one move (never wipes the game), and rewind does not make the client
drop replayed animation beats.
**Verified:** 2026-07-20
**Status:** passed
**Re-verification:** No — initial verification

## Note on stale planning docs

`.planning/ROADMAP.md`, `.planning/STATE.md`, and `.planning/REQUIREMENTS.md` currently show
Phase 155 as not-yet-executed / plans 02, 03, 05 unchecked, and UNDO-01/02/03 unchecked in
REQUIREMENTS.md (only UNDO-04 and PROC-01 checked). **This is a docs-sync gap, not a scope gap.**
Git history proves all 5 plans (01–05) were executed as a linear sequence of RED → GREEN →
adversarial → SUMMARY commits (`f87427b3`..`c11163be`), and all 5 `*-SUMMARY.md` files exist with
full PROC-01 evidence. The verification below is against the actual shipped code, independent of
the stale roadmap checkboxes. Recommend the next planning action update ROADMAP.md/STATE.md/
REQUIREMENTS.md checkboxes to match reality before closing the milestone phase.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Server-side undo executor refuses an undo crossing a `.notUndoable()` action, proven by a test that fails on pre-fix code | ✓ VERIFIED | `src/session/utils.ts:253-281` `assertUndoAllowed` throws `UndoRefusedError('non-undoable')` scanning `actionHistory[turnStartActionIndex..end)` for `undoable === false`. Wired at all 4 call sites (see Key Link table). RED commit `f87427b3` captures a genuine pre-fix failure (`notundoable-enforcement.test.ts`); GREEN commit `69973494`; adversarial commit `b3a6f457` (raw op + direct method-call bypass attempts both fail). Full suite green. |
| 2 | Undo fenced so it cannot rewind through a completed `execute()` barrier or out of `finished`; regression reproduces the pre-fix data-loss / hidden-info rewrite | ✓ VERIFIED | Finished-phase fence: `utils.ts:261-263` (`game.isFinished()` checked first, before any checkpoint lookup) — RED/GREEN in plan 01 (`finished-phase-undo.test.ts`). Execute-barrier fence: `utils.ts:275-280`, backed by `GameRunner.executeBarrierIndex` (`src/runtime/runner.ts:101,140,531,642,743` — persisted in `getSnapshot()`, adopted in `fromSnapshot()`/`fromCheckpoint()` with `?? 0` for legacy snapshots, clamped to `min(persisted, actionIndex)` on checkpoint restore). RED commit `7fb3f808` (`execute-barrier-undo.test.ts`, 6/8 pre-fix failures for the documented reason — score reverted 1→0, execute() side effect silently discarded); GREEN `8833447b`+`fc27c01d`; adversarial verified in `parity-contract.test.ts`. Durability genuinely proven: `execute-barrier-undo.test.ts`'s own doc comment + `stateless-ops.ts` confirms every stateless op rebuilds the runner via `runnerFromSnapshot`/`GameRunner.fromSnapshot` from the persisted `GameStateSnapshot` on every call — there is no surviving in-memory `frame.completed` to lean on. |
| 3 | Solo undo rewinds exactly one action-step (per approved "one undo = one action-step" contract); `computeUndoInfo` has no game-erasing fallback; `moveCount` published | ✓ VERIFIED | `utils.ts:173-195`: `computeUndoInfo` returns `{turnStartActionIndex: actionHistory.length, actionsThisTurn:0, hasNonUndoableAction:false}` when `moveCount === undefined` — no backward-scan history search remains (grep confirms zero `hasNonUndoableAction` discard sites outside the guard). `moveCount` sourced from `FlowState` and passed at `utils.ts:309-313`. RED `4fd08dff` (solo-undo-authoritative.test.ts, wipe reproduced pre-fix); GREEN `2ac037c6`; contract-rewrite commit `682b651c` updates `undo-authoritative.test.ts`/`stateful-undo-authoritative.test.ts` to the new "one undo = one action-step" semantics while retaining a positive undo case in both files (`undo-authoritative.test.ts:179`, `stateful-undo-authoritative.test.ts:140`) and the pending-mutation-preservation property (`undo-authoritative.test.ts:66-117`, `stateful-undo-authoritative.test.ts:45-86`). |
| 4 | Rewind does not reset the animation-event id sequence such that the client watermark dedupe drops beats | ✓ VERIFIED | Server side: `animationSeqFloor` option threaded `GameRunner.fromCheckpoint` (`runner.ts:611,648,734,760`) → `Game.loadSerializedState` (`src/engine/element/game.ts:2954-2989`, `Math.max(restored seq, floor)` keeps the sequence monotonic across checkpoint restore). Client side: `state.actionCount` published unconditionally (`utils.ts:365`, `state: PlayerGameState`), consumed by `useAnimationEvents.ts:84-96,398-425` (`actionCount` decrease detected → `lastQueuedId`/`lastProcessedId` reset to 0 before filtering, so a rewind replay batch is never partially dropped). Single call site `GameShell.vue:352-359` wires `actionCount` into `createAnimationEvents`. RED `49e29aa3`/`8b31f420`; GREEN `fe1cdc0c`/`97f30a5b`/`6072891e`; adversarial (repeated rewind cycles) `2c84d4c1`/`bfcb32c5`. Confirmed `src/engine/element/volatile-state.ts` untouched by any 155-* commit (only pre-existing 104-01/F3/F4 history). |
| 5 | Each of D1/D2/D5/D6 closed only after fix + regression test + adversarial verification (PROC-01) | ✓ VERIFIED | Each plan's SUMMARY documents a verbatim RED failure, a verbatim GREEN pass, and a dedicated adversarial task/commit (raw-op bypass, direct-method-call bypass, or repeated-cycle stress). Commit graph shows the pattern for every plan: `f87427b3`→`69973494`→`b3a6f457` (01), `49e29aa3`→`fe1cdc0c`(+`085fd236` cleanup)→`2c84d4c1` (04), `7fb3f808`→`8833447b`/`fc27c01d`→`5204d9c2` (02), `4fd08dff`→`2ac037c6`→`682b651c`→`783dc9a3` (03), `8b31f420`→`97f30a5b`/`6072891e`→`bfcb32c5`→`c11163be` (05). |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/session/utils.ts` — `assertUndoAllowed`/`UndoRefusedError` | Shared server-side guard | ✓ VERIFIED | Lines 173-281; 3 composable checks (finished, non-undoable, execute-barrier); substantive, not a stub |
| `src/session/stateless-ops.ts` — `handleUndo`, `handleDebugRewind` | Guard wired at both | ✓ VERIFIED | Lines 481, 1001 call `assertUndoAllowed` |
| `src/session/state-history.ts` — `undoToTurnStart`, `rewindToAction` | Guard wired at both | ✓ VERIFIED | Lines 315, 400 call `assertUndoAllowed` |
| `src/runtime/runner.ts` — `executeBarrierIndex` | Durable barrier field | ✓ VERIFIED | Declared line 101; advanced 140; serialized 531; adopted `fromSnapshot` 642; clamped `fromCheckpoint` 743 |
| `src/engine/flow/engine.ts` — `executeNodeCompletions` counter | Source of barrier advance | ✓ VERIFIED | Line 236 doc + 1576 wiring |
| `src/ui/composables/useAnimationEvents.ts` — watermark reset | Client rewind-detection | ✓ VERIFIED | Lines 84-96 (option), 398-425 (decrease detection + reset) |
| `src/ui/components/GameShell.vue` — `actionCount` wiring | Single call site | ✓ VERIFIED | Lines 352-359 |
| 6 new regression test files + 2 rewritten suites | Wave-0 test infra | ✓ VERIFIED | `notundoable-enforcement.test.ts`, `finished-phase-undo.test.ts`, `execute-barrier-undo.test.ts` (+fixture), `solo-undo-authoritative.test.ts`, `rewind-animation-watermark.test.ts`, `undo-authoritative.test.ts`, `stateful-undo-authoritative.test.ts` all exist and pass |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `stateless-ops.ts:handleUndo` | `utils.ts:assertUndoAllowed` | direct call | ✓ WIRED | line 481 |
| `stateless-ops.ts:handleDebugRewind` | `utils.ts:assertUndoAllowed` | direct call | ✓ WIRED | line 1001 |
| `state-history.ts:undoToTurnStart` | `utils.ts:assertUndoAllowed` | direct call | ✓ WIRED | line 315 |
| `state-history.ts:rewindToAction` | `utils.ts:assertUndoAllowed` | direct call | ✓ WIRED | line 400 |
| `runner.ts:fromCheckpoint` | `game.ts:loadSerializedState` | `animationSeqFloor` option | ✓ WIRED | runner.ts:760 → game.ts:2983-2989 |
| `utils.ts:buildPlayerState` | `state.actionCount` | unconditional publish | ✓ WIRED | utils.ts:365 |
| `GameShell.vue` | `useAnimationEvents.ts:createAnimationEvents` | `actionCount` getter option | ✓ WIRED | GameShell.vue:359 |

### Grep Gates (from plans 01/02, re-run against current HEAD)

| Gate | Expected | Actual | Status |
|------|----------|--------|--------|
| `assertUndoAllowed` call count in stateless-ops.ts+state-history.ts | >= 4 | 6 | PASS |
| `hasNonUndoableAction` leaked outside the guard | none | none | PASS |
| `executeBarrierIndex` occurrences in runner.ts | >= 5 | 7 | PASS |
| `executeBarrierIndex` occurrences in stateless-ops.ts+state-history.ts | >= 4 | 4 | PASS |

### Test Suite

`npm test` (vitest run, repo root): **193 test files passed (193), 2756 tests passed (2756)** —
matches the expected count exactly. No skipped/failed tests.

### Anti-Patterns Found

None. Scanned all files touched by 155-* commits (`src/session/utils.ts`, `stateless-ops.ts`,
`state-history.ts`, `runner.ts`, `engine.ts`, `game.ts`, `snapshot.ts`, `useAnimationEvents.ts`,
`GameShell.vue`) for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER` — zero matches.

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|--------------|-------------|--------|----------|
| UNDO-01 | `.notUndoable()` enforced server-side | ✓ SATISFIED | Truth 1 |
| UNDO-02 | Fenced at flow-node/terminal boundaries | ✓ SATISFIED | Truth 2 |
| UNDO-03 | No game-erasing fallback, `moveCount` published | ✓ SATISFIED | Truth 3 |
| UNDO-04 | Animation-id sequence survives rewind | ✓ SATISFIED | Truth 4 |
| PROC-01 | fix → test → adversarial-verify discipline | ✓ SATISFIED | Truth 5 |

**Note:** `.planning/REQUIREMENTS.md` still shows UNDO-01/02/03 unchecked (`[ ]`) — this is a
docs-sync gap only (see note above); the code-level evidence above satisfies all four.

### Human Verification Required

None. All 5 success criteria are server/client-code-level and fully covered by automated tests
(headless session + stateful `GameSession` harnesses, plus a client-side composable unit test for
the watermark reset). No visual/UX/real-time behavior in scope for this phase.

### Gaps Summary

No gaps. All 5 roadmap success criteria verified in the shipped code, not merely claimed in
SUMMARY.md. The only issue found is a documentation-sync gap (ROADMAP.md/STATE.md/REQUIREMENTS.md
checkboxes not updated to reflect that all 5 plans executed) — flagged above, does not block the
phase goal, but should be corrected before/at milestone close so downstream phase-status tracking
is accurate.

---

_Verified: 2026-07-20_
_Verifier: Claude (gsd-verifier)_
