---
phase: 179-source-free-verification-mode
plan: 02
subsystem: cli
tags: [verify-game, source-free, cli, provenance, vitest]

requires:
  - phase: 179-source-free-verification-mode
    plan: 01
    provides: "computeSourceFreeReport(projectDir) / VERIFY_PIPELINE_STEPS / SOURCE_FREE_ADDITIONAL_CHECKS in verify-source-free.ts"
  - phase: 171-provenance-and-scope
    provides: "computeVerificationScope / renderVerifiedAgainst / SCOPE_CODE_ONLY in chunk-provenance.ts"
provides:
  - "verifySourceFreeCheckCommand — the one read-only boardsmith verify-source-free-check CLI surface, human + --json, over computeSourceFreeReport"
  - "boardsmith verify-source-free-check registration in cli.ts, no scope-declaring option"
  - "PROV-02 data-flow proof: renderVerifiedAgainst's real output asserted against both source-free reasons and the full-scope no-Reason: case"
affects: [179-03-wiring-close, 179-04-skill-prose]

tech-stack:
  added: []
  patterns:
    - "verifySourceFreeCheckCommand renders only — every field in its --json output is a verbatim pass-through of computeSourceFreeReport; it never re-derives scope, reason, or the unchecked list."
    - "Exit code discipline: this command never assigns process.exitCode, on either a source-free or a full-scope project — a reduced pass is a successful pass, mirroring verify-derive-check/verify-example-replay's own advisory posture."
    - "PROV-02 cross-surface assertion: tests read scope/reason from computeSourceFreeReport, computeVerificationScope, and verifySourceFreeCheckCommand's own --json return, and assert all three agree for the same fixture, so a future divergence fails in this test file rather than in a live proof run."

key-files:
  created: []
  modified:
    - src/cli/commands/verify-source-free.ts
    - src/cli/commands/verify-source-free.test.ts
    - src/cli/cli.ts

key-decisions:
  - "Avoided the literal substring '--force' anywhere inside the verify-source-free-check cli.ts registration comment (even as part of a longer flag name like --force-scope), because an existing test (verify-impact.test.ts's cli.ts registration test) scans a fixed byte range of cli.ts between two markers for the substring '--force' as a bypass-flag sentinel, and the new registration block landed inside that range. Rewording ('no forcing flag' instead of naming --force/--assume-full/--force-scope literally) satisfied both this plan's own no-bypass-option criterion and the pre-existing unrelated test — found and fixed before the final green run, not left as a race between two tests."
  - "Task 2's fixtures reuse chunk-provenance.test.ts's own pre-provenance-project INDEX.md shape verbatim (per the plan's own read_first instruction to reuse rather than fork) instead of introducing a second hand-authored copy of that fixture text."

requirements-completed: [VERIFY-09]

duration: ~35min
completed: 2026-08-01
---

# Phase 179 Plan 02: verify-source-free-check CLI + PROV-02 Data-Flow Proof Summary

**One read-only `boardsmith verify-source-free-check` command that renders plan 01's `computeSourceFreeReport` (human + `--json`, exit 0 unconditionally), registered with no scope-declaring flag, plus a PROV-02 test asserting the durable `## Verified Against` block's real rendered output — not a hand-built string — for both source-free reasons and the full-scope no-`Reason:` case.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 2
- **Files modified:** 3 (0 created)

## Accomplishments

