---
phase: 167-skills-autonomy-rewrite
plan: 05
subsystem: bs-skills
tags: [autonomy, skills, proc-02, part-d, drift-tests, prose-spec, phase-gate]

# Dependency graph
requires:
  - phase: 167-04 (prior plan, same phase)
    provides: the complete set of autonomy-rewrite edits (SKILLAUTO-01..08) across
      state-machine.md, build-chunk.md, and build/*.md this plan's regression net
      verifies did not erode any Part D discipline
provides:
  - state-machine.md's "Autonomy Scope: How, Never What (PROC-02)" section — the
    explicit top-level statement that autonomy governs HOW to build, never WHAT
    the rules are, and that genuine rule ambiguity is surfaced (batched) never
    fabricated
  - build-chunk.md's mirrored one-paragraph cross-reference to that statement at
    the top of its own "Session Handoff Seams" section
  - two new drift describe blocks in build-chunk.test.ts: PROC-02 — autonomy is
    how-not-what (pins the explicit statement + cross-reference) and PROC-02 —
    Part D survives the autonomy rewrite (one it() per Part D discipline, proving
    all six survived Plans 01-04's edits intact)
  - the phase-gate confirmation: full bs suite (317/317) and full project suite
    (3110/3110) green after all of Phase 167's edits
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Regression-net-not-fail-pre/pass-post: the 'Part D survives' describe block
      is deliberately NOT a drift-test pair (no RED-then-GREEN) — it is a standing
      assertion that PASSES immediately if prior plans preserved the disciplines,
      and would only go RED if a prior edit eroded one, at which point the
      executor's job is to restore the eroded text, not weaken the assertion."

key-files:
  created: []
  modified:
    - src/cli/slash-command/bs/state-machine.md
    - src/cli/slash-command/bs/build-chunk.md
    - src/cli/slash-command/bs/build-chunk.test.ts

key-decisions:
  - "The how-not-what statement was placed as its own top-level '##' section
    ('Autonomy Scope: How, Never What') immediately before 'Session Handoff
    Seams' in state-machine.md, rather than folded into the existing Redteam
    Escalation or Cold-Resume Parse Contract sections — it needed to read as an
    unmistakable top-level statement, not buried inside either of the two
    sections it cites, per the plan's explicit acceptance criterion."
  - "build-chunk.md's mirror is a short paragraph at the top of its own 'Session
    Handoff Seams' section (which already cites state-machine.md's section by
    name for the group-boundary rules) rather than a new top-level section in
    build-chunk.md — this file's own convention is to cite state-machine.md's
    prose rather than duplicate it, and the mirror follows that convention while
    still satisfying the acceptance criterion that build-chunk.md 'carries a
    mirrored cross-reference.'"
  - "All six Part D anchors were independently re-verified via direct file reads
    (build/build.md, build/test.md, build/redteam.md, build/playtest.md,
    state-machine.md) BEFORE authoring the regression describe block's
    assertions, confirming the exact surviving text and line-wrap points, rather
    than trusting the plan's line-number anchors blind — two assertions needed
    \\s+-tolerant regexes for line-wrap points not visible from the plan text
    alone ('governs...WHAT' bolding, and 'reads\\nthis chunk's cited raw
    rulebook slices')."
  - "No Part D text required restoration: every one of the six regression
    assertions passed on first run against the post-167-04 files, confirming
    Plans 01-04 preserved every discipline the plan's threat model identifies as
    the phase's one real hazard."

patterns-established:
  - "Autonomy-scope statement is now the load-bearing top-level anchor any future
    bs- skill edit that touches autonomy behavior should re-read before changing
    prose — PROC-02's regression net (this plan's Part D describe block) is the
    standing test that would catch a future erosion, not just this phase's."

requirements-completed: [PROC-02, PROC-01]

# Metrics
duration: 30min
completed: 2026-07-22
---

# Phase 167 Plan 05: PROC-02 Autonomy-Scope Statement + Part D Survival Regression Net Summary

**Wove an explicit "autonomy = how-not-what; surfaced never fabricated" statement into state-machine.md's top-level prose (mirrored in build-chunk.md), then added a six-discipline "Part D survives the autonomy rewrite" regression describe block that verified — with zero restoration needed — every Part D provenance discipline (escalate-don't-hack, reuse-not-rebuild, honest-derived labeling, surface-don't-fabricate, in-process redteam, build-literally) survived Plans 01-04's autonomy rewrite intact; closed the phase with a green full-suite gate (317 bs tests, 3110 project-wide).**

## Performance

- **Duration:** ~30 min
- **Tasks:** 2/2 completed
- **Files modified:** 3

## Accomplishments
- `state-machine.md` gained a new top-level "## Autonomy Scope: How, Never What (PROC-02)"
  section, placed immediately before "Session Handoff Seams," stating explicitly that every
  autonomy behavior in the file (run-while-away, auto-advance, the batched-question queue, the
  context floor/ceiling) governs HOW the game gets built and never governs WHAT the rules of the
  game ARE, and that a genuine rules ambiguity is always surfaced (batched into the open-questions
  queue, or raised immediately if it blocks the current chunk) and never fabricated — tying the
  boundary explicitly to the Cold-Resume Parse Contract's "it never guesses the intended state"
  and the Redteam Escalation's "Disputes go to the human, never to more agents."
- `build-chunk.md`'s own "Session Handoff Seams" section gained a short mirrored paragraph at its
  top ("Autonomy is how, never what (PROC-02)") cross-referencing state-machine.md's new section
  by name, following this file's existing citation-not-restatement convention.
- Two new drift describe blocks landed in `build-chunk.test.ts`:
  - `PROC-02 — autonomy is how-not-what` (4 assertions): pins the explicit statement's presence
    in both files, the "surfaced ... batched ... never fabricated" phrasing, and the tie-back
    citations to the Cold-Resume Parse Contract and Redteam Escalation.
  - `PROC-02 — Part D survives the autonomy rewrite` (6 assertions, one per discipline): reads
    `build/build.md`, `build/test.md`, `build/redteam.md`, `build/playtest.md`, and
    `state-machine.md` directly and asserts each discipline's anchor text is still present after
    all of Plans 01-04's edits. All six passed on first run — no erosion found.
- Phase gate: `npx vitest run src/cli/slash-command/bs` green (317/317 across all four suites),
  `npm run test` green (214 test files, 3110 tests, full project suite, no unrelated regressions).

## Task Commits

Each task was committed atomically:

1. **Task 1: Weave the explicit "autonomy = how-not-what; surface never fabricate" statement into
   the top-level autonomy prose (+ drift test)** - `1a3b4dbe` (feat)
2. **Task 2: PROC-02 "Part D survives" regression describe covering all six disciplines (+
   phase-gate full suite)** - `bbff6bb9` (test)

_Both tasks are `tdd="true"`: the plan's frontmatter is `type: execute`, not `type: tdd`, so the
plan-level RED/GREEN commit-splitting requirement does not apply (same precedent 167-01..04
established). RED was confirmed by construction: Task 1's marker phrases ("Autonomy Scope: How,
Never What", "PROC-02", the how/what phrasing) were read and confirmed absent from
state-machine.md and build-chunk.md via the Read tool before any edit landed; Task 2's assertions
were confirmed to reference text that was independently re-read from the six Part D anchor files
via the Read tool during the read-first pass, before the describe block was authored. GREEN was
confirmed for both tasks via `npx vitest run` before each commit._

## Files Created/Modified
- `src/cli/slash-command/bs/state-machine.md` - added "## Autonomy Scope: How, Never What
  (PROC-02)" section immediately before "Session Handoff Seams"
- `src/cli/slash-command/bs/build-chunk.md` - added a mirrored one-paragraph cross-reference at
  the top of "## Session Handoff Seams"
- `src/cli/slash-command/bs/build-chunk.test.ts` - two new describe blocks: `PROC-02 — autonomy
  is how-not-what` and `PROC-02 — Part D survives the autonomy rewrite` (appended after all prior
  167-01..04 describes, never rewriting them)

## Decisions Made
- Placed the how-not-what statement as its own top-level section rather than folding it into an
  existing section, per the plan's explicit "explicit top-level" acceptance criterion.
- Mirrored the cross-reference in build-chunk.md as a short citing paragraph (not a duplicated
  restatement), consistent with this file's established citation-not-restatement convention for
  everything else it references in state-machine.md.
- Independently re-verified all six Part D anchor texts via direct Read-tool reads before
  authoring the regression assertions, rather than trusting the plan's cited line numbers blind —
  two assertions needed `\s+`-tolerant regexes to match line-wrap points in the authored prose
  (the "governs...WHAT" bold-markdown wrap, and "reads\nthis chunk's cited raw rulebook slices").
- No text required restoration — all six Part D regression assertions passed on first run against
  the post-167-04 state, confirming Plans 01-04 did not erode any discipline.

## Deviations from Plan

None - plan executed exactly as written. All Part D anchors were confirmed present without any
restoration being necessary; the plan's "if any fails, restore" contingency did not trigger.

## Issues Encountered
Two regex line-wrap fixes were needed in the newly authored drift assertions (matching the same
precedent 167-01..04 established): the how-not-what statement's "governs...WHAT" phrase and
build/build.md's "reads this chunk's cited raw rulebook slices directly" phrase both wrap across a
markdown line break in the authored prose (the first from bold-markdown emphasis insertion during
authoring, the second pre-existing in build/build.md from Phase 144), so the corresponding
`toMatch` assertions were switched to `\s+`-tolerant regexes before the first green run.

## PROC-01 Verification

- Confirmed every new marker phrase asserted in Task 1's drift describe ("Autonomy Scope: How,
  Never What", "PROC-02", "govern...HOW", "govern...WHAT", "surfaced", "never fabricated",
  "batched") was absent from state-machine.md and build-chunk.md before this plan's edits — read
  directly via the Read tool during the read-first pass, prior to any Edit call.
- Confirmed pass-post for both new describe blocks in `build-chunk.test.ts` after each task's
  prose edits landed, via `npx vitest run`.
- `npx vitest run src/cli/slash-command/bs` green: 317/317 tests passing across all four suites
  (`templates.test.ts` 52, `status-tools.test.ts` 44, `ingest.test.ts` 44, `build-chunk.test.ts`
  177) after both tasks landed.
- `npm run test` (full project suite, phase gate): 214 test files, 3110 tests, all green, no
  unrelated regressions.

## TDD Gate Compliance

Both tasks are marked `tdd="true"` per the plan. Per this repo's established drift-test
convention (confirmed against 167-01..04 precedent), the RED and GREEN halves land in a single
commit per task rather than separate `test(...)`/`feat(...)` commits — RED was confirmed by
construction (marker-phrase absence verified via direct file reads before any edit) rather than
by an intermediate failing-test commit. This plan's frontmatter is `type: execute`, not `type:
tdd`, so the plan-level commit-splitting requirement does not apply. Task 2 additionally reused
the existing green Task 1 state as its starting point rather than re-deriving a fail-pre baseline,
since Task 2's assertions are a regression net (verify-survives), not a fail-pre/pass-post pair,
per the plan's own explicit framing ("These assertions should PASS immediately if Plans 01-04
preserved Part D").

## Next Phase Readiness
- Phase 167 (skills-autonomy-rewrite) is now fully closed: all 5 plans landed, all 8 SKILLAUTO
  requirements plus PROC-01/PROC-02 complete, and this plan's regression net stands as the
  permanent guard against future Part D erosion for any subsequent bs- skill edit.
- No blockers. Full project suite green (3110/3110); no deferred items opened by this plan.

## Self-Check: PASSED

- FOUND: src/cli/slash-command/bs/state-machine.md
- FOUND: src/cli/slash-command/bs/build-chunk.md
- FOUND: src/cli/slash-command/bs/build-chunk.test.ts
- FOUND commit: 1a3b4dbe
- FOUND commit: bbff6bb9

---
*Phase: 167-skills-autonomy-rewrite*
*Completed: 2026-07-22*
