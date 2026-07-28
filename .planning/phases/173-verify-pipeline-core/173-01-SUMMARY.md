---
phase: 173-verify-pipeline-core
plan: 01
subsystem: cli
tags: [ingest-archive, provenance, chunk-provenance, wave-1-gate]

requires:
  - phase: 171-ingest-contract-upgrade
    provides: "HEADER_LABELS/renderIndex four-line provenance header contract; normalizeEdition/EDITION_UNKNOWN sentinel (F-1)"
  - phase: 171-ingest-contract-upgrade (later plan 07)
    provides: "computeVerificationScope() and the pre-provenance-project scope reason it reads"
provides:
  - "A repaired ingestArchiveCommand existing-INDEX branch that actually establishes provenance on an already-ingested project, instead of reporting false success while corrupting the header"
  - "Real-data proof that adoption works against BOTH reference games' real (and distinct) pre-provenance shapes"
  - "The unblocked precondition for CONTEXT.md decision 1 (adopt-on-first-verify) and every later plan in Phase 173 that needs real-game data"
affects: [173-02, 173-03, 173-04, 173-05, 173-06, 173-07]

tech-stack:
  added: []
  patterns:
    - "Decide-branch-before-try/catch: an existence probe (fs.access) selects the branch OUTSIDE any try/catch that performs a write, so a mid-repair throw can never fall through to a scaffold-overwrite path"
    - "Insert-if-absent via line-anchored findLabelLine() helper, never a blind .replace() (a no-match replace is a silent no-op)"
    - "Wrap-safe text repair: classify a legacy multi-line value (already-canonical / bare-path / wrapped-prose / absent) before mutating, and only ever strip a label prefix — never truncate designer prose"

key-files:
  created:
    - .planning/phases/173-verify-pipeline-core/173-PROOF.md
  modified:
    - src/cli/commands/ingest-archive.ts
    - src/cli/commands/ingest-archive.test.ts

key-decisions:
  - "Followed CONTEXT.md decision 1b's scope fence exactly: repaired only ingestArchiveCommand's existing-INDEX branch (extracted into a new repairExistingIndex helper), no refuse-on-ambiguity hardening, no broader rewrite."
  - "Refuted a plan hedge empirically (documented in 173-PROOF.md 'Hedge refutation'): chunk-provenance-status's projectProvenanceState field does NOT flip away from pre-provenance from this fix alone — that field tracks whether ANY chunk has ever had chunk-check run on it, a per-chunk concept unrelated to INDEX.md's header. The actual authoritative payoff check, computeVerificationScope() returning scope:'full', is what the gate asserts on, matching 173-PATTERNS.md's own stated 'Downstream proof target.'"
  - "Test B8 (canonical Source: wins) was unexpectedly GREEN pre-fix, contradicting the plan's stated RED expectation — the naive blind .replace() already produces a correct bare-path value on the first physical line; only the orphaned continuation (caught by B7) was actually broken. Kept the fixture and test as written since it correctly pins the post-fix invariant; documented the refuted hedge rather than force an artificial RED."
  - "Did NOT run requirements mark-complete for VERIFY-01 as fully closed — VERIFY-01 is declared in four of this phase's seven plans (01/04/05/06); this plan delivers only the wave-1 prerequisite gate, not the skill install/run capability VERIFY-01 describes. Left for the phase's later plans / phase close-out to mark complete once the skill actually exists and runs."

patterns-established:
  - "Real-data proof gate scripts (173-gate.sh) live in ${TMPDIR}/173-proof/ and re-cp -R fresh copies of both reference games from source on every invocation, so they are genuinely re-runnable rather than one-shot transcripts that depend on a prior run's mutated state."

requirements-completed: []

duration: ~50min
completed: 2026-07-28
---

# Phase 173 Plan 01: Repair ingest-archive's existing-INDEX branch (wave-1 gate) Summary

**Fixed `ingestArchiveCommand`'s existing-INDEX branch to actually establish provenance on an already-ingested project (insert-if-absent headers, wrap-safe `Source:` repair, `Edition:` preservation, decide-before-try/catch), and proved it against `cp -R` copies of both real reference games — `seven` (wrapped-prose `Source:`) and `one-two-punch` (no `Source:` line at all).**

## Performance

