---
phase: 101-accessibility-wcag-wave-4
verified: 2026-06-23T05:50:00Z
status: human_needed
score: 10/10 must-haves verified
overrides_applied: 0
human_verification:
  - test: "HexBoardRenderer SVG focus under Safari/VoiceOver — Tab into hex board, Arrow between cells, confirm VO announces per-cell aria-labels and Enter selects"
    expected: "VoiceOver announces per-cell aria-labels; Enter triggers selection; roving-tabindex cursor advances with arrow keys"
    why_human: "SVG <g tabindex> focus reliability in real AT is browser-specific; jsdom does not exercise VoiceOver speech output or SVG focus behavior"
  - test: "Screen-reader narration of turn/error/disconnect/game-over"
    expected: "VoiceOver/NVDA speaks 'Your turn', 'Reconnecting…', 'Game over — X wins' (game-over assertive); live-region timing correct"
    why_human: "Live-region announcement voicing and timing is AT-observable, not assertable beyond DOM text content"
  - test: "Two-step + drag interaction across all 9 games in browser (keyboard-only)"
    expected: "Tab to board, activate cells with Enter, then pointer-drag — both move pieces with no console errors"
    why_human: "Cross-repo real-board interaction requires running games; jsdom cannot exercise real drag-drop physics or game rules"
  - test: "Focus-visible ring + ≥44px target visual check"
    expected: "2px-bg/4px-accent double ring visible on every control via Tab navigation; touch targets comfortably tappable on mobile"
    why_human: "Visual rendering of the ring and tap-target size requires browser rendering — cannot be asserted from CSS source alone"
---

# Phase 101: Accessibility — WCAG 2.2 AA (Wave 4) Verification Report

**Phase Goal:** Close the WCAG 2.2 AA gaps including two Critical findings: (1) board fully keyboard-operable via ONE shared `useSelectable()` composable across all 8 renderers + hex, drag preserved as progressive enhancement; (2) board-anchored choices always reachable in a focusable action-panel list. Plus A11Y-03..10.
**Verified:** 2026-06-23T05:50:00Z
**Status:** human_needed — automated checks all pass; 4 documented manual-only items outstanding (per VALIDATION.md)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | `useSelectable()` / `useSelectableGrid()` is the single keyboard-wiring point across all 8 renderers | VERIFIED | All 8 renderer files import from `composables/useSelectable.js`; grep for `handleClick|handleCellClick|handleHexClick` returns zero matches |
| 2  | GridBoardRenderer and HexBoardRenderer carry `role="grid/group"` + `role="gridcell"` + roving tabindex | VERIFIED | GridBoardRenderer: `role="grid"` on container, `role="gridcell"` on cells; HexBoardRenderer: `role="group"` on SVG root, `role="gridcell"` on `<g>` cells |
| 3  | `splitAnchoredChoices` replaces `filterAnchoredChoices`; ActionPanel renders anchored choices as a focusable button list; footer not fully suppressed while picks pending | VERIFIED | `action-panel-helpers.ts:38` exports `splitAnchoredChoices`; `ActionPanel.vue:1090` renders `.anchored-choices` div with `<ul role="list">` buttons when `anchoredChoices.length > 0`; `filterAnchoredChoices` absent |
| 4  | GameShell has dual live regions (role=status/polite + role=alert/assertive); liveRegionAnnouncer module exists; announce postMessage emitted | VERIFIED | `GameShell.vue:1449-1450` — `role="status" aria-live="polite"` + `role="alert" aria-live="assertive"`; `liveRegionAnnouncer.ts` exports `announceTurnChange`, `announceConnectionChange`, `announceGameOver`, `announceOpponentTurn`; `GameShell.vue:178` emits `window.parent.postMessage` announce |
| 5  | GameHistory has `role="log" aria-live="polite"` | VERIFIED | `GameHistory.vue:189` — `role="log" aria-live="polite" aria-relevant="additions"` |
| 6  | Zero `outline: none` in ActionPanel.vue and GameHeader.vue; global `:focus-visible` ring in GameShell | VERIFIED | `grep "outline: none" ActionPanel.vue GameHeader.vue` → 0 matches; `GameShell.vue:1734` — `:focus-visible { box-shadow: 0 0 0 2px var(--bsg-bg), 0 0 0 4px var(--bsg-accent); }` |
| 7  | HamburgerMenu, GameOverCard, ControlsMenu use `role="dialog" aria-modal="true"` + `useFocusTrap`; GameOverCard has `escapeToClose:false` | VERIFIED | HamburgerMenu:103-104 `role="dialog" aria-modal="true"`, imports `useFocusTrap`; GameOverCard:85+89 `aria-modal="true" role="dialog"`, `useFocusTrap` with `escapeToClose: false`; ControlsMenu:37 imports `useFocusTrap` |
| 8  | Global `prefers-reduced-motion: reduce` block halts all animations; PlayersPanel breathe becomes static border | VERIFIED | `GameShell.vue:1744-1750` — canonical `*, *::before, *::after` block with `!important`; `PlayersPanel.vue:290` — `@media (prefers-reduced-motion: reduce)` static border |
| 9  | No `opacity: 0.35` disabled state across renderers (hatch pattern instead); Toast `.warning` ≥4.5:1 both themes in contrast tests; ≥44px targets on cancel/clear/hamburger/⋯ | VERIFIED | `grep "opacity.*0.35"` across all renderers → zero matches; `CardRenderer.vue:495` uses `.card-container.is-disabled { hatch pattern }`; `theme.contrast.test.ts:201` asserts `--bsg-warn vs --bsg-accent-ink ≥ 4.5:1`; `ActionPanel.vue:1213,1295`, `HamburgerMenu.vue:173-174`, `ControlsMenu.vue:198-199` all have `min-height: 44px` |
| 10 | Toasts have `role="status"` (error → `role="alert"`) + `<button aria-label="Dismiss">`; skip link `.sr-skip` → `#main`; visually-hidden `<h1>` in GameShell | VERIFIED | `Toast.vue:19` `:role="toast.type === 'error' ? 'alert' : 'status'"`; `Toast.vue:24` `aria-label="Dismiss"`; `GameShell.vue:1441` `<a class="sr-skip" href="#main">`; `GameShell.vue:1444` `<h1 class="vh">BoardSmith — game board</h1>` |

