---
phase: 179-source-free-verification-mode
plan: 01
subsystem: testing
tags: [verify-game, source-free, cli, vitest, defect-classes]

requires:
  - phase: 171-provenance-and-scope
    provides: "computeVerificationScope(projectDir) / SCOPE_FULL / SCOPE_CODE_ONLY / SCOPE_REASONS in chunk-provenance.ts"
  - phase: 172-source-free-checks
    provides: "trace-check (CHECK-03) and drift-check (CHECK-05), source-free by construction"
  - phase: 177-derive-check
    provides: "verify-derive-check (CHECK-04), source-free by construction"
  - phase: 178-worked-example-tests
    provides: "verify-example-replay (CHECK-06), source-free via QuoteVerifiedProvenance degradation"
provides:
  - "VERIFY_PIPELINE_STEPS — the one frozen step->defect-class mapping covering all 10 verify-game.md steps"
  - "SOURCE_FREE_ADDITIONAL_CHECKS — trace-check/CHECK-03 and drift-check/CHECK-05, the two checks not dispatched by a numbered step"
  - "computeSourceFreeReport(projectDir) — pure, disk-state-only mode/scope/unchecked-list computation"
  - "Decision 7's falsifiable coverage test, demonstrated live (see 'Decision 7 Demonstration' below)"
affects: [179-02-verify-source-free-cli, 179-03-wiring-close, 179-04-skill-prose]

tech-stack:
  added: []
  patterns:
    - "Single frozen mapping (VERIFY_PIPELINE_STEPS) parsed and cross-checked against verify-game.md's real ## Step N: headings at test time — never a hand-copied snapshot."
    - "stepsRun/stepsSkipped always partition VERIFY_PIPELINE_STEPS; a full-scope report runs everything, a source-free report only runs the 'runs' subset."
    - "computeSourceFreeReport delegates scope/reason entirely to computeVerificationScope — no second scope-derivation path, no override parameter."

key-files:
  created:
    - src/cli/commands/verify-source-free.ts
    - src/cli/commands/verify-source-free.test.ts
  modified: []

key-decisions:
  - "VerifyPipelineStep gained an optional `check?: SourceFreeCheck` field (not in the plan's literal behavior list) so Steps 7/8's command names could be derived into checksRun without a second literal list — satisfies task 2's 'no second literal list' constraint via Claude's-discretion module placement."
  - "checksRun is scope-invariant (always trace-check/drift-check/verify-derive-check/verify-example-replay) since all four are source-free by construction and run in both full and source-free scope — task 2's behavior text names 'the four source-free checks' without conditioning on scope, confirmed against 179-CONTEXT.md decision 2/measured_reality #3."
  - "wouldHaveBeenCaughtBy strings avoid CHECK-/VERIFY- ids entirely (not just defectClass, which the test enforces) — extending decision 6's 'not requirement IDs' spirit to both fields for consistency, even though only defectClass is mechanically tested."

requirements-completed: [VERIFY-09]

duration: 45min
completed: 2026-08-01
---

# Phase 179 Plan 01: Step->Defect-Class Mapping + computeSourceFreeReport() Summary

