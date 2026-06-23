---
phase: 102-material-dev-debug-wave-5
plan: "02"
subsystem: ui
tags: [loading-state, skeleton, retry, unsupported-topology, dev-only, accessibility, a11y]
dependency_graph:
  requires: []
  provides: [DEV-05]
  affects: [AutoRenderer.vue, UnsupportedTopologyPanel.vue]
tech_stack:
  added: []
  patterns: [setTimeout-retry, import.meta.env.DEV gate, TDD RED/GREEN]
key_files:
  created:
    - src/ui/components/auto-ui/AutoRenderer.loading.test.ts
  modified:
    - src/ui/components/auto-ui/AutoRenderer.vue
    - src/ui/components/auto-ui/archetypes/UnsupportedTopologyPanel.vue
decisions:
  - "Used vi.mock() hoisting to stub useFlyingElements/useAnimationEvents/useAutoRendererAnimations so jsdom tests avoid window.matchMedia static initializer"
  - "Retry re-arms a single 8s timer; no fabricated game state (CLAUDE.md: no fallbacks)"
  - "Used /docs/custom-ui-guide.md as the canonical guide link (confirmed exists in repo)"
  - "import.meta.env.DEV is the dev gate (not platformRequest injection which is always provided)"
metrics:
  duration_minutes: 4
  completed: "2026-06-23"
  tasks_completed: 2
  files_changed: 3
---

# Phase 102 Plan 02: Voiced Loading + Unsupported-Topology States Summary

**One-liner:** Animated skeleton with 8s timeout→retry in AutoRenderer; player/dev-split UnsupportedTopologyPanel gated by import.meta.env.DEV.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Failing loading skeleton tests | 911f5e8 | AutoRenderer.loading.test.ts (created) |
| 1 (GREEN) | Skeleton + timeout→retry implementation | 3ed921c | AutoRenderer.vue |
| 2 | Player/dev-split UnsupportedTopologyPanel | f3b66a4 | UnsupportedTopologyPanel.vue |

## What Was Built

**Task 1 — Loading skeleton with timeout→retry (TDD)**

- Replaced bare `<p>Waiting for game state…</p>` in `AutoRenderer.vue` with an animated skeleton (`class="auto-renderer-skeleton"`) containing 4 placeholder bars of varying widths.
- `aria-busy="true"` on the skeleton container; `.sr-only` span with "Loading game…" for screen readers.
- 8-second `setTimeout` arms `loadTimedOut` ref; when it fires, a Retry affordance (`class="auto-renderer-retry"`) appears.
- Retry handler: sets `loadTimedOut = false`, re-arms the timer, emits `'retry'` event. No fabricated game state.
- `onUnmounted` clears the timer; `watch(gameView)` clears on game-state arrival and re-arms on reconnect.
- Skeleton bars animated with `@keyframes skeleton-pulse`; `@media (prefers-reduced-motion: reduce)` disables animation (static bars).
- All Slate tokens: `--bsg-field`, `--bsg-surface`, `--bsg-line`, `--bsg-r-sm`, `--bsg-dur-base`, `--bsg-ink`, `--bsg-ink-3`. No raw hex.
- 11 vitest tests (jsdom) covering: skeleton renders, old text absent, 3+ bars present, aria-busy, sr-only, retry hidden initially, retry shows after 8s, retry hides after click, retry emit, timer re-arms.

**Task 2 — Player/dev-split UnsupportedTopologyPanel**

- Kept verbatim locked player-facing copy (heading + body) in the amber panel — unchanged.
- Added `v-if="isDev"` aside block gated by `const isDev = import.meta.env.DEV` (statically dropped in Vite production bundles — T-102-04).
- Dev aside: quiet styling (`--bsg-surface` bg, `--bsg-ink-3` text, `--bsg-line` border) distinct from loud amber player panel.
- Real link to `/docs/custom-ui-guide.md` (confirmed file exists in repo); no leaked internals (no IDs, paths, traces, attribute names).
- Existing `archetype-selector.test.ts` still passes; `lint:css` green.

## Deviations from Plan

**1. [Rule 3 - Blocking] vi.mock() for animation composables to bypass jsdom matchMedia**

- **Found during:** Task 1 (RED phase test run)
- **Issue:** `useElementAnimation.ts` calls `window.matchMedia()` at module-load time as a static initializer. In jsdom, `window.matchMedia` is undefined, crashing test collection before any test runs.
- **Fix:** Added `vi.mock()` hoists for `useFlyingElements`, `useAnimationEvents`, and `useAutoRendererAnimations`. `vi.mock()` is hoisted before imports by vitest, so the problematic modules are replaced before `useElementAnimation.ts` can execute.
- **Files modified:** `AutoRenderer.loading.test.ts`
- **Commit:** 911f5e8 (RED)

## TDD Gate Compliance

- RED commit: `test(102-02): ...` at 911f5e8 — tests collected (11 tests), 9 failed as expected
- GREEN commit: `feat(102-02): ...` at 3ed921c — all 11 tests pass

## Known Stubs

None.

## Threat Flags

None beyond plan's threat model (T-102-04 and T-102-05 both mitigated as designed).

## Self-Check: PASSED

- `src/ui/components/auto-ui/AutoRenderer.loading.test.ts` — exists, 207+ lines
- `src/ui/components/auto-ui/AutoRenderer.vue` — contains `loadTimedOut`, `prefers-reduced-motion`, no "Waiting for game state"
- `src/ui/components/auto-ui/archetypes/UnsupportedTopologyPanel.vue` — contains `import.meta.env.DEV`, `v-if="isDev"`, verbatim player heading, guide link
- Commits 911f5e8, 3ed921c, f3b66a4 all exist in git log
