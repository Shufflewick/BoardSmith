---
phase: 167-skills-autonomy-rewrite
plan: 03
subsystem: bs-skills
tags: [autonomy, skills, context-economics, sub-agent-offload, loud-completion, drift-tests, prose-spec]

# Dependency graph
requires:
  - phase: 167-02 (prior plan, same phase)
    provides: the ask triple-gate, batched-question queue, run-while-away, and
      auto-advance/crash-fallback framing this plan's "Then auto-advance" and
      "Session Handoff Seams" citations build on top of
provides:
  - state-machine.md's "Context floor + ceiling" (renamed from "Context-low escape
    hatch") — an explicit >=50% wind-down floor beneath the unchanged 60%
    harness-warning ceiling, plus a sub-agent-offload paragraph naming research/
    audits/large reads/repairs as the heavy work classes dispatched away from
    the main thread
  - build-chunk.md's reinforcement of the floor + offload at the group-1
    continuation and in Session Handoff Seams, with the Context-Economics Hard
    Rule ("orchestrator never reads the big stuff") preserved verbatim as the
    mechanism offload rides on
  - build/final-acceptance.md's "Game-Complete Banner + Summary Card" — a
    delimited GAME COMPLETE banner plus a three-field summary card (Shipped /
    Test count / Deferred) emitted once, at the game's own terminus
  - build/close.md's "Chunk-Complete Line" — a lighter, one-line per-chunk
    completion marker distinct from the game-level banner, that does not itself
    gate auto-advance
