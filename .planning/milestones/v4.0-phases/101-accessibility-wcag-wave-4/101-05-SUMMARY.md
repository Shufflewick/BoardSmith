---
phase: 101-accessibility-wcag-wave-4
plan: 05
subsystem: ui
tags: [vue, a11y, wcag, live-region, aria, focus-ring, skip-link, toast, vitest]

# Dependency graph
requires:
  - phase: 101-accessibility-wcag-wave-4
    provides: "101-01 keystones (useSelectable, useFocusTrap, --bsg-warn contrast)"
provides:
  - "Dual ARIA live regions (polite/assertive) in GameShell wired to turn/connection/game-over"
  - "GameHistory role=log for AT-announced additions"
  - "Global :focus-visible ring + reduced-motion block in non-scoped GameShell style"
  - ".vh visually-hidden utility + .sr-skip skip link + h1 landmark in GameShell"
  - "Accessible Toast with role=status/alert and real dismiss button"
  - "liveRegionAnnouncer.ts pure helper (14 behavioral tests)"
  - "Toast.a11y.test.ts (7 jsdom tests)"
affects: [101-06, 101-07, 101-08, 101-09, 101-10]

# Tech tracking
tech-stack:
  added: ["@vitejs/plugin-vue added to vitest.config.ts plugins (already installed)"]
  patterns:
    - "Pure-helper extraction for Vue watcher logic (enables unit testing without component mount)"
    - "immediate:false watchers for live region writes (Pitfall 2 guard)"
    - "announce postMessage alongside each live-region write for host relay"
    - "Non-scoped global style block in GameShell for cross-component a11y primitives"

key-files:
  created:
    - src/ui/composables/liveRegionAnnouncer.ts
    - src/ui/components/GameShell.live-region.test.ts
    - src/ui/components/Toast.a11y.test.ts
  modified:
    - src/ui/components/GameShell.vue
    - src/ui/components/GameHistory.vue
    - src/ui/components/GameHeader.vue
    - src/ui/components/Toast.vue
    - vitest.config.ts

key-decisions:
  - "Extract live-region mapping to pure liveRegionAnnouncer.ts helper rather than testing full GameShell mount — avoids complex mocking while achieving behavioral coverage"
  - "immediate:false on all live-region watchers (Pitfall 2: AT silently drops regions written at mount)"
  - "announce postMessage emitted alongside each live-region write for host relay (deferred)"
  - "Non-scoped style block is the single source for :focus-visible, prefers-reduced-motion, .vh, .sr-skip — child components inherit without per-element outline rules"
  - "Body-click toast dismissal removed; only dismiss button dismisses (keyboard/AT safety)"
  - "Pre-existing hex violations in GameShell.vue and GameHeader.vue migrated to --bsg-* tokens (Rule 3: lint:css gate blocked)"

patterns-established:
  - "Pattern: Global a11y primitives owned by GameShell non-scoped style block — one place for focus ring, motion, skip utilities"
  - "Pattern: Live-region watcher discipline — always immediate:false, always write via helper, always emit announce postMessage"

requirements-completed: [A11Y-02, A11Y-03, A11Y-06, A11Y-08, A11Y-10]

# Metrics
duration: 35min
completed: 2026-06-23
---

# Phase 101 Plan 05: Shell A11Y Primitives Summary

**GameShell becomes the single owner of all shell-level a11y: dual ARIA live regions wired to turn/connection/game-over, global :focus-visible ring + reduced-motion block, skip link + visually-hidden h1, and accessible Toast with role=status/alert + dismiss button**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-06-23T10:05:00Z
- **Completed:** 2026-06-23T10:17:00Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Dual ARIA live regions mounted unconditionally in GameShell template (never v-if per Pitfall 2); watchers with `immediate: false` fire "Your turn", "Reconnecting…", "Reconnected", and "Game over — [winner] wins" to the appropriate polite/assertive region; `announce` postMessage emitted alongside each write
- GameHistory `messages-container` gains `role="log" aria-live="polite" aria-relevant="additions"`
- Non-scoped global style block in GameShell adds `:focus-visible` ring (bsg tokens), `@media (prefers-reduced-motion: reduce)` halt-all block, `.vh` visually-hidden utility (NOT display:none), and `.sr-skip` skip-link class
- Skip link `<a class="sr-skip" href="#main">` and `<h1 class="vh">BoardSmith — game board</h1>` added at template root; `<main id="main">` confirmed
- `outline: none` deleted from GameHeader `.zoom-slider` — global ring covers it
- Toast redesigned: `:role` binding (alert/status), body-click dismissal removed, real `<button aria-label="Dismiss">` with 44x44px min target added
- 21 behavioral tests green (14 live-region pure-function tests + 7 Toast jsdom tests)

## Task Commits

Each task was committed atomically:

