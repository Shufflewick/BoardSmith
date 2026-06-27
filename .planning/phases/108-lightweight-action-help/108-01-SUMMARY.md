---
phase: 108-lightweight-action-help
plan: "01"
subsystem: engine/session/ui-types
tags: [action-metadata, help-text, propagation, tdd]
dependency_graph:
  requires: []
  provides: [ActionDefinition.help, .help()-builder, ActionMetadata.help-session, ActionMetadata.help-ui]
  affects: [src/engine/action/types.ts, src/engine/action/action-builder.ts, src/session/types.ts, src/session/utils.ts, src/ui/composables/useActionControllerTypes.ts]
tech_stack:
  added: []
  patterns: [TDD red-green, mirror-prompt pattern, optional field propagation]
key_files:
  created:
    - src/session/action-help-propagation.test.ts
  modified:
    - src/engine/action/types.ts
    - src/engine/action/action-builder.ts
    - src/engine/action/action.test.ts
    - src/session/types.ts
    - src/session/utils.ts
    - src/ui/composables/useActionControllerTypes.ts
decisions:
  - "help field is optional everywhere, mirrors prompt field at same position in each type"
  - "buildSingleActionMetadata updated in same commit as buildActionMetadata (PITFALL-1 prevention)"
metrics:
  duration: "~7 minutes"
  completed: "2026-06-27T01:34:22Z"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 6
---

# Phase 108 Plan 01: help field + propagation substrate Summary

Thread `help?: string` through four type/propagation layers — engine `ActionDefinition`, action DSL builder, session `ActionMetadata` (both build paths), and UI `ActionMetadata` composable type — establishing the parity-safe propagation chain before any UI layer consumes it.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add help field to ActionDefinition + .help() builder | b0fd8b2 | types.ts, action-builder.ts, action.test.ts |
| 2 | Propagate help through session + UI ActionMetadata types | 3bc4c61 | session/types.ts, utils.ts, useActionControllerTypes.ts |

## What Was Built

### Task 1: Engine Layer
- Added `help?: string` to `ActionDefinition` interface in `src/engine/action/types.ts`, immediately after `undoable?: boolean`, with a doc comment stating it is display-only and never used as a predicate.
- Added `.help(text: string): this` builder method in `src/engine/action/action-builder.ts`, immediately after `.prompt()`, assigning `this.definition.help = text` and returning `this` for chaining.
- Extended `src/engine/action/action.test.ts` with three unit tests covering: sets help text, undefined when unset, chainable return.

### Task 2: Session + UI Propagation
- Added `help?: string` to `ActionMetadata` interface in `src/session/types.ts` after `prompt?`.
- Added `help: actionDef.help` to the object literal returned by **both** `buildActionMetadata` and `buildSingleActionMetadata` in `src/session/utils.ts` (the critical pitfall — both paths updated in same commit).
- Added `help?: string` to UI `ActionMetadata` interface in `src/ui/composables/useActionControllerTypes.ts`.
- Created `src/session/action-help-propagation.test.ts` with integration tests for both build paths, covering help-set and help-undefined cases.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. This plan establishes type/propagation infrastructure only; no UI rendering yet.

## Threat Flags

None. The `help` field is a plain string with identical trust class to `prompt` — already broadcast in the same channel. No new surface introduced at this layer.

## Self-Check: PASSED

Files verified:
- src/engine/action/types.ts — `help?: string` present inside ActionDefinition ✓
- src/engine/action/action-builder.ts — `.help(text` method present ✓
- src/session/types.ts — `help?: string` present inside ActionMetadata ✓
- src/session/utils.ts — `help: actionDef.help` appears 2 times ✓
- src/ui/composables/useActionControllerTypes.ts — `help?: string` present inside ActionMetadata ✓
- src/session/action-help-propagation.test.ts — integration test file created ✓

Commits verified:
- 81936d0 — test(108-01): failing tests for .help() builder ✓
- b0fd8b2 — feat(108-01): add help field + .help() builder ✓
- 4f163bc — test(108-01): failing propagation tests ✓
- 3bc4c61 — feat(108-01): propagate help through session + UI types ✓

Test results: 744 tests passing (engine + session suites combined)
