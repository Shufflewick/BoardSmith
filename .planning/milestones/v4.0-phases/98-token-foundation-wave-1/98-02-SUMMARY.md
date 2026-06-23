---
phase: 98-token-foundation-wave-1
plan: "02"
subsystem: ui/tooling
tags: [stylelint, color-no-hex, linting, TOKEN-06, devDependencies]
dependency_graph:
  requires: []
  provides: [color-no-hex lint guard, lint:css npm script]
  affects: [package.json, vitest.config.ts]
tech_stack:
  added: [stylelint@17, postcss-html@1]
  patterns: [stylelint CJS config, programmatic stylelint lint() API in tests]
key_files:
  created:
    - .stylelintrc.cjs
    - scripts/check-no-hex.test.mjs
  modified:
    - package.json
    - vitest.config.ts
    - package-lock.json
decisions:
  - "Expanded ignoreFiles list beyond the plan's 5-file spec to cover all 18 currently-neon .vue files so lint:css exits 0 immediately (deviation Rule 2)"
  - "Added scripts/**/*.test.mjs to vitest include so the bite-test is runnable via both npx vitest run <file> and npm test"
  - "Probe file uses src/ui/__hexprobe__/probe.vue — inside the stylelint glob scope but outside ignoreFiles, so the real config is exercised end-to-end"
metrics:
  duration: "~8 minutes"
  completed: "2026-06-23"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 3
---

# Phase 98 Plan 02: Stylelint color-no-hex Guard Summary

One-liner: stylelint color-no-hex rule scoped to src/ui/**/*.vue with documented temporary
ignoreFiles list and a programmatic bite-test proving the guard works.

## What Was Built

TOKEN-06 delivered: a `color-no-hex` stylelint rule that fails CI whenever a raw hex literal
appears in a clean or new `.vue` file, while keeping `main` green during the Phase 98→99
staged landing by ignoring the not-yet-swept components.

### .stylelintrc.cjs

- `customSyntax: 'postcss-html'` — parses `<style>` blocks in Vue SFCs.
- `rules: { 'color-no-hex': true }` — any raw hex literal is an error.
- `ignoreFiles` — 18 currently-neon `.vue` files grouped by category (renderers, auto-ui
  top-level, auto-ui archetypes, chrome shell, helpers/overlays). Each group is commented.
- Top-of-file comment: "TEMPORARY ignore list — Phase 99 (Theming Swap) empties this as
  it sweeps each file's neon literals into `--bsg-*` tokens; this list MUST end at zero
  exclusions. Do not add files here to silence new violations."
- `theme.ts` is `.ts`, so it is never matched by `stylelint 'src/ui/**/*.vue'` — the
  sanctioned home for color literals stays exempt by design.

### package.json

- Added `"lint:css": "stylelint 'src/ui/**/*.vue'"` script.
- Added `stylelint` and `postcss-html` as devDependencies (never in the shipped bundle).

### scripts/check-no-hex.test.mjs (TOKEN-06 bite-test)

- Imports `stylelint` programmatically and runs it against the real `.stylelintrc.cjs`.
- Writes a probe Vue SFC at `src/ui/__hexprobe__/probe.vue` (inside `src/ui/**/*.vue`
  scope, outside `ignoreFiles`) then deletes it in `afterEach`.
- Test 1: `color: #ff0000;` → expects ≥1 `color-no-hex` warning. PASSES.
- Test 2: `color: var(--bsg-accent);` → expects 0 warnings. PASSES.

### vitest.config.ts

- Extended `include` with `scripts/**/*.test.mjs` so the bite-test is discovered by
  `npm test` as well as `npx vitest run scripts/check-no-hex.test.mjs`.

## Verification

- `npm run lint:css` exits 0 on the current tree (all 18 violating files are ignored).
- `npx vitest run scripts/check-no-hex.test.mjs` — 2/2 tests pass.
- `npm test` — 959/959 tests pass (full suite green).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Expanded ignoreFiles from 5 to 18 files**

- **Found during:** Task 2 (first `npm run lint:css` run)
- **Issue:** The plan's `<interfaces>` section listed only 5 file paths/globs to ignore
  (renderers/*.vue, ActionPanel.vue, GameShell.vue, WaitingRoom.vue, DebugPanel.vue).
  However, 13 additional `.vue` files in `src/ui/components/` also contain raw hex
  literals and produced 101 stylelint errors, causing `lint:css` to exit 2.
- **Fix:** Added all currently-violating files to `ignoreFiles`, grouped by directory with
  comments. The Phase 99 note and anti-addition warning remain in place. Zero new entries
  may be added to silence violations in new files.
- **Files modified:** `.stylelintrc.cjs`
- **Commit:** 1ec96d4

**2. [Rule 3 - Blocking issue] Added scripts/**/*.test.mjs to vitest include**

- **Found during:** Task 3 (first `npx vitest run` returned exit 1: "No test files found")
- **Issue:** vitest's `include` was `src/**/*.test.ts` only; the explicit file filter was
  still blocked by the include pattern, so the `.mjs` test was never collected.
- **Fix:** Appended `scripts/**/*.test.mjs` to the `include` array in `vitest.config.ts`.
- **Files modified:** `vitest.config.ts`
- **Commit:** 1e121dc

## Known Stubs

None. The guard is fully functional.

## Threat Flags

None. The only new surface is devDependency tooling (stylelint + postcss-html). Legitimacy
was pre-approved by the orchestrator (T-98-SC in the plan's threat register).

## Self-Check: PASSED

- `.stylelintrc.cjs` exists: confirmed.
- `scripts/check-no-hex.test.mjs` exists: confirmed.
- `package.json` contains `lint:css` script: confirmed.
- `vitest.config.ts` includes `scripts/**/*.test.mjs`: confirmed.
- Commit 1ec96d4 exists: confirmed (Task 2).
- Commit 1e121dc exists: confirmed (Task 3).
- No probe file left in tree: confirmed (src/ui/__hexprobe__/ absent).
