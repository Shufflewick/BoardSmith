---
phase: 170-ingest-contract-upgrade
plan: 02
subsystem: cli
tags: [agent-skills, markdown, bs-ingest, vitest, drift-tests, provenance]

# Dependency graph
requires:
  - phase: 170-01
    provides: "openGaps[] as the seventh transcription-subagent return field, transporting Named-but-undefined (p.N): lines to the orchestrator without a slice re-read"
provides:
  - "Step 3 (Synthesis) prose that archives the bound rulebookPath to rulebook/source/<original-filename>, verifies the copy, and computes its SHA-256 via shasum -a 256 (sha256sum fallback) — never moving/deleting the designer's original (INGEST-01)"
  - "A fixed, always-emitted four-line rulebook/INDEX.md header block (Edition:/Source:/Source hash:/Transcribed:) on both the transcription and interview paths, with an explicit not-stated-in-the-rulebook / not-applicable fallback rather than omission (INGEST-04)"
  - "An always-emitted ## Open Rules Gaps section built exclusively from openGaps[], with pinned no-deduplication concatenation semantics the Plan 03 checkpoint reconciles against (INGEST-03)"
affects: [170-03, 171, 173]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Archive+hash landed as a Step 3 sub-item (not a new numbered step, not in scaffold.md) — Step 3 is the earliest point {rulebookPath} is bound and INDEX.md is already written there"
    - "Never-omit header lines use an explicit not-applicable/not-stated sentinel value rather than blank/missing lines, mirrored identically across the transcription and interview paths"

key-files:
  created: []
  modified:
    - src/cli/slash-command/bs/ingest-rules.md
    - src/cli/slash-command/bs/ingest/interview-fallback.md
    - src/cli/slash-command/bs/ingest.test.ts

key-decisions:
  - "Archive+hash landed as Step 3 item 1 (before the INDEX.md item), not as a new top-level numbered step — preserves every cross-file Step N citation in the skill family (170-RESEARCH.md Open Question 1's recommendation, taken as-is)"
  - "## Open Rules Gaps heading pinned as the bare form (no parenthetical suffix), standardizing over seven's pre-phase hand-authored ## Open Rules Gaps (named-but-undefined in the source) variant"
  - "Interview path's Source:/Source hash: lines use the explicit sentinel 'not applicable — no source rulebook (interview path)' rather than omitting the lines, per CONTEXT.md's never-omit rule"

requirements-completed: [INGEST-01, INGEST-03, INGEST-04, PROC-02]

# Metrics
duration: 20min
completed: 2026-07-27
---

# Phase 170 Plan 02: Ingest Contract Upgrade — Step 3 Synthesis Summary

**Step 3 of `ingest-rules.md` now archives the source rulebook, computes its SHA-256, and always writes a four-line INDEX.md header block plus a `## Open Rules Gaps` section built exclusively from `openGaps[]`; the interview (no-rulebook) path emits the same header contract with explicit not-applicable values.**

## Performance

- **Duration:** 20 min
- **Tasks:** 3 completed
- **Files modified:** 3

## Accomplishments

- `ingest-rules.md` Step 3 gained a new leading sub-item that copies `{rulebookPath}` (bound at Step 2) to `rulebook/source/<original-filename>`, verifies the copy is byte-identical, and computes its SHA-256 with `shasum -a 256` (`sha256sum` named explicitly as the Linux/CI fallback) — stated as a deterministic shell operation the agent must actually run, never a reported-without-computing value. The non-destructive invariant (copy, never move/rename/delete/overwrite; stop-and-ask on an existing destination file) is stated imperatively.
- The existing single-line `Edition:` synthesis prose was extended into a fixed four-line, always-emitted header block (`Edition:`/`Source:`/`Source hash:`/`Transcribed:`) written above the existing `## Slices`/`## Term → Slice` tables, with an explicit `not stated in the rulebook` fallback for genuinely unknown values — a line is never dropped.
- Step 3 gained an always-emitted `## Open Rules Gaps` section (bare heading, no parenthetical), built exclusively from the accumulated `openGaps[]` return-field lists (never by sweeping/re-reading slices), reading `_None._` when empty, with an explicit no-deduplication rule pinned for Plan 03's slice-marker-count reconciliation checkpoint.
- `interview-fallback.md`'s "Output Re-Target" section now states the same four header labels for the no-rulebook path: `Edition:` keeps its existing `unpublished — designer statement` value; `Source:`/`Source hash:` both read the explicit `not applicable — no source rulebook (interview path)` sentinel (no `rulebook/source/` directory on this path — expected only here); `Transcribed:` is the interview session's ISO date. The same always/`_None._` `## Open Rules Gaps` terms apply on this path too.
- `ingest.test.ts` gained three new `v4.9`-prefixed describe blocks (`v4.9 INGEST-01 — source archive + SHA-256`, `v4.9 INGEST-04 — INDEX.md header block`, `v4.9 INGEST-03 — ## Open Rules Gaps section`) plus a negative assertion guarding `ingest/scaffold.md` against ever containing `rulebook/source/` (the Pitfall 1 guard), and extended the existing return-shape consumption assertion to include `openGaps[]`.

## Task Commits

1. **Task 1: Add source archive + SHA-256 and the four-line INDEX header block to ingest-rules.md Step 3** - `db0c0752` (feat)
2. **Task 2: Give the interview (no-rulebook) path explicit not-applicable header values** - `3ba9216a` (feat)
3. **Task 3: Pin the Step 3 contract in ingest.test.ts** - `27b41364` (test)

