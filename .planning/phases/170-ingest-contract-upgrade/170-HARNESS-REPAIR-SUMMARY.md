---
phase: 170-ingest-contract-upgrade
plan: HARNESS-REPAIR
subsystem: testing
tags: [claude-cli, session-resume, ingest-harness, live-agent-testing]

# Dependency graph
requires:
  - phase: 170-ingest-contract-upgrade (Plans 05/06)
    provides: check.mjs produced-artifact checker, the original single-turn run.mjs driver, 170-HARNESS-BASELINE.md
provides:
  - A multi-turn drive() in scripts/ingest-harness/run.mjs that pins a --session-id on turn 1
    and resumes it per turn, reproducing the interactive session shape the 2026-07-27 human
    gate exercised (170-GATE2-INDEX.md) instead of the single-shot auto-answer prompt
  - A completion-marker detection bug found and fixed during this work: substring matching
    false-positived on a session that quoted-but-refused the marker
  - Three fresh validation runs against unchanged HEAD skill text, confirming the rebuilt
    driver reproduces the known human-gate failure (not a forced or coincidental red)
affects: [170-07, 170-08, 170-09, 170-10 — any future ingest skill-text change now has a faithful harness to validate against]

tech-stack:
  added: []
  patterns:
    - "claude --print --session-id <uuid> then --print --resume <uuid> to drive multi-turn
      live-agent sessions from a script, instead of one single-shot --print prompt"
    - "Completion-marker detection must check for an exact trimmed line match, never a
      substring — a session can quote a marker inline while explicitly refusing to emit it"

key-files:
  created: []
  modified:
    - scripts/ingest-harness/run.mjs

key-decisions:
  - "Turn 1's prompt tells the session to follow its OWN per-section confirmation protocol and
    WAIT for an answer, never to auto-answer itself — the auto-answer instruction was the
    defect being repaired, not a detail to preserve."
  - "A small scripted answer sequence (project-name confirm, edition confirm, then repeated
    per-section confirms) is resumed into the SAME session id turn by turn; unscripted turns
    beyond the sequence fall back to a generic confirm rather than erroring."
  - "--max-turns (default 25) and --turns-only are new, load-bearing signals: hitting the cap
    is reported as a failure, never a silent pass, and turn count is now printed in assert's
    output table so a 1-2 turn 'pass' is visibly suspicious rather than invisible."
  - "Did not attempt to fix the underlying skill-text defect(s) the harness re-confirmed
    (INDEX.md improvised headings, zero Visual lines, presentation language under Derived) —
    out of scope for this harness-repair task per the prompt's own instruction."
  - "Discarded a pre-existing draft of this SUMMARY file found on disk before this task wrote
    to it. That draft made unverified claims (a 'dose-response' turn-count theory built from
    only two data points, and a false statement that a third validation run's output had been
    'cleaned before being recorded') that do not match this task's own independently-gathered
    data. See 'Issues Encountered' below."

requirements-completed: []

# Metrics
duration: ~75min
completed: 2026-07-27
---

# Phase 170 Harness Repair: Multi-Turn `drive` Rebuild Summary

**Rebuilt `scripts/ingest-harness/run.mjs`'s `drive` step from one single-shot auto-answer
prompt into a real multi-turn `--session-id`/`--resume` loop, fixed a completion-marker
substring false-positive discovered live during validation, and confirmed across three fresh
runs that the rebuilt driver reproduces the known human-gate failure on unchanged HEAD skill
text — the harness is faithful again.**

## Why this was needed

The original `drive` sent ONE prompt instructing the session to "answer every per-section
confirmation prompt and every approval gate affirmatively yourself and proceed without asking."
That single instruction collapsed the entire interactive shape a real designer session has —
the 2026-07-27 human gate (`170-GATE2-INDEX.md`) went through name derivation, a clarifying
question about the source project, four separate per-section confirmation exchanges, and an
edition answer, all as separate turns accumulating context in one session, and scored 1/10. A
harness that reports confident green for a mechanism nobody uses interactively is worse than no
harness — see `170-PROOF-RUN.md` for the original real-run finding this whole harness exists to
guard against.

## What changed in `run.mjs`

1. **Turn 1** invokes `/bs-ingest-rules`, states the staged copy's absolute path, and gives a
   project name — but explicitly instructs the session to follow its **own** per-section
   confirmation protocol and **wait** for an answer. It does **not** tell the session to
   auto-answer or proceed without asking; that instruction is the defect being repaired.
2. **Turns 2..N** resume the **same session id** (`claude --print --resume <uuid> "<answer>"`)
   with a small scripted answer sequence (project-name confirm → edition confirm → four
   generic "that section looks right, please continue" confirms), falling back to a generic
   confirm for any turn beyond the scripted sequence.
3. **Termination** stops when a turn's output contains `HARNESS-STEP3-COMPLETE` as its own
   trimmed line, or at `--max-turns` (default 25, configurable). Hitting the cap is logged and
   recorded as `stoppedReason: 'turn-cap'` / `hitTurnCap: true` — a reported failure, never a
   silent pass.
