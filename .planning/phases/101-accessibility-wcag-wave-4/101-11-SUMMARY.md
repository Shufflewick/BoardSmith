---
phase: 101-accessibility-wcag-wave-4
plan: 11
subsystem: ui/renderers
tags: [a11y, testing, divergence-guard, drag-drop, keyboard]
dependency_graph:
  requires: [101-02, 101-03, 101-04]
  provides: [divergence-guard, drag-keyboard-parity-tests]
  affects: [src/ui/components/auto-ui/renderers/]
tech_stack:
  added: []
  patterns: [source-grep guard, composable-contract test, createBoardInteraction integration test]
key_files:
  created:
    - src/ui/components/auto-ui/renderers/useSelectable.divergence.test.ts
    - src/ui/components/auto-ui/renderers/drag-keyboard-parity.test.ts
  modified: []
decisions:
  - "Divergence test uses readFileSync source-grep (not AST) — sufficient for detecting hand-rolled handler names, simpler, and less fragile than parsing .vue SFCs"
  - "handleCellActivate and handleHexActivate in grid renderers are NOT forbidden — they are the new correct wrappers that delegate to the composable; only the pre-migration names (handleCellClick, handleHexClick, handleClick) are banned"
  - "Drag parity test uses createBoardInteraction() directly (not setupDragDropOrchestration) — proves the core startDrag/setDropTargets/triggerDrop contract which is the shared API all consumers use"
metrics:
  duration: "~2m"
  completed: "2026-06-23"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 0
---

# Phase 101 Plan 11: Divergence Guard + Drag-Keyboard Parity Tests Summary

Two-sentence summary: Source-grep CI guard asserting all 8 renderer files are free of pre-migration handler names and each imports the shared `useSelectable`/`useSelectableGrid` composable — reintroducing a hand-rolled handler breaks the test immediately. Drag-keyboard parity test proves both the keyboard path (Enter/Space through mounted `CardRenderer` → `useSelectable` → `triggerElementSelect`) and the drag path (`startDrag` → `setDropTargets` → `triggerDrop`) work through the same `createBoardInteraction()` instance after the A11Y-01 migration.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Divergence grep-guard test | ee9e4c4 | useSelectable.divergence.test.ts |
| 2 | Drag-still-works regression + keyboard parity test | ee9e4c4 | drag-keyboard-parity.test.ts |

## Test Results

- `npx vitest run src/ui/components/auto-ui/renderers/useSelectable.divergence.test.ts` — 8/8 pass
- `npx vitest run src/ui/components/auto-ui/renderers/drag-keyboard-parity.test.ts` — 6/6 pass
- `npx vitest run src/ui/components/auto-ui/renderers/` — 63/63 pass (all renderer tests)
- `npx vitest run src/ui/` — 506/506 pass (full UI suite)
- `npm run lint:css` — exit 0

## Divergence Guard Details

`useSelectable.divergence.test.ts` reads each of the 8 renderer `.vue` source files and asserts:

**Forbidden patterns (must be absent):**
1. `function handleClick` — old per-renderer click handler
2. `\bhandleCellClick\b` — old grid cell click handler (distinct from `handleCellActivate`)
3. `\bhandleHexClick\b` — old hex cell click handler (distinct from `handleHexActivate`)
4. `@click` bound directly to `triggerElementSelect` — bypassing the composable

**Required pattern (must be present):**
- Each renderer imports `useSelectable` or `useSelectableGrid`

One test per renderer file; failure messages name the offending file and matched token.

## Drag-Keyboard Parity Details

`drag-keyboard-parity.test.ts` uses `createBoardInteraction()` with a real `CardRenderer` mount:

- **Keyboard path (3 tests):** Enter/Space trigger `onElementSelect` via the `useSelectable.onKeydown` → `triggerElementSelect` chain; Tab/ArrowDown/Escape do not.
- **Drag path (2 tests):** `startDrag` + `setDropTargets` + `triggerDrop` fires `onDropCallback`; dropping on a non-target does not.
- **Parity proof (1 test):** Both paths run on the same `bi` instance with no cross-contamination.

## Deviations from Plan

None — plan executed exactly as written.

The grid renderers (`GridBoardRenderer.vue`, `HexBoardRenderer.vue`) use `handleCellActivate` / `handleHexActivate` as local wrapper functions that call `boardInteraction.triggerElementSelect()`. These are the correct post-migration pattern and are explicitly NOT included in the forbidden token list; the divergence test documents this distinction in comments.

## Known Stubs

None — this plan creates test files only; no production code was modified.

## Threat Flags

None — test-only files, no new production surface.

## Self-Check: PASSED

Files exist:
- `src/ui/components/auto-ui/renderers/useSelectable.divergence.test.ts` ✓
- `src/ui/components/auto-ui/renderers/drag-keyboard-parity.test.ts` ✓

Commit exists:
- `ee9e4c4` ✓