- `verifySourceFreeCheckCommand(options: { project?, json? })` added to `verify-source-free.ts`: resolves `--project` with `resolve()` before any read (delegated to `computeSourceFreeReport` → `computeVerificationScope`), delegates all computation, and renders either `--json` (the exact `SourceFreeReport` object, one line on stdout) or a human summary naming the mode, the reason (when reduced), which pipeline steps ran vs. were skipped, the four source-free checks still run, and — on a source-free project only — every unchecked defect class paired with its responsible check. Never assigns `process.exitCode`.
- `verify-source-free-check` registered in `src/cli/cli.ts`, `--project`/`--json` only, immediately after `verify-example-translate`, with a registration comment stating the no-bypass-flag decision explicitly (decision 1 / T-179-06).
- 10 new tests in `verify-source-free.test.ts`: Task 1's command-surface tests (`--json` shape, human-output content on both scopes, exit-code-never-non-zero on both scopes, `checksRun` scope-invariance) and Task 2's `describe('PROV-02 data flow — source-free project')` block (4 tests: source-missing fixture's rendered block, pre-provenance-project fixture's rendered block, full-scope fixture's absent `Reason:` line, and a cross-surface agreement test asserting `verifySourceFreeCheckCommand`'s own `--json` return, `computeSourceFreeReport`, and `computeVerificationScope` all agree on `scope`/`reason` for one project state).
- Verified end-to-end through the real built entry point (`npm run build:cli` → `node dist/cli.js`), not just by reading the registration — see the literal commands and output below.

## Task Commits

1. **Tasks 1+2 combined: command + registration + PROV-02 tests** — `726849ad` (feat)

Both tasks were implemented and verified together in one commit: Task 1's command function and Task 2's cross-surface tests both live in the same two files (`verify-source-free.ts`/`.test.ts`), and splitting would have left an intermediate commit with a registered-but-untested command — not a meaningful standalone state, mirroring 179-01's own combined-commit rationale.

## Files Created/Modified

- `src/cli/commands/verify-source-free.ts` — added `verifySourceFreeCheckCommand` and its `VerifySourceFreeCheckOptions` type; added `resolve` (`node:path`) and `chalk` imports.
- `src/cli/commands/verify-source-free.test.ts` — added `describe('verifySourceFreeCheckCommand')` (6 tests) and `describe('PROV-02 data flow — source-free project')` (4 tests); imported `verifySourceFreeCheckCommand`, `computeVerificationScope`, `renderVerifiedAgainst`, and `vi`.
- `src/cli/cli.ts` — added the `verifySourceFreeCheckCommand` import and the `verify-source-free-check` registration block (with its no-bypass-flag comment) between `verify-example-translate` and the `verify-example-emit` block.

## Decisions Made

- See `key-decisions` in frontmatter. The `--force` substring collision with `verify-impact.test.ts`'s pre-existing cli.ts-scanning test is the one deviation worth flagging explicitly — see Deviations below.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Registration comment's literal `--force`/`--assume-full`/`--force-scope` substring broke an unrelated pre-existing test's scoped byte-range scan**
- **Found during:** Full-suite verification (`npx vitest run`) after the first green run of `verify-source-free.test.ts` and `chunk-provenance.test.ts` alone.
- **Issue:** `verify-impact.test.ts`'s `describe('cli.ts — verify-impact-* registration')` test slices `cli.ts` between the literal string `verify-impact-gate'` and the comment `// Claude Code integration`, and asserts that slice contains none of `['--force', '--yes', '--skip-gate', '--clear']` — a bypass-flag sentinel for a completely different command family. The new `verify-source-free-check` registration block (inserted between `verify-example-translate` and `verify-example-emit`, which sits inside that scanned range) named `--force`/`--assume-full`/`--force-scope` literally in its explanatory comment, to state which flags do NOT exist. That literal substring made the pre-existing test fail even though no actual `--force` option was ever registered.
- **Fix:** Reworded the comment to describe the absence without spelling the literal flag name (`"NO --source-free, no forcing flag, no --assume-full, and no scope-override option"`), preserving the same decision-1/T-179-06 documentation intent without the collision.
- **Files modified:** `src/cli/cli.ts`
- **Verification:** `npx vitest run` — full suite green (see Test Counts below); `verify-impact.test.ts`'s registration test passes unchanged.
- **Committed in:** `726849ad` (single combined commit — fixed before the first commit, never landed broken)

