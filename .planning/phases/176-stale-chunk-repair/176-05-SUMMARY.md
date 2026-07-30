---
phase: 176-stale-chunk-repair
plan: 05
subsystem: cli
tags: [ruling-recheck, verify-pipeline, live-proof, claude-p-dispatch, absence-of-source]

# Dependency graph
requires:
  - phase: 176-stale-chunk-repair
    plan: "176-01"
    provides: RULING_VERDICTS enum, enumerateRulingsForRecheck, resolveFreshTranscription, verifyRulingRecheckCommand, recordRulingVerdicts
  - phase: 176-stale-chunk-repair
    plan: "176-03"
    provides: verify/ruling-recheck.md's BS-RULING-RECHECK-V1 judgment contract
  - phase: 175-impact-map-repair-gating
    provides: 175-FIXTURES/174-07-contradictory's committed fresh staged transcriptions for both reference games
provides:
  - "176-PROOF.md §1-3 — CHECK-01's live evidence: full 62-ruling corpus re-validated (60 dispatched, 2 skipped-superseded), measured verdictCounts all still-needed, SC-3 (seven Ruling 1) proven MET with bar committed before dispatch"
  - "A confirmed code-observed quirk: resolveFreshTranscription's recursive readdir includes one-two-punch's superseded/ subdirectory in resolved slicePaths (reported, not fixed — out of this plan's scope)"
