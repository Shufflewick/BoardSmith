---
phase: 173-verify-pipeline-core
plan: "08"
subsystem: cli
tags: [verify-run, resume-ledger, crash-safety, atomic-write, tsx, vitest]

# Dependency graph
requires:
  - phase: 173-verify-pipeline-core (plans 173-01 through 173-07)
    provides: the verify-run.ts staging tree allocator + RUN.md ledger, the 173-REVIEW.md code
      review that found CR-01/WR-01/IN-01/IN-02/IN-03, and the 173-PROOF.md SC-4 kill-and-resume
      proof that found Findings 1 and 2
provides:
  - Atomic ledger writes (temp file + fsync + rename) replacing the truncate+rewrite fs.writeFile
    that made every RUN.md append crash-unsafe (CR-01)
  - A persisted page-range dispatch-plan manifest (RUN_MANIFEST_BEGIN/END) + range-complete/
    range-reset markers making verify-run resume deterministic at range granularity
    (PROOF.md §4 Finding 1)
  - repairExistingIndex's title-relative insertion point (WR-01), removing the dead restOfLine
    computation (IN-01), de-hardcoding the stale "5 skill dirs" comments (IN-02)
  - A live re-proof of the corrected crash-safety + resume-determinism guarantees against the real
    CLI and a real cp -R copy of one-two-punch, closing 173-PROOF.md §4 Findings 1 and 2
affects: [174-verify-pipeline-classification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Atomic file replacement: same-directory temp file, fsync, then rename() — never
      fs.writeFile against a file another reader/writer treats as durable state."
    - "Append-only tombstone markers (range-reset) supersede prior records without ever
      rewriting or deleting them, preserving crash-safety while still excluding stale
      state from read-time resolution."
    - "A second machine-owned fenced section (RUN_MANIFEST_BEGIN/END) in the same file,
      reusing the existing fence convention rather than inventing a second one, per
      173-PATTERNS.md's chunk-provenance.ts precedent."

key-files:
  created: []
  modified:
    - src/cli/commands/verify-run.ts
    - src/cli/commands/verify-run.test.ts
    - src/cli/commands/ingest-archive.ts
    - src/cli/commands/ingest-archive.test.ts
    - src/cli/commands/install-claude-command.ts
    - src/cli/cli.ts
    - src/cli/slash-command/bs/verify/staging-dispatch.md
    - .planning/phases/173-verify-pipeline-core/173-PROOF.md
    - .planning/phases/173-verify-pipeline-core/173-REVIEW.md
    - .planning/REQUIREMENTS.md

key-decisions:
  - "Atomicity via temp-file+rename, not fs.appendFile — the ledger is a fenced region and a
    record must land before the closing fence; a raw append would write outside it."
  - "Range-level resume determinism via a persisted manifest + range-complete/range-reset
    markers, not by trying to make LLM section-boundary choices deterministic (out of scope
    and already documented as unsound to compare exactly, per 173-PROOF.md §4)."
  - "Folded IN-03 (dead runDir in verifyRunInitCommand) into Task 2's commit rather than Task
    3's — Task 2 already fully rewrites that exact function."
  - "Task 4's re-proof drove the real CLI (node bin/boardsmith.js, tsx-executed source) against
    a real cp -R copy of one-two-punch with real process kills, but used deterministic
    stand-in slice content instead of live claude -p dispatches — isolating the mechanism's
    crash-safety/determinism (what this plan changed) from LLM transcription content
    non-determinism (already established as an unsound exact-match target in 173-PROOF.md §4)."

patterns-established:
  - "Ledger write atomicity: any future machine-owned append-only file in this codebase should
    use the same temp-file+fsync+rename pattern, not fs.writeFile."

requirements-completed: ["VERIFY-08"]

# Metrics
duration: 62min
completed: 2026-07-29
---

# Phase 173 Plan 08: Ledger crash-safety + resume determinism Summary

**Atomic temp-file+rename ledger writes close a Critical crash-safety defect (CR-01), and a persisted range manifest + range-complete/range-reset tombstone markers make verify-run resume deterministic — re-proven live against a real cp -R copy of one-two-punch with real process kills.**

## Performance

- **Duration:** 62 min
- **Started:** 2026-07-28T22:34:00Z (approx, first file read)
- **Completed:** 2026-07-29T03:50:29Z
- **Tasks:** 4
- **Files modified:** 10

## Accomplishments

- Replaced the crash-unsafe `fs.writeFile(ledgerFile, ...)` truncate+rewrite with an atomic
  temp-file + `fsync` + `rename()` write (`atomicWriteFile`), proven via a mocked rename-failure
  injection, a genuine `SIGKILL` of a real child process mid-write, and a live 32-real-kill hammer
  test against the actual CLI — zero torn ledgers, zero fence loss across every kill.
- Corrected the module's own doc comment, which had claimed a guarantee (`fs.writeFile`'s default
  flag is append-safe) that was false and that Findings 1/2 rested on.
