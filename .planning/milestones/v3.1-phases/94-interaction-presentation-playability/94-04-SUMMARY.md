---
phase: 94-interaction-presentation-playability
plan: "04"
subsystem: ui/presentation
tags: [presentation-overlay, security, auto-ui, renderers, PRESENT-01, PRESENT-02, PRESENT-03]
dependency_graph:
  requires: [94-02, 94-03]
  provides: [presentation-resolver, presentation-overlay-chain, overlay-first-renderers, hidden-safe-resolution]
  affects:
    - src/ui/components/auto-ui/presentation.ts
    - src/ui/components/GameShell.vue
    - src/ui/components/auto-ui/AutoUI.vue
    - src/ui/components/auto-ui/AutoRenderer.vue
    - src/ui/components/auto-ui/renderers/CardRenderer.vue
    - src/ui/components/auto-ui/renderers/PieceRenderer.vue
    - src/ui/components/auto-ui/renderers/GridBoardRenderer.vue
    - src/ui/components/auto-ui/renderers/HandRenderer.vue
    - src/ui/components/auto-ui/renderers/HexBoardRenderer.vue
tech_stack:
  added: []
  patterns:
    - "pure-module resolver (no vue runtime, no engine import, local interface)"
    - "provide/inject chain for per-UI presentation overlay (GameShell → AutoUI → AutoRenderer → renderers)"
    - "__hidden guard strips image/stats, allows label/render (PRESENT-02)"
    - "overlay-first rendering with engine fallback (image ?? $image, label ?? element.name)"
    - "renderers never index overlay maps directly — always route through resolvePresentation"
key_files:
  created:
    - src/ui/components/auto-ui/presentation.ts
    - src/ui/components/auto-ui/presentation.test.ts
  modified:
    - src/ui/components/GameShell.vue
    - src/ui/components/auto-ui/AutoUI.vue
    - src/ui/components/auto-ui/AutoRenderer.vue
    - src/ui/components/auto-ui/renderers/CardRenderer.vue
    - src/ui/components/auto-ui/renderers/PieceRenderer.vue
    - src/ui/components/auto-ui/renderers/GridBoardRenderer.vue
    - src/ui/components/auto-ui/renderers/HandRenderer.vue
    - src/ui/components/auto-ui/renderers/HexBoardRenderer.vue
decisions:
  - "resolvePresentation is pure: only import type { Component } from 'vue'; local element interface; no engine import"
  - "byName > byClass > byAttribute precedence; first match wins, no field merging across levels"
  - "__hidden guard returns { label, render } only — image and stats stripped (PRESENT-02 security)"
  - "GameShell provides via toRef(props, 'presentation'); AutoRenderer re-provides as computed for reactive re-render"
  - "Renderers never index overlay.byClass/byName directly — bypass prevention by construction"
  - "CardRenderer: effectiveCardImage computed routes overlay image through hidden-aware logic"
  - "HandRenderer: overlay label > element.name > ownership label (CF-2 + D-04 layering)"
  - "AutoRenderer: added null gameView empty/loading state (CF-3 carry-forward)"
metrics:
  duration: "10 minutes"
  completed: "2026-06-21T21:38:00Z"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 9
---

# Phase 94 Plan 04: Presentation Overlay (PRESENT-01/02/03)

Pure `presentation.ts` resolver with PRESENT-02 `__hidden` security guard, provide/inject chain from GameShell through AutoRenderer, and overlay-first rendering in all five visual renderers.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create pure presentation resolver + tests | 9755e76 | presentation.ts, presentation.test.ts |
| 2 | Wire provide/inject chain (GameShell → AutoUI → AutoRenderer) | 42146c9 | GameShell.vue, AutoUI.vue, AutoRenderer.vue |
| 3 | Consume overlay in visual renderers (overlay-first, hidden-safe) | 9fc7c21 | CardRenderer.vue, PieceRenderer.vue, GridBoardRenderer.vue, HandRenderer.vue, HexBoardRenderer.vue |

## What Was Built

**Pure resolver module (`presentation.ts`):** A dependency-free TypeScript module exporting `PresentationEntry`, `PresentationOverlay`, and `resolvePresentation`. No Vue runtime import (only `import type { Component }`), no engine import, local element interface. Precedence: `byName > byClass > byAttribute` (first match, no field merging). PRESENT-02 guard: when `element.__hidden` is true, strips `image` and `stats`; allows `label` and `render` through. 13 unit tests covering all 6 behaviors.

