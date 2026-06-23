---
phase: 100-ia-responsive-wave-3
plan: "01"
subsystem: ui
tags: [gameshell, layout, slate, ia-responsive, actionbar, tdd]
dependency_graph:
  requires: []
  provides:
    - GameShell Slate layout (.stage + .actionbar sibling structure)
    - Persistent actionbar prompt (boardPrompt ?? currentPick.prompt)
    - Conditional action buttons gate (allCurrentChoicesAnchored)
    - ResizeObserver --bsg-dock-h CSS variable
  affects:
    - src/ui/components/GameShell.vue (Phase 103 regression surface)
    - All plans in Phase 100 (keystone — every subsequent plan builds on this structure)
tech_stack:
  added: []
  patterns:
    - ResizeObserver for dock-height measurement
    - CSS container-type:size on .boardregion (first use in BoardSmith)
    - Slate flex-column shell: .app > .stage(.sidebar | .boardregion) + .actionbar
key_files:
  created:
    - src/ui/components/GameShell.ia.test.ts
  modified:
    - src/ui/components/GameShell.vue
decisions:
  - "ActionbarHarness TDD pattern: harness mirrors GameShell.vue actionbar logic; both updated together in GREEN phase"
  - "ResizeObserver disconnected in onUnmounted via module-level dockObserver ref"
  - "boardPrompt ?? actionController.currentPick.value?.prompt is the single prompt source-of-truth"
  - "Turn strip (.turn) kept outside the buttons gate so prompt survives board-anchored-only picks (IA-03)"
metrics:
  duration_minutes: 40
  completed: "2026-06-23T08:10:43Z"
  tasks_completed: 3
  files_changed: 2
---

# Phase 100 Plan 01: GameShell Slate Structural Keystone Summary

GameShell rebuilt from column-stack (header → main → footer) into Slate side-by-side layout: `.stage` (sidebar + boardregion) + full-width `.actionbar` sibling, with persistent prompt, conditional buttons, and ResizeObserver dock-height measurement.

## What Was Built

### Task 1 — Template Restructure

Replaced the game-screen block's column layout with the canonical Slate structure from `planning/mockups/boardsmith-chrome.html`:

- `.stage` = `aside.sidebar` (`.side-head` + `.side-scroll`) beside `main.boardregion`
- `.side-head` contains placeholder `.sw-btn` + `.menubtn` (wiring deferred to plan 100-04)
- `.side-scroll` holds PlayersPanel + sidebar-extra slot + GameHistory (unchanged)
- `main.boardregion` holds the existing zoom-container/slot block; `:set-board-prompt` preserved
- Empty `.actionbar` placeholder with `ref="actionbarRef"` added as sibling of `.stage`
- `<GameHeader>` kept as first child (platform mode gate is plan 100-04)

Commit: `1b12bed`

### Task 2 — Persistent Prompt + Conditional Dock + ResizeObserver (TDD)

**RED** (`8896fe6`): `GameShell.ia.test.ts` written with `ActionbarHarness` starting with empty template — 7 of 12 tests fail.

**GREEN** (`61ac58f`):

Actionbar content wired in `GameShell.vue`:
- Outer dock gate: `v-if="isMyTurn || awaitingPlayerNames.length"` (IA-04)
- `.turn` strip always inside the dock (never gated by allAnchored)
- Prompt source: `boardPrompt ?? actionController.currentPick.value?.prompt`
- Buttons inner gate: `v-if="!props.suppressActionPanel && !actionController.allCurrentChoicesAnchored.value"` (IA-03)
- All original ActionPanel props preserved (parity via useBoardInteraction unchanged)
- Time-travel banner moved inside the buttons gate

ResizeObserver:
- `let dockObserver: ResizeObserver | null = null` at module level
- `onMounted`: creates observer, reads `borderBoxSize[0].blockSize`, sets `--bsg-dock-h`; observes `actionbarRef.value`
- `onUnmounted`: `dockObserver?.disconnect()`

ActionbarHarness template updated to correct logic; all 12 tests pass.

### Task 3 — Baseline Slate CSS

Replaced old `.game-shell__main/__sidebar/__content/__action-bar` CSS with new Slate rules:

| New class | Key rules |
|-----------|-----------|
| `.game-shell__game` | flex column; height: 100dvh (100vh fallback) |
| `.stage` | flex:1; min-height:0; display:flex; position:relative |
| `.sidebar` | flex:none; width:var(--bsg-side); flex-column; min-height:0 |
| `.side-head` | flex row; gap:8px; border-bottom |
| `.sw-btn` | ghost button; font-weight:800; hover:var(--bsg-field) |
| `.menubtn` | 38×38; grid; border; margin-left:auto |
| `.side-scroll` | flex:1; min-height:0; overflow:auto; padding:var(--bsg-s3) |
| `.boardregion` | flex:1; min-height:0; container-type:size; padding-bottom uses var(--bsg-dock-h) |
| `.actionbar` | max-height:min(40dvh,320px); overflow-y:auto; flex-wrap |
| `.turn` | inline-flex; min-height:46px; border-right separator |

**Deleted**: `padding-bottom: 80px`, `padding-bottom: 60px` (platform), `.game-shell__sidebar` max-height:40vh, `width: 280px; min-width: 280px` sidebar, both 768px blocks for old class names.

Replaced 768px breakpoint with new selectors (`.sidebar`, `.boardregion`).

Tokens only: `var(--bsg-*)`, `rgba()`, `color-mix()`. `npm run lint:css` green.

Commit: `12e96c7`

## Test Results

```
src/ui/components/GameShell.ia.test.ts  12 tests passing
src/ui/components/GameShell.theme.test.ts  10 tests passing
Full suite: 1014 tests passing (75 test files)
```

## Deviations from Plan

None — plan executed exactly as written.

## Phase 103 Regression Surface

`GameShell.vue` template + CSS were fully restructured. The following are changed surfaces Phase 103 must re-check against all 9 games + MERC:

- `.boardregion` now has `container-type:size` (first use in BoardSmith — enables `cqw`/`cqh` for plan 100-02)
- Sidebar structure changed: PlayersPanel now inside `.side-scroll` (padding context changed from 15px/20px to `var(--bsg-s3)`)
- ActionPanel now conditionally rendered via the dock gate (`isMyTurn || awaitingPlayerNames.length`)
- `.game-shell__zoom-container` is now inside `.boardregion` (container query context available to zoom scale)

## Known Stubs

- `.sw-btn` and `.menubtn` in `.side-head` are static placeholder buttons with no wiring. Click handlers and host bridge integration are deferred to plan 100-04.
- `.sw-btn__mark` uses `background: var(--bsg-accent); opacity: 0.7` as a placeholder for the actual Shufflewick logo mark (plan 100-04).

## Threat Flags

None — no new network endpoints, auth paths, or trust boundary changes introduced. The actionbar is a flow sibling (not fixed), cannot cover browser UI. ResizeObserver is single, disconnected on unmount, writes one CSS var.

## Self-Check: PASSED

Files created/modified:
- `src/ui/components/GameShell.vue` — FOUND
- `src/ui/components/GameShell.ia.test.ts` — FOUND

Commits:
- `1b12bed` — FOUND (feat: restructure template)
- `8896fe6` — FOUND (test: RED failing tests)
- `61ac58f` — FOUND (feat: wire actionbar content)
- `12e96c7` — FOUND (feat: Slate CSS)
