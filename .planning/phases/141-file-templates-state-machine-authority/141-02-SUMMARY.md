---
phase: 141-file-templates-state-machine-authority
plan: 02
subsystem: cli
tags: [markdown-templates, state-machine, bs-skills, vitest, drift-testing]

# Dependency graph
requires:
  - phase: 141-01
    provides: state-machine.md (exact step-name/status-enum authority doc) + templates.test.ts scaffold with Plan 02/03 placeholders
provides:
  - CHUNK.template.md — authoritative per-chunk status skeleton (full 10-step + light 3-step ceremony, interpretation/citations, visibility declaration, findings ledger, append-only revision rounds, build manifest, playtest script, verified checklist, verified commit hash)
  - SKETCH.template.md — derived ordered-slug chunk-list skeleton (sketch version, session lock, player counts, UI strategy, per-chunk ui:/status/test-script, Variants (deferred), ideas backlog, mandated-chunks guidance)
  - Extended templates.test.ts with TMPL-01/02/03 assertions covering both new templates plus cross-file (CHUNK ↔ state-machine.md) step-name agreement
affects: [142-bs-ingest-rules, 143-146-bs-build-chunk, 147-bs-check-status-insert-chunk]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Status-line grammar (Pattern 1): authoritative `Status: <enum-value>` line with HTML-comment enum listing + authority pointer"
    - "Append-only round sections (Pattern 2): `### Revise N` / findings ledger never overwritten or renumbered"
    - "HTML-comment fill-in guidance that stays in the file after filling (Pattern 3), never deleted"

key-files:
  created:
    - src/cli/slash-command/bs/templates/CHUNK.template.md
    - src/cli/slash-command/bs/templates/SKETCH.template.md
  modified:
    - src/cli/slash-command/bs/templates.test.ts

key-decisions:
  - "CHUNK.template.md restates the ui: tag (redundant-but-safe) so a CHUNK-only session knows whether the a11y floor applies without re-reading SKETCH.md (RESEARCH Open Question 2)"
  - "SKETCH.template.md records the UI Strategy decision (custom-from-chunk-1 vs autoui-with-cutover) at ingest time, since DESIGN.md doesn't exist until the first UI chunk's ask (RESEARCH Open Question 1)"
  - "Drift test asserts CHUNK.template.md and state-machine.md contain the byte-identical step-name string (Pitfall 3 guard), and both new templates carry a literal 'state-machine.md' substring as the authority pointer (Pitfall 4 guard)"

patterns-established:
  - "Templates ship as standalone literal skeletons (full content), never thin pointers, matching the aspects/ shared-reference-file precedent rather than design-game.template.md's thin-pointer convention"

requirements-completed: [TMPL-01, TMPL-02, TMPL-03]

# Metrics
duration: 12min
completed: 2026-07-04
---

# Phase 141 Plan 02: CHUNK/SKETCH State Templates Summary

**Wrote CHUNK.template.md (authoritative per-chunk status skeleton) and SKETCH.template.md (derived ordered-slug view), plus 18 vitest drift assertions guarding their exact-string agreement with state-machine.md.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-04T18:38:00Z
- **Completed:** 2026-07-04T18:50:50Z
- **Tasks:** 3
- **Files modified:** 3 (2 created, 1 extended)

## Accomplishments
- CHUNK.template.md: complete cold-resumable skeleton with authoritative `Status:` line (full 6-value enum including `verified (user-waived)` and the em-dash `stale — re-derive before build`), full 10-step + light 3-step checklists using byte-identical strings to state-machine.md, interpretation/citations, visibility declaration, findings ledger (stable IDs), append-only revision rounds, per-file build manifest, playtest test script (build stamp, regression check, second-seat leak check), verified checklist + user-waived state, verified commit hash slot, restated `ui:` tag
- SKETCH.template.md: complete cold-resumable skeleton with sketch version stamp, session lock note, player-count/setup section, UI-strategy field, slug-ordered chunk list (what-it-builds/citations/ui-tag/derived-status-pointer/outcome-based test script per chunk, tail entries left sketch-level), Variants (deferred) list, ideas backlog, mandated-chunks guidance (core loop first, game-end chunk, final-acceptance chunk)
- templates.test.ts extended with 3 new describe blocks (TMPL-01, TMPL-03, TMPL-02) — 18/18 tests green, including the cross-file CHUNK↔state-machine step-name drift guard

## Task Commits

Each task was committed atomically:

1. **Task 1: Write CHUNK.template.md** - `c5ceb2df` (feat)
2. **Task 2: Write SKETCH.template.md** - `e4ab7d29` (feat)
3. **Task 3: Extend templates.test.ts with CHUNK/SKETCH + cross-file agreement assertions** - `b07ea64f` (test)

_Note: this plan carried no TDD tasks — content-first (write the literal skeleton) then test (drift-assert it), per RESEARCH's transcription-not-parser stance._

## Files Created/Modified
- `src/cli/slash-command/bs/templates/CHUNK.template.md` - authoritative per-chunk status skeleton
- `src/cli/slash-command/bs/templates/SKETCH.template.md` - derived ordered-chunk-list skeleton
- `src/cli/slash-command/bs/templates.test.ts` - drift assertions for both new templates + cross-file agreement

## Decisions Made
- `ui:` tag restated in CHUNK.template.md (not just looked up from SKETCH.md) — see key-decisions above
- UI Strategy field lives in SKETCH.template.md, recorded at ingest — see key-decisions above
- No markdown parser added; plain `toContain`/regex string assertions suffice per RESEARCH's "Don't Hand-Roll" guidance

## Deviations from Plan

None — plan executed exactly as written. All acceptance criteria (exact enum/step strings, authority pointers, required fields) were satisfied on first pass; no Rule 1-4 fixes were needed.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

CHUNK.template.md and SKETCH.template.md are ready for Plan 03 (RULINGS/DECISIONS/DESIGN/ASSETS templates) and for Phase 142 (`bs-ingest-rules`) and Phases 143-146 (`bs-build-chunk`) to read/cite directly. The Plan 03 ledger-template placeholder in templates.test.ts was left intact and untouched.

## Self-Check: PASSED

- FOUND: src/cli/slash-command/bs/templates/CHUNK.template.md
- FOUND: src/cli/slash-command/bs/templates/SKETCH.template.md
- FOUND: c5ceb2df (Task 1 commit)
- FOUND: e4ab7d29 (Task 2 commit)
- FOUND: b07ea64f (Task 3 commit)