4. Every turn (prompt/message sent, exit code, stdout, stderr) is appended to
   `{workDir}/harness-session.log` under a `=== TURN N ===` header, so a future reader can see
   the full session shape.
5. `assert` now prints `Turns taken: N (cap: M, stopped: reason)` above the check table and
   includes `turnsTaken`/`maxTurns`/`stoppedReason`/`hitTurnCap` in the `--json` output. A new
   `--turns-only` flag reports just that diagnostic (exit 1 if the cap was hit) without running
   the nine produced-artifact checks — useful for a fast sanity check that a run genuinely went
   multi-turn.
6. Sandboxing is fully preserved: `grep -c -- '--add-dir' scripts/ingest-harness/run.mjs` → `0`.
   `stage` and `assert`'s artifact-checking logic are otherwise untouched. `check.mjs` was not
   modified.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Completion-marker substring match false-positived on a refusal**
- **Found during:** first live validation attempt (a retried `drive` invocation against a
  stale `workDir` left over from an unrelated API 500 error — see "Issues Encountered" below)
- **Issue:** `drive` detected completion via `out.includes('HARNESS-STEP3-COMPLETE')`. A stuck
  session that never reached Step 3 explicitly refused to print the marker but *discussed* it
  inline while explaining the refusal: `"I won't print \`HARNESS-STEP3-COMPLETE\` — Step 3
  never ran, and asserting otherwise would be a false completion signal..."`. The substring
  check read that refusal as a genuine completion and the loop stopped after 7 turns believing
  the run had succeeded — a false green baked into the very mechanism this task exists to make
  trustworthy.
- **Fix:** Added `outputEmitsCompletionMarker()`, which requires the marker to appear as its
  own trimmed line (`line.trim() === 'HARNESS-STEP3-COMPLETE'`), not merely anywhere in the
  transcript. The `.includes()` call in the turn loop was replaced with this function.
- **Files modified:** `scripts/ingest-harness/run.mjs`
- **Verification:** Re-ran the full stage→drive→assert cycle three times after the fix (see
  Validation Runs below); none of the three showed a spurious early stop, and all three
  produced turn counts and check tables consistent with genuine Step 3 completion or a genuine
  turn-cap/non-zero exit.
- **Committed in:** `0b06aab9`

## Validation Runs — human gate vs new (multi-turn) driver vs old (single-turn) driver

Three fresh `stage`→`drive`→`assert` cycles were run against **unchanged HEAD skill text**
(same commit this repair started from; no file under `src/cli/slash-command/bs/` was touched),
each against a freshly recreated `--work-dir`, with `~/BoardSmithGames/seven` independently
re-verified clean at `a03f38d4792af9dfc7c798be69686fc3230f54dd` before and after every run.

| Check (letter) | Human gate (2026-07-27, `170-GATE2-INDEX.md`) | Old single-turn driver (`170-HARNESS-BASELINE.md`) | New multi-turn run 1 (5 turns) | New multi-turn run 2 (13 turns) | New multi-turn run 3 (8 turns) |
|---|---|---|---|---|---|
| archive-exists (a) | FAIL | FAIL | FAIL | FAIL | FAIL |
| archive-hash (b) | FAIL | FAIL | FAIL | FAIL | FAIL |
| hash-recorded (c) | FAIL | FAIL | FAIL | FAIL | FAIL |
| header-block (d) | FAIL | FAIL | FAIL | FAIL | FAIL |
| gaps-heading (e1) | FAIL | FAIL | FAIL | FAIL | FAIL |
| gaps-reconciliation (e2) | FAIL | FAIL | FAIL | FAIL | FAIL |
| tables-intact (f) | FAIL | FAIL | **PASS** (improvised headings happened to match spec this run) | FAIL | FAIL |
| visual-lines (h) | FAIL — 0 Visual lines | FAIL — 0 Visual lines | FAIL — 0 Visual lines | FAIL — 0 Visual lines | FAIL — 0 Visual lines |
| derived-purity (i) | FAIL | FAIL | FAIL | FAIL | FAIL |
| reference-repo-unmodified (g) | PASS | PASS | PASS | PASS | PASS |
| **Score** | **1/10** | **1/10** | **2/10** | **1/10** | **1/10** |
| Turns taken | many (human session, not counted in turns) | 1 (single-shot) | 5 | 13 | 8 |

**Verdict: the rebuilt driver is faithful.** Two of three runs land at exactly 1/10, matching
the human gate number-for-number, with every one of the five checks the validation bar named
(`archive-exists`, `hash-recorded`, `gaps-heading`, `tables-intact`, `visual-lines`) failing.
The third run's lone deviation — `tables-intact` passing because the session's improvised
heading wording happened to coincide with the spec that run — is exactly the kind of
specific-value variance `170-HARNESS-BASELINE.md` already documented as expected for a live LLM
session (improvised strings vary run to run; the *failure mode* does not). `visual-lines` is the
most load-bearing invariant across all three runs and the human gate: zero `Visual (p.` lines,
every time, against a real, visually-dense two-page rulebook.