- **Duration:** ~50 min
- **Started:** 2026-07-28T17:07:00Z
- **Completed:** 2026-07-28T22:18:00Z
- **Tasks:** 3/3 completed
- **Files modified:** 3 (2 source, 1 new proof doc)

## Accomplishments

- Closed all four root causes named in CONTEXT.md decision 1b: silent no-op insert (a), wrapped-`Source:` truncation (b), `Edition:` clobbering (c), and the previously-undiscussed try/catch scaffold-overwrite hazard (d, T-173-01) that the plan's threat model flagged as the most severe.
- All 12 decision-1b behaviors (B1–B12, plus B12 split into a normal-path and a forced-failure sub-case) pass; full suite 3525/3525; zero lint errors in `src/cli/`.
- Proved the fix against real, distinct pre-provenance shapes on both reference games — not just a synthetic fixture — and confirmed `computeVerificationScope()` flips `code-conformance-only`/`pre-provenance-project` → `full` for both.
- Both `~/BoardSmithGames/*` originals confirmed byte-identical (whole-tree sha256 manifest) and at their pinned commits before and after every proof run.
- Refuted a plan-stated hedge empirically rather than silently absorbing the discrepancy, and documented it in `173-PROOF.md` so the actual payoff check (`computeVerificationScope`, not `chunk-provenance-status`'s project-level state) is unambiguous for later plans.

## Task Commits

1. **Task 1: Pin all three decision-1b defects with failing-first tests** — `8bdb1df1` (test)
2. **Task 2: Repair the existing-INDEX branch** — `08d6c193` (fix)
3. **Task 3: Wave-1 gate proof against copies of BOTH reference games** — `caecb724` (docs)

**Plan metadata:** (this commit)

_Task 1 (TDD RED) and Task 2 (TDD GREEN) form the test→feat gate sequence; no separate refactor commit was needed._

## Files Created/Modified

- `src/cli/commands/ingest-archive.ts` — `ingestArchiveCommand`'s existing-INDEX branch rewritten: existence decided via `fs.access` outside any write-performing try/catch; new `findLabelLine()` and `repairExistingIndex()` helpers; insert-if-absent for `Source hash:`/`Transcribed:`; wrap-safe `Source:` classification (already-canonical / bare-path / wrapped-prose / absent); `Edition:` left byte-identical when `--edition` is omitted and a real value exists; the "provenance header updated" success line now only prints when the header was actually brought to contract.
- `src/cli/commands/ingest-archive.test.ts` — new `ingest-archive — existing INDEX.md adoption (decision 1b)` describe block: a `writePreProvenanceIndex()` fixture reproducing `seven`'s real shape, and 13 tests (B1–B12, with B12 split) covering insert-if-absent, header contiguity, Edition preservation/settability/F-1 compatibility, wrap-safe Source: handling, idempotence, and the forced-mid-repair-failure no-scaffold-overwrite case (using a write-only/no-read chmod to isolate the read failure from the write failure, so old vs. new code are genuinely discriminated).
- `.planning/phases/173-verify-pipeline-core/173-PROOF.md` — § 1 Wave-1 gate: verbatim BEFORE/AFTER `INDEX.md` for both games, diffs, independent cross-checks (sha256, regex well-formedness, second-run idempotence), a real `chunk-check`/`chunk-provenance-status` downstream demonstration, originals re-verification, and the hedge-refutation writeup. `## What is still unproven` stub lists the three live-session proofs (SC-2, SC-3, SC-4) owed by plans 173-06/173-07.

## Deviations from Plan

### Auto-fixed Issues

None beyond what the plan's own tasks specified — Task 2 implemented exactly the four changes the plan's action block enumerated, in the order given.

### Findings (not deviations — documented, not silently absorbed)

**1. Refuted hedge: test B8 was unexpectedly GREEN pre-fix.**
- **Found during:** Task 1
- **Detail:** the plan's `<verify>` block expected "at least B1, B2, B4, B7, B8 and B10 FAIL" pre-fix. B8 (the first `^Source:` match is the canonical bare path) was already green against the old code, because the old code's blind `.replace()` genuinely writes the correct value onto the first physical line — only the orphaned continuation line (independently caught by B7) is corrupted. Per the plan's own instruction ("a behavior that is unexpectedly GREEN means the fixture does not reproduce the real defect and the fixture is wrong, not the code"), I verified the fixture DOES reproduce `seven`'s real shape byte-for-byte and concluded the fixture is correct; the hedge itself was imprecise. Left the test as-is (it remains a valid post-fix invariant).
- **Files:** `src/cli/commands/ingest-archive.test.ts`

**2. Refuted hedge: `chunk-provenance-status`'s `pre-provenance` payoff check does not flip from this fix alone.**
- **Found during:** Task 3
- **Detail:** documented in full in `173-PROOF.md`'s "Hedge refutation" section. `projectProvenanceState` tracks whether any chunk has ever had `chunk-check` run on it — unrelated to `INDEX.md`'s provenance header — and both reference games are documented elsewhere in this same file (`chunk-provenance.ts`'s own doc comment) to stay `pre-provenance` there permanently until a later phase's chunk-check sweep. Used `computeVerificationScope()` returning `scope: 'full'` as the primary, authoritative gate assertion instead — exactly what `173-PATTERNS.md`'s "Downstream proof target" specifies — and additionally demonstrated the real CLI-visible effect (`chunk-check` on one chunk per game now records `scope: full`) as supplementary evidence.
- **Files:** `.planning/phases/173-verify-pipeline-core/173-PROOF.md`

### Additional false-success behavior surfaced (todo candidate, per plan's `<output>` instruction)

None beyond the three root causes (a/b/c) and the T-173-01 scaffold-overwrite hazard (d) already named in CONTEXT.md decision 1b — all four are closed by this plan. No new false-success class was discovered during repair or proof.

## Verification

- `npx vitest run src/cli/commands/ingest-archive.test.ts` — 48/48 green (36 pre-existing + 12 new decision-1b cases, with B12 split into two `it`s = 13 new tests actually, 48 total confirmed by direct run).
- `npm test` — 3525/3525 green, 233 test files. No pre-existing case regressed.
- `npm run lint` — 3 pre-existing errors, all in `src/engine/`/`src/ui/` (unrelated to this plan); zero errors in `src/cli/`.
- `bash "${TMPDIR:-/tmp}/173-proof/173-gate.sh"` — exits 0, twice in a row (verified re-runnability).
- `grep -c '^GATE: PASSED' .planning/phases/173-verify-pipeline-core/173-PROOF.md` — 1.
- `git diff --stat src/cli/commands/ingest-archive.ts` (against the plan-start commit) — change confined to the existing-INDEX branch and its two new helper functions (`findLabelLine`, `repairExistingIndex`); no other function touched.
- Both `~/BoardSmithGames/seven` and `~/BoardSmithGames/one-two-punch` confirmed at their pinned commits, `seven` porcelain-empty, both whole-tree sha256 manifests byte-identical before/after every proof run.

## Next Phase Readiness

Wave 1's hard gate is closed. Plans 173-02 through 173-07 (waves 2–6) may now proceed and, where they need real-game data, may rely on `ingest-archive` actually establishing provenance on `seven`/`one-two-punch` copies. `173-PROOF.md`'s "What is still unproven" section lists the three live-session proofs (SC-2 non-destructive staging, SC-3 slice-read absence, SC-4 kill-and-resume) that remain for plans 173-06/173-07 — none of them were in scope for this plan.

## Self-Check: PASSED

- `[ -f src/cli/commands/ingest-archive.ts ]` — FOUND
- `[ -f src/cli/commands/ingest-archive.test.ts ]` — FOUND
- `[ -f .planning/phases/173-verify-pipeline-core/173-PROOF.md ]` — FOUND
- `git log --oneline --all | grep -q 8bdb1df1` — FOUND
- `git log --oneline --all | grep -q 08d6c193` — FOUND
- `git log --oneline --all | grep -q caecb724` — FOUND
- `grep -c '^GATE: PASSED' .planning/phases/173-verify-pipeline-core/173-PROOF.md` — 1 (PASS)
- Re-ran plan-level `<verification>`: `npx vitest run src/cli/commands/ingest-archive.test.ts` (48/48), `npm test` (3525/3525), `npm run lint` (0 errors in `src/cli/`), `bash "${TMPDIR:-/tmp}/173-proof/173-gate.sh"` (exit 0) — all green.
