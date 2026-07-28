---
phase: 172-source-free-conformance-checks
plan: 05
subsystem: cli
tags: [vitest, cli, git, proof, trace-check, drift-check]

# Dependency graph
requires:
  - phase: 172-source-free-conformance-checks
    plan: 04
    provides: "boardsmith trace-check / drift-check registered on the CLI surface, findings exit 0, tool failure exits non-zero, both proven through the real bin/boardsmith.js entry point"
provides:
  - "172-PROOF.md: the SC-3 real-data record — both commands run against cp -R copies of both reference games, every reported count independently cross-checked against a from-scratch second computation, both originals confirmed byte-identical before/after"
  - "172-VALIDATION.md fully populated: all 12 tasks green, sign-off checkboxes checked, nyquist_compliant/wave_0_complete true"
affects: [173-bs-verify-game]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Independent cross-check discipline: every count the tool reports gets a from-scratch second computation (grep/awk/python parse or git diff), never trusting the command's own arithmetic — this run's cross-check caught a bug in its OWN first-draft script (unscoped manifest-path regex) and, separately, a real narrow-impact parser precision defect in the tool itself (AUTHORING_VERBS matching mid-prose)"

key-files:
  created:
    - .planning/phases/172-source-free-conformance-checks/172-PROOF.md
  modified:
    - .planning/phases/172-source-free-conformance-checks/172-VALIDATION.md

key-decisions:
  - "Hand-walked the three-rung resolution ladder on 4 real citations (3 one-two-punch, 1 seven) rather than only checking aggregate counts — this is what surfaced the AUTHORING_VERBS defect; aggregate-count matching alone would have missed it since the citation was already correctly reported ambiguous regardless"
  - "Reported the found parser defect prominently rather than silently working around it or treating it as out of scope, per the plan's explicit instruction ('a proof that only records the command's own output proves nothing... report it prominently, do not paper over it') — filed as a documented follow-up, not fixed in this proof-only plan"
  - "Went beyond the plan's exhibit (jab/GuardCardView.vue) to trace WHY the file was already absent at the verified hash itself (deletion commit is an ancestor of the verify commit, not a descendant) — sharpening decision 12's justification: a pure git-diff-based check would have missed this exact case, only the unconditional disk-existence check catches it"

requirements-completed: [CHECK-03, CHECK-05]

# Metrics
duration: ~90min
completed: 2026-07-28
---

# Phase 172 Plan 05: Real-data proof — trace-check and drift-check against both reference games Summary

**Ran `trace-check`/`drift-check` against copies of `~/BoardSmithGames/{seven,one-two-punch}` in 8 real invocations (4 `--json` + 4 human), independently cross-checked every reported count from scratch, and in doing so found and documented two real things: a bug in the cross-check script's own first draft, and a narrow-impact parser precision defect in `trace-check`'s `AUTHORING_VERBS` regex.**

## Performance

