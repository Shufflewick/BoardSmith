---
phase: 170-ingest-contract-upgrade
plan: 06
subsystem: testing
tags: [claude-cli, headless-agent, node-child-process, ingest-verification, sandboxing]

requires:
  - phase: 170-ingest-contract-upgrade
    provides: >
      170-05's checkIngestArtifacts() + CHECK_IDS (the deterministic checker this driver reports
      through) and 170-PROOF-RUN.md's human-gate checklist results (compared row-by-row here).
provides:
  - "scripts/ingest-harness/run.mjs: a stage/drive/assert driver that stages a throwaway project,
    installs the current working tree's skill text into it locally, sandbox-copies the source
    rulebook so no path outside the throwaway tree is ever granted to the driven session (no
    additional-directory access flag is passed), spawns a real headless claude session through
    /bs-ingest-rules, and reports the nine produced-artifact checks plus gate item (g)"
  - "npm run harness:ingest — operator/agent-invoked only, absent from npm test and every vitest
    include pattern"
  - "170-HARNESS-BASELINE.md: a recorded baseline run against current HEAD skill text, compared
    row-by-row against the human gate, with zero disagreement in pass/fail direction on any letter"
affects: [170-07, 170-08]

tech-stack:
  added: []
  patterns:
    - "Live-agent verification proxy: a real headless claude --print --dangerously-skip-permissions
      session run against a sandboxed throwaway tree, reported through the same deterministic
      checker a static-fixture test pins — CI stays deterministic while every skill-text change
      is still verified against real agent behavior"
    - "Prevention-over-detection sandboxing: the source-under-test is copied into the throwaway
      tree before the driven session ever runs, so the reference repo is structurally unreachable
      rather than merely forbidden and after-the-fact git-status-detected"

key-files:
  created:
    - scripts/ingest-harness/run.mjs
    - scripts/ingest-harness/README.md
    - .planning/phases/170-ingest-contract-upgrade/170-HARNESS-BASELINE.md
  modified:
    - package.json
    - .planning/phases/170-ingest-contract-upgrade/170-PROOF-RUN.md

key-decisions:
  - "No --add-dir passed to the driven claude session at all (operator-directed 2026-07-27); the
    source rulebook is copied into {workDir}/source-under-test/ at stage time instead, so the
    reference game repo is unreachable from the session rather than merely git-status-monitored
    after the fact"
  - "Comments/log lines in run.mjs describe the additional-directory grant flag in prose rather
    than spelling its literal two-dash name, so the acceptance grep (grep -c -- '--add-dir'
    returns 0) holds even for code that discusses the flag's absence"
  - "170-PROOF-RUN.md's header arithmetic corrected from '7 of 9' to '8 of 9' — its own checklist
    table lists 8 FAIL rows against 1 PASS ((g)); item (e) is one combined checklist row this
    harness's checker correctly splits into two named checks (e1 heading, e2 reconciliation)"
  - "Zero checker gaps or false positives found comparing harness vs. human gate — no amendment
    to check.mjs or check.test.mjs was needed this task"

requirements-completed: [PROC-01]

duration: 9min
completed: 2026-07-27
---

# Phase 170 Plan 06: Live-Agent Ingest Harness Driver Summary

**A `stage`/`drive`/`assert` driver (`scripts/ingest-harness/run.mjs`, `npm run harness:ingest`)
that spawns a real sandboxed headless `claude` session through `/bs-ingest-rules` and reproduces,
with zero human sessions, the exact 8-of-9 failure the 2026-07-27 human gate found — 1/10 checks
passing (only the reference-game-unmodified gate).**

## Performance

- **Duration:** ~9 min of driver-authoring work + a 330.5s live agent session
- **Started:** 2026-07-27T20:07:00Z (approx, prior commit `e63f3d87`)
- **Completed:** 2026-07-27T20:22:08Z
- **Tasks:** 2
- **Files modified:** 5 (3 created, 2 modified)