**Score:** 10/10 truths verified

### Deferred Items

None — all deferred items (host-side skip-link/h1/live-region relay, DebugPanel full ARIA-tabs reskin) are out of scope per CONTEXT.md and addressed in Phase 102 or the host milestone.

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/ui/composables/useSelectable.ts` | Shared keyboard composable (element + grid modes) | VERIFIED | 145 lines; exports `useSelectable()` (element mode) and `useSelectableGrid()` (roving tabindex); handles Enter/Space activation, arrow navigation, tabindex management |
| `src/ui/composables/useFocusTrap.ts` | Shared focus-trap composable | VERIFIED | 147 lines; `open()` saves focus + applies sibling `inert`, `close()` restores; `handleKeydown()` traps Tab, optionally closes on Escape; `escapeToClose` option |
| `src/ui/composables/liveRegionAnnouncer.ts` | Pure live-region message functions | VERIFIED | Exports `announceTurnChange`, `announceConnectionChange`, `announceGameOver`, `announceOpponentTurn` |
| `src/ui/components/auto-ui/action-panel-helpers.ts` | `splitAnchoredChoices` export | VERIFIED | `splitAnchoredChoices` at line 38 partitions choices; `filterAnchoredChoices` is absent |
| `src/ui/components/auto-ui/renderers/CardRenderer.vue` | Uses `useSelectable` | VERIFIED | Imports and calls `useSelectable` at line 22/182 |
| `src/ui/components/auto-ui/renderers/PieceRenderer.vue` | Uses `useSelectable` | VERIFIED | Imports and calls `useSelectable` at line 16/104 |
| `src/ui/components/auto-ui/renderers/DeckRenderer.vue` | Uses `useSelectable` | VERIFIED | Imports and calls `useSelectable` |
| `src/ui/components/auto-ui/renderers/HandRenderer.vue` | Uses `useSelectable` | VERIFIED | Imports and calls `useSelectable` at line 14/242 |
| `src/ui/components/auto-ui/renderers/SpaceRenderer.vue` | Uses `useSelectable` | VERIFIED | Imports and calls `useSelectable` at line 16/91 |
| `src/ui/components/auto-ui/renderers/DieRenderer.vue` | Uses `useSelectable` | VERIFIED | Imports and calls `useSelectable` at line 13/68 |
| `src/ui/components/auto-ui/renderers/GridBoardRenderer.vue` | Uses `useSelectableGrid` + `role=grid/gridcell` | VERIFIED | `useSelectableGrid` at line 19/159; `role="grid"` at 273; `role="gridcell"` at 282 |
| `src/ui/components/auto-ui/renderers/HexBoardRenderer.vue` | Uses `useSelectableGrid` + `role=group/gridcell` | VERIFIED | `useSelectableGrid` at line 26/236; `role="group"` at 313; `role="gridcell"` at 327 |
| `src/ui/composables/useSelectable.test.ts` | Unit tests for keyboard activation + roving tabindex | VERIFIED | File exists in composables directory |
| `src/ui/composables/useFocusTrap.test.ts` | Focus trap unit tests | VERIFIED | File exists in composables directory |
| `src/ui/components/auto-ui/renderers/useSelectable.divergence.test.ts` | Architectural invariant guard (no old handler names) | VERIFIED | Asserts zero `handleClick|handleCellClick|handleHexClick` + all renderers import composable |
| `src/ui/components/auto-ui/renderers/drag-keyboard-parity.test.ts` | Drag + keyboard two-path regression | VERIFIED | Tests both keyboard (Enter/Space) and drag paths against same `createBoardInteraction()` instance |
| `src/ui/components/Toast.a11y.test.ts` | Toast role + dismiss button tests | VERIFIED | Tests `role="status"`, `role="alert"` for error, `<button aria-label="Dismiss">` |
| `src/ui/components/GameShell.live-region.test.ts` | Live region announcement tests | VERIFIED | File exists in components directory |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| All 8 renderers | `boardInteraction.triggerElementSelect` | `useSelectable` / `useSelectableGrid` composable | VERIFIED | Zero old `handleClick` variants; composable is the only wiring point per divergence test |
| `ActionPanel.vue` | `splitAnchoredChoices` | `action-panel-helpers.js` import at line 29 | VERIFIED | `_splitChoices` computed uses it; `anchoredChoices` rendered in secondary list at line 1090 |
| `GameShell.vue` | `liveRegionAnnouncer` functions | Import at lines 14-17; watchers at line 286+ | VERIFIED | All 4 announce functions imported and called from watchers |
| `HamburgerMenu/GameOverCard/ControlsMenu` | `useFocusTrap` | Import + `{ open, close, handleKeydown }` destructure | VERIFIED | All three dialogs import and wire the composable |
| `GameShell` | announce postMessage | `window.parent.postMessage` at line 178 | VERIFIED | Emits alongside live-region writes |

---

## Data-Flow Trace (Level 4)

Not applicable — this phase adds ARIA/keyboard wiring on top of existing data flows. The renderers' `isSelectable`, `isSelected`, `isDisabled` booleans were pre-existing from Phase 99/100 and continue to flow from `useBoardInteraction`. The `useSelectable` composable is a thin wrapper that consumes those booleans and produces ARIA attrs — no new data sources.

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite green | `npx vitest run` | 1184 tests passed, 89 test files | PASS |
| CSS lint clean | `npm run lint:css` | Exit 0, no errors | PASS |
| No `outline: none` in ActionPanel / GameHeader | `grep "outline: none" ActionPanel.vue GameHeader.vue` | Zero matches | PASS |
| No `opacity: 0.35` in any renderer | `grep -rn "opacity.*0\.35" src/ui/components/auto-ui/renderers/` | Zero matches | PASS |
| No `role="tab"` in DebugPanel (Phase-102 scope creep) | `grep -n 'role="tab"' DebugPanel.vue` | Zero matches | PASS |
| `splitAnchoredChoices` exported (not `filterAnchoredChoices`) | `grep "splitAnchoredChoices\|filterAnchoredChoices" action-panel-helpers.ts` | Only `splitAnchoredChoices` at line 38 | PASS |
| All 8 renderers import `useSelectable` or `useSelectableGrid` | `grep "useSelectable" .../*.vue` | All 8 confirmed | PASS |
| GameOverCard `escapeToClose: false` | `grep "escapeToClose.*false" GameOverCard.vue` | Match at line 39 | PASS |
| Global reduced-motion block present | `grep "prefers-reduced-motion" GameShell.vue` | Match at line 1744 with canonical `*, *::before, *::after` block | PASS |

---

## Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| A11Y-01 | Keyboard-operable board via shared `useSelectable()` composable | VERIFIED | All 8 renderers use composable; divergence test guards invariant; drag-keyboard parity test passes |
| A11Y-02 | Board-anchored choices always reachable in focusable action-panel list | VERIFIED | `splitAnchoredChoices` partitions; `.anchored-choices` secondary list renders focusable buttons; `filterAnchoredChoices` removed |
| A11Y-03 | Live regions + `role="log"` + announce postMessage | VERIFIED | Dual live regions in GameShell; `liveRegionAnnouncer.ts` pure functions; GameHistory `role="log"`; postMessage emitted |
| A11Y-04 | Semantic names & state (`aria-label`, `aria-selected`, grid roles) | VERIFIED | All renderers bind `aria-label`/`aria-selected`/`aria-disabled` from same booleans as CSS; `role="grid/gridcell/group"` on board renderers |
| A11Y-05 | Non-color state cues + legend | VERIFIED | Hatch pattern for disabled (CardRenderer:495+); dashed/dotted borders for selectable/drop-target from Phase 99 retained; legend component from Phase 99/100 retained |
| A11Y-06 | Visible focus ring; no bare `outline: none` | VERIFIED | Zero `outline: none` in ActionPanel/GameHeader; global `:focus-visible` ring at GameShell:1734 |
| A11Y-07 | Dialog semantics + focus management (3 dialogs) | VERIFIED | HamburgerMenu, GameOverCard, ControlsMenu all use `role="dialog" aria-modal="true"` + `useFocusTrap`; GameOverCard `escapeToClose:false` |
| A11Y-08 | Global reduced-motion block | VERIFIED | GameShell:1744 canonical `*, *::before, *::after` block; PlayersPanel:290 static border fallback |
| A11Y-09 | Contrast ≥4.5:1 (Toast warning) + ≥44px targets; no opacity-only disabled | VERIFIED | Contrast test at theme.contrast.test.ts:201; 44px on ActionPanel/HamburgerMenu/ControlsMenu; hatch not opacity for disabled |
| A11Y-10 | Toasts: `role="status/alert"` + dismiss button; skip link + `<h1>` | VERIFIED | Toast:19 dynamic role; Toast:24 dismiss button; GameShell:1441 skip link; GameShell:1444 `<h1 class="vh">` |

---

## Anti-Patterns Found

None blocking. No `TBD`, `FIXME`, `XXX` debt markers found in phase-modified files. No stub implementations detected.

---

## Human Verification Required

Per VALIDATION.md, four behaviors are documented as manual-only and cannot be automated:

### 1. HexBoardRenderer SVG focus under Safari/VoiceOver

**Test:** In Safari with VoiceOver enabled, Tab into the hex board, use Arrow keys between cells, press Enter on a selectable cell.
**Expected:** VoiceOver announces per-cell aria-labels (e.g., "e5, white knight, selectable"); roving tabindex advances; Enter triggers selection.
**Why human:** SVG `<g tabindex>` focus reliability is browser-specific; jsdom does not model SVG focus behavior or VoiceOver speech. An automated jsdom test exists and passes (HexBoardRenderer.a11y.test.ts) but real AT behavior requires manual verification. If focus does not land, escalate to overlay-button fallback (CONTEXT.md Open Q3).

### 2. Screen-reader narration of turn/error/disconnect/game-over

**Test:** With VoiceOver or NVDA active, play a turn handoff, force a disconnect (kill network), and finish a game.
**Expected:** "Your turn" spoken politely on handoff; "Reconnecting…" spoken on disconnect; "Game over — X wins" spoken assertively on game-end; "Reconnected" spoken on reconnect.
**Why human:** Live-region announcement timing and voicing is AT-observable, not assertable from DOM text writes alone.

### 3. Two-step + drag interaction across all 9 games in browser (keyboard-only)

**Test:** Load each of the 9 BoardSmithGames in `boardsmith dev`. Keyboard-only: Tab to the board, activate cells with Enter; then pointer-drag — both must move pieces with no console errors.
**Expected:** Both paths produce the same game state change with no console errors; drag remains a progressive enhancement and has not regressed.
**Why human:** Cross-repo real-board interaction requires running actual game rules; cannot be exercised in jsdom.

### 4. Focus-visible ring + ≥44px target visual check

**Test:** Tab through the full game chrome in a browser; check mobile viewport for touch targets.
**Expected:** 2px-bg / 4px-accent double ring is visible on every interactive control. Hamburger, dismiss, cancel, clear, and ⋯ buttons are comfortably tappable (≥44px).
**Why human:** Visual rendering of CSS `box-shadow` rings and physical tap-target size require browser rendering.

---

## Gaps Summary

No gaps. All 10 A11Y requirements (A11Y-01 through A11Y-10) are verified in the codebase. The 4 items above are manual-only per the approved VALIDATION.md — they are not gaps but planned manual verification steps that require a real browser and AT.

Test suite: 1184 tests, 89 files, all passing. CSS lint: exit 0.

---

_Verified: 2026-06-23T05:50:00Z_
_Verifier: Claude (gsd-verifier)_
