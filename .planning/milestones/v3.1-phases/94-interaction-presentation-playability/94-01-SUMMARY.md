---
phase: 94-interaction-presentation-playability
plan: "01"
subsystem: engine/session/ui
tags: [d-01, refs-migration, type-system, pick-handler, drag-drop, action-panel]
dependency_graph:
  requires: []
  provides: [refs-array-protocol, RefWithRole-type, pick-handler-refs, drag-drop-refs, action-panel-refs]
  affects: [94-02, 94-03, 94-04, 94-05, 94-06]
tech_stack:
  added: [RefWithRole interface, refs: RefWithRole[] array pattern]
  patterns: [role-filter pattern, inline RefWithRole for standalone wire modules, boardRefs() returns refs array]
key_files:
  created: []
  modified:
    - src/engine/action/types.ts
    - src/engine/action/index.ts
    - src/engine/index.ts
    - src/session/types.ts
    - src/session/pick-handler.ts
    - src/session/pick-handler.test.ts
    - src/types/protocol.ts
    - src/ui/composables/useActionControllerTypes.ts
    - src/ui/composables/useDragDropTargets.ts
    - src/ui/composables/useDragDropTargets.test.ts
    - src/ui/components/auto-ui/ActionPanel.vue
decisions:
  - "RefWithRole declared inline in protocol.ts and useActionControllerTypes.ts (standalone wire modules must not import from engine)"
  - "session/types.ts imports RefWithRole from engine/action/types.ts (session already imports from engine)"
  - "Element pick always emits refs: [{ ref, role: 'highlight' }] regardless of boardRef presence (consistent shape)"
  - "useDragDropTargets.pickAcceptsDragged uses refs[0].ref for drag-to-select matching (element picks always have highlight-role ref at index 0)"
metrics:
  duration: "~25 minutes"
  completed: "2026-06-21"
  tasks_completed: 3
  files_modified: 11
requirements: [INTERACT-03]
---

# Phase 94 Plan 01: Refs Array Protocol Migration (D-01) Summary

Atomic migration of the entire ref-highlight protocol from singular `sourceRef`/`targetRef`/`ref` fields to a single generalized `refs: RefWithRole[]` array across all 7 type layers and 3 runtime consumers. No backward compatibility — singular fields deleted, not deprecated.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Define the refs contract across all 5 type layers | d0e8759 | 6 type files |
| 2 (RED) | Write failing tests for refs construction | 4d84b35 | pick-handler.test.ts, useDragDropTargets.test.ts |
| 2 (GREEN) | Migrate pick-handler + useDragDropTargets consumers | ee94673 | pick-handler.ts, useDragDropTargets.ts |
| 3 | Migrate all 9 singular-ref read sites in ActionPanel.vue | d71e8ef | ActionPanel.vue, useDragDropTargets.ts, pick-handler.test.ts |

## What Was Built

**RefWithRole interface** (`{ ref: BoardElementRef; role: 'source' | 'target' | 'highlight' }`) introduced in:
- `src/engine/action/types.ts` (authoritative definition)
- `src/types/protocol.ts` (inline, standalone wire module)
- `src/ui/composables/useActionControllerTypes.ts` (inline, standalone UI module)
- Re-exported from `src/engine/action/index.ts` and `src/engine/index.ts`

**ChoiceBoardRefs** replaced: `{ sourceRef?, targetRef? }` → `{ refs: RefWithRole[] }` (required, not optional)

**ChoiceWithRefs** replaced: `sourceRef?`/`targetRef?` → `refs?: RefWithRole[]` in session/types.ts, protocol.ts, useActionControllerTypes.ts

**ValidElement** replaced: `ref?` → `refs?: RefWithRole[]` in all 3 wire/UI type modules

**pick-handler.ts**: Choice pick assigns `choice.refs = result.refs`; element pick computes rawRef and assigns `validElem.refs = [{ ref: rawRef, role: 'highlight' }]`

**useDragDropTargets.ts**: Derives highlight ref from `el.refs?.find(r => r.role === 'highlight')?.ref`; derives drop-target ref from `choice.refs?.find(r => r.role === 'target')?.ref`

**ActionPanel.vue** (9 sites): All `choice.sourceRef`/`choice.targetRef` reads replaced with role-filtered `refs` array accesses

## Verification

- `tsc --noEmit` clean (0 errors in plan files)
- 21 tests green: `src/session/pick-handler.test.ts` (10 tests) + `src/ui/composables/useDragDropTargets.test.ts` (11 tests)
- `grep -vn '^\s*//' ActionPanel.vue | grep -c "\.sourceRef\b\|\.targetRef\b"` → 0
- `grep -rn "sourceRef\|targetRef" src/engine/action/types.ts src/types/protocol.ts src/session/types.ts src/ui/composables/useActionControllerTypes.ts` → ZERO matches

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript error in new pick-handler.test.ts**
- **Found during:** Task 3 final TypeScript check
- **Issue:** `chooseFrom<MoveChoice>` provided 1 type argument but the function expects 2 (`K` key name, `T` value type)
- **Fix:** Removed explicit type argument; annotated `choices` array elements and callback parameters explicitly
- **Files modified:** src/session/pick-handler.test.ts
- **Commit:** d71e8ef

**2. [Rule 2 - Documentation] Stale comments in useDragDropTargets.ts**
- **Found during:** Task 3 final grep verification
- **Issue:** Doc comments still referenced `targetRef` (old API) in JSDoc and dev-warning error messages
- **Fix:** Updated comments and error messages to reference `refs: [{ ref, role: 'target' }]` terminology
- **Files modified:** src/ui/composables/useDragDropTargets.ts
- **Commit:** d71e8ef

### Pre-existing Issues (Out of Scope)

- `useActionController.test.ts` line 1643: 1 pre-existing failing test (unrelated to this plan — `collectEquipment` test regression predates this phase). Logged as out-of-scope; not modified.
- `src/engine/element/image-leak.test.ts`: 9 pre-existing TypeScript errors (`$images` property). Not in scope.

## Known Stubs

None. All ref arrays are populated from actual data: boardRefs() callbacks, boardRef() callbacks, or default `{ id, notation? }` values.

## Threat Flags

No new threat surface introduced. The existing T-94-01-01/T-94-01-02/T-94-01-03 mitigations from the plan's threat model are preserved:
- refs are highlight metadata only, not authorization tokens
- validElements filter ensures hidden elements never become valid choices
- try/catch error-suppression preserved in pick-handler for throwing boardRefs() callbacks

## Self-Check: PASSED

- All 11 modified files exist on disk
- All 4 commits exist in git history (d0e8759, 4d84b35, ee94673, d71e8ef)
- RefWithRole present in all 6 type-layer files
- Zero singular sourceRef/targetRef reads in type files
