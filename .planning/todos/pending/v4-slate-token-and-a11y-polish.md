---
created: 2026-06-23
title: v4.0 Slate polish — orphaned tokens, lint scope, focus-ring naming, connection-announce seam
area: ui/theme + a11y
severity: low
files:
  - src/ui/theme.ts
  - src/ui/components/GameShell.vue
  - src/ui/composables/liveRegionAnnouncer.ts
  - package.json
---

## Problem (from v4.0 milestone integration audit — all non-blocking)

1. **8 orphaned design tokens** emitted by `theme.ts` but consumed nowhere:
   `--bsg-text-base/-lg/-xl/-2xl`, `--bsg-line-tight/-normal`, `--bsg-dur-slow`,
   `--bsg-elevation`. Either adopt them where the hand-rolled equivalents live, or
   trim the contract surface.
2. **`lint:css` scope gap (TOKEN-06):** the `color-no-hex` glob is `src/ui/**/*.vue`
   only — `src/cli/dev-host/DevHost.vue` is tokenized by discipline, not enforced.
   Extend the glob to cover `src/cli/dev-host/*.vue` so a future raw hex there fails CI.
3. **Focus-ring token naming:** the global `:focus-visible` rule hand-rolls
   `box-shadow: 0 0 0 2px var(--bsg-bg), 0 0 0 4px var(--bsg-accent)` instead of a
   `--bsg-ring`-style token (`--bsg-ring` is used for selection emphasis). Both are
   token-based; unify the naming for clarity.
4. **Connection-health announcement seam (A11Y, platform mode):** the platform
   heartbeat (IA-01) updates the visual connection dot but is NOT announced to
   screen readers; the SR `announceConnectionChange` watches the separate WebSocket
   `connectionStatus` (dev/standalone path only), and the two use different
   vocabularies. Platform-mode connection drops are visual-only. Pairs naturally
   with the deferred **HOST-03** connection banner — wire the heartbeat health into
   the live region (with a unified vocabulary) when the host milestone lands.

## Why non-blocking

All in-scope requirements (incl. A11Y-03 for the dev/standalone path) are
satisfied; these are polish + a platform-mode seam that belongs with host work.
