---
status: resolved
depth: standard
files_reviewed: 29
findings:
  critical: 5
  warning: 4
  info: 0
  total: 9
resolved:
  critical: 4   # CR-01, CR-02, CR-03, CR-05 fixed; CR-04 dismissed as false positive
  deferred: 4   # WR-01..04 — see dispositions
---

# Phase 99 — Theming Swap (Wave 2): Code Review

Standard-depth adversarial review of the 29 swept source files. The neon→token sweep was
broadly correct (HandRenderer border→outline confirmed fixed; all `var(--bsg-*)` references
resolve to real tokens; `color-mix()` syntax valid; no dangling keyframes/duplicate selectors;
DebugPanel `getTypeColor` returns CSS-var strings, not hex). The review surfaced one real class
of bug the contrast test missed: **selected-state compositions** where a solid accent fill is
painted behind near-white ink (the invisible-text trap), plus a status-badge variant of the same.

## Critical findings & resolution

### CR-01 — DeckRenderer selected/board-selected label invisible (dark) — FIXED
`.deck-container.is-selected/.is-board-selected` paint `background: var(--bsg-selected)` (= solid
`--bsg-accent`), but `.deck-label` (`--bsg-ink`) and `.deck-count` (`--bsg-ink-2`) sat on top →
~2:1 / ~1:1 in dark. **Fix:** pinned both to `var(--bsg-accent-ink)` under the selected states.

### CR-02 — DieRenderer board-selected label invisible (dark) — FIXED
`.die-label` (`--bsg-ink-2`) on solid accent ≈ 1.03:1. **Fix:** `color: var(--bsg-accent-ink)`
under `.die-container.is-board-selected`.

### CR-03 — SpaceRenderer board-selected label invisible (dark) — FIXED
`.space-label`/`.space-count` on solid accent ≈ 1.03:1. **Fix:** pinned both to
`var(--bsg-accent-ink)` under `.space-container.is-board-selected`.

### CR-04 — PieceRenderer board-selected token label — FALSE POSITIVE (dismissed)
The reviewer missed that `.piece-token` carries an inline `background: pieceVisual.color`
(PieceRenderer.vue:186). The `.piece-token-label` therefore sits on the player color, NOT on the
`.piece` selected fill (which is the outer ring behind the token). No invisible-text bug. The
label-vs-player-color contrast is a pre-existing concern unrelated to the Phase 99 sweep.

### CR-05 — GameHeader connection badges invisible (dark) — FIXED
`.connection-badge.connected/.connecting/.disconnected` used `color: var(--bsg-ink)` (near-white)
over solid `--bsg-ok/--bsg-warn/--bsg-danger` (mid-tone in dark) → 1.6–2.5:1. Toast already used
`--bsg-accent-ink` on these same status fills; the badge was inconsistent. **Fix:** all three badge
rules → `color: var(--bsg-accent-ink)`.

## Regression guard added (correctness rule #2 gap closure)
`theme.contrast.test.ts` extended (21 → 30 tests):
- status fills `--bsg-ok/warn/danger` vs `--bsg-accent-ink` ≥ 3:1 in BOTH schemes (catches CR-05 class)
- source guard: DeckRenderer/DieRenderer/SpaceRenderer must pin selected-state labels to
  `--bsg-accent-ink` (catches CR-01/02/03 regression)

## Warnings — dispositions (deferred, with rationale)
- **WR-01** raw hex in `<script>` (FlyingCardsOverlay player colors, suit colors): not neon, not
  CSS, not caught by `color-no-hex`; pre-existing seat/suit literals. Out of the Phase 99 neon-sweep
  scope; candidate for a SEAT_PALETTE-import cleanup in a later pass.
- **WR-02** HexBoardRenderer `.hex-piece-circle` `stroke`/`filter` raw `rgba(0,0,0,.3)`: neutral
  black, not neon, theme-agnostic shadow. Not in the neon-literal gate; minor.
- **WR-03** Toast `.warning` light-mode contrast 3.37:1 (sub-4.5 for small text): a true WCAG-AA
  shortfall but the text is legible (not invisible). The mid-tone `--bsg-warn` needs an always-dark
  on-warn ink to clear 4.5:1 in both themes — proper scope for **Phase 101 (WCAG 2.2 AA contrast
  sweep)**, not the Phase 99 token swap.
- **WR-04** magic px spacing/radius values not tokenized: spacing tokens are NOT part of THEME-01..08
  (color sweep only). Out of scope.
