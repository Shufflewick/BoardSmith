---
phase: 170-ingest-contract-upgrade
plan: 05
subsystem: testing
tags: [vitest, node-fs, node-crypto, checker, ingest-verification]

requires:
  - phase: 170-ingest-contract-upgrade
    provides: >
      170-PROOF-RUN.md's root-cause finding (a contract test proves an instruction exists,
      not that an agent followed it) and 170-PROOF-INDEX.md / 170-PROOF-SLICE.md's real
      non-conforming output, both consumed as fixture/spec source here.
provides:
  - "checkIngestArtifacts() + CHECK_IDS: a deterministic, dependency-free produced-artifact
    checker automating ingest gate items (a)-(f),(h),(i) against a real project directory"
  - "Two checked-in fixture trees: nonconforming/ (verbatim 2026-07-27 failed-run output) and
    conforming/ (hand-built tree satisfying every check, with a booby-trapped visual-survey
    file)"
  - "A deterministic self-test (25 assertions) proving the checker fails on the real failed
    output and passes on a conforming tree, plus three manually-run revert probes"
affects: [170-06, 170-08, 170-10]

tech-stack:
  added: []
  patterns:
    - "Produced-artifact checking: assert on what an agent actually wrote to disk, never on
      skill-text strings — the structural fix for 'contract test proves existence, not
      compliance'"
    - "Checked-in negative fixtures derived verbatim from a real failed run, never hand-tidied"

key-files:
  created:
    - scripts/ingest-harness/check.mjs
    - scripts/ingest-harness/check.test.mjs
    - scripts/ingest-harness/__fixtures__/README.md
    - scripts/ingest-harness/__fixtures__/nonconforming/rulebook/INDEX.md
    - scripts/ingest-harness/__fixtures__/nonconforming/rulebook/02-solo-variant.md
    - scripts/ingest-harness/__fixtures__/conforming/rulebook/INDEX.md
    - scripts/ingest-harness/__fixtures__/conforming/rulebook/01-setup.md
    - scripts/ingest-harness/__fixtures__/conforming/rulebook/00-visual-survey.md
    - scripts/ingest-harness/__fixtures__/conforming/rulebook/source/rules.pdf
  modified: []

