---
phase: 177-derived-line-re-derivation
plan: 12
subsystem: cli-verify
tags: [verify-derive-recheck, gap-closure, live-proof, targeting, honesty-discipline, negative-result]

# Dependency graph
requires:
  - phase: 177-derived-line-re-derivation (plans 08-11)
    provides: The decoration-tolerant, ledger-integrity-hardened, write-surface-complete, and
      targeting-fix-instrumented CHECK-04 core (annotationBody backstop, fence-rejecting
      upsert-append ledger, verifyDeriveRecordCommand, blindDeriveHandle/focusQuoteWindow/
      derivePayloadSet/factAlignment) this plan measures on real dispatch data.
provides:
  - 177-TARGETING-PREDICTION.md (commit f0b6a038) — a pre-registered, immutable metric definition
    and per-line prediction for the 16 real dispatch candidates, committed alone before any
    dispatch, naming a concrete FAILURE outcome (rule b) in advance
  - 177-PROOF-2.md — the real live re-proof: 28 real claude -p dispatches (16 blind + 12 compare)
    against fresh cp -R copies, every verdict recorded through the real `boardsmith
    verify-derive-record` CLI, measuring that the targeting fix did NOT close the artifact
    problem 177-PROOF.md measured (offTargetDisagreements 8/8 = 100% of disagrees, exceeding
    177-PROOF.md's own 8/9 = 89%)
  - A new, previously-unmeasured finding: a correctly and uniquely narrowed focus passage
    (targetingAmbiguous: false) does not reliably cause the blind subagent to derive the fact that
    passage supports — 6 of 8 off-target disagreements this run occurred on lines with a UNIQUE
    focus window, meaning focusQuoteWindow's payload-construction fix is necessary but not
    sufficient
affects: [177-13]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pre-registration discipline extended to a two-tier metric: purely mechanical, zero-dispatch
      metrics (targetingAmbiguousCount) are computed by a zero-dispatch dry-run BEFORE the
      prediction commit and disclosed as such (they are code-determined facts, not judgment
      calls); genuinely dispatch-dependent metrics (verdict distribution, factAlignment split)
      remain blind until Task 2's real dispatches run. Both are still committed in one file,
      before any dispatch, with the sequencing distinction disclosed rather than hidden."
    - "A committed, immutable prediction file can itself contain an authoring defect (duplicate/
      contradictory per-line assignment, or an outright omission) discovered only during
      predicted-vs-measured reconciliation — the correct handling is to report the defect
      honestly and score the affected lines UNDETERMINED, never to silently resolve the
      ambiguity in whichever direction is convenient after the fact."

key-files:
  created:
    - .planning/phases/177-derived-line-re-derivation/177-TARGETING-PREDICTION.md
    - .planning/phases/177-derived-line-re-derivation/177-PROOF-2.md
  modified: []

