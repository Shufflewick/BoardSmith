---
phase: 142-bs-ingest-rules
plan: 01
subsystem: cli
tags: [slash-command, bs-skills, ingest, vitest, tdd, drift-test]

requires:
  - phase: 141-bs-file-templates
    provides: "state-machine.md + templates/*.template.md + templates.test.ts (44 tests) drift-test precedent this plan mirrors"
provides:
  - "src/cli/slash-command/bs/ingest.test.ts — structural drift suite with one describe per INGEST-01..07 plus a cross-file consistency block"
  - "src/cli/slash-command/bs/ingest-rules.md — lean orchestrator: state detection, transcription/interview routing, six-artifact synthesis, scaffold delegation, sketch derivation delegation, UI strategy, approval gate, file-write step"
affects: [142-02-ingest-transcription-interview, 142-03-ingest-scaffold-sketch-derivation, 147-bs-check-status, 148-bs-distribution]

tech-stack:
  added: []
  patterns:
    - "Reads inside individual it() bodies (never at describe-level) so a missing referenced file fails only that one assertion instead of aborting the whole suite's collection phase — required because bs/ingest/*.md files don't exist until Plans 02/03"
    - "Citation-not-restatement: orchestrator cites state-machine.md / SKETCH.template.md / ASSETS.template.md / four ingest/*.md files by exact path, never restates their content inline"

key-files:
  created:
    - src/cli/slash-command/bs/ingest.test.ts
    - src/cli/slash-command/bs/ingest-rules.md
  modified: []

key-decisions:
  - "All read() calls moved inside individual it() bodies rather than at describe-level top, deviating from templates.test.ts's structure (which reads once per describe block) — necessary because ingest-rules.md and the four ingest/*.md files are authored across three separate plans, so most referenced files genuinely don't exist yet at collection time. A describe-level read() would throw synchronously during suite collection and abort the entire file instead of failing only the affected assertions."
  - "ingest-rules.md kept to 131 lines (well under the plan's 'few hundred lines' target) by delegating every step's heavyweight prose to a not-yet-authored ingest/*.md reference file, matching the citation-not-restatement convention from state-machine.md."

requirements-completed: [INGEST-02, INGEST-06, INGEST-07]

duration: 25min
completed: 2026-07-04
---

# Phase 142 Plan 01: Ingest drift suite + lean orchestrator Summary

**Authored the Wave-0 structural drift test (`ingest.test.ts`, 28 assertions across INGEST-01..07 plus cross-file consistency) and the `/bs-ingest-rules` orchestrator skill (`ingest-rules.md`, 131 lines) that cites — never restates — state-machine.md, the SKETCH/ASSETS templates, and four not-yet-authored `ingest/*.md` reference files.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2 completed
- **Files modified:** 2 created, 0 modified

## Accomplishments

