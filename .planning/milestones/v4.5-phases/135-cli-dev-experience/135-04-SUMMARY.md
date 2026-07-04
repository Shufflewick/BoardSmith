---
phase: 135-cli-dev-experience
plan: 04
subsystem: cli
tags: [build, manifest, playerCount, esbuild, vite, tdd]

# Dependency graph
requires:
  - phase: 135-01
    provides: PROC-01 verification gate confirming F9/CLIX-01 LEGITIMATE, including the build.ts manifest-spread silent-forwarding site
provides:
  - "deriveManifest(config, gameDefinition, protocolVersion) pure function in build.ts, unit-testable without invoking viteBuild"
  - "buildCommand loads the compiled gameDefinition via loadGameDefinition (game-runtime.js) before generating the manifest"
  - "manifest.playerCount is always { min: gameDefinition.minPlayers, max: gameDefinition.maxPlayers } — immune to stale/hand-edited boardsmith.json"
affects: [135-05, 135-06, 138-games-migration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Node-side esbuild+import of a project's rules index via getProjectContext + .boardsmith tempDir + loadGameDefinition (already established by simulate.ts, now reused by build.ts)"
    - "Pure derivation function extracted from a CLI command body so behavior is unit-testable without invoking the underlying build tool (mirrors runSimulation's extraction pattern)"

key-files:
  created:
    - src/cli/commands/build.test.ts
  modified:
    - src/cli/commands/build.ts

key-decisions:
  - "deriveManifest sets playerCount AFTER the ...config spread so the gameDefinition-derived value always wins over any stale config key, even if validation is bypassed (T-135-07)"
  - "build.ts's local getProjectContext copy was removed in favor of importing the shared one from game-runtime.js, reducing drift between build.ts/simulate.ts/dev.ts"
  - "protocolVersion parameter typed as number (matching BUNDLE_PROTOCOL_VERSION's actual type), not string as originally sketched in the plan's interface note"

patterns-established:
  - "CLI commands that need the compiled gameDefinition in Node reuse getProjectContext + .boardsmith tempDir + loadGameDefinition from game-runtime.ts rather than writing a bespoke esbuild loader"

requirements-completed: [CLIX-01, PROC-02]

# Metrics
duration: 20min
completed: 2026-07-03
---

# Phase 135 Plan 04: Derive Manifest playerCount from Compiled gameDefinition Summary

**build.ts's publish manifest now derives `playerCount: { min, max }` from the compiled `gameDefinition` via a new `deriveManifest` pure function, closing the second silent-forwarding site for stale `boardsmith.json` player counts (F9/CLIX-01).**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-03
- **Tasks:** 1 (TDD: RED, GREEN)
- **Files modified:** 2 (1 new, 1 modified)

## Accomplishments
- Extracted `deriveManifest(config, gameDefinition, protocolVersion)` as an exported pure function in `build.ts`, unit-testable without invoking `viteBuild`
- `playerCount` is now computed from `gameDefinition.minPlayers`/`maxPlayers` and set AFTER the `...config` spread, so a stale/hand-edited `playerCount` in `boardsmith.json` can never reach the published manifest
- `buildCommand` now loads the compiled `gameDefinition` in Node before generating the manifest, using the exact `getProjectContext` + `.boardsmith` tempDir + `loadGameDefinition` pattern already established by `simulate.ts:158-167`
- `build.ts`'s local duplicate `getProjectContext` function was deleted; it now imports the shared one from `game-runtime.js`
- New `build.test.ts` (build.ts previously had zero coverage) covers derivation, the PROC-02 stale-key regression, passthrough-key preservation, and the `version` default
- Manually verified end-to-end against `~/BoardSmithGames/go-fish`: its `boardsmith.json` has a stale `playerCount: {min:2,max:4}`, while its compiled `gameDefinition` actually allows 2-6 players — the real `boardsmith build` run produced a manifest with the correct derived `{min:2,max:6}`, proving the fix in a live build, not just a unit test

## Task Commits

TDD task (RED then GREEN):

1. **Task 1 RED: add failing test for deriveManifest** - `8bac3c0c` (test)
2. **Task 1 GREEN: derive manifest playerCount from gameDefinition** - `1c886248` (feat)

**Plan metadata:** (this commit, follows)

## Files Created/Modified
- `src/cli/commands/build.test.ts` - New: unit tests for `deriveManifest` (derivation, PROC-02 stale-key regression, passthrough preservation, version default)
- `src/cli/commands/build.ts` - Extracted `deriveManifest`; `buildCommand` now loads `gameDefinition` via `loadGameDefinition` before generating the manifest; removed local `getProjectContext` duplicate in favor of the `game-runtime.js` import

## Decisions Made
- `deriveManifest`'s `playerCount` assignment is placed as the LAST key in the returned object literal (after the `...config` spread), which is the load-bearing detail that makes overwrite-not-merge behavior work — object literal key order determines which value wins on duplicate keys in JS
- Kept the exact `{ min, max }` shape and `playerCount` key name (Open Question A1 from RESEARCH.md) to preserve the external publish-platform contract — this is an internal derivation-source change, not a wire-format change
- `protocolVersion` parameter is typed `number` (matching `BUNDLE_PROTOCOL_VERSION`'s actual type in `protocol-version.ts`), a minor deviation from the plan's illustrative `string` type in its interface note — see Deviations

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected deriveManifest's protocolVersion parameter type from string to number**
- **Found during:** Task 1 (GREEN implementation, `tsc --noEmit` check)
- **Issue:** The plan's illustrative signature note read `deriveManifest(config, gameDefinition, protocolVersion)` without a concrete type; an initial `string` typing failed `tsc --noEmit` because `BUNDLE_PROTOCOL_VERSION` (the only real caller argument) is `1`, a `number` (`src/engine/protocol-version.ts:20`)
- **Fix:** Typed the parameter `number`; updated `build.test.ts`'s three call sites from string literals (`'v1'`, `'protocol-v3'`) to numeric literals (`1`, `3`) and the corresponding assertion
- **Files modified:** src/cli/commands/build.ts, src/cli/commands/build.test.ts
- **Verification:** `npx tsc --noEmit -p tsconfig.json` shows zero errors in either file; `npx vitest run src/cli/commands/build.test.ts` green (4/4)
- **Committed in:** 1c886248 (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug/type-correctness)
**Impact on plan:** Type-only correction required for the file to compile; no behavior or scope change. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Self-Check: PASSED

- FOUND: src/cli/commands/build.ts (deriveManifest exported, loadGameDefinition imported and called)
- FOUND: src/cli/commands/build.test.ts
- FOUND commit 8bac3c0c (RED)
- FOUND commit 1c886248 (GREEN)
- Manually verified: `boardsmith build` against `~/BoardSmithGames/go-fish` produced a manifest with `playerCount` derived from the compiled rules (2-6), diverging correctly from the stale `boardsmith.json` value (2-4) — proof the fix works in a real build, not just in the unit test. Build artifacts (`tmp/`, `dist/`, `.boardsmith/`) cleaned up from the sibling repo; `git status --short` in `~/BoardSmithGames/go-fish` confirmed clean afterward.

## TDD Gate Compliance

RED gate: `8bac3c0c` (`test(135-04): add failing test for deriveManifest playerCount derivation`) — confirmed 4/4 tests failing (`deriveManifest is not a function`) before any implementation existed.
GREEN gate: `1c886248` (`feat(135-04): derive manifest playerCount from compiled gameDefinition`) — confirmed 4/4 tests passing after implementation.
No REFACTOR commit was needed (no cleanup pass required after GREEN).

## Next Phase Readiness
- The load-bearing half of CLIX-01 (F9) is complete: `build.ts` can no longer forward a stale `playerCount` from `boardsmith.json` into the publish manifest, regardless of whether Plan 03's scaffold-key deletion is bypassed by a hand-edited config
- No blockers for Plan 05/06 (remaining Phase 135 CLIX findings — CLIX-03 bundle-size limit, CLIX-04 dev host default, CLIX-05 template flag, CLIX-06 --players/--ai validation)

---
*Phase: 135-cli-dev-experience*
*Completed: 2026-07-03*