---

**Total deviations:** 1 auto-fixed (1 bug, caught by the full-suite run before committing — never landed in a separate broken commit).
**Impact on plan:** No scope creep; a pure wording fix that preserves the plan's own acceptance criterion (`grep -v '^\s*//' ... | grep -c -- "--assume-full\|--source-free\|--force-scope"` returns 0) while also respecting a pre-existing, unrelated test's scan boundary.

## Issues Encountered

None beyond the deviation above.

## Verification — the literal commands run

**Build:**
```
npm run build:cli
```
Output: `dist/cli.js  1.1mb`, built with esbuild, 19-23ms.

**Registration reachable through the real entry point:**
```
node dist/cli.js verify-source-free-check --help
```
```
Usage: boardsmith verify-source-free-check [options]

Report a project's verification mode (full or source-free), its reduced scope
and reason when reduced, and every designer-facing defect class that goes
unchecked as a result (read-only, source-free by construction,
machine-readable, exits 0 unconditionally)

Options:
  --project <dir>  Project directory (defaults to cwd)
  --json           Emit JSON instead of human-readable output
  -h, --help       display help for command
```
No `--run-id`, `--source-free`, `--force`, or `--assume-full` option listed.

**Full-scope real project (`~/BoardSmithGames/seven`, source archive present):**
```
node dist/cli.js verify-source-free-check --project ~/BoardSmithGames/seven
```
```
✓ Full scope — every pipeline step runs; nothing is skipped.
  4 source-free check(s) among the steps that ran:
    - trace-check (CHECK-03)
    - drift-check (CHECK-05)
    - verify-derive-check (CHECK-04)
    - verify-example-replay (CHECK-06)
```
`EXIT: 0`.

