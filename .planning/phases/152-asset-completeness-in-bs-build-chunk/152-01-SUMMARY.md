---
phase: 152-asset-completeness-in-bs-build-chunk
plan: 01
subsystem: cli
tags: [vue, scaffold, asset-fallback, project-scaffold, boardsmith-init]

# Dependency graph
requires: []
provides:
  - "generateAssetImageVue() generator emitting src/ui/components/AssetImage.vue"
  - "AssetImage.vue wired into generateScaffoldFiles() — every freshly-init'd game inherits it"
  - "Unit coverage proving the load-reveal and error-revert paths on the generator output"
affects: [152-02, bs-build-chunk-asset-completeness, cli-init, cli-scaffold]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Preload-then-swap DOM <img> (adapted from Die3D.vue's new Image() onload/onerror texture pattern) using native @load/@error on a real <img> element instead"
    - "Shared aspect-ratio CSS custom property drives both the drawn fallback and the absolutely-positioned overlay <img>, so revealing the real asset causes zero layout shift"

key-files:
  created: []
  modified:
    - src/cli/lib/project-scaffold.ts
    - src/cli/lib/project-scaffold.test.ts

key-decisions:
  - "AssetImage.vue is a single component with a kind discriminant ('card' | 'piece') rather than two separate components — one sanctioned entry point per Pit of Success, callers pick the fallback shape via a prop, not by choosing a different import"
  - "Fallback is always rendered (absolutely positioned under the <img>, not conditionally swapped) so there is never a frame where neither element is present"
  - "loaded ref reverts to false on @error (not left true) so a load-then-later-error DOM edge case can never strand a broken image; onerror explicitly documented as 'never leave a broken <img> visible'"

patterns-established:
  - "AssetImage.vue is the only sanctioned way to render card/piece art in generated games — bare <img> without @load/@error handlers is now the wrong path, structurally prevented at the scaffold layer"

requirements-completed: [ASSET-01]

# Metrics
duration: 20min
completed: 2026-07-06
---

# Phase 152 Plan 01: AssetImage.vue Scaffold Generator Summary

**Added `generateAssetImageVue()` to `project-scaffold.ts`, emitting a preload-then-swap `AssetImage.vue` SFC into every `npx boardsmith init` project so missing/unresolved card or piece art always degrades to a drawn game-semantic fallback instead of a broken `<img>`.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-06T03:42:11Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `generateAssetImageVue()` emits a `<script setup lang="ts">` SFC with `kind: 'card' | 'piece'` discriminant, `src`/`rank`/`suit`/`label`/`aspectRatio`/`alt` props, a `loaded` ref, and `@load`/`@error` handlers on a real `<img>`.
- The drawn fallback (rank+suit for cards, label token for pieces) is always in the DOM, absolutely positioned underneath the `<img>`, styled entirely with `--bsg-*` tokens (`--bsg-surface`, `--bsg-r-sm`, `--bsg-line`, `--bsg-ink`, `--bsg-s1`, `--bsg-text-sm`).
- Both the fallback container and the overlay `<img>` are sized from one shared `aspectRatio` prop (default `2 / 3`), so the real asset never causes a layout shift when it swaps in.
- Wired `{ path: 'src/ui/components/AssetImage.vue', content: generateAssetImageVue() }` into `generateScaffoldFiles()`.
- `project-scaffold.test.ts` gained 4 new tests: file-presence in `generateScaffoldFiles()`, the `@load`/`is-loaded`/`--bsg-` fallback assertions (`-t AssetImage` matches), the shared `aspectRatio` input assertion, and the `@error` → `loaded.value = false` revert assertion (`-t onerror` matches).

## Task Commits

Each task was committed atomically:

1. **Task 1: Add generateAssetImageVue() and wire it into generateScaffoldFiles()** - `452a1040` (feat)
2. **Task 2: Extend project-scaffold.test.ts with AssetImage generation + fallback/overlay/onerror assertions** - `339d41b9` (test)

**Plan metadata:** commit pending (docs: complete plan)

## Files Created/Modified
- `src/cli/lib/project-scaffold.ts` - Added `generateAssetImageVue()` and its entry in `generateScaffoldFiles()`
- `src/cli/lib/project-scaffold.test.ts` - Added `AssetImage`-generation, load-reveal/token-fallback, and `onerror`-revert test coverage

## Decisions Made
- Single component with a `kind` discriminant instead of `CardImage.vue`/`PieceImage.vue` — one sanctioned import, wrong usage (bare `<img>`) structurally harder than right usage.
- Fallback always rendered underneath (not `v-if`/`v-else` swapped with the `<img>`) so the DOM never has a frame with neither element — this is what makes the "zero layout change" and "never a broken image" guarantees hold simultaneously.
- `@error` explicitly sets `loaded.value = false` (not left as whatever it was) to cover the rare load-then-later-broken-src case, not just the initial-resolution-failure case.

## Deviations from Plan

None — plan executed exactly as written. `generateAssetImageVue()`'s output shape (props, `loaded` ref, `@load`/`@error`, `--bsg-*` token fallback, shared aspect-ratio input) matches the plan's `<action>` and `<behavior>` blocks directly; no bugs, missing functionality, or blockers were discovered during either task.

## Issues Encountered

None. `npx tsc --noEmit` showed only pre-existing, unrelated errors in other files (confirmed none touch `project-scaffold.ts` or its test); `npm test` (full suite) stayed green at 184 files / 2657 tests after this plan's wave.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `AssetImage.vue` now ships from Chunk 0 in every generated game — 152-02 (or whichever plan closes ASSET-01/ASSET-02's remaining half) can build the `bs-build-chunk` skill-level guard that requires custom-UI chunks to actually USE this component for card/piece art instead of a bare `<img>`.
- No blockers. The generator is pure string-template code with no runtime dependency on a real game, so it composes cleanly with any downstream `bs-build-chunk` skill work.