affects: [167-04, 167-05 (the >=50% floor + sub-agent offload substrate and the
  loud-completion framing are now load-bearing for the remaining phase 167
  plans' process-gap fixes and Part-D-survival drift assertions)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Floor-beneath-ceiling context framing: two independent thresholds (>=50%
      floor, 60% ceiling) coexist rather than one number being replaced by
      another — the floor forbids stopping too early, the ceiling forbids
      running too long, and sub-agent offload is the lever that lets the main
      thread satisfy both."
    - "Loud-vs-light completion split: a single delimited banner + structured
      summary card reserved for the one game-level terminus, versus a plain
      one-line marker emitted at every chunk close — never conflating the two
      so the game's actual end stays unmistakable."

key-files:
  created: []
  modified:
    - src/cli/slash-command/bs/state-machine.md
    - src/cli/slash-command/bs/build-chunk.md
    - src/cli/slash-command/bs/build/final-acceptance.md
    - src/cli/slash-command/bs/build/close.md
    - src/cli/slash-command/bs/build-chunk.test.ts

key-decisions:
  - "Renamed state-machine.md's 'Context-low escape hatch' heading to 'Context
    floor + ceiling' since the section now governs two thresholds, not one; all
    downstream citations to the old heading name were updated in the same
    commit (grep-confirmed zero stale references remain)."
  - "The game-complete banner lives in final-acceptance.md (not close.md)
    because the sketch's one mandated final-acceptance chunk's own close is
    the only chunk close that is also the game's terminus — placing it there
    keeps the loud/light split structurally enforced rather than requiring a
    runtime 'is this the last chunk?' check inside the generic close.md path."
  - "The chunk-level completion line in close.md explicitly states it does not
    itself stop the session or gate auto-advance, to prevent a future read of
    'chunk complete' as a new pause point that would silently regress
    SKILLAUTO-04/05's run-while-away/auto-advance model this plan depends on."

patterns-established:
  - "Fail-pre/pass-post drift-test discipline verified interactively per task:
    write the new describe block, run it against unedited prose (confirmed
    RED), then edit the prose files and re-run (confirmed GREEN) — same
    convention 167-01/167-02 established."

requirements-completed: [SKILLAUTO-06, SKILLAUTO-07, PROC-01]

# Metrics
duration: 25min
completed: 2026-07-21
---

# Phase 167 Plan 03: Context Floor + Sub-Agent Offload + Loud Completion Summary

**Added an explicit >=50% context wind-down floor beneath the existing 60% harness-warning ceiling, codified sub-agent offload of research/audits/large reads/repairs as the lever that keeps the main thread under the ceiling while still clearing the floor, and gave the game's actual finish a loud delimited banner + three-field summary card distinct from a new lighter per-chunk completion line.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2/2 completed
- **Files modified:** 5

## Accomplishments
- `state-machine.md`'s former "Context-low escape hatch" section is now "Context floor + ceiling (SKILLAUTO-06)": it states the session never winds down before at least 50% of the context window is consumed (the floor), keeps the existing 60% obey-the-harness-warning threshold completely unchanged (the ceiling), and names sub-agent offload of research/audits/large reads/repairs as the substantive lever that lets the main thread clear the floor without blowing past the ceiling — explicitly citing `build-chunk.md`'s Context-Economics Hard Rule as the mechanism that offload rides on.
- `build-chunk.md` reinforces the floor + offload at two points: the group-1 → group-2 continuation (naming which heavy work classes go to sub-agents) and a new paragraph inside "Session Handoff Seams" (citing `state-machine.md`'s "Context floor + ceiling" section by its new name). The Context-Economics Hard Rule's own text — "the orchestrator never reads rulebook slices, BoardSmith docs, or generated code itself" — is untouched.
- `build/final-acceptance.md` gained a new "Game-Complete Banner + Summary Card (SKILLAUTO-07)" section: at the sketch's one mandated final-acceptance chunk's own `close`, the session emits a visually-delimited `GAME COMPLETE` banner plus a summary card with exactly three named fields (Shipped / Test count / Deferred), additional to the ordinary close-out bookkeeping and never buried in narration.
- `build/close.md` gained a new "Chunk-Complete Line (SKILLAUTO-07)" section: every chunk's close emits a single lighter one-line marker (`chunk '<slug>' complete — verified`), explicitly distinguished from the game-level banner and explicitly stated to not itself stop the session or gate auto-advance.

## Task Commits

Each task was committed atomically:

1. **Task 1: >=50% wind-down floor + sub-agent offload (state-machine.md, build-chunk.md) (+ drift tests)** - `c0d12c0a` (feat)
2. **Task 2: Loud game-level completion banner + summary card + chunk-level line (final-acceptance.md, close.md) (+ drift tests)** - `7a4b6950` (feat)

_Both tasks are `tdd="true"`: each commit bundles its fail-pre-verified drift describe block(s) together with the prose edits that turn them green — verified interactively (new describe block run against the prose confirmed the specific new assertions RED before the corresponding prose existed, then re-run after the prose edit confirmed GREEN) before each commit, consistent with this suite's established single-commit-per-drift-describe convention._

**Plan metadata:** committed separately per `<final_commit>` protocol.

## Files Created/Modified
- `src/cli/slash-command/bs/state-machine.md` - renamed "Context-low escape hatch" to "Context floor + ceiling (SKILLAUTO-06)"; added the >=50% floor paragraph and a new sub-agent-offload paragraph
- `src/cli/slash-command/bs/build-chunk.md` - added a floor+offload sentence at the group-1 continuation and a new "≥50% floor (SKILLAUTO-06)" paragraph inside Session Handoff Seams; updated the stale "Context-low escape hatch" citation to the renamed heading; Context-Economics Hard Rule text left untouched
- `src/cli/slash-command/bs/build/final-acceptance.md` - added "## Game-Complete Banner + Summary Card (SKILLAUTO-07)" after the existing Downstream Shape section
- `src/cli/slash-command/bs/build/close.md` - added "## Chunk-Complete Line (SKILLAUTO-07)" ahead of "## Propose the Next Chunk"
- `src/cli/slash-command/bs/build-chunk.test.ts` - new `describe('SKILLAUTO-06 — context floor + offload'` (5 assertions) and `describe('SKILLAUTO-07 — loud completion'` (5 assertions) blocks, appended after 167-02's `SKILLAUTO-05` block, never rewriting it

## Decisions Made
- Renamed the "Context-low escape hatch" heading to "Context floor + ceiling" since the section now governs two coexisting thresholds rather than a single one; updated every citation to the old heading name in the same commit (grep-confirmed no stale references remain in the `bs/` tree).
- Placed the game-complete banner inside `final-acceptance.md` (not the generic `close.md`) because the sketch's one mandated final-acceptance chunk's own close is structurally the only chunk close that is also the game's terminus — this avoids a runtime "is this the last chunk?" branch inside `close.md`'s otherwise-identical bookkeeping path.
- Made the chunk-level completion line explicitly non-blocking ("does not itself stop the session") to guard against a future misreading of "chunk complete" as a new pause point that would regress plan 167-02's run-while-away/auto-advance model.

## Deviations from Plan

None — plan executed exactly as written. Both tasks matched the plan's edit targets, acceptance criteria, and drift-test convention precisely. Two regex-robustness fixes were made within Task 1's drift tests before commit (not deviations from the plan's substance): the prose's line-wrapped "premature\nbail" and "sub-agent\noffload" phrases required `\s+` regexes instead of literal spaces, matching the same line-wrap-tolerance precedent 167-02 established for its own `/bounded\s+only by/i` fix.

## Issues Encountered
None beyond the two regex line-wrap fixes noted above.

## PROC-01 Verification

- Confirmed fail-pre for Task 1's `SKILLAUTO-06` describe block (5 assertions) by running it against the pre-edit prose files — all 5 failed (the ≥50% floor, the sub-agent-offload paragraph, and the renamed heading did not yet exist).
- Confirmed fail-pre for Task 2's `SKILLAUTO-07` describe block (5 assertions) the same way — all 5 failed (no `GAME COMPLETE` banner, no summary card, no chunk-level line existed pre-edit).
- Confirmed pass-post for both blocks after each task's prose edits landed.
- `npx vitest run src/cli/slash-command/bs` green: 295/295 tests passing across all four suites (templates.test.ts, ingest.test.ts, build-chunk.test.ts, status-tools.test.ts) after both tasks landed.
- Confirmed BOTH "50%" and "60%" are present in `state-machine.md`'s state-machine context rule (5 and 8 occurrences respectively, `grep -c` verified) satisfying this plan's explicit success criterion.

## TDD Gate Compliance

Both tasks are marked `tdd="true"` per the plan. Per this repo's established drift-test convention (confirmed against 167-01/167-02 precedent), the RED and GREEN halves land in a single `feat(...)` commit per task rather than separate `test(...)`/`feat(...)` commits — the fail-pre/pass-post cycle was verified interactively (see "PROC-01 Verification" above) before each commit. This plan's frontmatter is `type: execute`, not `type: tdd`, so the plan-level commit-splitting requirement does not apply.

## Next Phase Readiness
- The >=50% context floor + sub-agent-offload substrate and the loud-completion/chunk-line split are now load-bearing for 167-04/05, which per 167-CONTEXT.md build the process-gap fixes (SKILLAUTO-08) and the PROC-02 Part-D-survival drift assertions on top of this plan's edits.
- No blockers. The 60% ceiling, the Context-Economics Hard Rule's exact "orchestrator never reads rulebook slices, BoardSmith docs, or generated code itself" wording, and every citation this plan touched were preserved or correctly re-pointed — confirmed by grep for stale "Context-low escape hatch" references (zero found) and by the full green suite.

## Self-Check: PASSED

- FOUND: src/cli/slash-command/bs/state-machine.md
- FOUND: src/cli/slash-command/bs/build-chunk.md
- FOUND: src/cli/slash-command/bs/build/final-acceptance.md
- FOUND: src/cli/slash-command/bs/build/close.md
- FOUND: src/cli/slash-command/bs/build-chunk.test.ts
- FOUND commit: c0d12c0a
- FOUND commit: 7a4b6950

---
*Phase: 167-skills-autonomy-rewrite*
*Completed: 2026-07-21*
