---
phase: 144-bs-build-chunk-build-test-ui-floor
plan: 03
subsystem: cli
tags: [bs-build-chunk, slash-command, a11y, axe-core, eslint-plugin, boardsmith-testing]

# Dependency graph
requires:
  - phase: 144-01
    provides: drift-pin scaffold constant edits (build-chunk.test.ts BUILD-05/06/UIQ-02/03 describe blocks)
provides:
  - "src/cli/slash-command/bs/build/build.md — the build step's reference prose (BUILD-05): raw-slice + approved-interpretation dual read, fresh-context exception, extends-not-restructures with a user gate, DECISIONS.md appends, per-file Build Manifest, Git Protocol citation, Placeholder Policy citation (UIQ-02)"
  - "src/cli/slash-command/bs/build/test.md — the test step's reference prose (BUILD-06): ordered stop-on-failure command sequence (tsc, boardsmith lint w/ seven sandbox rules, chunk tests, full suite, simulateRandomGames), plus the conditional five-item a11y floor (UIQ-03)"
affects: [144-02, 145-bs-build-chunk-audit-repair, bs-build-chunk-orchestrator]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Citation-not-restatement discipline for skill reference files (cite state-machine.md and templates/*.template.md sections by name, never restate their rules)"
    - "Numbered, non-reorderable, stop-on-failure command-sequence idiom (mirrors ingest/scaffold.md Verification Sequence) applied to the test step"

key-files:
  created:
    - src/cli/slash-command/bs/build/build.md
    - src/cli/slash-command/bs/build/test.md
  modified: []

key-decisions:
  - "build.md documents the fresh-context exception (build is the one build-chunk step allowed to read raw rulebook slices directly) as an explicit carve-out from the Context-Economics Hard Rule every other step restates"
  - "test.md frames boardsmith lint's seven AST-based sandbox rules as the sole hard gate, explicitly distinguishing them from the same command's regex-heuristic warnings (Pitfall 1) so a test-step failure is never triggered by an informational warning"
  - "test.md frames axe-core as structural/semantic only (labels, ARIA, duplicate IDs) and routes contrast checking to the separate no-color-literal grep + contrast assertion, since axe-core does not evaluate contrast under jsdom (Pitfall 2)"

patterns-established:
  - "Skill reference file shape: Referenced-by header naming the build-chunk.md step + session group, cited (not restated) shared-file sections, closing Downstream Shape footer naming the next consumer"

requirements-completed: [BUILD-05, BUILD-06, UIQ-02, UIQ-03]

# Metrics
duration: 12min
completed: 2026-07-04
---

# Phase 144 Plan 03: Build & Test Reference Files Summary

**Authored `build/build.md` (BUILD-05 build-step contract + UIQ-02 placeholder-policy citation) and `build/test.md` (BUILD-06 ordered verification sequence + UIQ-03 five-item a11y floor), turning the `{build, test}` session step group from a forward-reference into live, dispatchable prose.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-04T22:31:00Z
- **Completed:** 2026-07-04T22:43:00Z
- **Tasks:** 2
- **Files modified:** 2 (both new)

## Accomplishments
- `build/build.md` documents the build step's dual-input contract (raw cited rulebook slices + the approved interpretation from CHUNK.md), the fresh-context read exception this step alone gets from the Context-Economics Hard Rule, the extends-not-restructures rule with an explicit user gate for restructuring, DECISIONS.md append discipline, the per-file Build Manifest fill (crash/resume), the Git Protocol citation (commit before build starts), and the Placeholder Policy citation for UIQ-02 (asset swaps never change geometry — zero-layout-diff).
- `build/test.md` documents the ordered, stop-on-failure test sequence (`tsc --noEmit` → `boardsmith lint` → chunk tests → full accumulated suite → `simulateRandomGames` playthrough → conditional a11y floor), names all seven sandbox rule names as the hard gate distinct from lint's regex-heuristic warnings, and documents all five UIQ-03 a11y floor items (keyboard-only ActionPanel completion citing both the individual-control and real-wiring test precedents, `axe-core` structural/semantic scan, no-color-literal grep with contrast assertion, game-semantic aria-labels + `aria-hidden` decorative glyphs, focus management + `prefers-reduced-motion`).
- All four targeted drift-test describe blocks (`BUILD-05`, `BUILD-06`, `UIQ-02`, `UIQ-03`) in `build-chunk.test.ts` pass.

## Task Commits

Each task was committed atomically:

1. **Task 1: Author build/build.md (BUILD-05 + UIQ-02)** - `c028a98b` (feat)
2. **Task 2: Author build/test.md (BUILD-06 + UIQ-03 a11y floor)** - `3cbd9a9c` (feat)

**Plan metadata:** (this commit) `docs: complete 144-03 plan`

## Files Created/Modified
- `src/cli/slash-command/bs/build/build.md` - Build step reference prose (BUILD-05, UIQ-02)
- `src/cli/slash-command/bs/build/test.md` - Test step reference prose (BUILD-06, UIQ-03)

## Decisions Made
- None beyond what's captured in `key-decisions` above — plan executed as written.

## Deviations from Plan

None - plan executed exactly as written. Both tasks matched their acceptance criteria and `<action>` instructions verbatim; no auto-fixes, no architectural questions, no missing functionality discovered.

## Issues Encountered

None. Confirmed via a controlled before/after test run (temporarily moving the two new files aside and re-running the full `build-chunk.test.ts` suite) that this plan's two files resolve exactly 11 of the 16 pre-existing failures in that file; the remaining 5 failures (the `REFERENCED_PATHS`/`FORWARD_REFERENCE_MARKERS` routing-table updates and `build/design-ask.md`) are out of this plan's scope — they belong to `build/design-ask.md` + `build-chunk.md`'s routing-table edit, tracked separately per `144-PATTERNS.md`'s file classification (a sibling plan's `files_modified`, not this plan's `files_modified: [build/build.md, build/test.md]`).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `build/build.md` and `build/test.md` are live, dispatchable prose consumed by `build-chunk.md`'s Step 3 dispatch table once that table's own routing edit lands (sibling plan, not this one).
- Phase 145 (`{audit, repair}` step group) can cite `build/test.md`'s "Downstream Shape" footer as its upstream authority once authored.
- No blockers.

---
*Phase: 144-bs-build-chunk-build-test-ui-floor*
*Completed: 2026-07-04*

## Self-Check: PASSED

- FOUND: src/cli/slash-command/bs/build/build.md
- FOUND: src/cli/slash-command/bs/build/test.md
- FOUND: c028a98b (Task 1 commit)
- FOUND: 3cbd9a9c (Task 2 commit)