**Plan metadata:** (this commit, docs)

## Files Created/Modified

- `src/cli/slash-command/bs/ingest-rules.md` - Step 3 gained the archive+hash sub-item, the extended 4-line header block, and the always-emitted `## Open Rules Gaps` assembly; Steps 0-7 numbering unchanged, `ingest/scaffold.md` untouched.
- `src/cli/slash-command/bs/ingest/interview-fallback.md` - "Output Re-Target" section extended with the interview-path header values and the `## Open Rules Gaps` always/`_None._` statement.
- `src/cli/slash-command/bs/ingest.test.ts` - Three new `v4.9`-prefixed describe blocks (INGEST-01/03/04) plus an extension to the existing field-consumption assertion.

## Decisions Made

- Archive+hash placed as Step 3 item 1 (before the INDEX.md item), matching the plan's explicit instruction and 170-RESEARCH.md Open Question 1's recommendation — no new numbered step, no renumbering of Steps 4-7.
- `## Open Rules Gaps` heading kept bare (no parenthetical suffix), formalizing over `seven`'s pre-phase hand-authored `## Open Rules Gaps (named-but-undefined in the source)` variant per CONTEXT.md's locked decision.
- Interview path's not-applicable sentinel matches CONTEXT.md's em-dash style (`unpublished — designer statement`) for consistency: `not applicable — no source rulebook (interview path)`.

## Deviations from Plan

None — plan executed exactly as written. One test-authoring correction made during Task 3: the initial `v4.9 INGEST-03 — ## Open Rules Gaps section` "bare heading" assertion used a line-start regex (`/^## Open Rules Gaps$/m`) that failed against the actual skill-text form, where the heading appears inline inside a bolded instruction (`**\`## Open Rules Gaps\` (INGEST-03).**`) rather than as a literal markdown heading — `ingest-rules.md` is instructional prose *about* what heading to write into the generated `INDEX.md`, not the generated file itself. Corrected to a `toContain`/`not.toContain('## Open Rules Gaps (')` pair, which correctly asserts the exact bare string is present and the parenthetical-suffix variant is absent, matching every other assertion's idiom in this file. This is a same-task test-authoring fix, not a Rule 1-4 deviation against the shipped plan content.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Adversarial Revert-Probe (PROC-02 evidence)

Per Task 3's acceptance criteria, each of the three new requirement blocks was adversarially probed: the corresponding subject string was temporarily removed from `ingest-rules.md`, the exact test file was run under `-t` isolating that block, confirmed RED, the file was restored from a pre-edit backup, `git diff --stat` confirmed zero diff, and the suite was re-run to confirm GREEN.

- **`v4.9 INGEST-01 — source archive + SHA-256`:** Removed all `rulebook/source/` occurrences (replaced with `REMOVED-PROBE/`). RED: `ingest-rules.md prescribes the rulebook/source/ archive path` failed with the expected "expected string to contain rulebook/source/, but it does not" reason (1 failed / 3 passed / 59 skipped). Restored (`git diff --stat` = 0 diff). GREEN: 4 passed / 59 skipped.
- **`v4.9 INGEST-04 — INDEX.md header block`:** Removed the `Source hash:` label (replaced with `REMOVED-Source-hash:`). RED: `ingest-rules.md contains all four header labels` failed on the missing `Source hash:` string (1 failed / 2 passed / 60 skipped). Restored (0 diff). GREEN: 3 passed / 60 skipped.
- **`v4.9 INGEST-03 — ## Open Rules Gaps section`:** Removed all `## Open Rules Gaps` occurrences (replaced with `## Removed Rules Gaps`). RED: `ingest-rules.md contains the exact bare heading (no parenthetical suffix)` failed on the missing string (1 failed / 3 passed / 59 skipped). Restored (0 diff). GREEN: full describe block 4/4 passed.

All three probes failed for the correct reason (the target string's genuine absence, not a false positive from an unrelated assertion), confirming the new v4.9 blocks are not vacuously green.

Full-suite check after every restore: `npx vitest run src/cli/slash-command/bs/ingest.test.ts` → 63/63 passed; `npm test` → 223 files / 3205 tests passed (up from 223/3205 pre-plan baseline stated in 170-01-SUMMARY.md, since this plan only extends the same test file rather than adding new files).

## Next Phase Readiness

- `git diff --name-only` for this plan lists exactly `ingest-rules.md`, `ingest/interview-fallback.md`, `ingest.test.ts` — `ingest/scaffold.md` does NOT appear, confirmed by the Task 3 negative assertion staying green.
- Plan 03 can now reconcile its human checkpoint's `## Open Rules Gaps` entry count against the slice-side `Named-but-undefined` marker count with well-defined semantics, since the no-dedup concatenation rule is pinned both in skill prose (`do not deduplicate`) and in a passing regression test.
- No blockers or concerns for Plan 03.

---
*Phase: 170-ingest-contract-upgrade*
*Completed: 2026-07-27*

## Self-Check: PASSED

- FOUND: src/cli/slash-command/bs/ingest-rules.md
- FOUND: src/cli/slash-command/bs/ingest/interview-fallback.md
- FOUND: src/cli/slash-command/bs/ingest.test.ts
- FOUND: commit db0c0752 (Task 1)
- FOUND: commit 3ba9216a (Task 2)
- FOUND: commit 27b41364 (Task 3)
