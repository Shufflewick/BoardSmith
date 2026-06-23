---
phase: 101-accessibility-wcag-wave-4
plan: "06"
subsystem: ui
tags: [accessibility, a11y, wcag, action-panel, keyboard, screen-reader]
dependency_graph:
  requires: [101-01]
  provides: [splitAnchoredChoices, anchored-choices-secondary-list]
  affects: [ActionPanel.vue, action-panel-helpers.ts]
tech_stack:
  added: []
  patterns: [splitAnchoredChoices-partition, secondary-focusable-list, triggerElementSelect-parity]
key_files:
  created:
    - src/ui/components/auto-ui/action-panel-helpers.test.ts
  modified:
    - src/ui/components/auto-ui/action-panel-helpers.ts
    - src/ui/components/auto-ui/ActionPanel.vue
    - src/ui/components/auto-ui/ActionPanel.test.ts
decisions:
  - "Partition (splitAnchoredChoices) replaces filter (filterAnchoredChoices) so anchored choices are never dropped — keyboard/SR dead-end eliminated"
  - "Secondary list buttons call boardInteraction.triggerElementSelect({ notation }) — identical path as clicking the board element (parity)"
  - "ActionPanel.test.ts updated in-place to test splitAnchoredChoices semantics; action-panel-helpers.test.ts is the canonical unit suite"
metrics:
  duration: "~15 minutes"
  completed: "2026-06-23"
  tasks_completed: 3
  files_changed: 4
---

# Phase 101 Plan 06: Action Panel Anchored-Choice Parity + Focus + 44px Targets Summary

Closed three accessibility findings in ActionPanel: A11Y-02 (Critical — board-anchored choices were silently dropped, creating a keyboard dead-end), A11Y-06 (outline:none blocked visible focus on text/number inputs), and A11Y-09 (cancel/clear controls below 44px touch target floor).

## What Was Built

**splitAnchoredChoices helper (A11Y-02 — Critical)**

Replaced `filterAnchoredChoices` (which dropped notation-anchored choices) with `splitAnchoredChoices` that partitions choices into `{ primary, anchored }`. Anchored choices are never discarded. The function lives in `action-panel-helpers.ts` and is covered by a dedicated 6-test suite.

**Secondary focusable list in ActionPanel (A11Y-02)**

`ActionPanel.vue` now renders notation-anchored choices as a `<ul role="list">` of real `<button>` elements. Each button's `@click` calls `boardInteraction?.triggerElementSelect({ notation })` — the exact same selection path as clicking the matching board grid cell. This gives keyboard and screen-reader users an operable control in the panel even when every choice is board-anchored (e.g., Checkers destination squares).

**Removed outline:none (A11Y-06)**

Deleted `outline: none` from `.number-input input:focus, .text-input input:focus`. The `border-color: var(--bsg-accent)` style is preserved. The global `:focus-visible` ring added in plan 101-05 now provides the visible focus indicator.

**44px touch targets (A11Y-09)**

Added `min-height: 44px` to `.cancel-btn` and `min-height: 44px; min-width: 44px` to `.clear-selection-btn`.

## Tasks

| # | Task | Commit |
|---|------|--------|
| 1 | splitAnchoredChoices helper + unit test (TDD RED/GREEN) | 5cfddc7 |
| 2 | ActionPanel secondary anchored list + render consumption | 6936ec5 |
| 3 | Remove outline:none + 44px targets | c4ccee7 |

## Verification

- `npx vitest run src/ui/components/auto-ui/action-panel-helpers.test.ts` — 6/6 pass
- `npx vitest run src/ui/components/auto-ui/ActionPanel.test.ts` — 16/16 pass
- `grep -c "outline: none" ActionPanel.vue` — 0
- `grep -c "filterAnchoredChoices" action-panel-helpers.ts` — 0
- `npm run lint:css` — exit 0

## Deviations from Plan

**1. [Rule 3 - Blocking] ActionPanel.test.ts imported deleted filterAnchoredChoices**

- Found during: Task 2 TypeScript check
- Issue: Existing `ActionPanel.test.ts` imported `filterAnchoredChoices` which was removed
- Fix: Updated import to `splitAnchoredChoices` and rewrote test assertions to match partitioning semantics (notation choices now asserted to appear in `anchored`, not absent)
- Files modified: `src/ui/components/auto-ui/ActionPanel.test.ts`
- Commit: 6936ec5

**2. [Infrastructure] Merged main into worktree before starting**

- Found during: Task 1 RED phase
- Issue: Worktree branch was 10 commits behind main; `action-panel-helpers.ts` did not exist in the worktree
- Fix: Fast-forward merge of main into worktree branch (no conflicts — 101-01 touched different files)

## Known Stubs

None. The secondary list is fully wired to `triggerElementSelect`.

## Threat Flags

None. No new network endpoints, auth paths, or trust-boundary changes.

## Self-Check: PASSED

- SUMMARY.md: FOUND
- Commit 5cfddc7 (Task 1): FOUND
- Commit 6936ec5 (Task 2): FOUND
- Commit c4ccee7 (Task 3): FOUND
