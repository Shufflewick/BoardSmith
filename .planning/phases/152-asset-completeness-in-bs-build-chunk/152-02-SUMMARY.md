---
phase: 152-asset-completeness-in-bs-build-chunk
plan: 02
subsystem: ui
tags: [vue, auto-ui, renderers, assets, a11y]

# Dependency graph
requires:
  - phase: 152-01
    provides: AssetImage.vue single kind-discriminant component (custom-UI path load/error guard)
provides:
  - CardRenderer.vue url-image branch (Baseline 1) reveals the real <img> only after @load, reverts to the drawn .card-face fallback on @error
  - PieceRenderer.vue image branch (engine pieceVisual.image AND presentationEntry.image overlay, merged into one effective-src computed) reveals the real <img> only after @load, reverts to the drawn .piece-token fallback on @error
  - Zero-layout-diff load-guard pattern: fallback + absolutely-positioned overlay <img> inside one fixed-size container, driven by a `loaded` ref reset on src change
affects: [153-devhost-reconnect, 154-merc-revendor, future auto-ui renderer work]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Load-guarded image reveal: drawn fallback always in the DOM inside a fixed-size container; <img> overlays absolutely, revealed via a `loaded` ref only on @load, reverted on @error; ref reset via watch() on resolved src to re-guard reused elements"

key-files:
  created:
    - src/ui/components/auto-ui/renderers/CardRenderer.asset-fallback.test.ts
    - src/ui/components/auto-ui/renderers/PieceRenderer.asset-fallback.test.ts
  modified:
    - src/ui/components/auto-ui/renderers/CardRenderer.vue
    - src/ui/components/auto-ui/renderers/PieceRenderer.vue

key-decisions:
  - "PieceRenderer's two structurally-identical unguarded <img> branches (overlay presentationEntry.image override and engine pieceVisual.kind==='image') were merged into one effectivePieceImage computed + one load-guard, rather than duplicating the guard twice, since D-04 already established overlay-wins precedent"
  - "PieceRenderer fallback label/color derived defensively (pieceFallbackLabel/pieceFallbackColor) so a sane token-style fallback exists even when pieceVisual isn't literally 'token' kind (e.g. an overlay image override on a sprite-kind piece)"

patterns-established:
  - "Load-guarded image reveal: DEF-A guard for the AutoUI renderer path, mirroring plan 152-01's AssetImage.vue guard for the custom-UI path"

requirements-completed: [ASSET-01]

# Metrics
duration: 12min
completed: 2026-07-06
---

# Phase 152 Plan 02: AutoUI Renderer Load-Guard Summary

**CardRenderer and PieceRenderer now reveal `ui: auto` card/piece art only after the image's own `@load` fires, reverting to their existing drawn fallback on `@error` — closing DEF-A's exact failure mode for the AutoUI half of the pipeline.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-06T03:44:00Z
- **Completed:** 2026-07-06T03:47:28Z
- **Tasks:** 2
- **Files modified:** 2 (CardRenderer.vue, PieceRenderer.vue), 2 created (asset-fallback test files)

## Accomplishments
- CardRenderer's url-image branch (Baseline 1) wraps the always-rendered `.card-face` fallback and an absolutely-positioned overlay `<img>` inside one fixed-size `.card-face-container`; `<img>` reveals only on `@load`, reverts on `@error`, resets on src change
- PieceRenderer's overlay-image (`presentationEntry.image`) and engine image (`pieceVisual.kind === 'image'`) branches — previously two separate unguarded `<img>` elements — merged into one `effectivePieceImage` computed with a single load-guard, wrapped over an always-rendered `.piece-token` fallback with a sane label/color derived even for non-'token'-kind pieces
- Both renderers proven with synthetic `.trigger('load')`/`.trigger('error')` jsdom tests (no real image decode, no `naturalWidth` assertion)
- Zero-layout-diff preserved: fallback and overlay `<img>` share one fixed-size container and one sizing mechanism (absolute overlay), never a mutually-exclusive `v-if`/`v-else-if` swap that would resize the slot

## Task Commits

Each task was committed atomically:

1. **Task 1: Guard CardRenderer.vue's url image branch + synthetic load/error test** - `a67ee80f` (feat)
2. **Task 2: Guard PieceRenderer.vue's image branch + synthetic load/error test** - `bd751b3e` (feat)

**Plan metadata:** (this commit) (docs: complete plan)

_Note: implementation and test were authored together per task (not as separate RED/GREEN commits) since both tasks are small, single-purpose additive changes to existing renderers; each task's test was verified failing-to-passing locally before commit._

## Files Created/Modified
- `src/ui/components/auto-ui/renderers/CardRenderer.vue` - Baseline 1 (url image) load-guarded: `loaded` ref, `.card-face-container`/`.card-image-overlay` CSS, src-change watch reset
- `src/ui/components/auto-ui/renderers/PieceRenderer.vue` - Image branch (overlay + engine, merged) load-guarded: `effectivePieceImage`/`pieceFallbackLabel`/`pieceFallbackColor` computeds, `loaded` ref, `.piece-image-container`/`.piece-image-overlay` CSS, src-change watch reset
- `src/ui/components/auto-ui/renderers/CardRenderer.asset-fallback.test.ts` - Synthetic load/error coverage for CardRenderer's url-image branch
- `src/ui/components/auto-ui/renderers/PieceRenderer.asset-fallback.test.ts` - Synthetic load/error coverage for PieceRenderer's image branch

## Decisions Made
- Merged PieceRenderer's two unguarded `<img>` branches into one guarded branch rather than duplicating the guard — same shape, same D-04 overlay-wins precedent, one code path to maintain
- Derived a defensive token-style fallback (label/color) for PieceRenderer usable even when `pieceVisual.kind !== 'token'`, so the guard's "revert to a drawn fallback" promise holds regardless of which underlying visual kind the piece resolved to

## Deviations from Plan

None - plan executed exactly as written. The PieceRenderer branch-merge was explicitly anticipated by the plan's own acceptance criteria ("PieceRenderer.vue's image branch (and the presentationEntry.image overlay branch) contain @load and @error handlers") and is the natural implementation of that requirement, not a deviation.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `ui: auto` games (the scaffold default) now share the same load/error-guarded image reveal as the custom-UI `AssetImage.vue` path from plan 152-01 — ASSET-01 is fully closed for both UI paths.
- Full repo suite green: 186 test files / 2663 tests passing after this plan's changes; `tsc --noEmit` clean.
- Ready for the remaining 152-xx plans (if any) or phase closure; no blockers for 153 (DEVHOST) or 154 (MERC re-vendor), which are independent of this renderer change.

---
*Phase: 152-asset-completeness-in-bs-build-chunk*
*Completed: 2026-07-06*

## Self-Check: PASSED

All created/modified files verified present; all task commits (a67ee80f, bd751b3e) and the SUMMARY commit (a8f93203) verified present in git log.