1. **Task 1: Dual live regions + announce wiring + GameHistory log role** - `0a5622e` (feat)
2. **Task 2: Global focus ring + reduced-motion + skip link + h1 + token migration** - `327d89e` (feat)
3. **Task 3: Accessible Toast + jsdom test** - `758d20c` (feat)

**Plan metadata:** pending (docs commit)

## Files Created/Modified

- `src/ui/composables/liveRegionAnnouncer.ts` — Pure mapping functions: announceTurnChange, announceConnectionChange, announceGameOver, announceOpponentTurn
- `src/ui/components/GameShell.live-region.test.ts` — 14 behavioral unit tests for the pure helper
- `src/ui/components/Toast.a11y.test.ts` — 7 jsdom tests for Toast role mapping and dismiss button
- `src/ui/components/GameShell.vue` — Dual live regions, skip link, h1, id=main, global style block, hex token migration
- `src/ui/components/GameHistory.vue` — role=log aria-live=polite aria-relevant=additions on messages container
- `src/ui/components/GameHeader.vue` — outline:none deleted from .zoom-slider, hex token migration
- `src/ui/components/Toast.vue` — role=status/alert, dismiss button, body-click removed
- `vitest.config.ts` — Added @vitejs/plugin-vue to plugins (needed for .vue SFC in tests)

## Decisions Made

- **Pure helper over component mount:** GameShell is too complex to mount in tests (deep dependency injection). Extracted announce-mapping logic to `liveRegionAnnouncer.ts` and tested pure functions — achieves behavioral coverage without component scaffolding.
- **immediate:false mandate:** All four live-region watchers use `{ immediate: false }`. This is the single most important guard against the "silent first announcement" pitfall (Pitfall 2 per 101-RESEARCH.md).
- **announce postMessage for host relay:** Each live-region write emits `{ source: 'boardsmith-a11y', type: 'announce', level, text }` via `window.postMessage`. Host relay is deferred to a future plan.
- **Non-scoped global style:** All a11y CSS primitives in one non-scoped GameShell block. Child components inherit `:focus-visible` ring without per-element outline rules.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Pre-existing hex color violations blocking lint:css gate**
- **Found during:** Task 2 (lint:css verification step)
- **Issue:** GameShell.vue had 7 hex literals (`#1a1a2e`, `#16213e`, `#fff`, `#f59e0b`, `#e74c3c`, `#666`) and GameHeader.vue had 14 hex literals (`#00d9ff`, `#00ff88`, `#aaa`, `#27ae60`, `#f39c12`, `#fff`) in their scoped style blocks. Pre-existing from before the worktree's base commit.
- **Fix:** Replaced all hex literals with `--bsg-*` tokens: `var(--bsg-bg)`, `var(--bsg-ink)`, `var(--bsg-warn)`, `var(--bsg-danger)`, `var(--bsg-ink-2)`, `var(--bsg-accent)`, `var(--bsg-ok)`, `var(--bsg-accent-ink)`
- **Files modified:** `src/ui/components/GameShell.vue`, `src/ui/components/GameHeader.vue`
- **Verification:** Targeted stylelint run exits 0 on both files
- **Committed in:** `327d89e` (Task 2 commit)

**2. [Rule 3 - Blocking] vitest.config.ts missing @vitejs/plugin-vue for .vue SFC imports**
- **Found during:** Task 3 (TDD RED phase — Toast.a11y.test.ts failed: "Install @vitejs/plugin-vue to handle .vue files")
- **Issue:** The worktree's vitest config lacked the Vue plugin. Package is already installed in main repo's node_modules.
- **Fix:** Added `import vue from '@vitejs/plugin-vue'` and `plugins: [vue()]` to `vitest.config.ts` — matches main repo's config.
- **Files modified:** `vitest.config.ts`
- **Verification:** `npx vitest run src/ui/components/Toast.a11y.test.ts` exits 0 (7/7 pass)
- **Committed in:** `758d20c` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking)
**Impact on plan:** Both auto-fixes necessary for correctness (lint gate) and test execution. No scope creep.

## Issues Encountered

- **Pre-existing test failure:** `useActionController.test.ts` has 1 failing test ("should preserve followUp pre-filled args when skip triggers auto-execute") that predates this plan. Not touched by this work — deferred.
- **Teleport + test-utils:** Toast uses `<Teleport to="body">` which places elements outside the wrapper's element tree. Tests query `document.body` directly rather than `wrapper.findAll()`.

## Known Stubs

None — all live regions are wired to reactive state, all tests assert real behavior.

## Next Phase Readiness

- All shell-level a11y primitives in place; plans 101-06 through 101-10 can reference `.vh`, `.sr-skip`, and the live-region watcher pattern
- The announce postMessage channel is open; a future plan can wire it to the host relay
- `@vitejs/plugin-vue` in vitest config unlocks Vue component mounting in all future test files

---
*Phase: 101-accessibility-wcag-wave-4*
*Completed: 2026-06-23*
