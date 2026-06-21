---
phase: 94-interaction-presentation-playability
plan: "05"
subsystem: games/hex,games/go-fish,games/checkers
tags: [refs-migration, presentation-overlay, auto-ui-only, playability-gate, INTERACT-01, INTERACT-03, PRESENT-01, PRESENT-03]
dependency_graph:
  requires: [94-01, 94-04]
  provides: [hex-overlay, go-fish-overlay, checkers-overlay, multi-jump-highlight-refs]
  affects:
    - ~/BoardSmithGames/hex/src/ui/App.vue
    - ~/BoardSmithGames/hex/src/ui/presentation.ts
    - ~/BoardSmithGames/go-fish/src/rules/actions.ts
    - ~/BoardSmithGames/go-fish/src/ui/App.vue
    - ~/BoardSmithGames/go-fish/src/ui/presentation.ts
    - ~/BoardSmithGames/checkers/src/rules/actions.ts
    - ~/BoardSmithGames/checkers/src/ui/App.vue
    - ~/BoardSmithGames/checkers/src/ui/presentation.ts
    - src/ui/index.ts
tech_stack:
  added: []
  patterns:
    - "per-game PresentationOverlay sibling file (import type from boardsmith/ui)"
    - "refs array boardRefs callbacks: { refs: [{ ref, role }] } shape"
    - "multi-jump capturedNotations -> role:'highlight' refs for simultaneous board highlight"
    - "AutoUI-only #game-board slot: <AutoUI :game-view :player-seat :flow-state :presentation>"
key_files:
  created:
    - ~/BoardSmithGames/hex/src/ui/presentation.ts
    - ~/BoardSmithGames/go-fish/src/ui/presentation.ts
    - ~/BoardSmithGames/checkers/src/ui/presentation.ts
  modified:
    - ~/BoardSmithGames/hex/src/ui/App.vue
    - ~/BoardSmithGames/go-fish/src/rules/actions.ts
    - ~/BoardSmithGames/go-fish/src/ui/App.vue
    - ~/BoardSmithGames/checkers/src/rules/actions.ts
    - ~/BoardSmithGames/checkers/src/ui/App.vue
    - src/ui/index.ts
decisions:
  - "PresentationOverlay added to boardsmith/ui public exports (precondition for game overlay files)"
  - "Hex boardRef (element pick) unchanged — pick-handler wraps it as refs:[{ref, role:'highlight'}] internally"
  - "Go Fish rank boardRefs empty case returns {refs:[]} not {} (matches ChoiceBoardRefs required refs shape)"
  - "Checkers capturedNotations mapped from m.captures.map(s => s.notation) in choices builder"
  - "checkersPresentationOverlay includes byAttribute.isKing.true:{label:'K'} for king visual distinction"
  - "All three games: getStoneCount/getKingCount/getCapturedCount helper functions kept (used in #player-stats slot)"
metrics:
  duration: "12 minutes"
  completed: "2026-06-21T23:00:00Z"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 9
requirements: [INTERACT-01, INTERACT-03, PRESENT-01, PRESENT-03]
---

# Phase 94 Plan 05: Per-Game Playability Migration Summary

Three gate games migrated to auto-UI-only with per-game `PresentationOverlay` sibling files and D-01 `refs` array boardRefs callbacks. Checkers multi-jump emits captured squares as `role:'highlight'` refs for simultaneous board highlight (D-01 capability proof).

## Tasks Completed

| Task | Name | Commit (game repo) | Files |
|------|------|--------|-------|
| Pre | Export PresentationOverlay from boardsmith/ui | fd90406 (BoardSmith) | src/ui/index.ts |
| 1 | Hex — AutoUI-only App.vue + presentation overlay | b1fb9ca (hex repo) | App.vue, presentation.ts |
| 2 | Go Fish — refs migration + AutoUI-only App.vue + overlay | f17d3ed (go-fish repo) | actions.ts, App.vue, presentation.ts |
| 3 | Checkers — refs migration incl. multi-jump highlight + AutoUI-only App.vue + overlay | bcce18c (checkers repo) | actions.ts, App.vue, presentation.ts |

## What Was Built

**BoardSmith precondition:** Added `PresentationEntry`, `PresentationOverlay`, and `resolvePresentation` to the `boardsmith/ui` public API (`src/ui/index.ts`). Required for game `presentation.ts` files to `import type { PresentationOverlay } from 'boardsmith/ui'`.

**Hex game:**
- `src/ui/presentation.ts`: exports `hexPresentationOverlay` typed `PresentationOverlay` with `byClass.Cell: { label: '' }` (suppresses cell name — coordinate notation already identifies each cell)
- `src/ui/App.vue`: split-screen removed; `#game-board` slot contains only `<AutoUI :game-view :player-seat :flow-state>`; `:presentation="hexPresentationOverlay"` on `<GameShell>`; HexBoard import dropped; unused slot props (players/isMyTurn/availableActions) dropped
- Build: green

