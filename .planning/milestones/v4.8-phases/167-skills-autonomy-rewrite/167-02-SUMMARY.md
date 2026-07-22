---
phase: 167-skills-autonomy-rewrite
plan: 02
subsystem: bs-skills
tags: [autonomy, skills, ask-discipline, question-batching, auto-advance, drift-tests, prose-spec]

# Dependency graph
requires:
  - phase: 167-01 (prior plan, same phase)
    provides: SKETCH milestone-flag substrate + milestone-gated human playtest stop this plan
      builds its auto-advance framing on top of
provides:
  - build/ask.md's ask triple-gate (undetermined AND load-bearing AND no reasonable default,
    else proceed and record the assumption) + never-re-ask-granted-approval + never-UI-less-
    playtest rules
  - build/build.md's "surface, don't unilaterally decide" boundary extended to a load-bearing
    rules ambiguity discovered mid-build
  - state-machine.md's batched-question-queue model (unblocked work continues; the batch
    surfaces at the next human gate/milestone)
  - state-machine.md's run-while-away + auto-advance reframing of cross-chunk continuation,
    including the generate-AI → final-acceptance progression
  - the printed `/bs-build-chunk` resume command reframed everywhere (state-machine.md,
    build/close.md, build-chunk.md) as a cold-resume/crash fallback only, never the default
    end-of-close signal
