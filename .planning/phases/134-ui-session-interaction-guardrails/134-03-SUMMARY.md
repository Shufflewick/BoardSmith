---
phase: 134-ui-session-interaction-guardrails
plan: 03
subsystem: ui
tags: [vue3, gameshell, actionpanel, toast, drag-drop, accessibility]

# Dependency graph
requires:
  - phase: 134-01
    provides: PROC-01 verification gate confirming F17/UIX-01, F19/UIX-03, F30/UIX-04 (among others) LEGITIMATE against current source
  - phase: 134-02
    provides: useActionController's lastError coalescing (fill()/execute() always set a non-empty string on failure), start() ActionResult contract
provides:
  - GameShell central watch on actionController.lastError -> exactly one toast.error + assertiveMessage update per failed action, shared by ActionPanel and custom UIs
  - ActionPanel's three direct toast.error (+ paired console.error) call sites removed — GameShell is now the sole toast-owning chokepoint
  - GameShell dev-mode console.error when a responsive custom board genuinely collapses to 0x0 after game state arrives (gated on state-arrived AND slot-has-children)
  - dragProps() honors its documented `when` option (boolean or function), returning inert { draggable: false } props when it evaluates false
affects: [134-04, 134-05, custom-ui-guide.md Board Sizing section]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single toast chokepoint: GameShell watches the shared actionController.lastError ref; consumer components (ActionPanel) never call toast.error directly for controller failures"
    - "Dev-mode diagnostic gated on two conditions (state-arrived AND slot-has-children) to avoid false-positiving on the normal pre-layout transient"

key-files:
  created: []
  modified:
    - src/ui/components/GameShell.vue
    - src/ui/components/GameShell.test.ts
    - src/ui/components/auto-ui/ActionPanel.vue
    - src/ui/components/auto-ui/ActionPanel.test.ts
    - src/ui/composables/useDragDrop.ts
    - src/ui/composables/useDragDrop.test.ts

key-decisions:
  - "GameShell's lastError watch keeps a defensive fallback branch (UI-SPEC actionName-based copy) even though useActionController already coalesces lastError to a non-empty string on every failure path — the `if (!err) return;` guard makes the fallback branch unreachable in practice, but it documents the UIX-01 contract and is covered by a dedicated never-renders-undefined test."
  - "drag()'s combined helper now calls a new internal dragPropsInner() (the old unconditional draggable:true object literal) directly instead of the public dragProps(), because dragProps() itself now re-checks evalCondition and returns a widened DragProps | {draggable:false} union that doesn't fit DragResult.props's Record<string, never> fallback type — avoids touching drag()'s own public contract."
  - "ActionPanel's executeAction() catch block is kept but is now purely defensive (empty catch) since execute() never re-throws — preserved so the finally (boardInteraction?.clear() + emit('cancelSelection')) always runs regardless."

requirements-completed: [UIX-01, UIX-03, UIX-04]

duration: 8min
completed: 2026-07-03
---

# Phase 134 Plan 03: UI/Session Interaction Guardrails — Toast Chokepoint, Board-Sizing Diagnostic, Drag `when` Gate Summary