**Go Fish game:**
- `src/rules/actions.ts`: Both `boardRefs` callbacks in `ask` action migrated from `{ targetRef: {...} }` to `{ refs: [{ ref, role: 'target' }] }`. Empty fallback returns `{ refs: [] }` (required shape). Zero `sourceRef`/`targetRef` remaining; `role:` count = 2.
- `src/ui/presentation.ts`: exports `goFishPresentationOverlay` with `byClass.PlayerHand: { label: 'Hand' }`
- `src/ui/App.vue`: split-screen removed; AutoUI-only with overlay; GameTable import dropped
- Tests: 30/30 pass. Build: green.

**Checkers game:**
- `src/rules/actions.ts`:
  - `DestinationChoice` interface extended with `capturedNotations: string[]`
  - `choices` builder populates `capturedNotations: m.captures.map(s => s.notation)` for every move
  - `boardRefs` returns `{ refs: [{ ref: { notation: fromNotation }, role: 'source' }, { ref: { notation: toNotation }, role: 'target' }, ...capturedNotations.map(n => ({ ref: { notation: n }, role: 'highlight' })) ] }` — multi-jump captures all emit `role:'highlight'` so all intermediate squares highlight simultaneously (D-01 capability proof)
  - Zero `sourceRef`/`targetRef` remaining; `capturedNotations` appears in both interface and boardRefs mapping
- `src/ui/presentation.ts`: exports `checkersPresentationOverlay` with `byClass.CheckerPiece: { label: '' }`, `byClass.Square: { label: '' }`, and `byAttribute.isKing.true: { label: 'K' }` for king distinction
- `src/ui/App.vue`: split-screen removed; AutoUI-only with overlay; CheckersBoard import dropped
- Tests: 15/15 pass. Build: green.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Added PresentationOverlay to boardsmith/ui public exports**
- **Found during:** Task 1 setup (precondition check)
- **Issue:** The plan's PRECONDITION states game `presentation.ts` files import `PresentationOverlay` from `boardsmith/ui`, but the type was not exported from `src/ui/index.ts`. Without this export, the import would fail to resolve for TypeScript consumers.
- **Fix:** Added `resolvePresentation`, `PresentationEntry`, and `PresentationOverlay` export block to `src/ui/index.ts` (alongside the existing `registerRenderer` export)
- **Files modified:** `src/ui/index.ts`
- **Commit:** fd90406 (BoardSmith main repo)

### No Other Deviations

All three games executed exactly as described in the PATTERNS.md gate App.vue shape and boardRefs migration patterns.

## Known Stubs

None. All overlay data uses actual game class/attribute names matching the game element class definitions. All `boardRefs` callbacks return populated `refs` arrays derived from live move data.

## Threat Flags

No new threat surface beyond what the plan's threat model covers:

- T-94-05-01 (hidden card overlay re-exposure): **MITIGATED** — Go Fish overlay only declares `PlayerHand: { label: 'Hand' }`, no image or stats for hidden card classes. The 94-04 `__hidden` guard strips image/stats at the resolver level regardless.
- T-94-05-02 (multi-jump refs reference non-existent squares): **ACCEPTED** — `capturedNotations` are notation strings from actual `Square` objects returned by `getValidMovesForPiece()`. They are valid board squares at the time of choice generation; even if they were stale, `matchesRef` would simply find no matching element and no highlight would appear — no authorization or selection derives from highlight refs.
- T-94-05-SC (package install): **N/A** — No new packages installed. Only the existing local `file:../../BoardSmith` link used; no registry installs performed.

## Self-Check: PASSED

- `~/BoardSmithGames/hex/src/ui/presentation.ts` exists: FOUND
- `~/BoardSmithGames/go-fish/src/ui/presentation.ts` exists: FOUND
- `~/BoardSmithGames/checkers/src/ui/presentation.ts` exists: FOUND
- `grep -c "board-comparison" hex/src/ui/App.vue` → 0: CONFIRMED
- `grep -c "board-comparison" go-fish/src/ui/App.vue` → 0: CONFIRMED
- `grep -c "board-comparison" checkers/src/ui/App.vue` → 0: CONFIRMED
- `grep -c "sourceRef|targetRef" go-fish/src/rules/actions.ts` → 0: CONFIRMED
- `grep -c "sourceRef|targetRef" checkers/src/rules/actions.ts` → 0: CONFIRMED
- `grep -n "capturedNotations" checkers/src/rules/actions.ts` → lines 45, 133, 152: CONFIRMED
- Hex build: green
- Go Fish 30/30 tests pass, build green
- Checkers 15/15 tests pass, build green
- BoardSmith commits: fd90406 (pre-task)
- Hex commit: b1fb9ca
- Go Fish commit: f17d3ed
- Checkers commit: bcce18c
