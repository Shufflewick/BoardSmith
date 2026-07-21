---
requirements-completed: [SPACE-05, PROC-01]
---

# Plan 163-04 Summary — availableActions/actionMetadata Divergence (SPACE-05/D26, PROC-01)

**Plan:** 163-04 (execute — Denial-of-Service fix: `buildPlayerState`'s `availableActions` could be a
strict superset of `actionMetadata`, offering an un-startable action that threw and stranded the panel)
**Completed:** 2026-07-21
**Result:** PASS — `availableActions` and `actionMetadata` are now the SAME condition-checked set for any
real seat and cannot diverge; the client `start()` no-metadata path is a logged no-op, never a throw;
PROC-01's RED-before-GREEN satisfied.

## What was done

This closes T-163-28 (Denial of Service): `buildPlayerState` (`src/session/utils.ts`) set
`state.availableActions` from the RAW flow snapshot `availableActionsForSeat(flowState, playerPosition)`
— itself a cache computed once when the action-step is entered (`engine.ts:1494`
`this.game.getAvailableActions(player)`) — while `state.actionMetadata` was built separately via
`buildActionMetadata`, which re-checks each action's `condition` LIVE at broadcast time and drops any
action whose condition is now false. If a condition flipped false between step-entry and a later
broadcast (without the flow itself advancing), `availableActions` kept the stale entry while
`actionMetadata` dropped it — the client offered an action it could not start, and
`useActionController.start()` threw `"No metadata for action"`, stranding the panel.

1. **Task 1 (RED):** Added a `SPACE-05 (D26)` describe block to `action-metadata.test.ts` with a
   `DivergenceGame` whose `'conditional'` action becomes false-gated mid-step (`conditionOpen` flipped
   directly on the game instance after the action-step snapshot was already taken). Drove
   `buildPlayerState` via a real `GameRunner` fixture and asserted `state.availableActions` and
   `Object.keys(state.actionMetadata)` are the same set. Captured the real failure before any production
   change. Also added a negative control (condition-true action in both sets) and a UI-facing
   `useActionController.start()` no-throw assertion, both of which already passed pre-fix (isolating the
   divergence as the one real defect).
2. **Task 2 (GREEN):** In `buildPlayerState`, the condition-checked `actionMetadata` is now built FIRST
   for a real seat (`playerPosition > 0`), and `state.availableActions` is derived from
   `Object.keys(actionMetadata)` rather than the raw snapshot. Spectators (position 0) and the
   no-metadata-requested path keep the raw list — they never receive metadata and so cannot strand a
   panel on it. In `useActionController.ts`, the `start()` no-metadata hard error (`setError` +
   `"No metadata for action"`) was downgraded to a `devWarn` + benign no-op (`"not ready to start yet"`)
   so even a transient divergence can never throw and strand the board; the next state broadcast
   reconciles.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] RED test's `Action.condition()` usage was itself wrong, silently masking the
intended false-condition case**
- **Found during:** Task 1, first RED run
- **Issue:** `.condition()` takes a labeled-predicate record (`{ label: (ctx) => boolean }`), not a raw
  predicate function. The test originally passed a raw function; `evaluateCondition` iterates
  `Object.entries()` of that record, which is empty for a bare function (no own enumerable entries), so
  the condition silently always evaluated `true` and never gated the action at all. The first RED run
  failed, but for a coincidentally-similar reason rather than proving the intended condition-false
  scenario.
- **Fix:** Changed to `.condition({ 'condition open': (ctx) => (ctx.game as DivergenceGame).conditionOpen })`.
  Re-verified a TRUE RED against the corrected test (with the production files reverted to their
  pre-fix state) before re-applying the Task 2 fix, per PROC-01.
- **Files modified:** `src/engine/element/action-metadata.test.ts`
- **Commit:** `b78bd7cb` (folded into the GREEN commit; documented here since Task 1's commit `8d3d1aa3`
  captured the earlier, misleading RED)

**2. [Rule 1 - Bug] Pre-existing assertion pinned the old throw message**
- **Found during:** Task 2, full-suite verification
- **Issue:** `useActionController.test.ts`'s `"start() resolves to a failure ActionResult for an action
  with no metadata"` test asserted `result.error` contained `"No metadata"` — the exact string this plan
  intentionally removes.
- **Fix:** Updated the assertion to the new message (`"not ready to start yet"`) and added a
  `currentAction.value` check proving the board stays interactive (no wizard-mode pin).
- **Files modified:** `src/ui/composables/useActionController.test.ts`
- **Commit:** `b78bd7cb`

## PROC-01 verbatim RED output (Task 1, corrected test, before any production fix)

```
 ❯ src/engine/element/action-metadata.test.ts (11 tests | 1 failed)
   × SPACE-05 (D26): availableActions and actionMetadata cannot diverge > drops a now-false-condition action from BOTH availableActions and actionMetadata (no divergence) 5ms
     → expected [ 'conditional', 'always' ] to not include 'conditional'

 FAIL  src/engine/element/action-metadata.test.ts > SPACE-05 (D26): availableActions and actionMetadata cannot diverge > drops a now-false-condition action from BOTH availableActions and actionMetadata (no divergence)
AssertionError: expected [ 'conditional', 'always' ] to not include 'conditional'
 ❯ src/engine/element/action-metadata.test.ts:345:40

 Test Files  1 failed (1)
      Tests  1 failed | 10 passed (11)
```

## PROC-01 verbatim GREEN output (Task 2, after the fix)

```
 ✓ src/engine/element/action-metadata.test.ts (11 tests) 12ms

 Test Files  1 passed (1)
      Tests  11 passed (11)
```

## Verification

- `npx vitest run src/engine/element/action-metadata.test.ts` — 11 tests, all pass.
- `npx vitest run src/ui/composables/useActionController.test.ts` — 105 tests, all pass.
- `npm test` — **209 files / 2953 tests pass**, above the pre-phase baseline (209/2950 after 163-02); the
  +3 delta is this plan's net-new SPACE-05 coverage (divergence case, negative control, UI no-throw
  case), zero regressions.
- Grep gate: `grep -n "reconciledAvailableActions = Object.keys" src/session/utils.ts` → one match at
  `utils.ts:521`, confirming `availableActions` is derived from the built metadata's keys, not the raw
  `availableActionsForSeat` result.
- `computeUndoEligibility`/`canUndo` untouched — verified it still reads `runner.actionHistory` +
  `flowState`, not the `availableActions` array identity.

## Known Stubs

None.

## Threat Flags

None — the fix closes an existing threat register entry (T-163-28) at its documented mitigation site; no
new surface introduced.

## Self-Check: PASSED

- `src/session/utils.ts` — FOUND, contains `reconciledAvailableActions = Object.keys(actionMetadata)`.
- `src/ui/composables/useActionController.ts` — FOUND, contains `not ready to start yet`.
- `src/engine/element/action-metadata.test.ts` — FOUND, contains `SPACE-05 (D26)` describe block.
- Commit `8d3d1aa3` (RED) — FOUND in `git log`.
- Commit `b78bd7cb` (GREEN) — FOUND in `git log`.
