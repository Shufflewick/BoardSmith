---
phase: 134-ui-session-interaction-guardrails
plan: 02
subsystem: ui
tags: [vue3, composables, useActionController, devWarn, guardrails]

# Dependency graph
requires:
  - phase: 134-01
    provides: PROC-01 verification gate confirming F17/UIX-01, F18/UIX-02, F31/UIX-05 (and F19/F29/F30) as LEGITIMATE against current post-Phase-133 source
provides:
  - "start() returns Promise<ActionResult> (was Promise<void>), resolving { success:false, error } for both synchronous pre-check failures and { success:true } as a wizard-mode-began acknowledgment (never the eventual server outcome)"
  - "start() devWarns (UI-SPEC UIX-01 copy) when called for an action not in availableActions"
  - "fill() rejects a scalar for a multiSelect pick with the UI-SPEC UIX-02 actionable error, reusing resolveMultiSelectConfig; arrays and non-multiSelect scalars unaffected"
  - "setBeforeAutoExecute accumulates hooks (array, not single-slot) run sequentially in registration order, returns an unregister closure"
affects: [134-03, 134-04, 134-05, GameShell.vue lastError-watch toast wiring (a future plan in this phase)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "start()/execute() both return the shared ActionResult shape (no third result type introduced) — callers that ignore the return value still see lastError; callers that await get a checkable result"
    - "fill()'s multiSelect guard mirrors toggleMultiSelect's reverse guard (same devWarn/error-shape pattern, opposite direction), reusing resolveMultiSelectConfig instead of re-deriving dependsOn/multiSelectByDependentValue logic"
    - "Hook registries (beforeAutoExecuteHooks) use an array + identity-based unregister closure, sequential await in the consuming watcher — deterministic ordering, no Promise.all"

key-files:
  created: []
  modified:
    - src/ui/composables/useActionController.ts
    - src/ui/composables/useActionControllerTypes.ts
    - src/ui/composables/useActionController.test.ts
    - src/ui/composables/useActionController.picks.test.ts

key-decisions:
  - "start()'s success path returns bare { success: true } (no data/message) — JSDoc on both the impl and the public type explicitly states this reflects only the synchronous pre-checks, not the eventual server result, per RESEARCH.md Pitfall 1"
  - "useDragDropTargets.ts's two start() call sites already discard the return value (no destructuring) — return-type widening required zero changes there, confirmed by direct read before editing"
  - "fill()'s UIX-02 guard placed immediately after the choice-object auto-unwrap and before the repeat/onSelect routing branches, per 134-PATTERNS.md Pattern 3, so a single choice-object passed for a multiSelect pick is unwrapped first and then rejected by the multiSelect guard (not a confusing validateSelection error)"
  - "beforeAutoExecuteHooks stored as Ref<BeforeAutoExecuteHook[]> (seeded from initialBeforeAutoExecute when present) rather than a new registry abstraction — matches 134-PATTERNS.md Pattern 2 exactly"

patterns-established:
  - "Hook-accumulation-with-unregister is now the established shape for future multi-consumer hook slots in this composable (array + push + identity-splice closure)"

requirements-completed: [UIX-01, UIX-02, UIX-05, PROC-02]

# Metrics
duration: 12min
completed: 2026-07-03
---

# Phase 134 Plan 02: useActionController Guardrails (UIX-01 start-half, UIX-02, UIX-05) Summary

**Wired three missing guardrails into the shared `useActionController.ts` composable — start() now returns a checkable ActionResult and devWarns on unavailable actions, fill() rejects scalars for multiSelect picks, and setBeforeAutoExecute accumulates hooks instead of silently replacing them — closing the silent-wrong-path gaps confirmed LEGITIMATE by 134-01's verification pass (F17, F18, F31).**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-03T11:12:00-05:00 (approx, first read)
- **Completed:** 2026-07-03T11:24:08-05:00
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- `start()` widened from `Promise<void>` to `Promise<ActionResult>`, resolving `{ success: false, error }` for the unavailable-action and no-metadata branches, and `{ success: true }` as a synchronous-pre-checks-passed acknowledgment (explicitly NOT the eventual server outcome, documented in JSDoc on both the implementation and `useActionControllerTypes.ts`)
- `start()` now emits a `devWarn` with the UI-SPEC UIX-01 copy verbatim when called for an action not in `availableActions`
- `fill()` rejects a scalar passed for a multiSelect pick with the UI-SPEC UIX-02 actionable error, reusing the existing `resolveMultiSelectConfig()` helper (no re-derivation); arrays and non-multiSelect scalars pass through unchanged; a single choice-object for a multiSelect pick is unwrapped first, then rejected by this guard
- `setBeforeAutoExecute` now accumulates hooks in a `Ref<BeforeAutoExecuteHook[]>` (was a single-slot ref), runs them sequentially (not `Promise.all`) in registration order via the auto-execute watcher, and returns an unregister closure that removes only its own hook
- Flipped the PROC-02 regression test: `useActionController.test.ts`'s previously-committed `'setBeforeAutoExecute replaces the previous hook (single-slot)'` test — which asserted `['second']` as proof of the pre-fix replace-semantics bug — is now `'setBeforeAutoExecute accumulates hooks and runs them in registration order (UIX-05, PROC-02 regression)'`, asserting `['first', 'second']`. Confirmed RED (assertion failed against the pre-fix single-slot code: `expected ['second'] to deeply equal ['first', 'second']`, plus a second failing case for the not-yet-existing unregister function) before implementing the fix, then GREEN after.

## Task Commits

Each task was committed atomically:

1. **Task 1: start() returns ActionResult + devWarns on unavailable action (UIX-01)** - `a4654b2e` (feat)
2. **Task 2: fill() rejects scalar for a multiSelect pick (UIX-02)** - `37c98902` (feat)
3. **Task 3: setBeforeAutoExecute accumulates hooks + flip the RED test (UIX-05)** - `ff5e20b2` (feat)

**Plan metadata:** (this commit, following this SUMMARY)

_Note: Task 3 is a TDD-flagged task; the RED verification step (flipping the assertion and confirming failure) was done in-place against the not-yet-fixed code before the GREEN implementation edit, all within a single atomic commit per the plan's single-commit-per-task structure — the RED/GREEN transition is documented above and in the commit message rather than split into separate test/feat commits, since the task's `<action>` bundles the test flip and the fix as one deliverable._

## Files Created/Modified
- `src/ui/composables/useActionController.ts` - start() return-type widening + devWarn; fill() multiSelect guard (reuses resolveMultiSelectConfig); beforeAutoExecuteHooks array + unregister closure + sequential-await watcher
- `src/ui/composables/useActionControllerTypes.ts` - start() signature → Promise<ActionResult>; setBeforeAutoExecute signature → returns () => void; JSDoc updates (removed "REPLACES" language)
- `src/ui/composables/useActionController.test.ts` - new "start() return value (UIX-01)" describe block (3 tests); flipped setBeforeAutoExecute replace-semantics test to accumulation + new unregister test
- `src/ui/composables/useActionController.picks.test.ts` - new "fill() rejects a scalar for a multiSelect pick (UIX-02)" describe block (4 tests: reject-scalar, accept-array, accept-non-multi-scalar, unwrap-then-reject)

## Decisions Made
- start()'s success path returns bare `{ success: true }` — no `data`/`message` populated, since nothing meaningful exists yet at that point in the lifecycle; JSDoc makes the "not the eventual server result" caveat explicit per RESEARCH.md Pitfall 1
- `useDragDropTargets.ts`'s two `start()` call sites were confirmed (by direct read, not assumption) to already discard the return value — the Promise<void>→Promise<ActionResult> widening required zero changes there
- fill()'s UIX-02 guard is positioned after the choice-object auto-unwrap and before the `repeat`/`hasOnSelect`/`pendingOnServer` routing branches, matching 134-PATTERNS.md Pattern 3's exact insertion point, so the unwrap-then-reject test asserts a clean UIX-02 error rather than a confusing validateSelection failure
- `beforeAutoExecuteHooks` uses a plain array (`Ref<BeforeAutoExecuteHook[]>`) seeded from `initialBeforeAutoExecute` when present, rather than introducing a new registry abstraction — matches 134-PATTERNS.md Pattern 2 and keeps the change minimal (array + push + identity-based splice-on-unregister)

## Deviations from Plan

None - plan executed exactly as written. All three tasks' `<action>` and `<acceptance_criteria>` were implemented as specified; `resolveMultiSelectConfig` and the existing `devWarn` convention were reused verbatim per the plan's `<interfaces>` directive (no new abstractions introduced).

## Issues Encountered

None. The `vitest -t "beforeAutoExecute"` filter specified in the plan's Task 3 `<verify>` block does not match any test titles (all titles say `setBeforeAutoExecute`, not `beforeAutoExecute`) — used `-t "setBeforeAutoExecute"` instead to run the targeted tests, which is functionally equivalent and not a deviation in behavior, only in the grep pattern used for local verification.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- UIX-01's `start()`-half (return value + devWarn) is complete; the remaining UIX-01 scope (GameShell central `lastError` watch → toast, per 134-UI-SPEC.md's Interaction & Accessibility Contract) is out of this plan's scope and belongs to a later plan in Phase 134
- UIX-02 and UIX-05 are fully complete per this plan's must_haves
- `useActionController.ts`/`useActionControllerTypes.ts` are now the up-to-date reference for any subsequent plan in this phase that touches the same composable (e.g. GameShell's `lastError` toast wiring will consume the widened `start()` `ActionResult` and the existing `lastError` ref, both already in place)
- No blockers for 134-03/04/05

---
*Phase: 134-ui-session-interaction-guardrails*
*Completed: 2026-07-03*

## Self-Check: PASSED

All modified files confirmed present on disk; all three task commit hashes (a4654b2e, 37c98902, ff5e20b2) confirmed in git log.
