---
phase: 136-client-sdk-protocol
plan: 01
subsystem: process
tags: [proc-01, verify-before-fix, client-sdk, protocol, websocket]

# Dependency graph
requires:
  - phase: 136-client-sdk-protocol (research)
    provides: 136-RESEARCH.md's independent re-trace of all six findings against current HEAD
provides:
  - "136-FINDINGS-VERIFICATION.md: per-finding LEGITIMATE/REJECTED verdicts for F23, F24, F25, F26, F35, F38 with fresh HEAD file:line evidence"
  - "Locked scope boundary for F25/SDK-03: errorCode is optional on the client error type; lobby-manager.ts changes are out of phase scope"
  - "Locked scope boundary for F26/SDK-04: barrel re-export chain requirement and the action|ping|getState outgoing WS narrowing set"
affects: [136-02-PLAN, 136-03-PLAN, 136-04-PLAN, 136-05-PLAN]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "PROC-01 verify-first gate: a standalone verification doc with a literal VERDICT: token per finding, written before any fix task runs, so downstream plans are provably unblocked"

key-files:
  created:
    - .planning/phases/136-client-sdk-protocol/136-FINDINGS-VERIFICATION.md
  modified: []

key-decisions:
  - "All six findings (F23/SDK-01, F24/SDK-02, F25/SDK-03, F26/SDK-04, F35/SDK-05, F38/SDK-06) independently re-verified LEGITIMATE against current HEAD (post-Phase-135) — zero REJECTED"
  - "F25 scope boundary recorded: lobby-manager.ts populates zero errorCode fields (grep-confirmed), so the client error type's errorCode field is optional and lobby-manager.ts is out of scope for this phase"
  - "F25 also records that GameShell.vue's in-repo defensive .success double-handling migrates to the throwing contract in THIS phase (Plan 03), not deferred to Phase 138 (games/MERC only)"
  - "F26 scope boundary recorded: every type deleted from client/types.ts needs a matching re-export line from protocol.ts (barrel chain via index.ts), and the outgoing WS union narrows to exactly action|ping|getState (confirmed via game-connection.ts's only three outgoing message constructions)"
  - "Tasks 1 and 2 landed in a single commit (see Deviations) since both write to the same six-section file and were authored together in one verification pass for cross-referential consistency"

patterns-established: []

requirements-completed: [PROC-01]

# Metrics
duration: 12min
completed: 2026-07-03
---

# Phase 136 Plan 01: Findings Verification Gate Summary

**Independent HEAD re-trace of all six Phase 136 audit findings (F23/F24/F25/F26/F35/F38), all confirmed LEGITIMATE with fresh file:line evidence, recording the F25 optional-errorCode/lobby-manager-out-of-scope boundary and the F26 barrel-re-export/WS-narrowing boundary that gate Plans 02-05.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-03T21:37:00Z
- **Completed:** 2026-07-03T21:39:39Z
- **Tasks:** 2 completed
- **Files modified:** 1 created

## Accomplishments
- Produced `.planning/phases/136-client-sdk-protocol/136-FINDINGS-VERIFICATION.md` with a `VERDICT:` line and current-HEAD file:line evidence for all six in-scope findings
- Confirmed zero regression from 136-RESEARCH.md's earlier re-trace — no line-number drift beyond what research already documented, no finding flipped to REJECTED
- Independently grep-confirmed the F25 scope boundary: `src/session/lobby-manager.ts` has 0 `errorCode` occurrences
- Independently confirmed the F26 barrel re-export chain (`src/client/index.ts:81,90` re-export `CreateGameRequest`/`ClaimSeatRequest` from `./types.js`) and the F26/Pitfall-7 WS outgoing narrowing set (`action`/`ping`/`getState` are the only three message types `game-connection.ts` ever constructs)
- Recorded the locked fix scope for each finding directly in the verification doc, so Plans 02-05 can implement without re-deriving design decisions

## Task Commits

