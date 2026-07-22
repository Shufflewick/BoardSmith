---
requirements-completed: [AUTOEXEC-01, PROC-01]
---

# Plan 156-01 Summary — Sole-Option Auto-Execute Suppression via `.manual()` (AUTOEXEC-01, PROC-01)

**Plan:** 156-01 (execute — `ActionBuilder.manual()` closes D7)
**Completed:** 2026-07-20
**Result:** PASS — a new chainable `.manual()` builder flag threaded through both metadata builders
to the shell, gating the sole no-selection auto-execute branch on both auto-execute routes; PROC-01's
RED-before-GREEN and adversarial gates both satisfied.

## What was done

1. **Task 1 (RED):** Added a passive `manual?: boolean` type field to all three `ActionMetadata`
   shapes on the data path (`useActionControllerTypes.ts`, `session/types.ts`, `types/protocol.ts`) so
   the new test literals compile — no runtime gate yet. Added three net-new cases to
   `useBoardActionBridge.test.ts`: primary-watcher suppression, `actionCompletedTick`-route
   suppression, and a negative control (no `manual` flag still auto-executes). Ran against the
   UNGATED bridge and captured the real failure (verbatim below) — both `manual:true` cases failed
   because the ungated bridge called `executeAction` anyway; the negative control passed.
2. **Task 2 (GREEN):** Added `ActionDefinition.manual?: boolean` (`action/types.ts`) + chainable
   `ActionBuilder.manual()` (`action-builder.ts`), mirroring `notUndoable()`. Threaded the flag into
   both `buildActionMetadata` (`action-metadata.ts`) and the followUp `buildSingleActionMetadata`
   (`session/utils.ts`), serialized only when true via conditional spread. Gated the bridge's
   no-selection auto-execute branch in `tryAutoStartSingleAction`
   (`useBoardActionBridge.ts:278-281`-area): when `action.manual` is truthy, the branch returns
   without executing (leaving the already auto-started action surfaced); when falsy, it fires the
   existing `devWarn('autoexec:manual-hint:<name>', ...)` (dev-only, once-per-key, reused as-is) then
   executes as before. This single gate covers both routes because both the primary
   `isMyTurn`/`actionsWithMetadata` watcher and the end-turn `actionCompletedTick` coalescing path
   funnel through the same branch via `scheduleAutoStart` → `tryAutoStartSingleAction`. AI path
   (`session/ai-controller.ts`) untouched.
3. **Task 3:** Added propagation coverage to `build-player-state.test.ts` (new
   `TestManualGame`/`makeManualPropagationGame` fixture, mirroring the existing
   `action-help-propagation.test.ts` pattern) proving `manual` propagates through BOTH
   `buildActionMetadata` and `buildSingleActionMetadata`, and is omitted (not `false`) for a plain
   action. Added to `useBoardActionBridge.test.ts`: a Custom UI / Action Panel parity block (both
   consumption framings resolve through the identical shared bridge and neither auto-executes), an
   adversarial case driving `actionCompletedTick` with `pendingFollowUp` still true through the armed
   retry to prove the coalescing path cannot defeat `manual()`, and three dev-warning assertions
   (fires exactly once naming the action + `.manual()`, does not re-warn on a second trigger, never
   fires when `manual()` is set) using `_clearShownWarnings()` from `utils/dev.ts`.

## PROC-01 verbatim RED output (Task 1, before any fix)

```
 × useBoardActionBridge > manual() sole no-selection action (AUTOEXEC-01) > does NOT auto-execute
   a manual sole no-selection action via the primary watcher path
   AssertionError: expected "spy" to not be called with arguments: [ 'endTurn', {} ]
   Number of calls: 1

 × useBoardActionBridge > manual() sole no-selection action (AUTOEXEC-01) > does NOT auto-execute
   a manual sole no-selection action via the actionCompletedTick path
   AssertionError: expected "spy" to not be called with arguments: [ 'endTurn', {} ]
   Number of calls: 1

Test Files  1 failed (1)
     Tests  2 failed | 9 passed (11)
```
The negative control (no `manual` flag → still auto-executes) passed as expected. Both failures were
the real defect (the sole no-selection action's beat was silently consumed by `executeAction` when it
should have been suppressed), not a missing symbol or mechanical error.