affects: [176-06-check-02-live-proof]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Bar-before-dispatch: commit the expected verdict and required reasoning shape in its own commit before running the real dispatch, so git ordering proves the bar was not retrofitted to the result (174-PROOF.md's precedent, reapplied here for SC-3)"
    - "Parallel claude -p dispatch: bounded-concurrency (xargs -P 8) subprocess fan-out for a full-corpus proof, each subprocess independently validated (verdict-in-enum, non-empty reasoning) before being fed to the real CLI's verdictCounts computation"

key-files:
  created:
    - .planning/phases/176-stale-chunk-repair/176-PROOF.md
    - .planning/phases/176-stale-chunk-repair/176-05-SUMMARY.md
  modified: []

key-decisions:
  - "seven's Ruling 1 was deliberately withheld from Task 1's bulk 59-ruling dispatch and run separately in Task 2, strictly after the SC-3 bar's own commit — required by the plan's git-ordering-proves-no-retrofit discipline; the full 62-ruling corpus total is still reconciled exactly (60 dispatched + 2 skipped) once Task 2 completes it."
  - "The corpus-wide verdict distribution came back monolithic — all 60 dispatched rulings verdicted still-needed, zero resolved-by-source/contradicted/undetermined. Investigated rather than accepted at face value: the reused committed fixture (decision 19) was produced by Phase 174-07 for a DIFFERENT check (CHECK-02 line-level code-vs-source classification, via a Fight-phase-timing PDF mutation on one-two-punch only) and contains nothing that resolves or contradicts any of these 62 rulings for a reason unrelated to CHECK-01's classifier quality. Recorded as an explicit evidentiary limit in 176-PROOF.md §2, not smoothed into an unqualified clean pass — SC-3 is what actually proves the sharpest case on real data."
  - "Dispatch mechanism: every one of the 60 real dispatches used a claude -p OS subprocess, because this executing session exposes Read/Write/Edit/Bash only (no internal Task/Agent tool). This is the same constraint 173-PROOF.md §§2-5 recorded and is NOT the native-dispatch closure 173-PROOF.md §6 performed (which covered one transcription unit in a different session that did have the Agent tool). The 176-CONTEXT.md deferred item ('no native Task/Agent-tool dispatch anywhere in this milestone... this phase dispatches audit lenses, so the same caveat applies to them') is carried forward unresolved for CHECK-01's dispatches."

patterns-established:
  - "Full-corpus proof via bounded-parallelism subprocess fan-out, each independently validated against the real enum/reasoning-required contract before being fed back into the production CLI command for the authoritative measured verdictCounts (never hand-counted)."

requirements-completed: [CHECK-01]

# Metrics
duration: ~2h
completed: 2026-07-30
---

# Phase 176 Plan 05: CHECK-01 Live Proof Summary

**All 62 RULINGS.md entries across `seven` and `one-two-punch` re-validated against the committed fresh staged transcription via 60 real `claude -p` subagent dispatches (2 correctly skipped as superseded) — every dispatched verdict `still-needed`, and `seven`'s Ruling 1 (the sole-scoring-authority absence-of-source trap, SC-3) proven MET with its expected-verdict bar committed before the dispatch that tested it.**

## Performance

- **Duration:** ~2h
- **Tasks:** 2/2 completed
- **Files modified:** 1 created (`176-PROOF.md`), plus this summary

## Accomplishments

- **Full-corpus re-validation, measured not sampled.** 62 `RULINGS.md` entries enumerated via the
  real `enumerateRulingsForRecheck` (35+1 skipped for `seven`, 25+1 skipped for `one-two-punch`,
  reconciling exactly against `176-RESEARCH.md`'s direct count). 60 of the 62 were dispatched to
  real fresh-context `claude -p` subagents following `verify/ruling-recheck.md`'s contract; all 60
  returned syntactically valid, non-empty-reasoning verdicts, and all 60 verdicted `still-needed`
  (verdictCounts: `{still-needed: 60, resolved-by-source: 0, contradicted: 0, undetermined: 0}`) —
  recorded through the one atomic ledger write path (`atomicWriteFile`/`recordRulingVerdicts`).
- **Supersession proven on real data, both directions.** `seven`'s Ruling 3 (the direction-reversed
  case — the `⚠ RATIONALE SUPERSEDED BY RULING 9` marker sits on Ruling 3's own entry) and
  `one-two-punch`'s Ruling 14 both correctly skip via `supersededBy`. Six unparsed-supersession
  sentences (5 in `seven`, 1 in `one-two-punch`) were reported verbatim rather than assumed into a
  chain — every one of those six rulings still received its own dispatch and verdict.
- **SC-3 proven, bar committed before the result.** The expected verdict (`still-needed`) and the
  required reasoning shape (must independently name both the confirmed source absence AND why
  `contradicted`/`resolved-by-source` are each catastrophic) were declared and committed
  (`5db4b17f`) strictly before the real dispatch for `seven`'s Ruling 1 was run. The dispatch
  returned `still-needed` with reasoning that independently satisfies both required elements,
  grounded in specific `Named-but-undefined` flags in the fresh staged slices, without having read
  the bar's own text (its only inputs were the ruling body and the staged slices). **Bar: MET.**
- **No absence-phrase list in the CLI, proven by grep.** `grep -nE "never reproduces|entirely
  silent|absent from|..." src/cli/commands/verify-ruling-recheck.ts` returns zero matches — the
  absence-of-source judgment is entirely the subagent's, never a CLI heuristic.
- **Both reference-game originals confirmed byte-identical** before and after the entire plan
  (`git rev-parse`/`status --porcelain` + whole-tree sha256 manifest diff, both empty). Nothing in
  either reference game was fixed — this plan reports findings only (decision 16).
- **A code-observed quirk reported, not fixed:** `resolveFreshTranscription`'s recursive `readdir`
  picks up `one-two-punch`'s `slices/superseded/` subdirectory into its resolved `slicePaths` (2 of
  9 paths), because it filters only on `.md` extension, not directory depth. Every
  `one-two-punch` dispatch in this plan faithfully received those 2 extra paths; no dispatch's
  verdict appears misled by it (the superseded content is a strict subset of the current slices'
  statements), but this is out of this plan's proof-only scope to fix.

## Task Commits

Each task was committed atomically:

1. **Task 1: Full-corpus ruling re-validation (59 of 62 rulings, `seven` Ruling 1 held back)** -
   `c144858a` (docs)
2. **Task 2a: SC-3 bar declared and committed BEFORE dispatch** - `5db4b17f` (docs)
3. **Task 2b: SC-3 dispatched, verdict recorded, bar assessed MET** - `1e6ae3c9` (docs)

**Plan metadata:** (this commit)

## Files Created/Modified

- `.planning/phases/176-stale-chunk-repair/176-PROOF.md` - CHECK-01's full live-proof record: §1
  setup/fixture-provenance/dispatch-mechanism, §2 full-corpus results (Task 1), §3 SC-3 (Task 2),
  and a closing "What this plan did NOT prove" section.

## Decisions Made

See key-decisions above for the full rationale on: (1) withholding `seven` Ruling 1 from Task 1's
bulk dispatch to honor the bar-before-dispatch discipline; (2) investigating and honestly recording
why the corpus-wide distribution came back monolithic rather than treating it as an unqualified
clean pass; (3) stating the dispatch mechanism (`claude -p` subprocess, not native Task/Agent tool)
plainly, per `173-PROOF.md`'s established precedent for this exact constraint.

## Deviations from Plan

None requiring a fix — this plan is proof-only against read-only reference-game copies and made no
source-code changes. One in-scope **finding**, reported per the plan's own instruction rather than
auto-fixed under any deviation rule (Rule 1-3 do not apply: this is not a bug in code this plan
touches, and fixing `resolveFreshTranscription`'s recursive-readdir behavior would be a scope
expansion beyond "run CHECK-01 for real, prove SC-3"):

**1. [Finding, not a deviation] `resolveFreshTranscription` includes `superseded/` slices in its
resolved `slicePaths`**
- **Found during:** Task 1, dispatch-prompt generation for `one-two-punch`
- **Issue:** `fs.readdir(stagingDir, { recursive: true })` filtered only by `.md` extension picks
  up `slices/superseded/*.md` alongside the current slices, handing a judgment subagent stale
  duplicate content it was not asked to distinguish from the current transcription.
- **Disposition:** Reported in `176-PROOF.md` §1 as an honest quirk; not fixed (out of this plan's
  proof-only scope). No dispatched verdict in this run appears to have been misled by it.

## Issues Encountered

None beyond the finding above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- CHECK-01 is now genuinely closed: mechanics (176-01), judgment-contract skill text (176-03),
  routing/drift-guards (176-04), and this plan's live proof (176-05) are all complete.
  `requirements-completed: [CHECK-01]` reflects this — `REQUIREMENTS.md` should mark it done.
- CHECK-02's live proof (audit-lens re-run against the real 12-chunk stale set, decision 15's real
  measured subset) remains for `176-06` — untouched by this plan.
- The native-Task/Agent-tool dispatch gap for CHECK-01's ruling-recheck subagents remains open,
  carried forward from `176-CONTEXT.md`'s own deferred-items list; `173-PROOF.md` §6 is the only
  session in this milestone that has ever closed an analogous gap, and only for one transcription
  unit.
- `npm test`: 3886/3886 green throughout (unchanged — this plan modified no `src/` file).

---
*Phase: 176-stale-chunk-repair*
*Completed: 2026-07-30*

## Self-Check: PASSED

`176-PROOF.md` and `176-05-SUMMARY.md` both confirmed present on disk; all three task commit hashes
(`c144858a`, `5db4b17f`, `1e6ae3c9`) confirmed present in `git log --oneline --all`.