Both tasks' verdicts were written into one file in a single pass (see Deviations) and committed together:

1. **Tasks 1+2: Re-verify all six findings and record verdicts** - `6b5250b0` (docs)

**Plan metadata:** (this commit, following)

## Files Created/Modified
- `.planning/phases/136-client-sdk-protocol/136-FINDINGS-VERIFICATION.md` - Six-section verification gate; one section per finding (F23, F24, F38, F25, F26, F35) each with a `VERDICT:` token, current HEAD file:line citations, and the locked fix-scope summary for the plan that will implement it

## Decisions Made
- Confirmed (not re-derived) 136-RESEARCH.md's zero-REJECTED conclusion via independent direct reads of `src/client/game-connection.ts`, `src/client/client.ts`, `src/client/types.ts`, `src/client/vue.ts`, `src/types/protocol.ts`, `src/client/index.ts`, and a grep of `src/session/lobby-manager.ts` — all citations in the verification doc are from files read in this execution session, not copy-pasted from RESEARCH.md
- F25's errorCode scope boundary and F26's barrel re-export/WS-narrowing boundary are recorded as explicit, permanent constraints in the verification doc (not just implicit in RESEARCH.md), satisfying the plan's `must_haves.truths` requirement that these be recorded before any fix task runs

## Deviations from Plan

### Auto-fixed Issues

None — no bugs, missing functionality, or blocking issues encountered. This plan is pure documentation/verification with no source-code changes.

### Process Deviation (not a Rule 1-4 fix, documented for transparency)

**1. Tasks 1 and 2 combined into a single commit**
- **Found during:** Task 2 (writing F25/F26/F35 sections)
- **Rationale:** Both tasks write to the same `136-FINDINGS-VERIFICATION.md` file. Producing the document as one coherent pass (rather than two separate Write/Edit operations split artificially at the task boundary) kept the six verdicts internally cross-referenced and consistent — e.g., F25's verdict references the same `GameShell.vue` call sites cited in the F26 section's barrel-chain discussion, and both were verified against the same live source reads in the same session. Splitting the write into two file operations to force two commits would not have changed the verified content, only added a mechanical intermediate commit with no independent value.
- **Files modified:** `.planning/phases/136-client-sdk-protocol/136-FINDINGS-VERIFICATION.md` (single commit `6b5250b0`)
- **Verification:** `grep -v '^#' 136-FINDINGS-VERIFICATION.md | grep -c "VERDICT:"` returns 6, matching both tasks' `<verify>` blocks exactly
- **Precedent:** Matches the repo's own established pattern from Phase 135-06 ("Combined RED+GREEN commits for Tasks 1-3 — interleaved single-function edits, not independently compilable per-task"), logged in STATE.md's Decisions.

---

**Total deviations:** 0 auto-fixed; 1 process note (commit granularity, no content impact)
**Impact on plan:** None on scope or correctness — all `must_haves` and acceptance criteria from both tasks are satisfied in the single commit.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plans 02 (connection-lifecycle fixes: SDK-01/02/06), 03 (error-contract unification: SDK-03), 04 (protocol-type unification: SDK-04/05), and 05 are unblocked — every finding they depend on now has a recorded LEGITIMATE verdict with current-HEAD evidence and a locked fix-scope summary in `136-FINDINGS-VERIFICATION.md`
- No blockers. No REJECTED findings requiring plan rework.
- Plan 02 should read the F23/F24/F38 sections of `136-FINDINGS-VERIFICATION.md` directly rather than re-deriving fix scope from RESEARCH.md, since the verification doc is now the authoritative gate artifact per PROC-01

---
*Phase: 136-client-sdk-protocol*
*Completed: 2026-07-03*

## Self-Check: PASSED
- FOUND: .planning/phases/136-client-sdk-protocol/136-FINDINGS-VERIFICATION.md
- FOUND: .planning/phases/136-client-sdk-protocol/136-01-SUMMARY.md
- FOUND commit: 6b5250b0