key-decisions:
  - "The Task 1 zero-dispatch dry-run (which computes targetingAmbiguousCount and per-slice focus
    content — 100% code-determined by already-shipped, already-tested 177-11 source) was executed
    once BEFORE 177-TARGETING-PREDICTION.md was written, in order to learn the shipped field
    shapes per the plan's own <read_first> instruction. This is disclosed explicitly in the
    prediction file's own procedural note rather than silently absorbed, on the reasoning that a
    fully mechanical, deterministic value has no judgment call to leak — reading the code and
    running it produce the identical number. The genuinely blind quantities (verdict
    distribution, factAlignment split) were predicted with zero dispatches of any kind having
    occurred."
  - "The headline result is reported as a FAILURE per 177-TARGETING-PREDICTION.md's own
    pre-committed interpretation rule (b), in the exact words that rule committed to using: the
    targeting fix did not work. offTargetDisagreements is 8/8 (100%) of this run's disagrees
    verdicts, exceeding 177-PROOF.md's own pre-fix ratio of 8/9 (89%). No threshold was moved, no
    alternate reading was sought to rescue a better-looking number."
  - "A genuine authoring defect discovered in the already-committed, immutable
    177-TARGETING-PREDICTION.md during predicted-vs-measured reconciliation (one-two-punch:95
    named in two contradictory buckets; seven:11 and seven:42 never individually predicted despite
    being real candidates) is reported explicitly in 177-PROOF-2.md rather than corrected in place
    (the file is immutable per this phase's own discipline) or silently resolved in whichever
    direction happens to score a hit."

requirements-completed: []  # CHECK-04 stays OPEN/PARTIAL — this is gap-closure plan 5 of 6 (177-08..13)

# Metrics
duration: ~150min
completed: 2026-07-30
---

# Phase 177 Plan 12: Live Re-Proof of the Targeting Fix — Measured FAILURE, Reported Honestly Summary

**Re-ran the full 16-candidate live CHECK-04 corpus against 177-11's targeting fix with 28 real
`claude -p` dispatches through the real `verify-derive-record` CLI, and found — measured, not
assumed — that the fix did NOT close the targeting-collapse artifact problem `177-PROOF.md`
self-reported: every one of this run's 8 `disagrees` verdicts carries `factAlignment:
different-fact` (100% off-target, worse than the prior run's own 89%), against a
pre-registered prediction (`177-TARGETING-PREDICTION.md`, committed alone before any dispatch)
that named this exact failure outcome in advance and committed to reporting it in these words.**

## Performance

- **Duration:** ~150 min
- **Completed:** 2026-07-30
- **Tasks:** 3/3 completed
- **Files created:** 2 (`177-TARGETING-PREDICTION.md`, `177-PROOF-2.md`)

## Accomplishments

- **Pre-registration committed alone, before any dispatch (Task 1).** `177-TARGETING-PREDICTION.md`
  committed in `f0b6a038`, `git show --stat` for that commit lists only that one file. Names a
  concrete FAILURE outcome (interpretation rule b: `offTargetDisagreements` remaining >50% of
  `disagrees`, mirroring `177-PROOF.md`'s own 8-of-9 ratio, means the fix did not work) as
  concretely as the success outcome. `177-PREDICTION.md` (the original 22-line prediction from
  `177-06`) remains untouched — `git diff HEAD -- 177-PREDICTION.md` is empty.
- **Zero-dispatch mechanical dry-run proved the harness before spending real dispatches.** Built
  every payload for all 16 real candidates via the shipped `derivePayloadSet`, computed
  `targetingAmbiguousCount` (4/16, all in `seven`: `seven:19`/`21` and `seven:36`/`38`) with zero
  model calls — this number was later predicted EXACTLY (4/16) and measured EXACTLY (4/16), the
  one fully mechanical metric in the whole proof.
- **28 real `claude -p` dispatches** (16 blind + 12 compare — 4 of 16 blind results terminated
  without a compare dispatch per the pass-through rule: `seven:33`/`42` `underivable`,
  `one-two-punch:89` `not-rule-bearing`, `one-two-punch:95` `underivable`) against fresh `cp -R`
  copies of both reference games, each a genuine fresh OS subprocess
  (`claude -p "<prompt>" --allowedTools Read`), never native Task/Agent dispatch — stated honestly
  per this milestone's own precedent.
- **Every verdict recorded through the real registered `boardsmith verify-derive-record` CLI** —
  the driver spawns `node dist/cli.js verify-derive-record ...` as a child process for all 16
  recordings; it never calls `createDeriveVerdictRecord`/`recordDeriveVerdict` from its own
  process. `verify-derive-recheck --json` for both games reports zero `pending`, zero
  `staleRecords`, zero `orphanedRecords`.
- **Independence greps, including the new own-coordinate check.** All 16 blind prompts: zero
  `Derived (p.`/`Visual (p.` matches. All 12 compare prompts: exactly 1 `Derived (p.` match (the
  documented carve-out). New this run: each candidate's own slice path and own line number grepped
  against its own blind prompt — zero real leaks (one line-number-digit false positive
  investigated and confirmed coincidental: `"30 MINUTES"` box play-time text plus a hex substring
  of the opaque handle, neither the target's own resolvable line number).
- **The headline measured result: the targeting fix did not work, reported in exactly the words
  the pre-registered interpretation rule committed to using.** `offTargetDisagreements` is 8 of 8
  `disagrees` verdicts (100%), exceeding `177-PROOF.md`'s own pre-fix ratio (8 of 9, 89%).
  `genuineDisagreements` is 0/16. The raw `disagrees` rate barely moved (50%, 8/16, vs. 56%, 9/16).
- **A new, previously-unmeasured finding surfaced by this run and disclosed to `177-13`**: a
  correctly and UNIQUELY narrowed focus passage (`targetingAmbiguous: false`) does not reliably
  cause the blind subagent to derive the fact that passage actually supports — 6 of the 8
  off-target disagreements occurred on lines with a unique focus window (only 2, `seven:36`/`38`,
  are explained by the mechanically-flagged `targetingAmbiguous` collision). The
  payload-construction-layer fix (`focusQuoteWindow`) worked exactly as designed at that layer
  (zero coordinate leaks, `targetingAmbiguousCount` predicted exactly) — the remaining gap is in
  the blind subagent's own derivation judgment given a correctly-scoped prompt, a genuinely
  different defect than the one 177-11 closed.
- **An authoring defect in the already-committed, immutable prediction file was found and
  disclosed, not corrected in place.** Reconstructing the full 16-line predicted-vs-measured table
  surfaced that `one-two-punch:95` was named in two contradictory buckets (`agrees` AND
  `not-rule-bearing`) and that `seven:11`/`seven:42` were never individually predicted at all
  despite being real candidates — reported explicitly in `177-PROOF-2.md` and scored
  UNDETERMINED for those three lines, per this plan's own honesty discipline (never silently
  resolve an ambiguity in the direction that scores a hit).
- **Both originals confirmed byte-identical, whole-tree, before and after** all 28 dispatches and
  16 CLI writes; both still at their pinned commits (`a03f38d4...`, `7e69471b...`).

## Task Commits

1. **Task 1: Pre-register the targeting metric, commit alone, dry-run the harness (zero dispatch)**
   — `f0b6a038` (docs)
2. **Task 2 + Task 3 (combined — see Deviations): the live re-proof and closure** — `4e704491`
   (docs)

## Files Created/Modified

- `.planning/phases/177-derived-line-re-derivation/177-TARGETING-PREDICTION.md` (created) —
  pre-registered metric definitions, per-line predictions, and interpretation rules (including the
  concrete failure outcome that fired), committed alone before any dispatch
- `.planning/phases/177-derived-line-re-derivation/177-PROOF-2.md` (created) — the real live
  re-proof: §1 setup/hashes/install/dispatch mechanism/enumeration, §2 independence greps
  (including the new own-coordinate check), §3 the full 28-dispatch corpus run with the measured
  distribution, predicted-vs-measured, and the honest failure-outcome finding, §4 closure with
  originals re-verification and re-run instructions
- No source code was modified — this is a proof-only plan; `src/cli/commands/verify-derive-recheck.ts`
  and `src/cli/cli.ts` are unchanged from `177-11`'s state.

## Decisions Made

See `key-decisions` in frontmatter. The most consequential: the mechanical Task 1 dry-run was run
once before the prediction file was written (to learn the shipped field shapes per the plan's own
`<read_first>` instruction), and this sequencing is disclosed explicitly rather than hidden —
justified because that specific metric (`targetingAmbiguousCount`) is 100% code-determined by
already-frozen, already-tested source with no live-dispatch judgment call involved. The genuinely
blind, dispatch-dependent quantities (verdict distribution, `factAlignment` split) were predicted
with zero dispatches of any kind having occurred anywhere in this plan's history before the
prediction commit.

## Deviations from Plan

### Combined Task 2 + Task 3 commit (not a code deviation, a commit-structure deviation)

- **Found during:** Task 3, when staging for commit.
- **Issue:** the plan lists Task 2's file as `177-PROOF-2.md` §§1-3 and Task 3's file as the same
  file's §4 — both tasks write to the SAME single document, sequentially, and cannot be split into
  two independently-coherent commits without either (a) committing a mid-document draft missing
  its own closure section, which misrepresents the file as "done" when it is not, or (b)
  reconstructing two artificial diffs against a file that was authored as one continuous pass
  (§1-4 reference each other — §4's "both originals byte-identical" claim depends on §3's dispatch
  work having actually run against the SAME scratch copies §1 set up).
- **Resolution:** committed both tasks together in a single commit (`4e704491`) with a message
  describing the complete document's content, rather than attempting an artificial split of one
  continuously-authored file.
- **Files affected:** `.planning/phases/177-derived-line-re-derivation/177-PROOF-2.md`
- **Commit:** `4e704491`

No other deviations. No code was auto-fixed (Rules 1-3) — this plan touches no source files, only
proof/prediction documentation.

## Issues Encountered

- `dist/cli.js` was stale (predated the 177-11 commit) at the start of this plan — rebuilt via
  `npm run build:cli` before any dispatch, so every real CLI invocation this proof ran (enumeration,
  `verify-derive-record`, the final `--json` reports) used the current, 177-11-inclusive binary.
  Not a deviation requiring a rule — a build-freshness step implicit in "use the real built CLI."
- The `npx boardsmith claude --local --force` install initially appeared to fail when invoked via
  a direct `node dist/cli.js claude --project ...` call (the installer resolves its own root via
  `__dirname` assuming a nested `packages/cli/dist/` layout that does not match this repo's
  `dist/cli.js` layout when invoked directly). Resolved by invoking through the globally-linked
  `npx boardsmith` entry point from inside each scratch project directory instead — the same
  invocation `177-06`/`177-07` used and the one `boardsmith.json`'s own documented install path
  expects. No code was touched; this is an invocation-method finding, not a defect in shipped code.

## Verification

- `git show --stat --oneline $(git log --format=%H -1 -- .../177-TARGETING-PREDICTION.md)` — lists
  only that one file.
- `git diff HEAD -- .../177-PREDICTION.md` — empty (original prediction untouched).
- 28 real `claude -p` dispatches, evidence files saved verbatim to disk before each dispatch at
  `${TMPDIR}/…/177-12-proof/evidence/{blind,compare}__*.txt`.
- `verify-derive-recheck --json` for both scratch copies: zero `pending`, zero `staleRecords`, zero
  `orphanedRecords`.
- Both originals: `diff manifest-*.before manifest-*.after` empty for both `seven` and
  `one-two-punch`; both `git rev-parse HEAD` unchanged from their pinned commits;
  `git status --porcelain` unchanged (seven empty, one-two-punch's pre-existing Phase 173
  exception unchanged).
- **Full `npm test` (mandatory, not a subdirectory subset):** 4033/4033 green across 241 files —
  identical to the pre-plan baseline (no source files changed by this plan).
- No stray processes left running (`ps aux | grep -i "claude -p\|dispatch.ts"` returns nothing
  after this plan's driver completed).

## Known Stubs

None — no source code was created or modified by this plan.

## Threat Flags

None — this plan modifies no source files and introduces no new network endpoint, auth path, file
access pattern, or schema change. `T-177-12-01` (tampering with reference-game originals) is
mitigated (sha256 baselines + whole-tree diff, both empty). `T-177-12-02` (a result reported
against a retrofitted expectation) is mitigated by the pre-registration commit ordering.
`T-177-12-03` (blind subagent opening the live slice via its unsandboxed file-read tools) remains
explicitly `accept`ed per the plan's own threat model, and is restated in `177-PROOF-2.md` §4's
"What is still unproven" rather than silently assumed closed.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

`177-13` inherits two things from this plan, both disclosed plainly: (1) the measured result that
177-11's targeting fix did not close the artifact problem `177-PROOF.md` self-reported —
`offTargetDisagreements` is 100% of this run's `disagrees` verdicts, worse than the pre-fix 89%;
(2) a new, more specific finding about WHY — a correctly and uniquely narrowed focus passage does
not reliably steer the blind subagent's own derivation to the fact that passage supports, which is
a defect in judgment given a correctly-scoped prompt, not in payload construction. `177-13`'s job
(re-measure the phase goal, dispose of CHECK-04) inherits this as a real, unresolved limitation to
report — not something this gap-closure sequence closed. **CHECK-04 stays OPEN/PARTIAL in
`REQUIREMENTS.md`** — this is 5 of 6 gap-closure plans; `177-13` remains.

---
*Phase: 177-derived-line-re-derivation*
*Completed: 2026-07-30*

## Self-Check: PASSED

Both created files confirmed present on disk; both commits (`f0b6a038`, `4e704491`) confirmed
present in `git log`.
