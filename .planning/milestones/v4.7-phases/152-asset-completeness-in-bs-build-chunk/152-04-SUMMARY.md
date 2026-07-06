---
phase: 152-asset-completeness-in-bs-build-chunk
plan: 04
subsystem: docs
tags: [bs-build-chunk, asset-reachability, ui-guardrails, skill-prose]

requires:
  - phase: 152-03
    provides: "src/cli/lib/asset-scan.ts exporting scanAssetReachability(cwd), the single-source-of-truth bare-<img> scanner"
provides:
  - "build.md's UIQ-02 section prohibits any bare asset <img> and mandates routing card/piece art through AssetImage.vue"
  - "test.md's ordered stop-on-failure sequence gains a build-blocking asset-reachability gate, conditional on ui: touches|major"
  - "build-chunk.test.ts regression-locks both new prose additions"
affects: [153-devhost-follow-up, bs-build-chunk-skill-consumers]

tech-stack:
  added: []
  patterns:
    - "cite-not-restate: prose references a scanner module by exported function name instead of re-describing its heuristic"
    - "ui: touches|major-conditional gate items in test.md's ordered sequence (mirrors the existing a11y-floor conditional shape)"

key-files:
  created: []
  modified:
    - src/cli/slash-command/bs/build/build.md
    - src/cli/slash-command/bs/build/test.md
    - src/cli/slash-command/bs/build-chunk.test.ts

key-decisions:
  - "New asset-reachability gate's failure routes the chunk back to build (not repair) — plan text said 'repair' but test.md's own established 'Failures Loop Back to build' convention (a hard rule the file states for every item in the ordered sequence, since test and build share session group 2) makes 'repair' factually wrong; repair only enters after the later, separate {audit, repair} group. Fixed to match the file's own doctrine (Rule 1 — bug in plan wording)."
  - "Asset-reachability gate is item 7 in test.md's ordered sequence (bumped from the old item 6 slot) since it now sits between random-sim playthrough and the a11y floor; no other numeric back-references existed elsewhere in the file to update."

requirements-completed: [ASSET-01, ASSET-02]

duration: 12min
completed: 2026-07-06
---

# Phase 152 Plan 04: Wire Asset Guarantees into bs-build-chunk Prose Summary

**Extended build.md's UIQ-02 to prohibit bare asset `<img>` and mandate AssetImage.vue; added a ui-conditional, build-blocking asset-reachability gate to test.md citing `scanAssetReachability(cwd)`; regression-locked both in build-chunk.test.ts.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-06T03:46:00Z (approx)
- **Completed:** 2026-07-06T03:58:01Z
- **Tasks:** 3 completed
- **Files modified:** 3

## Accomplishments
- `build.md`'s Placeholders (UIQ-02) section now names `AssetImage.vue` as the operationalization of `DESIGN.md`'s `## Placeholder Policy` and states a bare asset `<img>` is a `test`-step failure, not merely discouraged.
- `test.md`'s ordered, non-reorderable, stop-on-failure sequence gained a new item 7: an asset-reachability gate conditional on `ui: touches|major`, citing `scanAssetReachability(cwd)` from `src/cli/lib/asset-scan.ts` as the single source of truth (cite-not-restate, mirroring how item 2 cites `sandbox-scan.ts`).
- `build-chunk.test.ts`'s existing `UIQ-02` and `BUILD-06` describe blocks each gained a new `it` regression-locking the new prose so a future edit that quietly drops the prohibition/gate fails CI.

## Task Commits

1. **Task 1: Extend build.md UIQ-02 to prohibit bare asset `<img>` and mandate AssetImage.vue** - `5d088893` (docs)
2. **Task 2: Add the asset-reachability gate to test.md's ordered sequence** - `eb191e92` (docs)
3. **Task 3: Extend build-chunk.test.ts UIQ-02 + BUILD-06 blocks with the new prose assertions** - `83a12682` (test)

**Plan metadata:** (this commit)

## Files Created/Modified
- `src/cli/slash-command/bs/build/build.md` - UIQ-02 section extended with the bare-`<img>` prohibition and `AssetImage.vue` mandate
- `src/cli/slash-command/bs/build/test.md` - new ordered-sequence item 7 (asset-reachability gate, `ui: touches|major`-conditional)
- `src/cli/slash-command/bs/build-chunk.test.ts` - two new `it` blocks inside existing `UIQ-02` and `BUILD-06` describe blocks

## Decisions Made
- Failure routing for the new gate corrected to `build` (not `repair` as the plan text said) to match test.md's own pre-existing "Failures Loop Back to `build`" doctrine — `repair` belongs to the later `{audit, repair}` session group and is never a `test`-step failure destination. See key-decisions above.
- New gate placed as ordered-sequence item 7 (after random-sim playthrough, before the a11y floor) since no fixed slot was mandated and this keeps asset-reachability adjacent to the a11y floor's identical conditional shape.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected failure-routing destination in test.md's new gate from `repair` to `build`**
- **Found during:** Task 2 (adding the asset-reachability gate to test.md)
- **Issue:** The plan's action text specified "routes the chunk back to `repair`" for the new gate's failure semantics. This contradicts test.md's own explicit, pre-existing "Failures Loop Back to `build`" section, which states unambiguously that every item in this ordered sequence (test and build share session group 2) fails back to `build`, never advancing to `audit`/`repair` (a separate, later session group authored in Phase 145).
- **Fix:** Wrote the new gate's failure semantics as "routes this chunk back to `build`" with a cross-reference to the existing "Failures Loop Back to `build`" section, matching every other item in the sequence.
- **Files modified:** src/cli/slash-command/bs/build/test.md
- **Verification:** Grepped the file for stale numeric item back-references (none existed) and confirmed the "Failures Loop Back to `build`" section's own wording ("A failure at any step in the ordered sequence above") already generically covers the new item without needing edits there.
- **Committed in:** eb191e92 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Necessary for correctness — following the plan literally would have introduced a routing contradiction inside the same file. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ASSET-01/ASSET-02 guarantees are now fully wired end-to-end: the scanner (152-03) is cited, not reimplemented, by both the authoring-time prohibition (build.md) and the build-blocking gate (test.md), and both are regression-locked in build-chunk.test.ts.
- Full repo suite (`npm test`) green: 187 files, 2668 tests passed.
- Phase 152 plans complete; ready for Phase 153 (DEVHOST-01/02), which is independent of this phase's changes.

---
*Phase: 152-asset-completeness-in-bs-build-chunk*
*Completed: 2026-07-06*

## Self-Check: PASSED

All created/modified files and all three task commit hashes (5d088893, eb191e92, 83a12682) verified present.