- `ingest.test.ts` mirrors `templates.test.ts`'s `read()`/marker-constant/`describe`-per-requirement pattern exactly, with one deliberate structural deviation (see Key Decisions) required by this phase's multi-plan authoring order.
- `ingest-rules.md` satisfies INGEST-02 (all six synthesis sub-artifacts named), INGEST-06 (UI Strategy step names both strategy values and points at the template's existing `## UI Strategy` heading rather than inventing a new field), and INGEST-07 (three-way state detection: fresh / existing-bs-project re-run guard / old-design-game migration).
- Confirmed zero content restatement from state-machine.md into ingest-rules.md via grep (`CHUNK.md owns`, `SKETCH.md holds only`, `Write order is always` — no matches).
- Confirmed no regression to Phase 141: `templates.test.ts` still 44/44 green.

## Task Commits

1. **Task 1: Author bs/ingest.test.ts drift suite (Wave 0)** - `69239afd` (test)
2. **Task 2: Author bs/ingest-rules.md orchestrator** - `5810f6ac` (feat)

**Plan metadata:** pending (docs: complete plan)

## Files Created/Modified

- `src/cli/slash-command/bs/ingest.test.ts` - 196-line structural drift suite; 28 tests, 18 passing after Task 2 (up from 3 after Task 1 alone)
- `src/cli/slash-command/bs/ingest-rules.md` - 131-line lean orchestrator skill covering state detection → transcription/interview routing → synthesis → scaffold delegation → sketch derivation delegation → UI strategy → approval gate → file writes

## TDD Gate Compliance

Both tasks carried `tdd="true"`. Gate sequence verified in git log:
- RED: `69239afd test(142-01): author bs/ingest.test.ts structural drift suite` (18/28 passing at this point is intentional partial-RED — INGEST-02/06/07 blocks assert only against `ingest-rules.md`, which did not exist yet, so those 6 tests + 4 more failed; INGEST-01/03/04/05 + 4 cross-file-exists checks also failed as expected, pending Plans 02/03)
- GREEN: `5810f6ac feat(142-01): author bs/ingest-rules.md lean orchestrator` (INGEST-02, INGEST-06, INGEST-07 describe blocks now fully pass; total 18/28 green)

No premature-pass fail-fast trip occurred: at RED-phase collection, the suite correctly failed 25/28 (not an unexpected pass), matching the plan's expectation that "the suite is mostly RED after this task."

## Known Stubs

None. This plan ships only markdown reference content (the orchestrator skill file) and a test file — no runtime code paths, no UI, no data flow to stub.

The following are intentional, plan-documented RED tests (not stubs) that remain until Plans 02/03 land the four `bs/ingest/*.md` reference files:
- INGEST-01 (transcription per-section confirmation) — 1 of 2 tests red (`ingest/transcription.md` doesn't exist)
- INGEST-03 (interview fallback) — 1 of 2 tests red (`ingest/interview-fallback.md` doesn't exist)
- INGEST-04 (scaffold verification) — 1 of 2 tests red (`ingest/scaffold.md` doesn't exist)
- INGEST-05 (sketch derivation heuristic) — 3 of 4 tests red (`ingest/sketch-derivation.md` doesn't exist)
- cross-file consistency — 4 of 5 tests red (the four `ingest/*.md` paths don't exist on disk yet)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug avoidance] Moved all `read()` calls from describe-level to individual `it()` bodies**
- **Found during:** Task 1, before first test run
- **Issue:** `templates.test.ts`'s pattern (its direct analog) reads each referenced file once at the top of a `describe` block, outside any `it()`. Since `ingest-rules.md` and all four `ingest/*.md` files are authored progressively across Plans 01/02/03, a describe-level `readFileSync` on a not-yet-existing file throws synchronously during vitest's collection phase, which aborts collection for the entire test file (not just the affected describe block) — the opposite of the plan's stated expectation ("grepping its output shows all seven INGEST-NN describe blocks... are present").
- **Fix:** Moved every `read()` invocation inside its own `it()` callback so a missing file surfaces as one failing assertion, leaving every other describe block (and every other `it` within the same describe) collectible and independently reportable.
- **Files modified:** `src/cli/slash-command/bs/ingest.test.ts` (this is the file's original authoring, not a later edit — verified via live vitest run before commit)
- **Commit:** `69239afd`

### Threat Flags

None. No new network endpoints, auth paths, file-access patterns, or schema changes at trust boundaries were introduced — this plan ships markdown content and a content-assertion test only, consistent with the plan's `threat_model` (T-142-01 mitigate via byte-identical marker constants — applied via `SKETCH_LEVEL_MARKER`; T-142-02 accept — no runtime rulebook interpretation code shipped).

## Self-Check: PASSED

- FOUND: src/cli/slash-command/bs/ingest.test.ts
- FOUND: src/cli/slash-command/bs/ingest-rules.md
- FOUND commit 69239afd
- FOUND commit 5810f6ac
