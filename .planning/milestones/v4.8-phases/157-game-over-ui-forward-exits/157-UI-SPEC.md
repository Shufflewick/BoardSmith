# Phase 157: Game-Over UI + Forward Exits — UI Design Contract

**Author:** autonomous (from codebase scout + locked CONTEXT decisions)
**Date:** 2026-07-20
**Scope:** `GameOverCard.vue` presentation changes + the `#game-over` slot surface in `GameShell.vue`.
This is a modification of an existing, shipped component on the Slate design system — NOT a new
design language. Reuse the existing `--bsg-*` tokens; introduce no new palette.

## Design System State

- Existing component: `src/ui/components/GameOverCard.vue` (Slate, `--bsg-*` tokens defined in
  `src/ui/theme.ts`). Tokens already used by the card: `--bsg-surface`, `--bsg-accent`,
  `--bsg-accent-ink`, `--bsg-ink`, `--bsg-line-2`, spacing `--bsg-s*`, radius `--bsg-r-*`,
  `--bsg-shadow`. WCAG 2.2 AA is the standing bar (theme.contrast.test.ts enforces it).
- No new tokens, fonts, or colors. All additions must theme correctly in light AND dark
  (the token system is theme-aware).

## Contract

### 1. Title / label states (fixes the mislabel bug)

The card's headline is a pure function of two inputs — `winners: Player[]` and an explicit
draw/unknown signal:

| State | Condition | Headline |
|-------|-----------|----------|
| Single winner | `winners.length === 1` | `{name} wins` |
| Co-winners | `winners.length > 1` AND rules mean co-win | `{names} win` |
| Draw / no winner | game complete AND winners explicitly empty (`isDraw`) | `Draw` |
| Unknown | winner data unavailable (winners undefined — dev-WS degrade) | `Game Over` |

- The card MUST NOT render winner tokens when there are no winners.
- "Draw" and "Game Over" are visually the same weight/placement as a winner headline (no error/alarm
  styling — a draw is a normal outcome).

### 2. Dismiss affordance

- Add a close control (top-right of the card) labeled for AT (`aria-label="Close"`), using an
  existing icon/button token style already present in the shell (match the ControlsMenu / dialog
  close affordance if one exists; otherwise a text "×" button styled with `--bsg-ink` on transparent,
  min 44×44 CSS px hit target for AA).
- **Escape closes the card** (reverse the current `escapeToClose:false` and the "Escape does NOT
  close" comment). Focus returns to a sensible element (the board region) on dismiss.
- Dismissing hides the card and reveals the final board; it does NOT restart or leave the game.
- The focus trap stays active WHILE the card is shown (unchanged), but is released on dismiss.

### 3. `#game-over` slot

- `GameShell` exposes a `#game-over` scoped slot with slot props: `{ winners: Player[], players:
  Player[], isDraw: boolean, rematch: () => void, newGame: () => void, dismiss: () => void }`.
- When the slot is provided (has content), the default `GameOverCard` is NOT rendered — the game's
  slot content replaces it entirely, in the same absolute position within `.boardregion`.
- The `providesOwnGameOverUI` prop, when true, suppresses BOTH the default card and the slot (the
  game renders its end state inside its own board).

### 4. Forward-exit controls (unchanged appearance, fixed behavior)

- Rematch and New Game buttons keep their current Slate styling (`--bsg-accent` primary). Behavior is
  wired per CONTEXT (both restart). No visual change required; if a dismiss affordance is added the
  buttons remain the primary actions.

## Accessibility

- AA contrast for all new text/controls in light and dark (theme.contrast.test covers tokens; new
  markup must use tokens, not raw colors).
- Close control: 44×44 min target, `aria-label`, keyboard-reachable, Escape-activated.
- The game-over announcement (live region at GameShell.vue:1780-1785) must announce the correct
  outcome including "Draw" — not "Game Over" for a draw.

## Out of scope

- No redesign of the card layout, buttons, or the Slate language.
- No new animation beyond what dismiss requires (a simple fade/hide is fine; reuse existing
  transition tokens if present).

## Verification (design dimensions)

- Labeling correctness (draw vs winner vs unknown) — asserted by component test on rendered text.
- Dismissability (Escape + close button) — asserted by component/focus-trap test.
- Slot suppression + `providesOwnGameOverUI` suppression — asserted by GameShell component test.
- Theme/contrast — existing token tests cover it provided no raw colors are introduced.
