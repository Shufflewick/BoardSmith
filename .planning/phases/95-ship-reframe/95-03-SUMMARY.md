---
phase: 95-ship-reframe
plan: "03"
subsystem: testing
tags: [tree-shaking, vite, rollup, bundle-grep, ship-02, integration-test]
dependency_graph:
  requires:
    - phase: 95-01
      provides: single-ui-scaffold with generateAppVue branching on config.ui; GameTable re-export removed
  provides:
    - SHIP-02 empirical proof: real Vite/Rollup build + bundle grep verifies tree-shaking
    - Regression guard: any future re-export landmine will fail this test
  affects: [95-04, future-refactors-to-boardsmith-ui-exports]
tech_stack:
  added: []
  patterns: [fixture-build-integration-test, bundle-grep-assertion, repo-internal-fixtures]
key_files:
  created:
    - src/cli/lib/treeshake-bundle.test.ts
  modified: []
key_decisions:
  - "Assert AutoRenderer (not AutoUI string) in bundle grep: 'AutoUI' appears in GameTable stub template comment as compiled createTextVNode() string — too broad. AutoRenderer absent ↔ full auto-UI chain tree-shaken."
  - "Fixtures placed inside BOARDSMITH_ROOT/.treeshake-test-fixtures/ so Rollup node_modules walk reaches repo's node_modules for vue; cleaned up in afterAll."
  - "configFile: false + resolve.alias for boardsmith: avoids loading fixture's vite.config.ts (no deps installed there); alias is equivalent to npm install."
  - "Minification left at Vite default (esbuild): comments stripped (prevents false positives), __name:'AutoRenderer' string survives (esbuild does not mangle property values)."
requirements-completed: [SHIP-02]
duration: ~25 minutes
completed: 2026-06-22
---

# Phase 95 Plan 03: Tree-Shaking Bundle Proof Summary

**Real Vite/Rollup production build + bundle grep proves AutoRenderer is absent from custom-UI bundles and present in auto-UI bundles (SHIP-02), guarding the single-static-import tree-shaking guarantee.**

## Performance

- **Duration:** ~25 minutes
- **Started:** 2026-06-22
- **Completed:** 2026-06-22
- **Tasks:** 2 (combined into one file/commit)
- **Files modified:** 1 created

## Accomplishments

- Written `src/cli/lib/treeshake-bundle.test.ts` with two test cases that perform a real production Vite build of fixture game projects and grep the output bundle
- Negative case (SHIP-02 proof): fixture with `ui: './components/GameTable.vue'` → App.vue imports only GameTable, no AutoUI → `AutoRenderer` absent from dist bundle (tree-shaking confirmed)
- Positive control: fixture with `ui: 'auto'` (default) → App.vue imports AutoUI → `AutoRenderer` present in dist bundle (proves negative case is genuine tree-shake drop, not empty output)
- Discovered and documented that `AutoUI` as a bare string is an unreliable grep target because `GameTable.vue`'s template comment `<!-- Build your custom UI here. AutoUI handles everything until you're ready. -->` compiles to `createTextVNode("...")` whose string content survives esbuild minification

## Task Commits

1. **Tasks 1+2: Tree-shaking proof + positive control** - `133e420` (feat)

**Plan metadata:** to be committed with this SUMMARY

## Files Created/Modified

- `src/cli/lib/treeshake-bundle.test.ts` — Integration test: scaffolds two fixture game projects (custom UI + auto UI), runs real `viteBuild()` on each, greps `dist/ui/*.js` for `AutoRenderer`

## Decisions Made

- **Assert `AutoRenderer`, not `AutoUI` string:** The string `"AutoUI"` appears in the bundle from `GameTable.vue`'s template comment even when AutoUI is tree-shaken. The template comment compiles to `createTextVNode("... AutoUI ...")` which is a string literal that survives esbuild minification. `AutoRenderer` does not have this false-positive risk — it only appears as `__name:"AutoRenderer"` in the compiled component object when AutoRenderer.vue is actually bundled.

- **Fixtures inside repo tree:** Fixtures are created at `BOARDSMITH_ROOT/.treeshake-test-fixtures/` (a sibling of `node_modules/`) so that Rollup's standard node_modules resolution walk finds vue, @vitejs/plugin-vue, etc. OS tmpdir fixtures were tested but failed because Rollup couldn't resolve `vue` from `/tmp/`.

- **Vite default minification:** Minification is left enabled (Vite default: esbuild). This is strictly better than `minify: false` for two reasons: (1) comments are stripped, eliminating false positives from prose-format strings in comments; (2) `__name:"AutoRenderer"` string values are preserved (esbuild only mangles identifiers, not property values).

- **`configFile: false` + `resolve.alias`:** Fixtures don't have their deps installed. Using `configFile: false` skips loading the fixture's `vite.config.ts` and we supply `plugins: [vue()]` inline. The `boardsmith/ui` alias is semantically equivalent to `npm install boardsmith` in the fixture; it does not affect tree-shaking behavior.

## Deviations from Plan

### Investigation of Real Leak (Ruled Out)

**[Investigation - Not a bug] "AutoUI" in custom-UI bundle traced to GameTable template comment**
- **Found during:** Task 1 (first test run)
- **Issue:** Test initially asserted both `AutoRenderer` and `AutoUI` absent from custom-UI bundle. Test failed: "AutoUI must not appear" assertion fired.
- **Investigation:** Built fixture with tsx diagnostics script. Found `AutoUI` appears at bundle index ~743172 inside `createTextVNode(" Build your custom UI here. AutoUI handles everything until you're ready. ")` — compiled from `GameTable.vue`'s `<template>` comment, NOT from AutoUI component code.
- **Resolution:** Narrowed assertion to `AutoRenderer` only. This is the correct tree-shaking signal: `AutoUI.vue` imports `AutoRenderer.vue`, so if AutoRenderer is absent the entire auto-UI module chain is tree-shaken. `AutoRenderer` has no false-positive risk from prose.
- **Note:** This is NOT a tree-shaking failure — AutoRenderer confirmed absent, tree-shaking works as designed.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes. This plan adds a test-only file with no production code paths.

## Known Stubs

None.

## Self-Check: PASSED

Files verified:
- `src/cli/lib/treeshake-bundle.test.ts` — exists, 2 test cases, both passing

Commits verified:
- `133e420` — feat(95-03): prove SHIP-02 with real Vite build + bundle grep (tree-shaking)

Test run: `npm test -- --run src/cli/lib/treeshake-bundle.test.ts` — 2 tests passed in ~2.3s