- **Duration:** ~90 min
- **Started:** 2026-07-28T19:20:00Z (approx, first tool call)
- **Completed:** 2026-07-28T20:56:10Z
- **Tasks:** 2 (both completed)
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- **Read-only preflight passed cleanly on both originals.** `seven` confirmed at pinned HEAD `a03f38d4792af9dfc7c798be69686fc3230f54dd` with empty porcelain; `one-two-punch` confirmed at pinned HEAD `7e69471bd8980a854f3e351f2f486e1fb6f712b9` (porcelain NOT asserted empty there, per instruction — its two pre-existing deletions were left alone). Whole-tree SHA-256 manifests captured for both (3919 files for `seven`, 4134 for `one-two-punch`) before any copy was made.
- **`cp -R` copies made; all 8 invocations ran only against the copies and all exited 0** with real, substantial findings on the first run — no dry no-op: `trace-check` reported 157/165 untested claims on one-two-punch and 212/212 on seven; `drift-check` reported 10/12 chunks drifted on one-two-punch and 16/17 on seven.
- **Every claim-count and ruling-count total independently re-derived from a from-scratch Python/grep parse and matched the tool exactly**: 165/212 claims, 26/36 rulings, both games.
- **6 chunks' drift (3 per game, including the highest-drift chunk in each) independently re-derived via a from-scratch `git diff --name-only <hash> HEAD` intersected with an independently-parsed manifest file list — matched the tool's `changedFiles`/`missingFiles`/`manifestFileCount` exactly in all 6 cases**, after catching and fixing a bug in the first-draft cross-check script itself (an unscoped regex picked up path-shaped tokens from prose inside status cells, not just the file-path cell — documented in the proof as the kind of disagreement the plan asked to be reported, not papered over).
- **The decision-12 exhibit (`jab`'s manifest listing `src/ui/components/GuardCardView.vue`, deleted and never recreated) confirmed independently in full** — plus a sharper finding: the deleting commit is an ancestor of the chunk's OWN verified hash, meaning the file was already absent at verification time, not merely deleted afterward. A pure `git diff --name-only <hash> HEAD -- <path>` on just that file prints nothing (confirmed), so a diff-only drift check would have missed this case entirely — only decision 12's unconditional disk-existence check catches it. Two more independently-discovered missing-file cases (`rest`'s `rest.js`, `plan-and-reveal`'s `tests/a11y.example.test.ts`) confirm this is not a one-off.
- **Hand-walked the three-rung resolution ladder on 4 real citations, comparing predicted outcome against the tool's actual JSON, one per rung-type plus one full trace on seven**: rung-3-deciding (`claim 5` in `punch.test.ts` → `second-action-resolution`), rung-2-alone-deciding (`claim 19` in `a11y.test.ts` → `jab`), stays-ambiguous-after-all-three-rungs (`claim 6` in `a11y.test.ts` → `jab, second-action-resolution`), and one seven citation (`claim 13` in `game.test.ts`) that surfaced a real defect.
- **Found and documented a real, reproducible parser precision defect**: `trace-check.ts`'s `AUTHORING_VERBS` regex (`/\b(new|written)\b/i`) matches the word "written" anywhere in a status cell's full prose, not anchored to the row's own leading verb. `seven`'s `game-end-trigger` chunk has a genuinely `unchanged` (non-authoring) `tests/game.test.ts` row whose explanatory prose happens to contain "...any test **written** for it would go green..." — causing it to be misclassified `authoring: true` and appear in a candidate list it should have been excluded from. Confirmed by directly importing and running the real `parseBuildManifest()` against the exact file. Measured the blast radius across both games (grepped every manifest entry for `authoring: true` rows not visibly starting with `new`/`written`): exactly 3 such rows in `seven`, 0 in `one-two-punch`; 2 of the 3 are on non-`.test.ts` paths and never consulted by the claim-resolution ladder (which only looks up `.test.ts` files), so the live consequential impact this run is exactly the one case documented — and its effect was cosmetic (one extra name added to an already-multi-candidate-ambiguous list), never a false single-chunk resolution.
- **Ruling supersession-exemption confirmed correct on live data**: `172-RESEARCH.md`'s raw pre-exemption figure was 3 untested rulings for one-two-punch; the tool reports 2. Independently confirmed Ruling 14 is legitimately exempt (Ruling 16's entry reads "This supersedes Ruling 14's..." — the narrow, direction-aware pattern decision 5 targets) — the tool's lower count is the CORRECT answer, not a discrepancy.
- **`test-unlinked`/`unassociated-test` negative space confirmed**: independently re-derived Build-Manifest-scoped ownership (not a naive whole-file grep, which over-matches prose mentions) for every test file in both games and matched the tool's `unassociated-test` sets exactly (4 for one-two-punch, 3 for seven); confirmed decision 6b's trigger fired only for genuinely rule-importing, citation-free, chunk-associated files and did NOT fire on the legitimately-varied a11y/soak/theme files RESEARCH.md flagged as a risk.
- **`npm test`: 3503/3503 green**, matching the baseline from `172-04-SUMMARY.md` (no `src/` touched by this proof-only plan).
- **Both originals re-verified byte-identical after the run**: `rev-parse`/`status --porcelain` unchanged for both, and a whole-tree SHA-256 manifest diff (before vs after) printed zero output for both games — provably, not merely asserted, unchanged.

## Task Commits

This plan's two tasks culminated in a single atomic commit (the entire plan's `files_modified` is `172-PROOF.md` and `172-VALIDATION.md`, both finished together as one proof-writing unit — consistent with `171-07`'s precedent of a single proof-record commit):

1. **Tasks 1+2: read-only preflight, real runs, independent cross-checks, `172-PROOF.md`, `172-VALIDATION.md`** — `07e34a6c` (docs)

## Files Created/Modified

- `.planning/phases/172-source-free-conformance-checks/172-PROOF.md` (631 lines, new) — the SC-3 real-data record: verbatim invocations, verbatim output, 8 independent cross-check sections, and a "What is still unproven" section
- `.planning/phases/172-source-free-conformance-checks/172-VALIDATION.md` (modified) — all 12 tasks marked green with observed results, all 7 sign-off checkboxes checked, `status: complete`, `wave_0_complete: true`

