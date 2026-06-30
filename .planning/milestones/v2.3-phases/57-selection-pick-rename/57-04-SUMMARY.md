---
phase: 57-selection-pick-rename
plan: 04
completed: 2026-01-22
duration: ~5 minutes

subsystem: documentation
tags: [nomenclature, pick, terminology, docs, templates]

dependency-graph:
  requires: [57-01, 57-02, 57-03]
  provides: [updated-docs-pick-terminology, updated-cli-templates]
  affects: [new-game-projects, developer-experience]

tech-stack:
  patterns: [nomenclature-standardization, api-rename]

file-tracking:
  modified:
    - docs/custom-ui-guide.md
    - docs/common-pitfalls.md
    - docs/api/ui.md
    - docs/ui-components.md
    - docs/element-enrichment.md
    - src/cli/slash-command/instructions.md
    - src/cli/slash-command/aspects/square-grid.md

decisions:
  - id: DOCS-01
    decision: "Update user-facing docs to use pick terminology"
    rationale: "Consistency with engine rename in 57-01/57-02"
  - id: DOCS-02
    decision: "Update CLI templates for boardsmith init"
    rationale: "New projects should use modern pick API from day one"
---

# Phase 57 Plan 04: Documentation Updates Summary

Updated documentation and CLI templates to use pick terminology consistently.

## One-liner

Documentation and CLI templates updated: currentSelection -> currentPick, SelectionMetadata -> PickMetadata

## Commits

| Commit | Description |
|--------|-------------|
| 1d20dd6 | docs(57-04): update core documentation with pick terminology |
| c9d1aa7 | docs(57-04): update API reference with pick terminology |
| 5a5a820 | docs(57-04): update CLI templates with pick terminology |

## Changes Made

### Task 1: Core Documentation
Updated user-facing documentation in:
- `docs/custom-ui-guide.md` - Replaced currentSelection with currentPick, updated code examples
- `docs/common-pitfalls.md` - Replaced getSelectionChoices with getPickChoices

### Task 2: API Reference Documentation
Updated API documentation in:
- `docs/api/ui.md` - Replaced injectSelectionStepFn with injectPickStepFn
- `docs/ui-components.md` - Replaced currentSelection with currentPick, updated PickMetadata types
- `docs/element-enrichment.md` - Replaced currentSelection with currentPick, updated PickMetadata type import

### Task 3: CLI Templates
Updated generated code templates in:
- `src/cli/slash-command/instructions.md` - currentSelection -> currentPick in template code
- `src/cli/slash-command/aspects/square-grid.md` - currentSelection -> currentPick in grid game template

## Verification Results

- `grep "currentSelection" docs/` - No matches (as expected)
- `grep "currentSelection" src/cli/slash-command/` - No matches (as expected)
- `grep "currentPick" docs/` - Found in 4 files (confirmed)
- `grep "currentPick" src/cli/slash-command/` - Found in 2 files (confirmed)

## Deviations from Plan

None - plan executed exactly as written.

## Next Phase Readiness

Phase 57 (selection-to-pick rename) is now complete:
- 57-01: Engine types renamed (Selection* -> Pick*)
- 57-02: UI composables updated (currentSelection -> currentPick)
- 57-03: Extracted games updated
- 57-04: Documentation and templates updated

The v2.3 Nomenclature Standardization milestone continues with Phase 58.
