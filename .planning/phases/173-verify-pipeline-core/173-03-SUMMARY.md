---
phase: 173-verify-pipeline-core
plan: 03
subsystem: bs-skills-ingest
tags: [skill-text, transcription-contract, decision-15, verify-pipeline]

# Dependency graph
requires:
  - phase: 173-01
    provides: verification-scope groundwork (INDEX.md provenance header repair)
provides:
  - transcription-subagent.md's output directory generalized to a dispatch input
  - ingest/transcription.md's dispatch template documents the value as per-dispatch, names the
    verify orchestrator as the other caller
  - pinning tests for the generalization plus a structural no-fork guard against bs/verify/
affects: [173-04, 173-05, 173-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared-contract-file, parameterized-input generalization (no fork) for a two-caller skill contract"

key-files:
  created: []
  modified:
    - src/cli/slash-command/bs/ingest/transcription-subagent.md
    - src/cli/slash-command/bs/ingest/transcription.md
    - src/cli/slash-command/bs/ingest.test.ts

key-decisions:
  - "Reused decision 15 verbatim: one transcription contract, two callers (ingest, verify), zero forks."
  - "Kept the four-site edit surgical — 10 changed lines in transcription-subagent.md, confirmed by the diff-size gate in the plan's own verify step."
  - "No-fork guard implemented as a directory scan for BS-DISPATCH-V2 contract-body markers under bs/verify/, not a comment — passes today because bs/verify/ does not exist yet, and will fail loudly the moment a future file restates the contract instead of pointing at it."

requirements-completed: []  # VERIFY-07 is NOT complete — its live transcript-absence proof lands in plan 173-06.

# Metrics
duration: 15min
completed: 2026-07-28
---

# Phase 173 Plan 03: Generalize transcription-subagent.md's output directory Summary

**Parameterized `ingest/transcription-subagent.md`'s four hardcoded `rulebook/` write-instruction sites into an "assigned output directory" dispatch input — a 10-line diff — so plan 173-04's verify orchestrator can reuse the exact same contract instead of forking it, satisfying decision 15.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-28T22:21:00Z (approx, from context load)
- **Completed:** 2026-07-28T22:36:51Z
- **Tasks:** 2/2 completed
- **Files modified:** 3

## Accomplishments

- `transcription-subagent.md`'s four output-directory sites (`## Your inputs` bullet, the Section 1
  heading, the worked example, and the `slicePath` return-field description) now describe the
  output directory as "the path given in this dispatch prompt" / "your assigned output directory"
  instead of the literal `rulebook/`. Everything else in the file — the `BS-DISPATCH-V2` handshake,
  the three line-kind vocabulary, the rule-bearing decision test, the named-but-undefined marker
  rule, the worked-example rule, the full structured-return field list, `nextStep`'s exact string,
  `## Scope limit`, `## Edition`, and the `rulebook/00-visual-survey.md` / `rulebook/INDEX.md`
  references — is byte-identical.
- `ingest/transcription.md`'s dispatch template gained one clarifying paragraph: the `Write slices
  to:` line is a per-dispatch substitution, ingest always fills it with `rulebook/` (unchanged
  behavior), and the verify orchestrator is named as the other caller that fills the same input
  with a staging path.
- `ingest.test.ts` gained a 7-test `describe` block pinning the generalization (write-instruction
  wording, `slicePath` wording, the three-input `## Your inputs` enumeration, the untouched
  `rulebook/00-visual-survey.md` reference, ingest's unchanged `rulebook/` fill, and the new
  "verify orchestrator" sentence) plus a structural no-fork guard that scans `bs/verify/` (once
  plan 173-04 creates it) for any file restating the `BS-DISPATCH-V2` contract body instead of
  pointing at `transcription-subagent.md`.

## Task Commits

1. **Task 1: Parameterize the four output-directory sites** - `ffb4790c` (feat)
2. **Task 2: Pin the generalization and guard every previously-pinned string** - `db834a2d` (test)

_No separate plan-metadata commit was requested by this executor invocation's protocol beyond the
two task commits above; STATE/ROADMAP/REQUIREMENTS updates below are captured in this SUMMARY's
own commit._

## The exact dispatch-input contract plan 173-04 must honor

Quoting the four edited sites verbatim, since 173-04's verify orchestrator dispatch prose must
match them exactly:

1. **`## Your inputs` bullet** (`transcription-subagent.md`):
   ```
   - **Output directory** — the path given in this dispatch prompt, relative to the project
     directory you are already inside. This is the ONLY place you write slice files; you never write
     outside it.
   ```

2. **Section 1 heading** (`transcription-subagent.md`):
   ```
   ## 1. WRITE the transcribed text to `NN-topic.md` in your assigned output directory
   ```

3. **Worked example** (`transcription-subagent.md`, inside the page-anchored-numbering paragraph):
   ```
   `NN` is the section's **starting page number**, zero-padded to two digits (a section starting on
   p.14 → `14-movement.md` in your assigned output directory).
   ```

