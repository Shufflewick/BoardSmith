---
phase: 55-gametable-rename
plan: 02
subsystem: cli-templates
completed: 2026-01-22
duration: 15m
tags: [cli, templates, documentation, nomenclature, vue]

dependency_graph:
  requires: [55-01]
  provides: ["CLI templates generate GameTable.vue", "Documentation uses GameTable naming"]
  affects: [55-03, 55-04, 55-05]

tech_stack:
  patterns: ["project scaffold generation", "slash command templates"]

key_files:
  modified:
    - src/cli/lib/project-scaffold.ts
    - src/cli/slash-command/instructions.md
    - src/cli/slash-command/aspects/dice.md
    - src/cli/slash-command/aspects/square-grid.md
    - src/cli/slash-command/aspects/playing-cards.md
    - src/cli/slash-command/aspects/hex-grid.md
    - docs/getting-started.md
    - docs/ui-components.md
    - docs/component-showcase.md
    - packages/ui/README.md
    - llms.txt

decisions:
  - decision: "Preserve AutoGameBoard references"
    rationale: "AutoGameBoard is a distinct component in public API, not the custom GameTable"
  - decision: "Keep renderGameBoard in api/client.md example"
    rationale: "User-defined function name in their own code, not our API"
---

# Phase 55 Plan 02: CLI Templates and Documentation Summary

**One-liner:** CLI scaffold and /design-game templates now generate GameTable.vue with updated documentation

## What Was Done

### Task 1: Update project-scaffold.ts templates
- Renamed `generateGameBoardVue()` function to `generateGameTableVue()`
- Updated export/import statements to use GameTable
- Changed generated file path from `GameBoard.vue` to `GameTable.vue`
- Updated placeholder notice text

**Commit:** b5d6f89

### Task 2: Update /design-game instructions and aspect templates
- Updated 11 occurrences in instructions.md
- Updated section headers in all 4 aspect templates:
  - dice.md
  - square-grid.md
  - playing-cards.md
  - hex-grid.md

**Commit:** d8ef25c

### Task 3: Update documentation files
- getting-started.md: file tree and template usage
- ui-components.md: examples and comments (preserved AutoGameBoard)
- component-showcase.md: MyGameBoard -> MyGameTable
- packages/ui/README.md: MyGameBoard -> MyGameTable

**Commit:** cebb348

### Task 4: Regenerate llms.txt
- Regenerated with repomix to reflect all documentation changes
- Verified only AutoGameBoard references remain

**Commit:** d347938

## Verification Results

All verification checks passed:

1. `grep "GameBoard" src/cli/lib/project-scaffold.ts` - empty (pass)
2. `grep "GameBoard" src/cli/slash-command/` - empty (pass)
3. `grep "GameBoard" docs/getting-started.md` - empty (pass)
4. `grep "GameBoard" docs/ui-components.md` - only AutoGameBoard (pass)
5. `grep "MyGameBoard" packages/ui/README.md` - empty (pass)
6. `grep "GameBoard" llms.txt` - only AutoGameBoard and nomenclature migration notes (pass)

## Deviations from Plan

None - plan executed exactly as written.

## Artifacts

| File | Changes |
|------|---------|
| src/cli/lib/project-scaffold.ts | Function rename, generated file path change |
| src/cli/slash-command/instructions.md | 11 GameBoard -> GameTable replacements |
| src/cli/slash-command/aspects/*.md | Section header updates (4 files) |
| docs/getting-started.md | File tree and component usage |
| docs/ui-components.md | 6 component references updated |
| docs/component-showcase.md | MyGameTable example |
| packages/ui/README.md | MyGameTable example |
| llms.txt | Regenerated with updated content |

## Next Phase Readiness

**Ready for 55-03:** Core engine types documentation to add GameTable/Table terminology.

All CLI templates now correctly generate GameTable.vue for new projects and /design-game usage.