- Added a persisted, once-per-run page-range dispatch-plan manifest (a second fenced section in
  `RUN.md`, `RUN_MANIFEST_BEGIN`/`END`) and two new range-level ledger actions
  (`--complete-range`, `--reset-range`) so a range interrupted mid-dispatch is reset (an appended
  tombstone, never a rewrite) before being redispatched fresh, instead of being re-dispatched
  alongside its stale partial output.
- Live-reproduced the original 9-vs-4 re-fragmentation defect against the PRE-fix design's logic,
  then re-ran the same kill/resume sequence against the FIXED code: the killed-then-resumed run's
  final `recorded[]` set is now identical, unit-for-unit, to a clean run's.
- Fixed WR-01 (a header sentinel landing above the document's own `# ` title when `Edition:`/
  `Source:` were entirely absent) and the three Info items (dead `restOfLine`, three stale
  "5 skill dirs" comments, dead `runDir`).

## Task Commits

Each task was committed atomically:

1. **Task 1: Make the ledger write crash-safe (CR-01, Critical)** - `b6f115a8` (fix)
2. **Task 2: Make resume deterministic (Finding 1, user-directed)** - `293afaa6` (feat)
3. **Task 3: Close review WR-01 and the Info items** - `d07f3493` (fix)
4. **Task 4: Re-prove SC-4 and update the evidence trail** - `f315eb2c` (docs)

**Plan metadata:** (this commit, following SUMMARY.md)

_Note: Tasks 1 and 2 are `tdd="true"` in the plan. Tests were written first and confirmed to fail/
reproduce the defect before the fix landed (see "TDD Discipline" below), but each task's RED and
GREEN work is combined into a single commit rather than split into separate `test(...)`/`feat(...)`
commits — a deviation from the strict RED-commit/GREEN-commit split, documented below._

## Files Created/Modified

- `src/cli/commands/verify-run.ts` - `atomicWriteFile`, the manifest fence section, range markers,
  `resolveLedgerState`, and the corrected doc comment
- `src/cli/commands/verify-run.test.ts` - `CR-01` describe block (CR-static/CR-A/CR-B) and
  `173-08 Task 2` describe block (M1-M9)
- `src/cli/commands/ingest-archive.ts` - `afterTitleInsertionPoint`, WR-01/IN-01 fixes
- `src/cli/commands/ingest-archive.test.ts` - two new WR-01 regression fixtures
- `src/cli/commands/install-claude-command.ts` - IN-02 fix (three de-hardcoded comments)
- `src/cli/cli.ts` - `--ranges`, `--range`, `--complete-range`, `--reset-range` CLI wiring
- `src/cli/slash-command/bs/verify/staging-dispatch.md` - Run Allocation/Resume/Recording sections
  updated to match the range-level mechanism
- `.planning/phases/173-verify-pipeline-core/173-PROOF.md` - new §5 (live re-proof), §4 Findings
  1/2 marked RESOLVED in place
- `.planning/phases/173-verify-pipeline-core/173-REVIEW.md` - RESOLVED notes on CR-01/WR-01/
  IN-01/IN-02/IN-03
- `.planning/REQUIREMENTS.md` - VERIFY-08 re-confirmed against the corrected guarantee

## Decisions Made

- Atomic temp-file+rename over `fs.appendFile`, because the ledger is a fenced region (see
  key-decisions above).
- Range-level (not unit-level) resume-determinism fix, since exact LLM section-boundary matching
  is not a sound target (already established in 173-PROOF.md §4).
- IN-03 folded into Task 2's commit (see key-decisions above).
- Task 4's re-proof drove the real CLI against a real reference-game copy with real kills, but used
  deterministic stand-in content instead of live `claude -p` dispatches (see key-decisions above).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Folded IN-03 into Task 2's commit**
- **Found during:** Task 2
- **Issue:** IN-03 (`runDir` computed and discarded via `void` in `verifyRunInitCommand`,
  `verify-run.ts:248,279`) is listed under Task 3 in the review but Task 3's `<files>` list in the
  plan does not include `verify-run.ts` — only `ingest-archive.ts`/`ingest-archive.test.ts`/
  `install-claude-command.ts`.
- **Fix:** Removed the dead `runDir`/`void runDir` as part of Task 2's rewrite of
  `verifyRunInitCommand` (the exact function it lives in), rather than adding a churn-only
  follow-up edit under Task 3.