**One frozen `VERIFY_PIPELINE_STEPS` mapping (10 entries covering verify-game.md's Steps 0-9, 5 skipped source-free) plus a pure `computeSourceFreeReport()` derived entirely from `computeVerificationScope()`, backed by a coverage test whose falsifiability was demonstrated live, not claimed.**

## Performance

- **Duration:** ~45 min
- **Tasks:** 3 (executed as one coherent implementation pass — see Deviations)
- **Files modified:** 2 created, 0 modified

## Accomplishments

- `src/cli/commands/verify-source-free.ts` exports `VERIFY_PIPELINE_STEPS` (frozen, 10 entries, one per `## Step N:` heading in `verify-game.md`), `SOURCE_FREE_ADDITIONAL_CHECKS` (trace-check/CHECK-03, drift-check/CHECK-05), `computeSourceFreeReport(projectDir)`, and their supporting types.
- Steps 2-6 (`sourceFreeBehavior: 'skipped'`) each carry >=1 designer-facing `unchecked` entry (rulebook-fidelity drift, wording-vs-rules-change discrimination, contradiction adjudication/rules-staleness, stale-ruling re-validation, stale-chunk repair) — none names a step number or a requirement id.
- `computeSourceFreeReport` never re-derives scope/reason itself; it is a pure pass-through of `computeVerificationScope(projectDir)`, with `sourceFree = (scope === SCOPE_CODE_ONLY)` as the sole derivation.
- `verify-source-free.test.ts`'s decision-7 coverage test parses `verify-game.md`'s real `## Step N:` headings at test time and cross-checks both directions (forward and reverse drift), plus the empty/placeholder `unchecked` case, plus a single-declaration guard scanning `src/` for a second `VERIFY_PIPELINE_STEPS` declaration.
- The coverage test's failure was demonstrated live (not merely claimed) — see below.

## Task Commits

Tasks 1-3 were implemented and verified together, then committed as a single atomic unit, because the mapping (task 1) and `computeSourceFreeReport` (task 2) live in the same file and splitting the commit would have left an intermediate commit with a `.ts` file that either had no report function or a report function referencing an as-yet-uncommitted mapping — neither is a meaningful standalone state. Each task's own `<verify>`/`<acceptance_criteria>` were individually checked before combining (see below).

1. **Tasks 1-3 combined: mapping + report + coverage test** - `e9d24179` (feat)

**Plan metadata:** committed in this same summary-writing pass (see Final Commit below).

## Files Created/Modified

- `src/cli/commands/verify-source-free.ts` - `VERIFY_PIPELINE_STEPS`, `SOURCE_FREE_ADDITIONAL_CHECKS`, `computeSourceFreeReport()`, and their types (`VerifyPipelineStep`, `UncheckedDefectClass`, `SourceFreeCheck`, `SourceFreeUncheckedEntry`, `SourceFreeReport`)
- `src/cli/commands/verify-source-free.test.ts` - decision 7's coverage test (forward/reverse drift, empty-entry detection, id-ban regex, single-declaration guard) plus `computeSourceFreeReport` unit tests against temp-directory fixtures

## Decisions Made

- Added an optional `check?: SourceFreeCheck` field to `VerifyPipelineStep` (task 1's `<behavior>` list didn't name this field explicitly) so `computeSourceFreeReport`'s `checksRun` could derive Step 7/8's command names from the single `VERIFY_PIPELINE_STEPS` list rather than introducing a second literal list — this is the module-placement/wording discretion the plan explicitly leaves to the executor ("Module placement... provided there is exactly ONE definition").
- `checksRun` is computed the same way regardless of `sourceFree` (always the 4 source-free-by-construction checks), matching task 2's `<behavior>` wording literally ("lists the four source-free checks... with their command names," not conditioned on scope) and 179-CONTEXT.md's measured_reality #3 (all four run unconditionally, source-free by construction).
- `stepsRun`/`stepsSkipped` partition ALL of `VERIFY_PIPELINE_STEPS` in both scopes: full scope -> `stepsRun` = all 10, `stepsSkipped` = `[]`; source-free scope -> `stepsRun` = the 5 `'runs'` entries, `stepsSkipped` = the 5 `'skipped'` entries. This reading was required to satisfy task 2's own acceptance criterion ("`stepsRun` and `stepsSkipped`... together cover `VERIFY_PIPELINE_STEPS.length`") in the full-scope case, where the initial implementation (stepsRun = only 'runs'-behavior entries regardless of scope) would have left `stepsRun.length + stepsSkipped.length` under-counting in full scope. Caught and fixed before committing — see Deviations.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `stepsRun`/`stepsSkipped` did not partition `VERIFY_PIPELINE_STEPS` in the full-scope case**
- **Found during:** Implementing task 2, before any test was written against it — caught by re-reading task 2's own acceptance criterion ("stepsRun and stepsSkipped have zero intersection by id and together cover VERIFY_PIPELINE_STEPS.length") against a first draft that only ever populated `stepsRun` with `sourceFreeBehavior === 'runs'` entries, regardless of scope.
- **Issue:** In full scope, all 10 steps genuinely run (source is present and verified) — but the first draft would have reported `stepsRun.length === 5` (only the always-runs steps) with `stepsSkipped === []`, undercounting by 5 and violating the "together cover VERIFY_PIPELINE_STEPS.length" invariant.
- **Fix:** `stepsRun` now branches on `sourceFree`: full scope returns all 10 steps as `stepsRun`; source-free scope returns only the `'runs'`-behavior subset, with the `'skipped'`-behavior subset in `stepsSkipped`.
- **Files modified:** `src/cli/commands/verify-source-free.ts`
- **Verification:** `verify-source-free.test.ts`'s partition test (both full-scope and source-free-scope fixtures) passes.
- **Committed in:** `e9d24179` (single combined commit)

---

**Total deviations:** 1 auto-fixed (1 bug, caught before committing — never landed in a separate "broken" commit)
**Impact on plan:** No scope creep; the fix was required for the plan's own literal acceptance criterion to hold.

## Issues Encountered

None beyond the deviation above.

## Decision 7 Demonstration

Per the plan's explicit instruction, the coverage test's failure was **observed live**, not merely claimed:

**Step 1 — baseline:** `npx vitest run src/cli/commands/verify-source-free.test.ts` — 13 tests passed.

**Step 2 — the breaking edit:** appended to `src/cli/slash-command/bs/verify-game.md`:
```

## Step 10: Anything

Demonstration text.
```
(no matching `VERIFY_PIPELINE_STEPS` entry added)

**Step 3 — observed failure, verbatim:**
```
 FAIL  src/cli/commands/verify-source-free.test.ts > decision 7 — VERIFY_PIPELINE_STEPS coverage of the real pipeline > every ## Step N: heading in verify-game.md has a VERIFY_PIPELINE_STEPS entry
AssertionError: Step 10 ("Anything") has no VERIFY_PIPELINE_STEPS entry: expected undefined to be defined
 ❯ src/cli/commands/verify-source-free.test.ts:49:10
     47|       const entry = VERIFY_PIPELINE_STEPS.find((s) => s.step === headi…
     48|       expect(entry, `Step ${heading.step} ("${heading.title}") has no …
     49|         .toBeDefined();
       |          ^
     50|       expect(entry?.title).toBe(heading.title);
     51|     }