key-decisions:
  - "gaps-reconciliation is unconditional: it never gates the comparison on the count looking
    low, since a drop can land anywhere (170-03-PLAN.md's load-bearing wording, preserved)"
  - "Missing '## Open Rules Gaps' heading is treated as a 0-entry section for reconciliation
    purposes rather than aborting the check — this still produces the correct FAIL direction
    (markers > entries) against the real failed run"
  - "derived-purity is documented in-source as a heuristic, not a parser, per plan instruction —
    false positives are a human judgment for the Plan 10 gate, not something this checker
    self-adjudicates"
  - "conforming/rulebook/source/rules.pdf is a 113-byte synthetic stand-in, not a copy of the
    2.1 MB seven/rules.pdf, since the checker hashes bytes and never parses PDF content"

requirements-completed: []

duration: 35min
completed: 2026-07-27
---

# Phase 170 Plan 05: Deterministic Ingest Harness Checker Summary

**A dependency-free `checkIngestArtifacts()` that reads a produced ingest project directory and
reports 9 named pass/fail checks with observed-value details — proven to fail all 9 against the
real 2026-07-27 non-conforming run and pass all 9 against a hand-built conforming tree.**

## Performance

- **Duration:** 35 min
- **Started:** 2026-07-27T14:55:00Z
- **Completed:** 2026-07-27T15:30:00Z
- **Tasks:** 3
- **Files modified:** 9 created (0 modified)

## Accomplishments

- Built `scripts/ingest-harness/check.mjs`: a pure `node:fs`/`node:path`/`node:crypto` module
  exporting `checkIngestArtifacts` and a frozen `CHECK_IDS` array, mechanizing gate letters
  (a)-(f), (h), (i) from 170-03-PLAN.md's human checklist. Every check reports an observed-value
  `detail` string, never a bare boolean, and no check ever throws — a missing upstream file
  reports `pass: false` naming the missing path.
- Built two checked-in fixture trees: `nonconforming/` is the verbatim 2026-07-27 failed-run
  output (`170-PROOF-INDEX.md` / `170-PROOF-SLICE.md` copied byte-for-byte, no `rulebook/source/`
  directory added since its absence is the real (a) defect), and `conforming/` is a hand-built
  tree satisfying every check, including a deliberately booby-trapped `00-visual-survey.md` that
  trips the `derived-purity` presentation lexicon while being excluded from the slice-file
  helper.
- Wrote `scripts/ingest-harness/check.test.mjs`: a deterministic, mock-free, subprocess-free self
  test with 25 assertions across two describe blocks, run under the existing `vitest.config.ts`
  `scripts/**/*.test.mjs` include pattern, alongside the 3211 pre-existing tests (now 3236).

## Task Commits

1. **Task 1: Write the produced-artifact checker** - `a3715b5e` (feat)
2. **Task 2: Build the non-conforming and conforming fixture project trees** - `68ed7833` (test)
3. **Task 3: Pin the checker with a deterministic self-test** - `7281cd03` (test)

**Plan metadata:** committed separately after this SUMMARY (docs)

## Files Created/Modified

- `scripts/ingest-harness/check.mjs` - the checker: 9 named checks, `CHECK_IDS`, no new deps
- `scripts/ingest-harness/check.test.mjs` - self-test proving fails-on-real/passes-on-conforming
- `scripts/ingest-harness/__fixtures__/README.md` - not-skill-text + never-hand-edit-to-green rule
- `scripts/ingest-harness/__fixtures__/nonconforming/rulebook/{INDEX.md,02-solo-variant.md}` -
  verbatim copies of the real 2026-07-27 failed-run output
- `scripts/ingest-harness/__fixtures__/conforming/rulebook/{INDEX.md,01-setup.md,00-visual-survey.md,source/rules.pdf}` -
  hand-built conforming tree, including the booby-trapped survey file

## Decisions Made

- **Missing-heading reconciliation fallback:** the plan specifies counting "the entries in the
  `## Open Rules Gaps` section body," but the real failed run never emits that exact heading at
  all. Rather than making `gaps-reconciliation` unrunnable in that case, the checker treats a
  wholly-absent heading as a 0-entry body. This still yields the correct FAIL (`markers greater
  than entries: the transport is dropping gaps`) against the real fixture, and is the more
  diagnosable behavior — a check that can't run at all is a worse debugging proxy than one that
  reports the honest zero.
- **Reduced nonconforming slice set matches plan scope, not the original run's full slice set:**
  per Task 2's explicit instruction, only `02-solo-variant.md` is copied into the nonconforming
  fixture (not `01-components-and-credits.md`, also cited in `170-PROOF-RUN.md`). The
  `gaps-reconciliation` and `derived-purity` numbers therefore differ from the proof-run's
  original counts (1 slice-side marker here vs. 5-6 in the original 6-slice run) but the
  pass/fail outcome and failure direction are unchanged and still correctly diagnosable.
- **Conforming fixture's PDF is 113 bytes, not a copy of the real `seven/rules.pdf`** — per the
  plan's explicit instruction, since the checker only hashes bytes.

## Deviations from Plan

None — plan executed exactly as written. No Rule 1-4 auto-fixes were needed; the one adaptation
(missing-heading-as-zero-entries fallback for `gaps-reconciliation`) is a direct, literal
implementation of the spec's own stated logic (count entries in "the section body... or end of
file") applied to the case where the heading itself is absent, not a deviation from it.

## Adversarial Probes (PROC-02) — run and observed, not merely claimed

**Probe 1 — delete `Transcribed:` from the conforming INDEX.md:**
```
FAIL  ... "header-block" passes — enumerated by id so a new unsatisfied check surfaces immediately
AssertionError: expected false to be true
```
Restored via the pre-probe backup; `git diff --stat` reported no changes; suite re-ran GREEN
(25/25 passed).

**Probe 2 — delete one `Named-but-undefined (p.1):` line from `01-setup.md`:**
```
FAIL  ... "gaps-reconciliation" passes — enumerated by id so a new unsatisfied check surfaces immediately
AssertionError: expected false to be true
```
Directly queried detail before restoring:
```
{
  id: 'gaps-reconciliation', pass: false,
  detail: 'section entries=2, slice Named-but-undefined markers=1
           (entries greater than markers: the section is not built purely from openGaps[])'
}
```
Both counts present in the detail, confirming the reconciliation catches a silent drop. Restored;
`git diff --stat` empty; suite re-ran GREEN.

**Probe 3 — remove the `00-visual-survey.md` exclusion from `check.mjs`'s slice-file helper:**
```
FAIL  ... conforming fixture > "derived-purity" passes — enumerated by id ...
AssertionError: expected false to be true
FAIL  ... 00-visual-survey.md contains a Derived (p. line matching the presentation lexicon,
       yet derived-purity still passes (the booby trap)
AssertionError: expected false to be true
```
Both the enumerated-by-id assertion and the explicit booby-trap assertion went RED, as designed.
Restored via the pre-probe backup; `git diff --stat` empty; suite re-ran GREEN; full `npm test`
re-ran GREEN at 3236/3236.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The deterministic half of the ingest verification harness is complete and proven against real
  failed-run output. `CHECK_IDS` is exported as a frozen array for Plan 06's driver and Plan 08's
  additions to consume as a single source of truth.
- **Plan 170-06 (the live-agent driver) is explicitly NOT started here**, per this run's scope
  boundary — it spawns a headless agent with `--dangerously-skip-permissions` and requires
  explicit operator consent before proceeding.
- No INGEST requirement is claimed closed by this plan (per its own success criteria); this
  plan's `requirements-completed` is intentionally empty. PROC-01 and PROC-02 (this plan's own
  frontmatter `requirements`) are satisfied by the existence of the checker and the three revert
  probes above, respectively.

---
*Phase: 170-ingest-contract-upgrade*
*Completed: 2026-07-27*

## Self-Check: PASSED

All 9 created files verified present on disk. All 3 task commit hashes (`a3715b5e`, `68ed7833`,
`7281cd03`) verified present in `git log`.
