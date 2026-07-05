---
phase: 147-bs-check-status-insert-chunk
plan: 01
subsystem: cli
tags: [markdown-skill, bs-skills, drift-test, vitest, agent-tooling]

# Dependency graph
requires:
  - phase: 141-file-templates-state-machine
    provides: state-machine.md authority rules + SKETCH/CHUNK/ASSETS templates
  - phase: 142-bs-ingest-rules
    provides: ingest-rules.md structural analog (thin-skill idiom, drift-test scaffold)
  - phase: 146-bs-build-chunk-group-4
    provides: build-chunk.md's Step 2 current-chunk/current-step derivation rules this skill reuses
provides:
  - "/bs-check-status skill (STAT-01): thin, read-only status reader reporting all 7 status items"
  - status-tools.test.ts drift-test scaffold + shared constants (STALE_MARKER, WAIVED_STATUS,
    REFERENCED_PATHS, REFERENCED_SECTIONS) for Plan 02's STAT-02 (/bs-insert-chunk) block
affects: [147-02-bs-insert-chunk]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "cite-not-restate: check-status.md cites state-machine.md headings by exact string rather
       than duplicating rule text (same convention as ingest-rules.md / build-chunk.md)"
    - "read-only reporting skill: no subagent dispatch, no state writes, only reads SKETCH.md /
       CHUNK.md / ASSETS.md and synthesizes a 7-item report"

key-files:
  created:
    - src/cli/slash-command/bs/check-status.md
    - src/cli/slash-command/bs/status-tools.test.ts
  modified: []

key-decisions:
  - "check-status.md reuses build-chunk.md's Step 2 current-chunk/current-step derivation rules
     verbatim in spirit (first entry neither verified nor verified (user-waived); first unchecked
     Step Checklist item) rather than inventing new derivation logic"
  - "Waived-chunk batch-playtest proposal only fires at 2+ waived chunks; 0 or 1 just reports the count"
  - "Sketch-level tail entries that are the current-chunk target are reported as 'not yet detailed'
     rather than attempting to read a non-existent CHUNK.md — detailing a tail entry stays
     /bs-build-chunk's job, not this skill's"

patterns-established:
  - "Read-only bs- skill contract: explicit no-writes section, including a note that even the
     session-lock timestamp is never refreshed by this skill (repair/refresh stays with
     /bs-build-chunk)"

requirements-completed: [STAT-01]

duration: 25min
completed: 2026-07-05
---

# Phase 147 Plan 01: /bs-check-status (STAT-01) Summary

**Authored the thin, read-only `/bs-check-status` skill reporting all 7 canonical status items (chunks done/remaining, current chunk+step, outstanding playtest feedback, waived verifications + batch-playtest proposal, asset debts, ideas backlog size, exact next command) plus its drift-test scaffold shared with Plan 02.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-05T01:51:56Z
- **Completed:** 2026-07-05T01:53:51Z
- **Tasks:** 2 completed
- **Files modified:** 2 (both new)

## Accomplishments
- `/bs-check-status` (`check-status.md`) authored as a top-level, non-thin-pointer reader skill (115 lines) that cites `state-machine.md`'s Consistency Check, Status Enum, and Session Lock sections by exact heading instead of restating them
- All 7 report items enumerated and derivable purely from reading `SKETCH.md` → current chunk's `CHUNK.md` → `ASSETS.md`, reusing `build-chunk.md`'s existing current-chunk/current-step derivation rule rather than re-deriving it
- Explicit read-only posture documented and pinned by a negative-assertion drift test — including the subtle case of never refreshing the session-lock timestamp, which stays `/bs-build-chunk`'s job
- `status-tools.test.ts` drift-test scaffold created mirroring `ingest.test.ts`'s per-`it()` isolation style, with shared constants (`STALE_MARKER`, `WAIVED_STATUS`, `REFERENCED_PATHS`, `REFERENCED_SECTIONS`) ready for Plan 02's STAT-02 (`/bs-insert-chunk`) block to extend

## Task Commits

Each task was committed atomically (TDD RED → GREEN):

1. **Task 1: Scaffold status-tools.test.ts + STAT-01 drift block (RED)** - `8405e72f` (test)
2. **Task 2: Author check-status.md (STAT-01, GREEN)** - `05edbeea` (feat)

_TDD gate compliance: RED commit (`8405e72f`) precedes GREEN commit (`05edbeea`) — both present, no refactor commit needed._

## Files Created/Modified
- `src/cli/slash-command/bs/status-tools.test.ts` - Drift-test scaffold (read() helper, existsSync, per-it() isolation) + shared constants + STAT-01 describe block (13 tests)
- `src/cli/slash-command/bs/check-status.md` - The `/bs-check-status` skill: Step 0 consistency check, 7-item report body, explicit read-only posture, Reference Files footer

## Decisions Made
- Reused `build-chunk.md` Step 2's exact current-chunk/current-step derivation rule rather than inventing new logic — cited, not restated, per the plan's "read_first" guidance
- Waived-chunk batch-playtest proposal gated at 2+ waived chunks (0-1 just reports the count) — a reasonable threshold for "batch" that wasn't explicitly pinned by the plan but is a natural reading of "check-status surfaces accumulated waived chunks and proposes a batch playtest" (bs-skills-plan.md §8)
- A sketch-level tail entry that happens to be the current-chunk target is reported as "not yet detailed" rather than the skill attempting to read/create a CHUNK.md — detailing tail entries stays `/bs-build-chunk`'s exclusive responsibility

## Deviations from Plan

None - plan executed exactly as written. Both tasks completed with no auto-fixes needed; the RED test suite failed for exactly the expected reason (check-status.md absent) and went fully GREEN (13/13) after Task 2 with zero iteration.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. This phase only adds a markdown skill file and its drift test; no runtime dependencies added.

## Next Phase Readiness

Plan 02 (`/bs-insert-chunk`, STAT-02) can proceed: `status-tools.test.ts`'s shared constants (`STALE_MARKER`, `WAIVED_STATUS`, `REFERENCED_PATHS`, `REFERENCED_SECTIONS`) are already in place for its describe block to reuse, and `check-status.md` establishes the citation conventions (exact heading citation, no restatement, explicit read-only/write-boundary framing) Plan 02's editor-skill counterpart should mirror where applicable (though `/bs-insert-chunk` is a mutating skill, unlike this one).

Full `src/cli/slash-command/bs/` test suite green: 209/209 tests across `status-tools.test.ts` (13), `templates.test.ts` (44), `ingest.test.ts` (40), `build-chunk.test.ts` (112).

---
*Phase: 147-bs-check-status-insert-chunk*
*Completed: 2026-07-05*

## Self-Check: PASSED

- FOUND: src/cli/slash-command/bs/check-status.md
- FOUND: src/cli/slash-command/bs/status-tools.test.ts
- FOUND commit: 8405e72f
- FOUND commit: 05edbeea