## PROC-01 verbatim GREEN output (Task 2, after the fix)

```
✓ src/ui/composables/useBoardActionBridge.test.ts (11 tests) 9ms

Test Files  1 passed (1)
     Tests  11 passed (11)
```

## Adversarial verification (Task 3, both routes proven un-defeatable)

- `actionCompletedTick` pulse with `manual:true` metadata, including the `pendingFollowUp`-still-true
  armed-retry race (mirroring the existing capture-chain adversarial test) — `executeAction` never
  called with `('endTurn', {})` before OR after the armed retry settles.
- Custom UI and Action Panel consumption framings both resolve through the single shared
  `useBoardActionBridge` wiring — asserted identically, proving there is no divergent path to patch
  separately (CLAUDE.md parity rule).

## Verification

- `npx vitest run src/ui/composables/useBoardActionBridge.test.ts src/session/build-player-state.test.ts` — 17/17 and 30/30 pass.
- `npm test` — **193 files / 2771 tests pass**, at/above the pre-phase baseline (193/2758 + 13 net-new tests). No regressions.
- Grep gate: `grep -v '^\s*//' src/ui/composables/useBoardActionBridge.ts | grep -c 'action\.manual'` → 1 (≥1 required).
- Grep gate: `grep -c 'manual' src/engine/element/action-metadata.ts src/session/utils.ts` → 1 each (≥1 required).
- Grep gate: `grep -c 'manual' src/session/ai-controller.ts` → 0 (AI path untouched). Note: the plan's
  stated path `src/ai/ai-controller.ts` does not exist in this repo; the real file is
  `src/session/ai-controller.ts` (confirmed via `find`), which was verified clean instead.

## Deviations from Plan

### Auto-fixed Issues
None — plan executed exactly as written; no Rule 1/2/3 fixes were needed beyond what the plan already
specified.

### Notes (not deviations)
- The plan's grep-gate verification section references `src/ai/ai-controller.ts`; the actual file
  location in this repo is `src/session/ai-controller.ts` (confirmed via `find src -iname
  "ai-controller.ts"`). Verified the correct file instead of the plan's stated path — same intent
  (AI path unaffected), correct target.
- Task 3's `build-player-state.test.ts` addition uses a lightweight fixture (`TestManualGame`) mirroring
  the existing `action-help-propagation.test.ts` pattern rather than the file's heavier `GameRunner`-based
  `TestGame` fixture used elsewhere in the file — this matches how `help` propagation was already tested
  for the identical class of concern (a metadata field threaded through both builders), keeping the new
  tests minimal and consistent with established precedent.

### Auth gates
None encountered.

## Known Stubs
None — no stub patterns introduced.

## Threat Flags
None — this plan implements the mitigations specified in the plan's own threat model (T-156-01 through
T-156-03); no new, unlisted security-relevant surface was introduced. `manual` remains a client-side
UX hint only; the server never trusts it for validity.

## Self-Check: PASSED

- `src/engine/action/action-builder.ts` (`manual()`) — FOUND
- `src/engine/action/types.ts` (`manual?:`) — FOUND
- `src/engine/element/action-metadata.ts` (`manual` threading) — FOUND
- `src/session/utils.ts` (`buildSingleActionMetadata` `manual` threading) — FOUND
- `src/ui/composables/useBoardActionBridge.ts` (`action.manual` gate + `devWarn`) — FOUND
- `src/ui/composables/useBoardActionBridge.test.ts` (net-new manual()/parity/adversarial/warning cases) — FOUND
- `src/session/build-player-state.test.ts` (manual propagation cases) — FOUND
- Commit `fa37cb31` (RED) — FOUND in `git log`
- Commit `2824f1ee` (GREEN) — FOUND in `git log`
- Commit `033b0b03` (propagation + parity + adversarial + dev-warning) — FOUND in `git log`