```
(A second, deliberately self-documenting test in the file — "DEMONSTRATED LIVE during 179-01 execution..." — also failed as expected, since it asserts the live file does not contain `## Step 10:`; that failure is expected collateral of the demonstration, not a defect.)

**Step 4 — revert:** `verify-game.md` restored byte-for-byte from a pre-edit backup (`diff` confirmed clean). `git status --short` after revert showed zero changes to `verify-game.md` at any point — the edit and revert both happened before any commit.

**Step 5 — confirmed green again:** `npx vitest run src/cli/commands/verify-source-free.test.ts` — 13/13 passed.

**Subtler case — empty/placeholder `defectClass` (also demonstrated live):** temporarily set Step 2's `defectClass` to `''` in the module (not committed), and re-ran the test file. Result:
```
 × decision 7 — VERIFY_PIPELINE_STEPS coverage of the real pipeline > no defectClass or wouldHaveBeenCaughtBy string is empty, and no defectClass names a step number or requirement id
   → Step 2 has an empty defectClass: expected 0 to be greater than 0
 × computeSourceFreeReport > source-free fixture: uncheckedDefectClasses has at least 5 entries, all with non-empty fields
   → expected 0 to be greater than 0
```
Both the direct field-emptiness assertion and the downstream `computeSourceFreeReport` unit test caught the placeholder — confirming the test catches "a step present with an EMPTY or placeholder defectClass," not merely a missing mapping entry. Reverted via backup copy; `diff` confirmed byte-identical to the committed version before proceeding.

## Test Counts

- **Before:** 4322 tests / 247 files, 0 failing (measured baseline, matches plan's stated figure).
- **After:** 4335 tests / 248 files, 0 failing (`npx vitest run`, full suite).
- **Delta:** +13 tests, +1 file — all new tests in `verify-source-free.test.ts`; zero regressions.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**For plan 179-02 (`verify-source-free-check` CLI wrapper):**
- `computeSourceFreeReport(projectDir)` is ready to consume: it is pure (no console output, no exit codes, no writes, no process concerns), takes exactly the project directory, and returns `SourceFreeReport { sourceFree, scope, reason?, stepsRun, stepsSkipped, uncheckedDefectClasses, checksRun }`.
- `uncheckedDefectClasses` entries are `{ defectClass, wouldHaveBeenCaughtBy, stepId }` — already flattened, in step order, ready to format directly; no further derivation needed in the CLI layer.
- `checksRun` is a flat `{ command, checkId }[]` of the four source-free-by-construction checks, present in every report regardless of scope — 179-02 should NOT re-filter this by scope; it already reflects "what runs," not "what's reduced."
- `VERIFY_PIPELINE_STEPS`/`SOURCE_FREE_ADDITIONAL_CHECKS` are exported and frozen — 179-02 should import and format them, never redeclare or re-derive any part of the mapping (this is exactly the drift-by-duplication failure the single-declaration guard test exists to catch).
- No CLI surface, no `boardsmith` command registration, and no skill prose changes were made in this plan — all three remain fully open for 179-02/179-03/179-04.
- `chunk-provenance.ts` and `verify-game.md` skill prose were both read but NOT modified in this plan, per the phase's out-of-scope boundary (wave 3/wave 4 territory).

## Self-Check: PASSED

- FOUND: `src/cli/commands/verify-source-free.ts`
- FOUND: `src/cli/commands/verify-source-free.test.ts`
- FOUND commit `e9d24179` in `git log --oneline --all`

---
*Phase: 179-source-free-verification-mode*
*Completed: 2026-08-01*
