---
created: 2026-06-23
title: Dev-standalone shell does not fill viewport height (white gap below board)
area: dev-host / GameShell layout
severity: low
files:
  - src/cli/dev-host/host.html
  - src/ui/components/GameShell.vue
---

## Problem

In `boardsmith dev` standalone (observed in light-mode OS across hex, go-fish, and
checkers during v4.0 Phase 103 browser verification), the game shell (sidebar +
board region) only occupies the top ~565–640px of the viewport, leaving a white
band of un-themed body background below it before a thin dark bar at the very
bottom. The shell is not filling `100dvh` in the dev-standalone host.

Cosmetic and dev-only — the board is fully usable and players use the platform
host iframe (sized by the host), not this standalone page. No functional impact,
no console errors.

## Likely cause

Possibly introduced or exposed by the Phase 100 layout rework (GameShell height /
dock ResizeObserver / `.boardregion` sizing) interacting with the dev-host
`host.html` container height chain. Needs a quick check of whether GameShell's
height resolves to `100dvh` when mounted inside `host.html`, or whether a parent
in the dev-host chain caps it.

## Solution (to investigate)

Ensure the dev-host `host.html` body/root container establishes full height so the
shell's `100dvh`/`100%` fills the viewport, and the `--bsg-bg` ground covers the
whole page (no white gap) in both light and dark.