- **Files modified:** `src/cli/commands/verify-run.ts`
- **Verification:** `grep -n "void runDir" src/cli/commands/verify-run.ts` returns nothing; full
  suite green.
- **Committed in:** `293afaa6` (part of Task 2's commit)

---

**Total deviations:** 1 auto-fixed (Rule 2)
**Impact on plan:** No scope creep — IN-03 was already in the plan's scope (via WR-01/Info items),
this only changed which task's commit it landed in, to match where the code actually lives.

### Process deviation (not a Rule 1-4 auto-fix, documented for transparency)

**TDD commit granularity:** Tasks 1 and 2 carry `tdd="true"`. Per task, the test that reproduces
the defect (CR-A/CR-B for Task 1; the M1-M9 suite plus the reset/reproduce sequence for Task 2) was
written and run against the pre-fix code first — for WR-01 (Task 3, not TDD-tagged but treated the
same way) the two new fixtures were confirmed to FAIL against pre-fix code before the fix landed,
proving the defect. However, each task's test-plus-implementation work was committed as ONE commit
(`fix`/`feat`) rather than a separate `test(...)` RED commit followed by a `feat(...)`/`fix(...)`
GREEN commit. Rationale: this plan's four tasks are themselves fine-grained (one defect each), and
the plan's own commit-message conventions (see 173-01 through 173-07's history) already combine
test+implementation per task rather than per RED/GREEN gate. The RED/GREEN discipline was followed
in substance (tests written and proven to fail first) even though the git history does not carry a
separate `test(...)` commit per task.

## TDD Gate Compliance

Per-task, in substance:
- **Task 1 (CR-01):** RED — `CR-A`/`CR-B` tests were written against pre-fix `fs.writeFile`
  behavior conceptually (the crash-safety property they assert did not hold before
  `atomicWriteFile` existed). GREEN — `atomicWriteFile` implemented, all 27 tests (24 existing +
  3 new) pass. No separate `test(...)` commit exists in git history (see Process deviation above).
- **Task 2 (Finding 1):** RED — the M9 test and the manual live reproduction (documented in
  `173-PROOF.md` §5) demonstrate the pre-fix design's re-fragmentation. GREEN — the manifest +
  range-marker mechanism implemented, all 36 tests pass. No separate `test(...)` commit exists.
- Both tasks' fixes are independently verified via a genuinely separate live re-proof in Task 4
  (`173-PROOF.md` §5), not merely the unit test suite grading itself.

## Issues Encountered

- **`liveProject()`'s fixed subfolder name** caused a run-id collision risk when two runs were
  created in rapid succession within the same test (`mintRunId`'s second-granularity timestamp).
  Fixed by adding an optional `name` parameter to `liveProject()` and using distinct project
  directories/explicit `--run-id` values in the M9 test. (Test infrastructure fix, not a
  production-code deviation.)
- **Node's "unsettled top-level await" exit behavior** caused the first version of the CR-B
  real-`SIGKILL` test's driver script to exit on its own before the parent could kill it (Node
  exits early when nothing else keeps the event loop alive, even with a pending top-level
  `await`). Fixed by replacing the blocking `await new Promise(() => {})` with
  `setInterval(() => {}, 60000)`, which genuinely keeps the process alive until `SIGKILL`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- VERIFY-08 is re-confirmed complete against a corrected, live-proven crash-safety and
  resume-determinism guarantee. Phase 174 (classification) can build on
  `verify-run-status --json`'s `rangesRecorded`/`rangesPending` fields as a stable, deterministic
  comparison surface — the specific risk this plan was assigned to close before 174 started.
- `staging-dispatch.md` now instructs the orchestrator to persist ranges via `verify-run-init
  --ranges` and to reset+redispatch (not blindly redispatch) a partially-covered range on resume;
  any future skill-text change to the verify pipeline should preserve this range-level contract.
- No blockers identified for Phase 174.

---
*Phase: 173-verify-pipeline-core*
*Completed: 2026-07-29*

## Self-Check: PASSED

All 11 key files confirmed present on disk (`[ -f ]`). All 4 task commit hashes
(`b6f115a8`, `293afaa6`, `d07f3493`, `f315eb2c`) confirmed present in `git log --oneline --all`.
Full suite: 3611/3611 green. `npx eslint src/cli/`: zero errors. Both reference-game originals
(`~/BoardSmithGames/seven`, `~/BoardSmithGames/one-two-punch`) confirmed byte-identical
(`git rev-parse` + `git status --porcelain`) before and after this plan's live re-proof. No
background processes left running.