**Staged source-free project** (decision 9's method: `cp -R ~/BoardSmithGames/seven` into the session scratchpad, then `rm -rf rulebook/source` on the COPY only — the original `seven/` was never written to, confirmed by `git status --short` in `~/BoardSmithGames` before and after showing no change to `seven/` beyond its pre-existing untracked state):
```
node dist/cli.js verify-source-free-check --project <scratch>/seven-source-free
```
```
⚠ Source-free mode — scope: code-conformance-only (source-missing)
  5 of 10 pipeline step(s) run; 5 skipped for lack of input.
  4 source-free check(s) still run:
    - trace-check (CHECK-03)
    - drift-check (CHECK-05)
    - verify-derive-check (CHECK-04)
    - verify-example-replay (CHECK-06)
  5 defect class(es) go unchecked:
    - rulebook-fidelity drift between the live rules text and the source rulebook — would have been caught by the staging-dispatch re-transcription pass
    - wording-change-versus-rules-change discrimination in the live text — would have been caught by the classification-dispatch pairwise comparison
    - unadjudicated contradictions and cross-chunk rules-staleness — would have been caught by the adjudication gate and its impact map
    - a recorded ruling that no longer matches the current source — would have been caught by the ruling-recheck dispatch against fresh staged text
    - a stale chunk left unrepaired through the build-pipeline audit lenses — would have been caught by the repair-dispatch audit-and-repair loop
```
`EXIT: 0` — `--json` on the same staged fixture also exited 0 and printed one parseable JSON object with `sourceFree: true`, `scope: "code-conformance-only"`, `reason: "source-missing"`.

Scratch copy deleted after the manual proof; the real command's own automated tests (below) reproduce this same reduced-scope path against temp-dir fixtures, so this manual run exists to prove the entry point, not to be the only evidence of the behavior.

## How the PROV-02 test asserts through the REAL renderer

`describe('PROV-02 data flow — source-free project')` (4 tests) never hand-builds an expected string. Each test:
1. Builds a real fixture on disk (`fs.mkdtemp` + `renderIndex()`/a hand-reproduced pre-Phase-170 `INDEX.md`, reusing `chunk-provenance.test.ts`'s own fixture shapes rather than forking a second copy).
2. Calls the real, unmodified `computeVerificationScope(project)` from `chunk-provenance.ts`.
3. Passes that real result's `scope`/`reason`/`edition`/`sourceHash` fields into the real, unmodified `renderVerifiedAgainst(record)` from `chunk-provenance.ts`, and asserts against the STRING IT RETURNS (`.toContain('code-conformance-only')`, `.split('\n').some((l) => l.startsWith('Reason:'))`, `.toContain('Reason: source-missing')`, etc.) — never a doc-comment claim about what it "should" emit.
4. Cross-asserts `computeSourceFreeReport(project).reason === computeVerificationScope(project).reason` (and `.scope ===`) for both source-free fixtures, and additionally asserts `verifySourceFreeCheckCommand`'s own `--json` return agrees with both, so a future divergence between the CLI surface, the pure report function, and the durable-block renderer fails in this test file, not in a live proof run.

Both real source-free reasons are covered: `source-missing` (an `INDEX.md` with a recorded `Source:`/`Source hash:` but no archived file) and `pre-provenance-project` (no `Source hash:` line at all — the reference games' real pre-Phase-170 shape). The full-scope fixture asserts the INVERSE: `renderVerifiedAgainst`'s output contains no line starting with `Reason:` at all.

## Test Counts

- **Before (measured baseline, matches 179-01's reported figure):** 4335 tests / 248 files, 0 failing.
- **After:** 4345 tests / 248 files, 0 failing (`npx vitest run`, full suite).
- **Delta:** +10 tests, +0 files — all new tests added to the existing `verify-source-free.test.ts`; zero regressions.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**For plan 179-03 (durable `verify-close-record` write, wiring `/bs-verify-game`'s Close to `chunk-check`):**
- `verify-source-free-check` is the CLI surface a skill dispatches to LEARN the mode/scope/reason/unchecked-list; it does not itself write anything. 179-CONTEXT.md's measured_reality #2 (corrected) established that the durable `## Verified Against` block is written by exactly ONE function, `chunkCheckCommand` (`chunk-provenance.ts:432`, `boardsmith chunk-check <slug>`), and every current call site is in the BUILD pipeline — `/bs-verify-game` never reaches it today. Wiring that dispatch is 179-03's job, unchanged by this plan.
- `renderVerifiedAgainst`/`computeVerificationScope`/`chunkCheckCommand` were read and exercised (via the PROV-02 tests) but NOT modified in this plan, per the phase's out-of-scope boundary (wave 3's write path).
- `VerifiedAgainstRecord`'s shape (`scope`, `reason?`, `edition?`, `sourceHash?`, `boardsmithVersion`, `skillsTreeHash`, `citedSlices`, `unresolved`, `reverifiedNoCodeChange?`) is confirmed live-exercised now — 179-03's Close-wiring work can build a real record from `computeVerificationScope`'s own return the same way this plan's tests do, with no surprises about which fields are optional/omitted.
- `verify-source-free-check`'s `--json` output is the exact shape (`sourceFree`, `scope`, `reason`, `stepsRun[]`, `stepsSkipped[]`, `uncheckedDefectClasses[]`, `checksRun[]`) 179-03/179-04 should format from — no re-derivation needed at the skill layer.

## Self-Check: PASSED

- FOUND: `src/cli/commands/verify-source-free.ts` (modified, `verifySourceFreeCheckCommand` present)
- FOUND: `src/cli/commands/verify-source-free.test.ts` (modified, new describe blocks present)
- FOUND: `src/cli/cli.ts` (modified, `verify-source-free-check` registration present)
- FOUND commit `726849ad` in `git log --oneline --all`
- FOUND: `verify-source-free-check` reachable via `node dist/cli.js verify-source-free-check --help` after `npm run build:cli`

---
*Phase: 179-source-free-verification-mode*
*Completed: 2026-08-01*