## Accomplishments

- Built `scripts/ingest-harness/run.mjs`: an ESM `stage`/`drive`/`assert` driver, importing
  `checkIngestArtifacts` and `CHECK_IDS` from Plan 05's `check.mjs` rather than restating the
  check list. `stage` recreates the throwaway project, installs this repo's **current working
  tree's** skill text into it via `node bin/boardsmith.js claude --local --force`, verifies the
  install landed (`bs-ingest-rules/SKILL.md` + `bs-shared/ingest/transcription-subagent.md`),
  asserts the operator's global `~/.claude/skills/` was untouched (stated, not silent), verifies
  the reference repo's source hash and cleanliness, and copies the source rulebook into
  `{workDir}/source-under-test/` — the sandboxing step that makes the reference repo structurally
  unreachable from the driven session rather than merely detected-after-the-fact.
- `drive` spawns `claude --print --dangerously-skip-permissions` with cwd `{workDir}` and **no
  additional-directory access grant at all**, passing a prompt that only names the invocation and
  the staged copy's path — never restating or paraphrasing the ingest contract, and never
  mentioning the reference repo's path (both asserted before the child process is spawned).
- `assert` locates the single produced project directory, reports Plan 05's nine checks plus a
  new tenth check (`reference-repo-unmodified`, gate item (g)) re-verifying the reference repo's
  git cleanliness/HEAD against what `stage` recorded, prints a ten-row table, and exits non-zero
  unless all ten pass.