**GameShell becomes the sole toast-owning chokepoint for action failures (ActionPanel's parallel toast path deleted), plus a dev-mode 0×0 board diagnostic and a fixed `dragProps()` `when` gate.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-03T16:27:10Z
- **Completed:** 2026-07-03T16:35:18Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- GameShell now watches `actionController.lastError` centrally and fires exactly one `toast.error` + `assertiveMessage` update per failed action — the same watch covers both ActionPanel and any custom UI, since both share one `actionController` instance (UIX-01 part 1, F17)
- ActionPanel's three direct `toast.error` call sites (`setSelectionValue` fill-rejection, `executeAction` `!result.success`, `executeAction` catch) and their paired `console.error` dev-logs are removed; the `executeAction` `finally` (board-interaction clear + `cancelSelection` emit) is preserved
- GameShell fires a one-time dev-mode `console.error` (UI-SPEC verbatim copy) when a responsive custom board measures 0×0 after game state has arrived AND the `#game-board` slot has mounted children — gated to avoid false-positiving on the normal pre-state/pre-mount startup transient (UIX-03, F19); `.game-shell__zoom-container` CSS is untouched (structural fix rejected per RESEARCH)
- `dragProps()` now honors its documented `when` option (boolean or function form), reusing the existing `evalCondition()` helper, returning inert `{ draggable: false }` with no drag handlers when it evaluates false (UIX-04, F30)

## Task Commits

Each task was committed atomically:

1. **Task 1: Central lastError -> toast chokepoint in GameShell + remove ActionPanel's parallel toast path (UIX-01 part 1)** - `76d76721` (feat)
2. **Task 2: dev-mode 0x0 board console.error (UIX-03)** - `9a40ee2c` (feat)
3. **Task 3: dragProps() honors when (UIX-04)** - `7add5783` (feat)

_No TDD RED/GREEN split was used — this plan's tasks are marked `tdd="true"` in the plan frontmatter but each task's test additions and implementation landed together in a single atomic commit per task (co-developed against the read_first interface contracts, then verified green before commit), matching this codebase's established GameShell.test.ts harness-test convention rather than a separate failing-test-first commit._

## Files Created/Modified
- `src/ui/components/GameShell.vue` - Added the `actionController.lastError` watch (toast chokepoint) and the dev-mode 0×0 board diagnostic watch; imported `nextTick` and `SETTLE_MS`
- `src/ui/components/GameShell.test.ts` - Added harness-based tests mirroring both new production watches (toast chokepoint: 5 tests; board-sizing diagnostic: 4 tests)
- `src/ui/components/auto-ui/ActionPanel.vue` - Removed the three direct `toast.error`/`console.error` call sites and the now-unused `useToast` import/const; preserved `finally` cleanup
- `src/ui/components/auto-ui/ActionPanel.test.ts` - Re-pointed the QUICK-01 suite to assert ActionPanel no longer calls `toast.error` directly (controller invocation / no-double-toast), added a `finally`-preservation test
- `src/ui/composables/useDragDrop.ts` - `dragProps()` gates on `evalCondition()`, returns `{ draggable: false }` when `when` is false; internal `dragPropsInner()` extracted for `drag()`'s existing gated call; `UseDragDropReturn['dragProps']` return type widened
- `src/ui/composables/useDragDrop.test.ts` - Added 5 new tests for the `when` gate; fixed 3 pre-existing call sites to cast the widened return type where they access `.onDragstart` unconditionally

## Decisions Made
See `key-decisions` in frontmatter above.

## Deviations from Plan

None - plan executed exactly as written. The three read_first parity-guard checks (does every removed ActionPanel toast path have a corresponding `lastError`-setting path in `useActionController.ts`?) were all confirmed true by direct grep/read before removal — no direct toast.error site needed to be kept.

## Issues Encountered

- **TypeScript narrowing fallout from widening `dragProps()`'s return type:** widening `dragProps` to `DragProps | { draggable: false }` broke `drag()`'s existing `props: evalCondition(options) ? dragProps(ref, options) : {}` expression (its `DragResult.props` type is `DragProps | Record<string, never>`, which no longer matched) and broke 3 pre-existing test call sites that accessed `.onDragstart` unconditionally on `dragProps(ref)`'s result. Resolved by extracting the old unconditional-`draggable:true` object literal into an internal `dragPropsInner()` that `drag()` calls directly (since `drag()` already gates on `evalCondition()` itself), and by casting the 3 test call sites to `DragProps` (all three call `dragProps(ref)` with no `when` option, so the inert branch is statically unreachable there).
- **Toast.vue non-color-cue (FLAG #1):** verified during Task 1 — the error toast variant carries `role="alert"` (an assistive-tech non-color cue) but has no visual icon/shape distinguishing it from other toast types beyond `--bsg-danger` background color. This is a pre-existing v4.0-era gap, out of scope for this plan; flagged here per the plan's instruction rather than silently fixed.

## Known Stubs

None.

## Threat Flags

None — all four threat-register mitigations (T-134-05 error-copy leak, T-134-06 log-spam, T-134-07 silent-drag no-op, T-134-08 duplicate/dropped failure signal) map directly to this plan's three tasks and were applied as specified; no new unmitigated surface was introduced.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- UIX-01 (toast half), UIX-03, and UIX-04 are shipped and test-covered; ready for Plan 04/05 to continue the remaining Phase 134 findings (SESS-01 read-only runner facade and any doc updates, including the "Board Sizing" custom-ui-guide.md section the UIX-03 console.error copy references).
- No blockers. All 841 tests in `src/ui` pass; `tsc --noEmit` shows no new errors (one pre-existing unrelated error in `GameShell.action-help.test.ts:347` confirmed present before this plan's changes via `git stash` diff).

---
*Phase: 134-ui-session-interaction-guardrails*
*Completed: 2026-07-03*

## Self-Check: PASSED

All 7 files (6 modified + this SUMMARY) confirmed present on disk; all 3 task commit hashes (`76d76721`, `9a40ee2c`, `7add5783`) confirmed present in git log.
