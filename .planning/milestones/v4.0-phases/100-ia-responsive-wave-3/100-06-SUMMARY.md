---
phase: 100-ia-responsive-wave-3
plan: "06"
subsystem: ui
tags: [game-over, result-card, slate, ia-07, scrim, winnerseats, tdd]
dependency_graph:
  requires:
    - 100-04 (handleMenuItemClick bridge + connectionHealth pattern)
    - 100-01 (GameShell .boardregion structure where GameOverCard mounts)
  provides:
    - GameOverCard.vue: Slate result overlay — scrim + winners + Rematch/New Game
    - winnerSeats capture + validation from game_state postMessage (T-100-06-01)
    - AutoUI always renders the board (GameOverCard is GameShell's responsibility)
  affects:
    - src/ui/components/GameShell.vue (winnerSeats ref + GameOverCard mount — Phase 103 surface)
    - src/ui/components/auto-ui/AutoUI.vue (flowState prop kept; game-complete banner gone)
tech_stack:
  added: []
  patterns:
    - GameOverCard: absolute scrim inside .boardregion (not fixed) — cannot cover actionbar or browser chrome
    - winnerSeats: Array.isArray + every(typeof === 'number') validation before assigning
    - TDD: RED test commit → GREEN component commit → GREEN wire commit
key_files:
  created:
    - src/ui/components/GameOverCard.vue
    - src/ui/components/GameOverCard.test.ts
  modified:
    - src/ui/components/GameShell.vue
    - src/ui/components/auto-ui/AutoUI.vue
    - src/ui/components/GameShell.ia.test.ts
decisions:
  - "GameOverCard scrim is absolute inside .boardregion (not position:fixed) so it cannot cover .actionbar or browser chrome (T-100-06-02)"
  - "Rematch wired to handleRestartGame (restarts same session); New Game wired to handleMenuItemClick('new-game') (leaves to lobby)"
  - "Dev-WS degrade: winnerSeats stays [] when game_state lacks winners; card renders 'Game Over' without player names"
  - "flowState prop retained on AutoUI.vue for any external consumer still reading it; only the banner logic is removed"
  - "Winner token identity (shape+color+letter) mirrors PlayersPanel.vue SHAPES set for visual consistency"
metrics:
  duration_minutes: 15
  completed: "2026-06-23T08:54:30Z"
  tasks_completed: 2
  files_changed: 5
---

# Phase 100 Plan 06: Game Over Result Card (IA-07) Summary

Slate result card with scrim, winner names, and Rematch/New Game actions replaces the dead-end AutoUI "Game Over!" banner. The final board remains visible behind the scrim. winnerSeats captured with validation from the game_state postMessage.

## What Was Built

### Task 1 — GameOverCard component (TDD)

**RED** (`f94b196`): 11 failing tests in `GameOverCard.test.ts` covering winner naming, dev-degrade (empty winnerSeats), and rematch/new-game emits.

**GREEN** (`a4e84d8`): Created `src/ui/components/GameOverCard.vue`:

- Props: `winnerSeats: number[]`, `players: Player[]`
- Emits: `'rematch'`, `'new-game'`
- `.game-over-scrim`: `position: absolute; inset: 0; z-index: 30` inside `.boardregion` — cannot cover `.actionbar` (sibling of `.stage`) or browser chrome
- Background: `color-mix(in srgb, var(--bsg-bg) 66%, transparent)` — Slate token, no hex literals
- `.game-over-card`: `role="dialog" aria-labelledby="game-over-title"` (focus-trap deferred Phase 101)
- Title: "Game Over" when `winnerSeats=[]`; "{name} wins" for single winner; "{names} win" for multiple
- Winner rows: player token identity (shape+color+letter) mirrors `PlayersPanel.vue` SHAPES set
- Action buttons: `.goc-btn--primary` (New Game) + `.goc-btn--ghost` (Rematch) — Slate tokens only
- `lint:css` green; zero hex literals confirmed

### Task 2 — winnerSeats capture + GameOverCard mount; AutoUI banner removal

**Commit** (`6803d5e`):

**GameShell.vue:**
- Added `import GameOverCard from './GameOverCard.vue'`
- Added `const winnerSeats = ref<number[]>([])` near `connectionHealth`
- In `game_state` handler: `winnerSeats.value = Array.isArray(data.winners) && data.winners.every((n) => typeof n === 'number') ? data.winners : []` — validates before assigning (T-100-06-01)
- Mounted `<GameOverCard v-if="state?.flowState?.complete" :winner-seats="winnerSeats" :players="players" @new-game="handleMenuItemClick('new-game')" @rematch="handleRestartGame" />` inside `.boardregion`, after the connection dot and before the zoom container
- Added Suite 5 to `GameShell.ia.test.ts`: 6 tests covering valid winners capture, absent winners (dev degrade), string-array rejection, non-array rejection

**AutoUI.vue:**
- Removed the `v-if="flowState?.complete"` `.game-complete` banner block
- Removed the `v-else` from `<AutoRenderer>` — board now always renders
- Deleted the `.game-complete` / `.game-complete h2` CSS blocks
- `flowState` prop retained (external consumers may still read it)

## Test Results

```
GameOverCard.test.ts  11 tests passing (new)
GameShell.ia.test.ts  36 tests passing (was 22; +14 for IA-07 winnerSeats Suite 5 + prior)
Full suite: 1066 tests passing (78 test files) — was 1041
npm run lint:css: exit 0
```

## Deviations from Plan

None — plan executed exactly as written. Dev-WS degrade (winnerSeats=[]) is the accepted behavior per Open Question 1 resolution in RESEARCH.md.

## Phase 103 Regression Surface

- `AutoUI.vue` no longer gates the board on `flowState.complete` — Phase 103 regression note to re-check that dev games still display correctly after game over
- `GameShell.vue` now consumes `data.winners` from the `game_state` postMessage — host must send `winners: number[]` for result names to appear; platform-mode validation needed in Phase 103
- `winnerSeats` ref exposed to template; any future test mounting GameShell in platform mode should send a `game_state` with winners

## Known Stubs

None — the result card is fully wired: GameOverCard renders winner names when winnerSeats is non-empty, and degrades intentionally when empty (dev-WS mode). New Game and Rematch are wired to existing bridge functions.

## Threat Flags

None — T-100-06-01 (winner payload validation) and T-100-06-02 (scrim absolute positioning) are both fully mitigated.

## Self-Check: PASSED

Files created:
- `src/ui/components/GameOverCard.vue` — FOUND
- `src/ui/components/GameOverCard.test.ts` — FOUND

Files modified:
- `src/ui/components/GameShell.vue` — FOUND
- `src/ui/components/auto-ui/AutoUI.vue` — FOUND
- `src/ui/components/GameShell.ia.test.ts` — FOUND

Commits:
- `f94b196` — test(100-06): add failing GameOverCard RED tests
- `a4e84d8` — feat(100-06): add GameOverCard Slate result overlay (IA-07)
- `6803d5e` — feat(100-06): wire winnerSeats + GameOverCard; remove AutoUI dead-end banner