- Registered as `npm run harness:ingest`; confirmed absent from `npm test` and unmatched by
  `npx vitest list`. Full suite stayed at 3236/3236 (Plan 05's baseline, unchanged).
- Ran the harness end-to-end against current HEAD skill text (unchanged since Plan 05, per
  `git log` on `src/cli/slash-command/`) and recorded `170-HARNESS-BASELINE.md`: **1/10 checks
  pass** (only gate (g)), matching the human gate's corrected 8-of-9-FAIL result letter-for-letter
  in pass/fail direction. Zero checker gaps, zero checker false positives.

## Task Commits

1. **Task 1: Write the stage / drive / assert driver** - `2dde272a` (feat)
2. **Task 2: Run the harness against current HEAD and record the baseline** - `996b746b` (test)

**Plan metadata:** committed separately after this SUMMARY (docs)

## Files Created/Modified

- `scripts/ingest-harness/run.mjs` - the stage/drive/assert driver, no new dependencies
- `scripts/ingest-harness/README.md` - CI-exclusion rationale + reference-game read-only invariant
- `package.json` - added `harness:ingest` script, not wired into `test`
- `.planning/phases/170-ingest-contract-upgrade/170-HARNESS-BASELINE.md` - the recorded baseline
  run, compared row-by-row against `170-PROOF-RUN.md`
- `.planning/phases/170-ingest-contract-upgrade/170-PROOF-RUN.md` - header arithmetic corrected
  from "7 of 9" to "8 of 9" (its own checklist table already listed 8 FAIL rows)

## Decisions Made

- **No `--add-dir` under any circumstance, prevention over detection:** the source rulebook is
  copied into the throwaway tree at stage time so the reference game repo is never granted to the
  driven session at all — not merely git-status-monitored after the fact. Verified live: `ps aux`
  while `drive` ran showed the child process's argv carried exactly `--print
  --dangerously-skip-permissions <prompt>`.
- **Literal flag string never appears in `run.mjs`, even in comments:** the acceptance criterion
  (`grep -c -- '--add-dir' scripts/ingest-harness/run.mjs` returns 0) is stricter than "don't pass
  the flag" — it also forbids the two-dash string appearing anywhere, including in a comment
  explaining its absence. Comments/log lines describe it in prose ("additional-directory access
  grant flag") instead.
- **170-PROOF-RUN.md's "7 of 9" corrected to "8 of 9":** independently re-counted the checklist
  table (a)-(i) before writing the comparison — 8 FAIL rows, 1 PASS row ((g)). The original "7 of
  9" undercounted by one; item (e)'s single checklist row bundles two distinct defects (wrong
  heading string, wrong reconciliation count) that this harness's checker correctly reports as
  two separate checks (e1, e2).

## Deviations from Plan

None — plan executed as written. The one adjustment worth naming as a correction, not a
deviation: 170-PROOF-RUN.md's own header undercounted its checklist by one FAIL row; fixed inline
per Rule 1 (bug in a previously-written record) since an inaccurate human-gate count would corrupt
this task's row-by-row comparison.

## Issues Encountered

None. The live agent session (330.5s) completed cleanly on the first attempt, printed
`HARNESS-STEP3-COMPLETE` as instructed, and produced a project directory with exactly the
`rulebook/` shape `assert`'s directory-discovery logic expects.

## Fidelity Finding (the point of Task 2)

Comparing all ten rows of this run against `170-PROOF-RUN.md`'s human-gate results letter by
letter: **no letter disagrees in pass/fail direction.** Every letter that failed the human gate
fails this harness run; gate (g) passes in both. Zero checker gaps (no letter where the harness is
blind to a defect the human gate caught) and zero checker false positives (no letter where the
harness manufactures a failure the human gate didn't see) — so no amendment to `check.mjs` or
`check.test.mjs` was needed.

The one pattern worth calling out explicitly, because it directly informs Plans 07/08's fix
strategy: **every disagreement between the two runs is in the *specific improvised value*, never
in the *failure direction*.** The `## Open Rules Gaps` heading came out as
`## Open Questions (deferred at ingest by the designer)` in the human run and
`## Open Rules Questions (surfaced, never fabricated)` in this harness run — two different
invented strings, neither matching the spec, neither matching each other. The reconciliation
counts (3-vs-6 human, 0-vs-5 harness) and Derived totals (24 human, 28 harness) likewise differ in
absolute number but agree on direction (Visual stayed at exactly 0 in both runs; markers always
exceed section entries in both runs). This is the signature of prose *instruction* being
paraphrased fresh each session rather than a fixed string being misread — strengthening the
hypothesis that a template *shape to fill* survives where *prose specifying an exact string*
does not, which is exactly what Phase 170's next plans (07/08) are built to test.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The harness is proven as a faithful, reusable proxy for the human ingest gate: it reproduces the
  known defect with no human in the loop, on a live agent session, using the exact skill text the
  human gate ran against.
- **No INGEST requirement is closed by this plan** (per its own success criteria and the plan's
  own frontmatter, which lists only PROC-01). PROC-01 is satisfied by the harness's existence and
  by this task's independently-reproduced, row-by-row-compared baseline.
- Plans 07/08 (the template-based rewrite of `INDEX.md`'s Step 3 synthesis) now have a cheap,
  agent-driven acceptance bar: `npm run harness:ingest` reporting the relevant check green,
  rather than another human ingest session. The template hypothesis this baseline strengthens
  (§ Fidelity Finding above) is the concrete prediction those plans should test against.
- Plan 170-07 is explicitly NOT started here, per this run's scope boundary.

---
*Phase: 170-ingest-contract-upgrade*
*Completed: 2026-07-27*

## Self-Check: PASSED

- `scripts/ingest-harness/run.mjs` — FOUND
- `scripts/ingest-harness/README.md` — FOUND
- `.planning/phases/170-ingest-contract-upgrade/170-HARNESS-BASELINE.md` — FOUND
- Commit `2dde272a` — FOUND in `git log`
- Commit `996b746b` — FOUND in `git log`
- `grep -c -- '--add-dir' scripts/ingest-harness/run.mjs` → `0`
- `npm test` → 3236/3236 passing
- `git -C ~/BoardSmithGames/seven status --porcelain` → empty; HEAD `a03f38d4792af9dfc7c798be69686fc3230f54dd`
- `/tmp/bs-ingest-harness` → removed