4. **Return-field description** (`transcription-subagent.md`, item (a) of the structured return):
   ```
   - **(a) `slicePath`** — the `NN-topic.md` file you wrote, inside your assigned output directory.
   ```

5. **`transcription.md`'s dispatch template** — the `Write slices to:` line still literally fills
   `rulebook/` for ingest (unchanged); it is followed by:
   ```
   `Write slices to:` is a per-dispatch substitution, not a constant — this ingest path always fills
   it with `rulebook/`, but the verify orchestrator (`bs/verify/*.md`) is the other caller of this
   same contract and fills it with a staging path instead. The contract in
   `transcription-subagent.md` treats it as an input either way.
   ```
   Plan 173-04's `BS-DISPATCH-V2` pointer block for the verify dispatch should copy this same
   three-substitution shape, changing ONLY the `Write slices to:` value (e.g.
   `rulebook/.verify/<run-id>/slices/` per 173-PATTERNS.md), never composing, restating, or
   summarizing the contract body itself.

**Structural guarantees this contract still makes** (unchanged, confirmed byte-identical by the
plan's scope fence and by every pre-existing pinned assertion staying green):
- The subagent still validates `BS-DISPATCH-V2` and rejects a composed prompt unread.
- The subagent still **RETURNs a structured summary only — never the transcribed text itself**
  (`## 2. RETURN...` heading, unedited). This is what structurally prevents the orchestrator —
  ingest's or verify's — from ever holding slice content in its own context, and is the
  precondition VERIFY-07's transcript-absence proof (plan 173-06) depends on.
- `transcription.md`'s "Orchestrator Records (never writes slices, never re-reads them)" section
  is unedited and remains mutually coherent with the subagent contract's return-only rule.

## Deviations from Plan

None. Plan executed exactly as written — four sites edited in `transcription-subagent.md`, one
clarifying paragraph added to `transcription.md`'s dispatch template, and the pinning +
no-fork-guard tests added to `ingest.test.ts`.

## Verification

- `npx vitest run src/cli/slash-command/bs/ingest.test.ts` — 106/106 green (99 pre-existing + 7
  new).
- `npm test` — 3556/3556 green (baseline was 3549/3549; +7 from this plan's new tests, zero
  regressions).
- `npx eslint src/cli/` — zero errors (project-wide `npm run lint` has 3 pre-existing errors in
  `src/ui/composables/useAnimationEvents.ts` and `src/ui/composables/useFlyingElements.ts`,
  unrelated to any file this plan touches; not introduced by this plan, not fixed by this plan —
  out of scope per the scope-boundary rule).
- `git diff -U0 src/cli/slash-command/bs/ingest/transcription-subagent.md | grep -c '^[+-][^+-]'`
  → 6 changed content lines (10 total diff lines including context markers), confined to the four
  named sites — well within the plan's "~10 changed lines" gate.
- `grep -n 'rulebook/00-visual-survey.md'` and the `${CLAUDE_SKILL_DIR}/../bs-shared/ingest/
  transcription.md` cross-references confirmed untouched by direct read after editing.

## What this plan explicitly did NOT do (scope discipline)

- Did not touch the `BS-DISPATCH-V2` validation block, the three line-kind vocabulary, the
  rule-bearing decision test, the named-but-undefined marker rule, the worked-example rule, the
  structured-return field list, `nextStep`'s exact string, `## Scope limit`, or `## Edition`.
- Did not touch the `rulebook/00-visual-survey.md` reference (the fixed orchestrator-owned
  visual-survey file, out of scope per decision 15 / RESEARCH.md Pitfall 3) or the
  `rulebook/INDEX.md` reference inside the `nextStep` string.
- Did not create `bs/verify/` or any verify-side file — that is plan 173-04's job. This plan's
  no-fork guard test is written to pass in that file's absence and only becomes a live check once
  173-04 lands.
- Did not mark VERIFY-07 complete in REQUIREMENTS.md. Its `requirements-completed` field above is
  intentionally empty — the live transcript-absence proof required to close VERIFY-07 is plan
  173-06's job, and this phase already reverted one prior over-eager completion mark (see
  `eb4f7ce3`).

## Known Stubs

None. This plan touches only skill-text (`.md`) prose and its pinning tests; no runtime code paths
were added or stubbed.

## Threat Flags

None beyond what the plan's own `<threat_model>` already registered (T-173-21, T-173-22, T-173-23,
all `mitigate`, all closed by this plan's bounded edit + diff-size gate + no-fork guard). No new
network endpoints, auth paths, file-access patterns, or schema changes were introduced.

## Self-Check: PASSED

- `src/cli/slash-command/bs/ingest/transcription-subagent.md` — FOUND, edited.
- `src/cli/slash-command/bs/ingest/transcription.md` — FOUND, edited.
- `src/cli/slash-command/bs/ingest.test.ts` — FOUND, edited.
- Commit `ffb4790c` — FOUND in `git log`.
- Commit `db834a2d` — FOUND in `git log`.

---
*Phase: 173-verify-pipeline-core*
*Plan: 03*
*Completed: 2026-07-28*