**Provide/inject chain:** GameShell provides via `toRef(props, 'presentation')` (reactive); AutoUI passes through as prop to AutoRenderer; AutoRenderer re-provides as `computed(() => props.presentation)` so injectors re-render when the prop changes. All three files declare `presentation?: PresentationOverlay` and import the type from the presentation module.

**Overlay-first renderers:** All 5 visual renderers inject `'presentation'` as `ComputedRef<PresentationOverlay | undefined>` and compute `presentationEntry` via `resolvePresentation`. Rendering is overlay-first with engine fallback:
- `image`: overlay URL (stripped by resolver for `__hidden` elements) or engine `$images.face/back`
- `label`: overlay label or `element.name ?? element.className`
- `stats`: `<dl>` block rendered only when `presentationEntry.stats` is present (stripped for hidden)
- `render`: `<component :is="presentationEntry.render">` full override

**Security invariant (PRESENT-02):** Renderers route exclusively through `resolvePresentation`. They never index `overlay.byClass`, `overlay.byName`, or `overlay.byAttribute` directly — there are zero such usages across all 5 renderer files. The `__hidden` guard cannot be bypassed.

**CF-3 carry-forward closed:** AutoRenderer now shows a "Waiting for game state..." empty state when `gameView` is null instead of rendering a blank tableau.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Added carry-forward CF-3 null gameView state to AutoRenderer**
- **Found during:** Task 2 (AutoRenderer was being touched for the presentation provide)
- **Issue:** CF-3 from `94-UI-CARRYFORWARD.md` noted that null `gameView` renders a blank tableau with no loading/empty state. The plan's `critical_notes` directive also states: "If you touch AutoRenderer.vue, add a minimal null-gameView empty/loading state (CF-3)."
- **Fix:** Added `v-if="!gameView"` empty state with "Waiting for game state&hellip;" message (14px, muted `#888888`); all archetype template branches use `v-else-if="gameView"` guard.
- **Files modified:** `AutoRenderer.vue`
- **Committed in:** 42146c9 (Task 2 commit)

### Other Notes

None — plan executed as designed. The provide chain, resolver, and renderer integrations all matched the PATTERNS.md specification exactly.

## Known Stubs

None. All overlay logic is fully wired. When no overlay is provided, renderers fall back to engine topology defaults (Phase 93 behavior). When an overlay is provided, it is resolved and applied for all matching elements.

## Threat Flags

No new threat surface introduced beyond what the plan's threat model covers:

- T-94-04-01 (overlay re-exposes hidden identity via image/stats): **MITIGATED** — `resolvePresentation` strips `image` and `stats` when `element.__hidden`; proven by unit test `'strips image and stats when element.__hidden is true'`; renderers route exclusively through the resolver.
- T-94-04-02 (static overlay stats for hidden class): **MITIGATED** — stats stripped by resolver regardless; `toJSONForPlayer` redaction already removed attribute values before overlay sees them.
- T-94-04-03 (engine gains value-bearing $-prop): **MITIGATED** — `presentation.ts` imports nothing from engine; `grep -rn "from .*engine" src/ui/components/auto-ui/presentation.ts` returns only comments.
- T-94-04-04 (resolution before visibility filtering): **MITIGATED** — resolver runs only in the UI layer on the already-filtered `gameView`; no server-side overlay path.

## Self-Check: PASSED

- `presentation.ts` exists: FOUND
- `presentation.test.ts` exists: FOUND
- 13/13 tests pass: CONFIRMED (npx vitest run ... 13 passed)
- `grep -n "from 'vue'" src/ui/components/auto-ui/presentation.ts` shows only `import type { Component }`: CONFIRMED
- `grep -n "engine" src/ui/components/auto-ui/presentation.ts` shows only comments: CONFIRMED
- `grep -L "resolvePresentation" src/ui/components/auto-ui/renderers/{CardRenderer,PieceRenderer,GridBoardRenderer,HandRenderer,HexBoardRenderer}.vue` is EMPTY: CONFIRMED
- `grep -n "byClass\|byName" src/ui/components/auto-ui/renderers/*.vue` is EMPTY: CONFIRMED
- `grep -n "provide('presentation'" GameShell.vue AutoRenderer.vue` matches both: CONFIRMED
- `grep -n ":presentation" AutoUI.vue` shows pass-through: CONFIRMED
- tsc 0 errors for all 8 modified files: CONFIRMED
- Commits 9755e76, 42146c9, 9fc7c21 exist in git log: CONFIRMED