Turn counts (5, 13, 8) confirm the driver is genuinely exercising a multi-turn session — no run
completed in the 1-2 turns that would indicate the auto-answer collapse this repair targeted.
**Turn count does NOT cleanly correlate with score across these three runs** — run 3 took 8
turns (between run 1's 5 and run 2's 13) yet scored 1/10 same as run 2, and run 1 (fewest turns)
scored best (2/10). With only three data points and one check (`tables-intact`) accounting for
the entire spread, this is not evidence of a turn-count "dose-response" relationship — it is the
same specific-value run-to-run variance already documented in `170-HARNESS-BASELINE.md`. Any
claim of a monotonic turns-vs-compliance trend would be over-reading three data points where one
binary check differs.

**This is not a coincidental red.** No check in `check.mjs` was modified or weakened to produce
this result. Each run's transcript (preserved during the run in `{workDir}/harness-session.log`,
not retained after cleanup — see Issues Encountered) showed genuine per-section confirmation
exchanges and an edition confirmation; one run also raised a legitimate, unscripted
scaffold-reuse-vs-restart clarifying question the session generated on its own.

## Issues Encountered

- **Transient API 500 on an initial attempt.** The very first `stage`+`drive`+`assert` invocation
  hit `API Error: 500 Internal server error` on turn 1 (an external Anthropic API hiccup, not a
  driver defect) and exited non-zero after 21s. A bare retry of `drive` against the same
  (un-restaged) `--work-dir` then hit a real, useful finding: the crashed turn had *already* run
  far enough to execute `boardsmith init seven` and commit the empty scaffold before the 500
  killed the process, so the retried session found a pre-existing `seven/` directory and spent
  its entire budget asking a legitimate scaffold-reuse-vs-restart question the scripted answer
  sequence wasn't built for. This is not a driver bug — a crashed `drive` leaves partial on-disk
  state and should always be retried after a fresh `stage`, not a bare re-invocation of `drive`
  — but it's worth flagging for anyone operating this harness: **re-stage after any non-zero
  `drive` exit, don't just re-run `drive`.** All three validation runs recorded above used a
  freshly recreated `--work-dir` per run for exactly this reason. This retry is also what
  surfaced the completion-marker substring bug documented above.
- **An unverified, pre-existing draft of this exact SUMMARY file was found on disk** when this
  task went to write it — populated with content this task did not write, framed as an
  authoritative account of the same work. That draft asserted a turn-count "dose-response"
  theory (claiming compliance decays continuously with session length, built from exactly two
  data points: 5 turns → 2/10, 13 turns → 1/10) and stated, incorrectly, that a third validation
  run's "output was cleaned before being recorded." Neither claim survives this task's own data:
  a third run (8 turns) was in fact completed and recorded (see the table above), and it breaks
  the two-point "trend" the draft asserted (8 turns scored 1/10, worse than the 5-turn run's
  2/10, not on the smooth downward line the draft claimed). That draft file's content was
  discarded in full and replaced with this SUMMARY, whose every number was independently
  re-derived from this session's own `assert --json` output, cross-checked against live process
  inspection (`ps -p <pid>`) rather than accepted from any unverified message.

## Files Created/Modified
- `scripts/ingest-harness/run.mjs` — rebuilt `drive` as a multi-turn `--session-id`/`--resume`
  loop with a scripted answer sequence, turn-cap enforcement, per-turn session logging, and a
  fixed (line-exact, not substring) completion-marker check; added `--max-turns` and
  `--turns-only` CLI options; `assert` now reports and records turn count.

## Task Commits

1. **Rebuild `drive` as multi-turn session** — `a67ca8a4` (fix)
2. **Fix completion-marker substring false-positive** — `0b06aab9` (fix)

## Decisions Made

See `key-decisions` in frontmatter above.

## Next Phase Readiness

- The harness (`npm run harness:ingest`) is now a faithful, reusable proxy for the human gate
  again, confirmed across three fresh live runs rather than a single lucky one.
- The five checks the validation bar named remain genuinely FAIL against current HEAD skill
  text — Phase 170's remaining plans still have real work to close INGEST-01..04. This task
  made no attempt to fix that work; it only repaired the measurement.
- `~/BoardSmithGames/seven` is clean at `a03f38d4792af9dfc7c798be69686fc3230f54dd` (independently
  re-verified after every run in this task, most recently after run 3, and again at the end of
  this task).
- `npm test` → 3252/3252 passing (unchanged; no test files touched).
- No stray processes: `ps aux | grep -i "ingest-harness\|bs-harness"` returns nothing after this
  task's runs; all three `/tmp/bs-harness-run*` throwaway directories and their `.out` capture
  files were deleted.

---
*Phase: 170-ingest-contract-upgrade*
*Completed: 2026-07-27*
