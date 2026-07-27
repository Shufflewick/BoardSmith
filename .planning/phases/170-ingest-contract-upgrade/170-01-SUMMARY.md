---
phase: 170-ingest-contract-upgrade
plan: 01
subsystem: cli
tags: [agent-skills, markdown, bs-ingest, vitest, drift-tests]

# Dependency graph
requires: []
provides:
  - "`Visual (p.N):` line-prefix in transcription.md, disambiguated from `Derived (p.N):` by a single rule-bearing decision test (legality, scoring, or sequencing)"
  - "`openGaps[]` as the seventh transcription-subagent return field, transporting `Named-but-undefined (p.N):` lines to the orchestrator without a slice re-read"
  - "v4.9 INGEST-02 / v4.9 INGEST-03 contract tests in ingest.test.ts, extending RETURN_SHAPE_FIELDS"
affects: [170-02, 171, 173]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "openGaps[] mirrors the existing variants[] return-field pattern (in-slice tag -> structured return list, no slice re-read)"
    - "v4.9-prefixed describe block names to disambiguate from pre-existing v4.6 INGEST-01..07 blocks with different meanings"

key-files:
  created: []
  modified:
    - src/cli/slash-command/bs/ingest/transcription.md
    - src/cli/slash-command/bs/ingest.test.ts

key-decisions:
  - "Exactly two worked examples for the Derived/Visual split (CONTEXT.md's locked cap); the publisher-logo/copyright edge case is mentioned in prose, not added as a third numbered example"
  - "openGaps[] added as a new seventh return field rather than reusing citedTerms[] with a prefix convention, mirroring variants[]'s existing precedent"

requirements-completed: [INGEST-02, INGEST-03, PROC-02]

# Metrics
duration: 25min
completed: 2026-07-27
---

# Phase 170 Plan 01: Transcription Contract Upgrade Summary

**Split the overloaded `Derived (p.N):` prefix into `Derived`/`Visual` via a one-line rule-bearing decision test, and added `openGaps[]` as a new structured return field so `## Open Rules Gaps` can be built without re-reading slices.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-07-27T12:12:00Z (session start)
- **Completed:** 2026-07-27T12:13:56Z
- **Tasks:** 2 completed
- **Files modified:** 2

## Accomplishments

- `transcription.md` now defines `Visual (p.N):` as a sibling to `Derived (p.N):`, disambiguated by a single stated decision test ("does this affect legality, scoring, or sequencing?") rather than a category enumeration, with exactly two worked examples (one Derived, one Visual) and a one-sentence mention of the publisher-logo/copyright edge case (not a third numbered example).
- `transcription.md` now returns `openGaps[]` as a seventh structured field (mirroring the existing `variants[]` pattern), transporting every `Named-but-undefined (p.N): <rule name>` line the subagent wrote, so the orchestrator can build `## Open Rules Gaps` in Plan 02 without ever re-reading a slice.
- `ingest.test.ts` extended `RETURN_SHAPE_FIELDS` in place (now 7 entries) and added two new `v4.9`-prefixed describe blocks (`v4.9 INGEST-02 — Derived/Visual line-prefix split`, `v4.9 INGEST-03 — openGaps[] return-field transport`) that assert against the new contract without touching any pre-existing v4.6 `INGEST-01..07` block.

## Task Commits

1. **Task 1: Add the Derived/Visual decision test and the openGaps[] return field to transcription.md** - `69f89e11` (feat)
2. **Task 2: Pin the new transcription contract in ingest.test.ts** - `8326fc85` (test)

**Plan metadata:** (this commit, docs)

## Files Created/Modified

- `src/cli/slash-command/bs/ingest/transcription.md` - Added the `Visual (p.N):` bullet + decision test + two worked examples + edge-case note + survey-complementary note; added `(g) openGaps[]` to the return-shape list; extended the `Return exactly:` one-liner to seven fields.
- `src/cli/slash-command/bs/ingest.test.ts` - Extended `RETURN_SHAPE_FIELDS` to 7 entries (`openGaps[]` appended); added `v4.9 INGEST-02` and `v4.9 INGEST-03` describe blocks.

## Decisions Made

- Exactly two worked examples were added for the Derived/Visual split per CONTEXT.md's locked cap; the publisher-logo/copyright-note edge case named in 170-RESEARCH.md Pitfall 4 is covered in a single sentence, deliberately not promoted to a third numbered example.
- `openGaps[]` was added as a genuinely new seventh return field (not folded into `citedTerms[]` with a prefix convention), matching 170-RESEARCH.md's Assumption A3 recommendation and mirroring the `variants[]` precedent exactly.

## Deviations from Plan

None — plan executed exactly as written. Both tasks landed with the exact acceptance criteria specified (seven-field return list `(a)`-`(g)`, `Return exactly:` one-liner naming all seven fields in order, `00-visual-survey.md` reference preserved, exactly two worked examples, pre-existing v4.6 describe blocks untouched).

## Issues Encountered

None.

## Adversarial Revert-Probe (PROC-02 evidence)

Per the plan's Task 2 acceptance criteria, the `openGaps[]` addition was temporarily reverted from `transcription.md` (removing the `(g) openGaps[]` return-list item and dropping `openGaps[]` from the `Return exactly:` one-liner) to confirm the new assertions actually bite:

- **RED (fix removed):** `npx vitest run src/cli/slash-command/bs/ingest.test.ts -t "v4.9 INGEST-03"` failed with 2 failing assertions — `transcription.md defines openGaps[]` and `the Return exactly: enumeration line names openGaps[] in the same statement` — for the expected reason (the string was genuinely absent), not a false positive.
- **GREEN (fix restored):** After restoring the file byte-for-byte (verified via `git diff --stat` showing zero diff), the full suite returned to 52/52 passing.

This confirms the new v4.9 INGEST-03 assertions fail for the right reason and are not vacuously green.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 02 can now consume `openGaps[]` to build the `## Open Rules Gaps` INDEX.md section (INGEST-03 transport half is complete; the synthesis/assembly half is Plan 02's job).
- Full repo suite verified green: 223 files / 3194 tests passing after this plan's changes (includes the 52/52 `ingest.test.ts` suite, up from 44 pre-existing).
- No blockers or concerns for Plan 02.

---
*Phase: 170-ingest-contract-upgrade*
*Completed: 2026-07-27*
