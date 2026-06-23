---
phase: 99-theming-swap-wave-2
plan: "07"
subsystem: ui/chrome
tags: [theming, slate, actionpanel, tokens, teal-button]
dependency_graph:
  requires: [99-01]
  provides: [THEME-03, THEME-07]
  affects: [src/ui/components/auto-ui/ActionPanel.vue]
tech_stack:
  added: []
  patterns:
    - "Primary button as teal plate: var(--bsg-accent) fill + var(--bsg-accent-ink) label + var(--bsg-shadow-sm) elevation"
    - "Surfaces tokenized atomically (background + ink togther in same edit)"
    - "var(--bsg-selectable) for accent-tinted chip/row backgrounds"
key_files:
  created: []
  modified:
    - src/ui/components/auto-ui/ActionPanel.vue
    - .stylelintrc.cjs
decisions:
  - "Primary action button uses teal plate pattern (--bsg-accent bg, --bsg-accent-ink text, --bsg-shadow-sm) with no colored glow; hover lifts translateY(-1px) + --bsg-shadow"
  - "Undo button demoted to secondary/neutral: --bsg-surface-2 fill, --bsg-line-2 border, --bsg-ink text"
  - "Dead-code first .skip-btn block removed; second already-tokenized block serves both choice-skip and animation-skip contexts"
  - "Duplicate @keyframes pulse collapsed to single definition"
  - "ActionPanel.vue removed from .stylelintrc.cjs ignoreFiles"
metrics:
  duration: "~8 min"
  completed: "2026-06-23"
  tasks_completed: 1
  tasks_total: 1
  files_changed: 2
---

# Phase 99 Plan 07: ActionPanel Slate Sweep Summary

ActionPanel fully tokenized to Slate: primary action button is the teal plate (--bsg-accent / --bsg-accent-ink / --bsg-shadow-sm, no glow), undo is a quiet neutral secondary, all 36 hex literals and 33 rgba glass/glow values replaced with --bsg-* tokens.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Primary teal button + tokenize action-dock surfaces (atomic) | 1709fcb | ActionPanel.vue, .stylelintrc.cjs |

## What Was Built

- **Primary action button** (``.action-btn``): ``background: var(--bsg-accent)``, ``color: var(--bsg-accent-ink)``, ``box-shadow: var(--bsg-shadow-sm)``; hover lifts ``translateY(-1px)`` with ``var(--bsg-shadow)`` — no colored glow of any kind.
- **Undo button** (``.undo-btn``): overrides to ``var(--bsg-surface-2)`` fill, ``1px solid var(--bsg-line-2)`` border, ``var(--bsg-ink)`` text — clearly secondary, no accent.
- **Choice buttons** (``.choice-btn``): ``var(--bsg-surface-2)`` / ``var(--bsg-line)`` / ``var(--bsg-ink)``; hover uses ``var(--bsg-selectable)`` tint + ``var(--bsg-accent)`` border.
- **Filtered choice buttons** (``.filtered-choice-btn``): same surface pattern as choice-btn, losing the green neon tint.
- **Accumulated-selections strip**: ``var(--bsg-selectable)`` + ``var(--bsg-line-2)`` border instead of rgba(0,217,255,…) glow.
- **Chips** (``selected-value.from-board``, ``accumulated-chip``): ``var(--bsg-selectable)`` fill, ``var(--bsg-accent)`` text.
- **Dock surfaces** (``element-instruction``, ``waiting-message``, ``selected-value``, ``number/text inputs``): ``var(--bsg-field)``/``var(--bsg-surface-2)`` + ``var(--bsg-line)`` hairlines.
- **Multi-select** (checkboxes, labels, ``selected`` state): ``var(--bsg-surface-2)``/``var(--bsg-line)``/``var(--bsg-ink)``; checked checkbox uses ``var(--bsg-accent)`` fill + ``var(--bsg-accent-ink)`` checkmark.
- **Loading / status text**: ``var(--bsg-ink-2)``/``var(--bsg-ink-3)`` throughout.
- **``ActionPanel.vue`` removed** from ``.stylelintrc.cjs`` ``ignoreFiles``.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Dead Code] Removed first .skip-btn block**
- **Found during:** Task 1
- **Issue:** A ``/* Skip button for optional selections */`` ``.skip-btn`` block (with rgba literals ``rgba(128,128,128,.2)``, ``rgba(128,128,128,.4)``, ``#999``, ``#ccc``) existed above the already-tokenized second ``.skip-btn`` block. Because both have equal specificity and the second appears later in the cascade, the first block had **zero effect** — it was already overridden before the sweep. Retaining it would require tokenizing dead code.
- **Fix:** Removed the first ``.skip-btn`` / ``.skip-btn:hover`` block. The second tokenized block (``var(--bsg-surface)``, ``var(--bsg-line)``, ``var(--bsg-ink-2)``) serves both choice-skip and animation-skip contexts correctly.
- **Files modified:** ``src/ui/components/auto-ui/ActionPanel.vue``
- **Commit:** 1709fcb

**2. [Rule 1 - Dead Code] Collapsed duplicate @keyframes pulse**
- **Found during:** Task 1
- **Issue:** ``@keyframes pulse`` was defined twice in the style block (once for ``.loading-indicator``, once for ``.loading-choices``). Duplicate keyframe names in the same scope are a lint hazard and unnecessary.
- **Fix:** Kept the single ``@keyframes pulse`` definition early in the block; both ``.loading-indicator`` and ``.loading-choices`` reference it via ``animation: pulse …``.
- **Files modified:** ``src/ui/components/auto-ui/ActionPanel.vue``
- **Commit:** 1709fcb

## Verification

- ``npx stylelint --custom-syntax postcss-html --config .stylelintrc.cjs src/ui/components/auto-ui/ActionPanel.vue`` → **PASS** (zero violations)
- ``grep -E '#00d9ff|#00ff88|rgba\(46,…|color:#fff'`` → **none found**
- ``grep 'var(--bsg-accent-ink)'`` → **present**
- ``npx vitest run ActionPanel.test.ts ActionPanel.smoke.test.ts ActionPanel.interaction.test.ts`` → **19/19 passed**

## Known Stubs

None. All tokens are real ``--bsg-*`` values registered in ``theme.ts`` from Phase 98.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes introduced.

## Self-Check: PASSED

- src/ui/components/auto-ui/ActionPanel.vue — FOUND (modified, no hex literals remain)
- .stylelintrc.cjs — FOUND (ActionPanel.vue removed from ignoreFiles)
- commit 1709fcb — FOUND