## Decisions Made

- **Hand-walked individual resolution-ladder citations rather than relying only on aggregate counts.** Aggregate counts (165/212 claims, 26/36 rulings, 18/13 ambiguous, drift file counts) all matched exactly and would, on their own, have looked like a clean pass. The per-citation hand-walk is what surfaced the `AUTHORING_VERBS` defect — a lesson directly applied from the plan's own instruction to never trust the tool's own arithmetic, extended one level deeper than count-matching into individual-decision-matching.
- **Reported the defect prominently rather than treating it as out of scope for a proof-only plan.** The plan's `files_modified` does not include `src/`, so the defect was NOT fixed here — but per the plan's explicit instruction ("report it prominently, do not paper over it or silently adjust the expectation to match"), it is documented in full in `172-PROOF.md` with root cause, confirmed blast radius (3 occurrences total, 1 consequential), and a specific fix recommendation (anchor `AUTHORING_VERBS`/`EDITING_VERBS` to the leading verb, not the whole cell) for a follow-up task.
- **Sharpened the decision-12 exhibit beyond what the plan specified.** Rather than stopping at "manifest lists it, it's absent, deletion commit exists" (the plan's three-part exhibit), traced the deletion commit's ancestry relative to the chunk's own verified hash — discovering the file was already gone AT verification time, not merely afterward, which is a stronger and more precise justification for decision 12's unconditional disk-existence-check design than a pure git-diff approach would provide.

## Deviations from Plan

None that required a Rule 1-4 fix — this is a proof-only plan and no production code was touched. One thing worth naming explicitly since it is adjacent to a deviation: the independent cross-check found a real defect in `trace-check.ts` (the `AUTHORING_VERBS` whole-cell-match imprecision). Per Rule 1 ("auto-fix bugs"), this would normally be fixed inline — but this plan's `files_modified` is scoped to `172-PROOF.md`/`172-VALIDATION.md` only, and the defect's confirmed blast radius on this run's actual findings was cosmetic (no verdict flip), not a correctness-of-this-proof issue. Fixing `src/cli/commands/trace-check.ts`/`build-manifest.ts` here would exceed this plan's proof-only scope and risk re-litigating a locked decision (the resolution ladder) mid-proof. Documented in full in `172-PROOF.md`'s "What is still unproven" section as a follow-up recommendation instead of auto-fixed — this is a deliberate scope judgment, not an oversight.

## Issues Encountered

- **First-draft independent cross-check script had its own bug** (unscoped path-token regex over the whole Build Manifest cell, not just the first/path cell) that produced a manifest-file-count disagreement against the tool (25 vs 23 for `jab`). Diagnosed by reading the actual manifest table structure, fixed by scoping the regex to genuine first-cell content, and re-run — the fixed independent count then matched the tool exactly across all 6 spot-checked chunks. Recorded transparently in `172-PROOF.md` rather than silently corrected and hidden, per the plan's instruction to report cross-check disagreements prominently.

## User Setup Required

None — no external service configuration required. `git` (already an assumed dependency) is the only tool this plan invoked beyond the repo's own CLI.

## Next Phase Readiness

Phase 172 is complete: CHECK-03 (traceability sweep) and CHECK-05 (code drift) both exist, are registered on the CLI surface, and are now proven end-to-end against real, non-fixture data from both reference games, satisfying success criterion 3. `172-PROOF.md` is the durable record Phase 173's `/bs-verify-game` should read before wiring these two commands into its pipeline — it names both what is proven and what remains unproven (notably: neither command has yet been exercised from inside a skill-text invocation, only via direct CLI calls; and the `AUTHORING_VERBS` defect should be fixed before Phase 173 depends heavily on resolution-ladder precision at higher citation volume than these two games currently exhibit).

No blockers for Phase 173.

---
*Phase: 172-source-free-conformance-checks*
*Completed: 2026-07-28*

## Self-Check: PASSED

- FOUND: .planning/phases/172-source-free-conformance-checks/172-PROOF.md (631 lines)
- FOUND: .planning/phases/172-source-free-conformance-checks/172-VALIDATION.md (modified, all 12 tasks green, sign-off checked)
- FOUND commit: 07e34a6c
- `npm test`: 3503/3503 passed
- Both reference-game originals confirmed byte-identical before/after (whole-tree SHA-256 manifest diff, zero output both games)
