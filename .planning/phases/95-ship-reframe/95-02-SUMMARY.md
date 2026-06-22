---
phase: 95-ship-reframe
plan: "02"
subsystem: docs
tags: [reframe, autoui, docs, slash-command, instructions]
dependency_graph:
  requires: [95-01]
  provides: [SHIP-01-docs, design-game-flow-aligned]
  affects: [docs/, src/cli/slash-command/instructions.md]
tech_stack:
  added: []
  patterns: [production-peer framing, single-UI on-ramp]
key_files:
  modified:
    - docs/ui-components.md
    - docs/component-showcase.md
    - docs/nomenclature.md
    - docs/llm-overview.md
    - src/cli/slash-command/instructions.md
decisions:
  - "AutoUI framed as a valid production choice for simple games across all five target files"
  - "instructions.md: GameTable.vue customization is now explicitly optional; AutoUI is the default shipping UI"
  - "instructions.md: removed DO NOT SKIP mandate, Custom UI panel split-screen verification, and split-screen success criteria"
metrics:
  duration: "~8 minutes"
  completed: "2026-06-22"
  tasks_completed: 2
  tasks_total: 2
---

# Phase 95 Plan 02: Docs & Slash-Command Reframe Summary

**One-liner:** Replaced debug/reference/prototype framing with production-peer framing across five docs/CLI files; aligned `/design-game` slash command with the Plan 01 single-UI scaffold (AutoUI ships by default, custom UI is an optional on-ramp).

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Reframe AutoUI in four markdown docs | b335d08 |
| 2 | Align /design-game slash command with single-UI scaffold | 16673b6 |

## Changes Made

### Task 1 — Four Markdown Docs

**docs/ui-components.md (L139):**
- Old: "Useful for prototyping or as a reference implementation."
- New: "A production-ready UI for any game — ideal for simple games or as a starting point before investing in a custom UI."
- Also added: "Ships as your production UI for simple games — no custom UI required" bullet under the auto-generated UI features list.

**docs/component-showcase.md (L103, L115-118):**
- Heading: "Automatic UI generation for prototyping." → "Production-ready automatic game UI."
- Removed "Debugging game state" and "Reference implementation" bullets.
- Replaced with: "Shipping simple games as a complete, production-ready UI" and kept rapid prototyping as a secondary use.

**docs/nomenclature.md (L416, L421):**
- Definition: replaced "Useful for prototyping and as a reference implementation." with "A valid production choice for simple games, and a solid starting point before building a custom UI."
- Usage example: "Use AutoUI to test rules before building custom UI" → "Use AutoUI to ship simple games or build rules before investing in a custom UI"

**docs/llm-overview.md (L13):**
- Appended "and can ship as the production UI for simple games" to the AutoUI capability line.

### Task 2 — /design-game Slash Command (instructions.md)

**L698 (section heading + mandate):**
- "GameTable.vue Generation (REQUIRED)" → "GameTable.vue Generation (Optional Custom UI)"
- Replaced "You MUST customize GameTable.vue" mandate with clear single-UI framing: AutoUI is immediately playable and a valid ship choice; GameTable is an optional path when a bespoke UI is wanted.

**L1027–1040 (Step 4):**
- "Step 4: Customize GameTable.vue (REQUIRED)" → "Step 4: Custom UI (Optional On-Ramp)"
- Removed "DO NOT SKIP THIS STEP. You MUST replace it..." mandate.
- Added two-step activation path: fill GameTable.vue AND set boardsmith.json "ui" to activate.
- Removed "Custom UI panel should show" split-screen verification language.
- Verification step now scoped to "only if you implemented a custom UI."

**L400 (Goal checklist):**
- "Customize GameTable.vue for the game type" → "Optionally customize GameTable.vue for a bespoke UI (not required — AutoUI ships by default)"
- Success criterion updated: "Custom UI shows actual game elements (not JSON)" → "AutoUI renders the game (or custom UI if GameTable.vue has been filled in)"

## Deviations from Plan

None — plan executed exactly as written. The three instructions.md locations matched the RESEARCH surface precisely. No embedded App.vue/GameShell template was found in instructions.md (the templates are GameTable.vue aspect templates, not App.vue), so no App.vue template update was needed.

## Verification

```
grep -rniE "reference implementation|debugging game state" docs/ui-components.md docs/component-showcase.md docs/nomenclature.md docs/llm-overview.md
# (no output — PASS)

grep -niE "DO NOT SKIP THIS STEP|board-comparison|Auto-Generated UI|Custom UI panel" src/cli/slash-command/instructions.md
# (no output — PASS)

grep -rniE "debug aid|reference aid|reference implementation|prototyping.only|Custom vs Auto|split-screen" docs/ui-components.md docs/component-showcase.md docs/nomenclature.md docs/llm-overview.md src/cli/slash-command/instructions.md
# (no output — PASS)
```

## Self-Check: PASSED

- [x] docs/ui-components.md modified: AutoUI has production-peer framing + "ships as production UI" bullet
- [x] docs/component-showcase.md modified: "Production-ready automatic game UI"; debug/reference bullets removed
- [x] docs/nomenclature.md modified: definition and usage example updated
- [x] docs/llm-overview.md modified: "can ship as the production UI for simple games" appended
- [x] src/cli/slash-command/instructions.md modified: mandatory mandate removed; optional on-ramp framing added; no split-screen language remains
- [x] Task 1 commit: b335d08
- [x] Task 2 commit: 16673b6
