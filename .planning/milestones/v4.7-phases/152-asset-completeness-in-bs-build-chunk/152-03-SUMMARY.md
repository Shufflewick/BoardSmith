---
phase: 152-asset-completeness-in-bs-build-chunk
plan: 03
subsystem: cli
tags: [asset-completeness, static-analysis, cli-lib, vitest, single-source-of-truth]

# Dependency graph
requires:
  - phase: 152-02
    provides: "AssetImage.vue runtime fallback wrapper — the sanctioned wrapper this scan exempts by basename"
provides:
  - "src/cli/lib/asset-scan.ts exporting scanAssetReachability(cwd) — a file-system-level static scan for bare <img> tags"
  - "Fixture pair (bare-img FAILs, wrapped PASSes) proving the gate's before/after behavior"
affects: [152-04, boardsmith-build-gate, boardsmith-lint]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Single-source-of-truth static scanner mirroring sandbox-scan.ts's collectSourceFiles shape"]

key-files:
  created:
    - src/cli/lib/asset-scan.ts
    - src/cli/lib/asset-scan.test.ts
    - src/cli/lib/__fixtures__/asset-scan/bare-img/src/ui/components/GameTable.vue
    - src/cli/lib/__fixtures__/asset-scan/wrapped/src/ui/components/GameTable.vue
    - src/cli/lib/__fixtures__/asset-scan/wrapped/src/ui/components/AssetImage.vue
  modified: []

key-decisions:
  - "Fixtures authored as real on-disk files under __fixtures__/asset-scan/ (per plan) rather than mkdtempSync-generated tmp dirs, so the before/after pair is inspectable and version-controlled"
  - "Detection kept coarse per locked CONTEXT.md heuristic: any <img\\b> token outside AssetImage.vue is a FAIL regardless of src content — no prop-plumbing trace"
  - "AssetImage.vue exclusion is by basename match, not directory path, matching the plan's explicit NOTE"

patterns-established:
  - "asset-scan.ts is the single delegate for bare-<img> detection — any future boardsmith lint/build surface must call scanAssetReachability(cwd), never re-implement the regex"

requirements-completed: [ASSET-02]

# Metrics
duration: 12min
completed: 2026-07-06
---

# Phase 152 Plan 03: Asset-Reachability Static Scan Summary

**`scanAssetReachability(cwd)` — a file-system-only bare-`<img>` gate that never issues an HTTP request, closing the DEF-A class defect at the static-analysis layer.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-06T03:51:00Z
- **Completed:** 2026-07-06T03:53:03Z
- **Tasks:** 1 TDD feature (RED + GREEN)
- **Files modified:** 5 created

## Accomplishments
- New `src/cli/lib/asset-scan.ts` module mirroring `sandbox-scan.ts`'s single-source-of-truth shape (same `collectSourceFiles` recursion pattern, `node:fs` only, zero network calls)
- `scanAssetReachability(cwd)` scans `<cwd>/src/ui/**`, flags every bare `<img` tag outside `AssetImage.vue`'s own definition (matched by basename, any directory)
- Fixture pair proves the gate end-to-end: `__fixtures__/asset-scan/bare-img/` (unwrapped `<img>`) FAILs with a violation citing file+line; `__fixtures__/asset-scan/wrapped/` (same UI routed through `<AssetImage>`) PASSes with `[]`
- Confirmed via the full repo suite: 2666/2666 tests green, no regressions

## Task Commits

TDD feature executed as RED then GREEN:

1. **RED: failing test for scanAssetReachability** - `5a68dbe0` (test) — fixtures + test file authored; confirmed failure (`asset-scan.js` module not found) before any implementation existed
2. **GREEN: implement scanAssetReachability** - `64df62b6` (feat) — module implemented; all 3 tests pass, full suite green

No REFACTOR commit needed — implementation was already minimal and clean on first pass.

**Plan metadata:** (this commit) `docs: complete plan`

## Files Created/Modified
- `src/cli/lib/asset-scan.ts` - `AssetViolation` interface + `scanAssetReachability(cwd)`; scoped to `<cwd>/src/ui`, returns `[]` if absent, excludes `AssetImage.vue` by basename, flags any `/<img\b/` match with cwd-relative file, 1-based line, and an actionable message naming `<AssetImage>` as the fix
- `src/cli/lib/asset-scan.test.ts` - 3 tests: bare-img FAILs (file+line asserted), wrapped PASSes (`[]`), absent `src/ui` returns `[]`
- `src/cli/lib/__fixtures__/asset-scan/bare-img/src/ui/components/GameTable.vue` - real fixture: card hand rendered via a bare `<img :src="cardImage(card,'face')">`, no `AssetImage` wrapper
- `src/cli/lib/__fixtures__/asset-scan/wrapped/src/ui/components/GameTable.vue` - same UI, routed through `<AssetImage :src=... kind="card" />`
- `src/cli/lib/__fixtures__/asset-scan/wrapped/src/ui/components/AssetImage.vue` - copy of the sanctioned wrapper (its own `<img>` present, exempted by basename)

## Decisions Made
- Fixtures live as real files on disk under `__fixtures__/asset-scan/` rather than generated via `mkdtempSync` in `beforeEach`/`afterEach` (the pattern `sandbox-scan.test.ts` uses) — the plan's `files_modified` frontmatter explicitly names these five fixture file paths as deliverables, so they're authored directly for inspectability and version control.
- Kept detection intentionally coarse (`/<img\b/` per line, no `src`-value inspection) — this is the locked pit-of-success heuristic from `152-CONTEXT.md`: any bare `<img>` is an automatic FAIL, since prop-plumbing analysis would let a subtly-wrong wrapper slip through the exact class of gap that let DEF-A ship green.
- `AssetImage.vue` exclusion matches by `basename()` only (not a directory-path check), per the plan's explicit NOTE, so the sanctioned wrapper is recognized regardless of where it lives in a generated project's tree.

## Deviations from Plan

None - plan executed exactly as written. Contract signature (`scanAssetReachability(cwd): AssetViolation[]` with `{ file, line, message }`) matches the plan's locked interface exactly, since plan 152-04's `test.md` gate prose cites it by name.

## TDD Gate Compliance

RED gate: `5a68dbe0` (`test(152-03): ...`) — confirmed failing before GREEN (module import error, zero tests collected).
GREEN gate: `64df62b6` (`feat(152-03): ...`) — confirmed passing after (3/3 tests, full suite 2666/2666).
Both gates present in git log in correct order. No REFACTOR commit was needed.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
`scanAssetReachability(cwd)` is ready to be wired into `test.md`'s build-blocking gate prose in plan 152-04, which cites it by name per this plan's locked contract. No blockers.

---
*Phase: 152-asset-completeness-in-bs-build-chunk*
*Completed: 2026-07-06*

## Self-Check: PASSED

All 5 created files verified present on disk; both commits (`5a68dbe0`, `64df62b6`) verified in git log.