affects: [167-03, 167-04, 167-05 (remaining phase 167 plans build on this autonomy substrate;
  the 60% ceiling and Part D disciplines this plan preserved are load-bearing for them)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Triple-gate ask discipline: undetermined AND load-bearing AND no reasonable default —
      all three must hold before a question reaches the user; otherwise proceed and record the
      assumption in DECISIONS.md."
    - "Batched-question queue: a triple-gate-clearing question that doesn't block THIS chunk's
      own progress queues instead of stopping the session; unblocked work continues; the batch
      surfaces at the next human gate/milestone."
    - "Auto-advance as the default, resume-command as crash fallback: cross-chunk and
      cross-step continuation (including generate-AI → final-acceptance) is the default; the
      printed re-invocation command is retained strictly for the stop-condition case."

key-files:
  created: []
  modified:
    - src/cli/slash-command/bs/build/ask.md
    - src/cli/slash-command/bs/build/build.md
    - src/cli/slash-command/bs/state-machine.md
    - src/cli/slash-command/bs/build/close.md
    - src/cli/slash-command/bs/build-chunk.md
    - src/cli/slash-command/bs/build-chunk.test.ts

key-decisions:
  - "Assumption recording reuses build/build.md's existing 'Decisions — Append to DECISIONS.md'
    append-as-made precedent rather than inventing a new ledger for triple-gate-failing
    assumptions."
  - "A question that clears the triple-gate but doesn't block the current chunk queues; a
    question that does block the current chunk still gates that chunk's own `ask` directly —
    the queue is for deferred/cross-cutting items, not a way to relax `ask`'s own gate."
  - "The generate-AI → final-acceptance progression is asserted as a named example of
    auto-advance carrying across chunk TYPES (not just chunk-to-chunk of the same kind),
    since bs-generate-ai is a real late-sketch chunk per the tracking design doc even though
    no bs-generate-ai skill file exists in this repo yet."

patterns-established:
  - "Fail-pre/pass-post drift-test discipline verified interactively per task: author the new
    describe block against unedited prose (confirmed RED), then edit the prose files and
    re-run (confirmed GREEN) — same convention 167-01 established."

requirements-completed: [SKILLAUTO-02, SKILLAUTO-03, SKILLAUTO-04, SKILLAUTO-05, PROC-01]

# Metrics
duration: 30min
completed: 2026-07-21
---

# Phase 167 Plan 02: Ask Discipline + Batching + Run-While-Away + Auto-Advance Summary

**Codified the ask triple-gate (undetermined + load-bearing + no reasonable default, else proceed and record) with a batched open-questions queue, and retired the residual print-and-hand-off stop so cross-chunk continuation — including generate-AI → final-acceptance — auto-advances by default with the printed resume command surviving only as a crash fallback.**

## Performance

- **Duration:** ~30 min
- **Tasks:** 2/2 completed
- **Files modified:** 6

## Accomplishments
- `build/ask.md` now states an explicit ask triple-gate at the head of the gate ceremony — ask only when the answer is genuinely undetermined by rules + prior answers AND load-bearing AND no reasonable default exists; otherwise proceed and record the assumption in `DECISIONS.md` (citing `build/build.md`'s existing append-as-made precedent). It also states already-granted approval is never re-asked, and a `ui: none` chunk is never routed to a human playtest.
- `build/build.md`'s "Extends, Never Restructures" architectural-gate boundary is extended with a parallel rule for a load-bearing **rules** ambiguity discovered mid-build: surface it (queue it), never fabricate or unilaterally decide it.
- `state-machine.md`'s Session Handoff Seams region now carries an explicit batched-question-queue model: a triple-gate-clearing question that doesn't block the current chunk accumulates into a queue, unblocked work keeps going, and the whole batch surfaces together at the next human gate/milestone rather than as one-off interruptions.
- `state-machine.md`'s Cross-chunk continuation is reframed as run-while-away + auto-advance: progress on reasonable defaults continues bounded only by the milestone gates, rules-adjudication escalations, and the context/stuck-state conditions — and auto-advance explicitly carries into the next LOGICAL step across chunk types, naming the generate-AI → final-acceptance progression.
- `build/close.md`'s "Then continue — do not hand off" section is rewritten to "Then auto-advance — the printed command is a crash fallback, never the default"; its Downstream Shape section is aligned the same way.
- `build-chunk.md`'s Step Group 4 end and Session Handoff Seams section are reframed to match: the printed `/bs-build-chunk` re-invocation is explicitly named the crash/context-fallback resume path, not a routine end-of-session handoff.

## Task Commits

Each task was committed atomically:

1. **Task 1: Ask discipline triple-gate + record-assumption + batched queue (ask.md, build.md, state-machine.md) (+ drift tests)** - `0508dc03` (feat)
2. **Task 2: Run-while-away + auto-advance; remove residual print-and-handoff stop; resume command = crash fallback (+ drift tests)** - `180f9e60` (feat)

_Both tasks are `tdd="true"`: each commit bundles its fail-pre-verified drift describe block(s) together with the prose edits that turn them green — verified interactively (new describe block run against unedited prose confirmed RED, then re-run after the prose edit confirmed GREEN) before each commit, consistent with this suite's established single-commit-per-drift-describe convention (see 167-01-SUMMARY.md "TDD Gate Compliance")._

**Plan metadata:** committed separately per `<final_commit>` protocol.

## Files Created/Modified
- `src/cli/slash-command/bs/build/ask.md` - added "Ask Triple-Gate (SKILLAUTO-02)" section ahead of the Fixed 4-Part Presentation Format: the three-gate test, never-re-ask, never-UI-less-playtest, and a pointer to the batched-queue model for non-blocking items
- `src/cli/slash-command/bs/build/build.md` - extended "Extends, Never Restructures" with a parallel surface-don't-fabricate rule for a load-bearing rules ambiguity discovered mid-build
- `src/cli/slash-command/bs/state-machine.md` - added the batched-question-queue paragraph to Session Handoff Seams; rewrote Cross-chunk continuation as run-while-away + auto-advance, naming the generate-AI → final-acceptance progression and reframing the printed resume command as a crash fallback
- `src/cli/slash-command/bs/build/close.md` - rewrote "Then continue — do not hand off" to "Then auto-advance — the printed command is a crash fallback, never the default"; aligned Downstream Shape
- `src/cli/slash-command/bs/build-chunk.md` - reframed Step Group 4's end-of-group prose and the Session Handoff Seams section to name the printed re-invocation as the crash/context-fallback resume
- `src/cli/slash-command/bs/build-chunk.test.ts` - new `describe('SKILLAUTO-02 — ask discipline'`, `describe('SKILLAUTO-03 — batched question queue'`, `describe('SKILLAUTO-04 — run-while-away'`, and `describe('SKILLAUTO-05 — auto-advance'` blocks (11 assertions total), appended after plan 01's `SKILLAUTO-01` block, never rewriting it

## Decisions Made
- Reused `build/build.md`'s existing DECISIONS.md append-as-made precedent for recording triple-gate-failing assumptions, rather than inventing a new ledger — keeps a single append-only decision trail per chunk.
- Named the generate-AI → final-acceptance progression explicitly in both state-machine.md and build-chunk.md/close.md as the concrete example of auto-advance crossing chunk *types*, satisfying the plan's SKILLAUTO-05 acceptance criterion even though no `bs-generate-ai` skill file exists yet in this repo (it is a named future late-sketch chunk per the tracking design doc, `.planning/bs-skills-plan.md:161`).
- Kept the distinction between a triple-gate-clearing-but-non-blocking question (queues) and a question that blocks the current chunk's own design (still gates that chunk's `ask` directly) — the queue model does not relax `ask`'s own gate-before-write discipline.

## Deviations from Plan

None - plan executed exactly as written. Both tasks matched the plan's edit targets, drift-test convention, and acceptance criteria precisely. One test-authoring correction was made within Task 2 before commit: the initial `/bounded only by/i` regex assertion failed against a hard line-wrap in the markdown prose (the phrase spans a line break as "bounded\nonly by"); the assertion was adjusted to `/bounded\s+only by/i` to tolerate the wrap without changing the underlying prose — not a deviation from the plan's substance, just a regex robustness fix caught during the mandatory fail-pre/pass-post cycle.

## Issues Encountered
None beyond the regex line-wrap fix noted above.

## PROC-01 Verification

- Confirmed fail-pre for Task 1's two new describe blocks (5 assertions) by running them against the unedited prose files before authoring the edits — all 5 failed.
- Confirmed fail-pre for Task 2's two new describe blocks (6 assertions) the same way — all 6 failed, including the negative assertion confirming the residual "is NOT the end of the session by default" / handoff phrasing was still present pre-edit.
- `npx vitest run src/cli/slash-command/bs` green: 285/285 tests passing across all four suites (templates.test.ts, ingest.test.ts, build-chunk.test.ts, status-tools.test.ts) after both tasks landed.

## TDD Gate Compliance

Both tasks are marked `tdd="true"` per the plan. Per this repo's established drift-test convention (confirmed against 167-01's precedent), the RED and GREEN halves land in a single `feat(...)` commit per task rather than separate `test(...)`/`feat(...)` commits — the fail-pre/pass-post cycle was verified interactively (see "PROC-01 Verification" above) before each commit. This plan's frontmatter is `type: execute`, not `type: tdd`, so the plan-level commit-splitting requirement does not apply.

## Next Phase Readiness
- The ask triple-gate, batched-queue model, and auto-advance/crash-fallback framing are now load-bearing substrate for 167-03/04/05, which per 167-CONTEXT.md build the 50%+ context floor + sub-agent offload (SKILLAUTO-06/07), the process-gap fixes (SKILLAUTO-08), and the PROC-02 Part-D-survival drift assertions on top of this plan's edits.
- No blockers. The 60% "obey-the-harness-warning" ceiling and every cited Part D discipline (surface-don't-fabricate, escalate-don't-hack, honest-derived labeling) were preserved verbatim, not restructured — confirmed by re-reading the edited sections after each task.

## Self-Check: PASSED

- FOUND: src/cli/slash-command/bs/build/ask.md
- FOUND: src/cli/slash-command/bs/build/build.md
- FOUND: src/cli/slash-command/bs/state-machine.md
- FOUND: src/cli/slash-command/bs/build/close.md
- FOUND: src/cli/slash-command/bs/build-chunk.md
- FOUND: src/cli/slash-command/bs/build-chunk.test.ts
- FOUND commit: 0508dc03
- FOUND commit: 180f9e60

---
*Phase: 167-skills-autonomy-rewrite*
*Completed: 2026-07-21*
