---
phase: 169-post-fix-game-de-workaround-sweep
plan: 01
subsystem: docs
tags: [crosswalk, defect-tracking, undo, multiselect, mcts, space-lifecycle, dock-suppression]

# Dependency graph
requires:
  - phase: 155-164
    provides: "D1-D31 library defect fixes across undo/rewind, auto-zoom, MCTS/multiSelect, space lifecycle, dock/loop/visual/debug-view"
provides:
  - "Dxx ↔ repo-BUG-n crosswalk covering all 5 game repos' own bug ledgers"
  - "grep-verified library fix-present checklist (PRESENT/ABSENT) for D1/D8/D9/D12/D22/D23/D24/D26/D28/D29/D30/D31/D32"
  - "the SC-5/PROC-01 removal gate document cited by plans 169-02..06"
affects: [169-02-lanternfall, 169-03-seven, 169-04-one-two-punch, 169-05-doom-machine, 169-06-boardsmithgames2-seven]

# Tech tracking
tech-stack:
  added: []
  patterns: ["crosswalk-then-remove gating: no game-repo removal without a grep-verified PRESENT fix + green suite"]

key-files:
  created:
    - .planning/phases/169-post-fix-game-de-workaround-sweep/169-CROSSWALK.md
  modified: []

key-decisions:
  - "Read all 5 repos' bug ledgers directly (not summarized) to build a per-filing crosswalk table, one row per filing id, rather than one row per Dxx"
  - "Marked filings not in the v4.8 D1-D32 battery (e.g. dev-host bugs, tooling bugs, SIM-family undo-seat/simultaneous-step bugs not cited by any CONTEXT removal target) as out-of-scope rather than force-mapping them to a Dxx"
  - "D32 recorded as ABSENT by design (platform-side, proven absent from library src per Phase 165) — not a blocker since no removal target depends on it"
  - "D2/D3/D4/D5/D6/D25 not independently re-verified since no Section 1 removal candidate cites them; downstream plans instructed to re-run the same grep method if they discover an undocumented workaround tied to those Dxx"

requirements-completed: [SWEEP-01, PROC-01]

duration: 25min
completed: 2026-07-22
---

# Phase 169 Plan 01: Dxx ↔ Repo-BUG-n Crosswalk + Fix-Present Checklist Summary

**Built the grep-verified SC-5/PROC-01 removal gate: a per-filing crosswalk from all 5 game repos' own bug ledgers (lanternfall BUG 1-7, seven BSR-1..12, one-two-punch BUG 1-8, doom-machine BS-1..11, BoardSmithGames2/seven BUG-01..05) to their v4.8 Dxx defects, paired with a PRESENT/ABSENT verdict for each fix's exact code anchor in this library repo's live source.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-07-22T04:00:49Z (approx; recorded at summary time)
- **Completed:** 2026-07-22T04:00:49Z
- **Tasks:** 2 completed
- **Files modified:** 1 created (169-CROSSWALK.md)

## Accomplishments
- Read all 5 game repos' bug/request ledgers in full and mapped every filing to a v4.8 `Dxx` defect (or explicitly marked it out-of-scope/no-op/WITHDRAWN) with fixing phase and disposition-hint
- Grep-verified 13 Dxx anchors (D1, D8, D9, D12, D22, D23, D24, D26, D28, D29, D30, D31, D32) against the live symlinked `boardsmith` source with exact `file:line` evidence for every PRESENT verdict
- Explicitly flagged the two BSR-12/BUG-8-style AI re-verify close candidates (seven's BSR-12, one-two-punch's BUG 8) and the doom-machine BS-5 DEFERRED item per the CONTEXT decisions
- Recorded all no-op/withdrawn/out-of-scope items: D32 (platform-side, absent by design), the 2 WITHDRAWN lanternfall filings, and MERC (out of scope)

## Task Commits

Each task was committed as a single atomic commit (both tasks build the same artifact incrementally — the crosswalk table and the fix-present checklist are two sections of one file, committed together since splitting them would leave an incomplete/unverifiable intermediate state):

1. **Task 1 + Task 2: Crosswalk table + Library Fix-Present Checklist** - `437ecec7` (docs)

## Files Created/Modified
- `.planning/phases/169-post-fix-game-de-workaround-sweep/169-CROSSWALK.md` - Section 1: per-filing crosswalk table (5 repos, ~43 filings) mapping repo-id → Dxx → fix phase → sweep target → disposition-hint. Section 2: grep-verified Library Fix-Present Checklist (13 Dxx anchors, all PRESENT except D32 which is expected-absent). Section 3: usage instructions for downstream plans 169-02..06.

## Decisions Made
- Read every ledger directly rather than relying on the CONTEXT.md summary, to catch filings not already enumerated there (e.g. lanternfall BUG 1-5, seven BSR-1..4/6..11, one-two-punch BUG 1/2/4-7, doom BS-1/2/4/6-8/11, BSG2 BUG-01/03/05) and correctly mark them out-of-scope for this Dxx crosswalk (they are real filed bugs, but not part of the deduped D1-D32 battery this phase gates removals on)
- Verified each PRESENT verdict with an actual grep run against `/Users/jtsmith/BoardSmith/src` (not assumed) and cited exact file:line evidence, per the plan's PROC-01/anti-silent-skip requirement
- Did not force a Dxx mapping onto simultaneous-action-step undo bugs (seven BSR-7/8, one-two-punch BUG 6/7) since no CONTEXT removal target cites them and they are not among the D1/D9/D8/D12/D22-26/D28-31 anchors this plan was scoped to verify — recorded as out-of-scope with a note for downstream plans to re-check if needed

## Deviations from Plan

None - plan executed exactly as written. Both tasks (crosswalk assembly, fix-present checklist) were folded into a single file write and single commit since they are two sections of the same deliverable artifact and the plan's own verify commands check for both sections' markers within the one file.

## Issues Encountered

None. No game-repo files were read or written for editing purposes (only their ledger `.md` files were read, per the plan's "no game-repo edits" constraint) — `git status` in each game repo was not touched.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

169-CROSSWALK.md is complete and ready to gate plans 169-02 (lanternfall), 169-03 (seven), 169-04 (one-two-punch), 169-05 (doom-machine), and 169-06 (BoardSmithGames2/seven). Every removal candidate identified in the CONTEXT.md code_context inventory has a corresponding PRESENT verdict in Section 2, so none of the planned removals are blocked. D32 is the one recorded ABSENT verdict but it gates no removal (nothing in game `src/` depends on it). No blockers for downstream waves.

---
*Phase: 169-post-fix-game-de-workaround-sweep*
*Completed: 2026-07-22*

## Self-Check: PASSED
