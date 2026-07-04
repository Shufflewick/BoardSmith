---
phase: 143-bs-build-chunk-interpretation-ask-gate
plan: 05
subsystem: docs
tags: [bs-skills, slash-command, ask-gate, markdown-reference, vitest-drift-test]

# Dependency graph
requires:
  - phase: 143-01
    provides: "build-chunk.test.ts drift-protection suite (BUILD-01..04, cross-file consistency, return-shape pins)"
  - phase: 143-02
    provides: "build/investigate.md — claims list producer, INVESTIGATE_RETURN_FIELDS"
  - phase: 143-04
    provides: "build/redteam.md — settled-interpretation producer that ask.md consumes"
provides:
  - "src/cli/slash-command/bs/build/ask.md — the ask-gate reference file (BUILD-04)"
  - "Fixed 4-part presentation format (rules interpretation+citations, ambiguity questions, deferred list, zero-implementation-vocabulary)"
  - "Never-blocking asset placeholder request wired to ASSETS.md's 5-column ledger"
  - "Gate-before-write discipline: Status: approved and RULINGS.md/ASSETS.md writes only after explicit user approval, Status written last"
affects: [144-bs-build-chunk-build-test, 145-bs-build-chunk-audit-repair, 146-bs-build-chunk-playtest-close]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Ask-gate 4-part fixed presentation skeleton (a/b/c/d) mirrored from 143-RESEARCH.md's code example"
    - "Gate-before-write: present -> negotiate -> explicit approval -> write (Status: approved written last, per state-machine.md Write Order)"
    - "Investigate's claims-list carve-out: factual rulebook interpretation is NOT re-gated at ask, only the design authorization is"

key-files:
  created:
    - src/cli/slash-command/bs/build/ask.md
  modified: []

key-decisions:
  - "Used lowercase 'what you will NOT see yet' (matching build-chunk.test.ts's exact BUILD-04 grep and the plan's artifact `contains` spec) rather than title-casing the heading"
  - "Forbidden-vocabulary list scoped to the four words the test pins (action, flow, state, element) plus a general note about BoardSmith API vocabulary, per 143-RESEARCH.md Pitfall 2"
  - "Asset request and RULINGS.md ledger-fill sections kept as separate subsections from the gate-before-write section, so the file reads as: format -> assets -> rulings -> gate -> downstream, mirroring investigate.md/redteam.md's section-per-concern structure"

patterns-established:
  - "Ask-gate skeleton pattern: any future bs- skill step needing human sign-off before a durable write can reuse the present -> negotiate -> gate -> write-last-with-Status-last shape documented here"

requirements-completed: [BUILD-04]

# Metrics
duration: 12min
completed: 2026-07-04
---

# Phase 143 Plan 05: Ask Gate Reference (BUILD-04) Summary

**Authored `build/ask.md`, the ask-gate reference file specifying the fixed 4-part plain-language presentation, the total ban on implementation vocabulary, the never-blocking asset request wired to ASSETS.md, and the gate-before-write discipline (Status: approved written last, only after explicit user approval).**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-04T21:23:25Z
- **Completed:** 2026-07-04T21:25:41Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Authored `src/cli/slash-command/bs/build/ask.md` (115 lines) mirroring `ingest-rules.md` Steps 6-7's negotiate-then-gate posture, applied per-chunk instead of per-sketch
- Fixed 4-part presentation format documented as labeled sections: (a) rules interpretation + citations, (b) ambiguity questions with explicit options, (c) "what you will NOT see yet" deferred list, (d) zero-implementation-vocabulary rule, with `action`/`flow`/`state`/`element` named as forbidden words in a prohibition context
- Never-blocking asset placeholder path documented: "I don't have art yet" never blocks; debt recorded as an appended row in `ASSETS.md`'s existing 5-column ledger, header never restructured
- House-rule/adaptation choices routed to `RULINGS.md` as `### Ruling N` entries, filling `RULINGS.template.md`'s Decision/Citation/Rationale shape
- Gate-before-write discipline: present -> negotiate -> explicit approval required before any durable write; `Status: approved` written LAST after RULINGS.md/ASSETS.md writes, citing `state-machine.md` "Write Order"; explicit carve-out stating investigate's claims list (`## Interpretation` / `## Visibility Declaration` / `## Newly Discovered Citations`) is NOT re-gated here, mirroring `ingest-rules.md` Step 7's ASSETS.md/visual-survey carve-out
- Full unfiltered `build-chunk.test.ts` suite (38 tests, all describe blocks including cross-file consistency and return-shape pins) is 100% green — this was the last Wave 2 plan, closing out the BUILD-01..04 drift-protection suite
- Full repo `npm test` run: 181 test files / 2508 tests, all passing

## Task Commits

1. **Task 1: Author build/ask.md (BUILD-04)** - `39289dfe` (feat)

**Plan metadata:** committed together with STATE.md/ROADMAP.md updates in the final docs commit (see below)

## Files Created/Modified
- `src/cli/slash-command/bs/build/ask.md` - Ask-gate reference: 4-part presentation skeleton, implementation-vocabulary ban, never-blocking asset request, gate-before-write with Status-last write order, RULINGS/ASSETS ledger fills

## Decisions Made
- Used lowercase "what you will NOT see yet" heading text to byte-match the test's exact `toContain` assertion and the plan artifact spec's `contains` field
- Kept the forbidden-vocabulary enumeration to exactly the four words the drift test pins (`action`, `flow`, `state`, `element`), each with a short designer-language substitution example, plus a general note extending the spirit to BoardSmith API vocabulary broadly (per 143-RESEARCH.md Pitfall 2, non-exhaustive)
- Structured the file as: presentation format -> prohibited vocabulary -> assets -> rulings -> gate-before-write -> downstream shape, consistent with `investigate.md`/`redteam.md`'s section-per-concern layout already established in this phase

## Deviations from Plan

None - plan executed exactly as written. One micro-correction during self-verification: the first draft used "What you will NOT see yet" (title case); the plan's artifact spec and the test's `toContain('what you will NOT see yet')` assertion require lowercase "what" — fixed by lowercasing the heading before the first task commit (not a separate deviation, folded into Task 1's single commit since no wrong state was ever committed).

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 143 (`{investigate, redteam, ask}` step group) is now complete: `build/investigate.md`, `build/redteam.md`, and `build/ask.md` all authored and pinned by `build-chunk.test.ts`'s full 38-assertion suite, 100% green.
- Ready for Phase 144 (`{build, test}` step group), which will author `build/build.md` and `build/test.md` — both already named as forward-reference stubs in `build-chunk.md`'s dispatch table with the "authored in Phase 144" marker this plan's suite pins as a stub, not a file-existence check.
- No blockers. Full repo test suite (181 files / 2508 tests) green after this plan.

---
*Phase: 143-bs-build-chunk-interpretation-ask-gate*
*Completed: 2026-07-04*

## Self-Check: PASSED
- FOUND: src/cli/slash-command/bs/build/ask.md
- FOUND: commit 39289dfe
