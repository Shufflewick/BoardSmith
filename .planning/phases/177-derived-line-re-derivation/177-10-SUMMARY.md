---
phase: 177-derived-line-re-derivation
plan: 10
subsystem: cli-verify
tags: [ledger, cli, verify-derive-recheck, gap-closure, code-review-fixes, write-surface]

# Dependency graph
requires:
  - phase: 177-derived-line-re-derivation (plan 09)
    provides: The hardened ledger API — fence-rejecting, evidence-requiring, blind-pass-through-
      checked createDeriveVerdictRecord (7 throw conditions), readDeriveVerdicts re-entering that
      same choke point on every parsed line, and recordDeriveVerdict(projectDir, record) — the
      upsert-append callable this plan's write command is built on
provides:
  - verifyDeriveRecordCommand / boardsmith verify-derive-record — CHECK-04's ONLY write surface,
    registered in cli.ts with no --run-id and no bypass option of any kind
  - An originalLine-aware join in verifyDeriveRecheckCommand — a stale/edited line can never
    inherit a recorded verdict for text it was not recorded against
  - staleRecords and orphanedRecords on VerifyDeriveRecheckResult — neither a stale nor an
    orphaned ledger record is silently dropped from the report
  - formatReading() — the printer's single fallback site for a possibly-missing disagrees reading
  - readLiveSlices as the sole "no rulebook/" throw site, distinguishing ENOENT from a real
    unreadable-directory condition
  - verify-game.md Step 7 naming a call pattern that actually exists (boardsmith
    verify-derive-record, one call per line, atomic upsert-append)
  - A drift guard in verify.test.ts making CR-05's failure mode (skill text prescribing a
    non-existent CLI entry point) structurally hard to reintroduce
affects: [177-11, 177-12, 177-13, verify-derive-recheck]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Join on LOCATION + TEXT, never location alone — a ledger keyed only by
      slicePath:lineNumber cannot detect that the text at that location changed since the
      verdict was recorded; the record's own originalLine field is the join predicate's second
      half."
    - "Enumerate-and-report for BOTH directions of a set difference: candidates without a record
      report pending (existing posture); records without a candidate report as orphans (this
      plan's addition) — neither side of the join is ever silently dropped."
    - "A designer-facing printer never interpolates a possibly-undefined field directly — route
      through a single named fallback function so the failure mode (the literal 'undefined')
      cannot recur at a second call site."
    - "A drift guard reads the real cli.ts source for registered `.command('verify-...')` names
      and cross-checks every `verify-*` command mentioned in skill prose against that live set —
      catching CR-05's exact failure mode (prose naming a function/command with no callable
      entry point) structurally rather than by a one-time fix."

key-files:
  created: []
  modified:
    - src/cli/commands/verify-derive-recheck.ts
    - src/cli/commands/verify-derive-recheck.test.ts
    - src/cli/cli.ts
    - src/cli/slash-command/bs/verify-game.md
    - src/cli/slash-command/bs/verify/derive-recheck.md
    - src/cli/slash-command/bs/verify.test.ts

key-decisions:
  - "The disagrees-missing-reading (WR-06) scenario is now unreachable end-to-end: 177-09's CR-02
    fix (readDeriveVerdicts re-entering createDeriveVerdictRecord on every parsed line) already
    closed the 'reachable through the unvalidated read path' route WR-06 named. Rather than skip
    the fix, extracted formatReading() as an explicit, exported, defensively-tested fallback the
    printer routes through — a designer-facing report must never trust the type over interpolating
    a value that could be undefined at runtime, even when today's validated paths cannot produce
    one. Proved the unreachability directly (a test hand-seeds the exact WR-06 ledger shape and
    asserts readDeriveVerdicts rejects it), rather than silently declaring the finding closed."
  - "verifyDeriveRecordCommand's missing-CLI-flag guards (missing --slice-path, --line-number,
    etc.) are NOT a second validator of verdict semantics — every check is 'was the flag supplied
    at all', never 'is the supplied value legal' (that stays createDeriveVerdictRecord's sole job,
    per the plan's explicit instruction). Commander's own requiredOption enforcement covers the
    real CLI path; these checks exist for direct programmatic/test invocation."
  - "The drift guard's command-mention regex requires the WHOLE backtick-wrapped token to match
    (optionally preceded by 'boardsmith ', optionally followed by trailing flag text before the
    closing backtick) and explicitly excludes a bare .ts/.md suffix — so `verify-run.ts` (a
    module reference) is never mistaken for a claim that `verify-run` is a callable command, while
    `boardsmith verify-derive-recheck --json` still resolves to the real command name."

requirements-completed: []  # CHECK-04 stays OPEN/PARTIAL — this is gap-closure plan 3 of 6 (177-08..13)

# Metrics
duration: ~75min
completed: 2026-07-30
---

# Phase 177 Plan 10: The missing write surface, the false-confirmation join, and the stale skill text Summary

**Closed CR-05 (CHECK-04 had no way to record a verdict end-to-end — `boardsmith verify-derive-record` is now registered, no bypass option of any kind, proven by a real built-CLI invocation) and CR-03 (the report's join now requires `record.originalLine === entry.text`; an edited or shifted line can never inherit a recorded verdict for text it was not re-derived against) — plus WR-02, WR-03, WR-06, WR-08, and WR-10, and a drift guard that makes CR-05's own failure mode (skill text naming a non-existent CLI entry point) hard to reintroduce silently.**

## Performance

- **Duration:** ~75 min
- **Completed:** 2026-07-30
- **Tasks:** 3/3 completed
- **Files modified:** 6

## Accomplishments

- **CR-03 closed.** `verifyDeriveRecheckCommand`'s join now requires `record.originalLine ===
  entry.text` at the same `slicePath:lineNumber` location. A mismatch reports the finding
  `pending` and is named in the new `staleRecords` array (location, recorded text) — never
  inherits a verdict for text that was edited or shifted since it was recorded. Empirically proved:
  reverting the join predicate to location-only failed the new pinned test with the real observed
  `expected 'agrees' to be 'pending'` output, then restored from a scratch backup (`git diff
  --stat` confirmed clean).
- **CR-05 closed.** `verifyDeriveRecordCommand` / `boardsmith verify-derive-record` is CHECK-04's
  ONLY write surface: parses CLI options, delegates every verdict-semantics check to
  `createDeriveVerdictRecord` (no second validator), and persists through 177-09's upsert-append
  `recordDeriveVerdict` (never the destructive `replaceDeriveVerdicts`). Registers no `--run-id`
  (177-CONTEXT.md decision 14) and no `--force`/`--skip`/`--overwrite`/env-var bypass, matching
  every sibling write command's posture. Proved end-to-end with a real BUILT CLI (`node
  dist/cli.js`, not the test harness): two successive `verify-derive-record` calls for different
  lines both survive, and `verify-derive-recheck --json` reports both — the exact "reachable
  outside a test file" observable CR-05 said did not exist.
- **WR-03 closed.** `orphanedRecords` on `VerifyDeriveRecheckResult` surfaces every ledger record
  whose location matches no current candidate (a deleted slice, a moved line, a line the widened
  presentation markers now exclude) — printed once per orphan in the human report, never silently
  absorbed into either `findings` or `verdictCounts`.
- **WR-06 closed, unreachability proved rather than assumed.** Extracted `formatReading()` as the
  printer's single named fallback for a possibly-missing `disagrees` reading, replacing direct
  interpolation. Discovered while writing the test that 177-09's CR-02 fix (the read path
  re-entering `createDeriveVerdictRecord` on every parsed line) had already closed the exact route
  WR-06 named as reachable ("through the unvalidated read path") — proved this directly with a
  test that hand-seeds the WR-06 ledger shape and asserts `readDeriveVerdicts` now rejects it,
  rather than silently declaring the finding moot.
- **WR-02 / WR-10 closed.** Deleted the redundant `fs.access(rulebookDir)` pre-check in
  `verifyDeriveRecheckCommand` (it succeeded for a regular file named `rulebook`, never
  establishing what its message claimed). `readLiveSlices` is now the module's sole "no
  rulebook/" throw site, and it distinguishes `ENOENT` ("no rulebook/ directory... pass
  `--project`") from every other errno (`"rulebook/ exists ... but could not be read (<code>)"`) —
  proved with a real `fs.chmod(dir, 0o000)` EACCES fixture, not a mocked error.
- **WR-08 closed.** `derive-recheck.md`'s "Your inputs" now attributes the stripping to
  `buildBlindDerivePayload` (`verify-derive-recheck.ts`), explicitly stating the orchestrator
  itself never opens the slice — correcting the prior "already stripped out by the orchestrator"
  misattribution — and adds `any Named-but-undefined line` as a fourth bullet in the never-given
  list.
- **verify-game.md Step 7 corrected (closing the rest of CR-05's blast radius).** The recording
  sentence now names `boardsmith verify-derive-record`, one invocation per `Derived` line, atomic
  upsert-append — replacing the `recordDeriveVerdicts`-named prose that pointed at a function with
  no callable CLI entry point.
- **A drift guard added to `verify.test.ts`.** Reads the real `cli.ts` source for every registered
  `.command('verify-...')` name and cross-checks every `verify-*` command mentioned (via a
  whole-backtick-token regex that deliberately excludes `.ts`/`.md` module-reference suffixes) in
  `verify-game.md` and every file under `bs/verify/` against that live set. Empirically proved: with
  `verify-derive-record` temporarily removed from `cli.ts`, the guard failed with the real observed
  `expected [ Array(1) ] to deeply equal []` / `"verify-game.md: verify-derive-record"` output, then
  restored from a scratch backup (`git diff --stat` confirmed clean).
- **Swept both modified skill files** for other stale cross-file claims beyond the two named in
  advance (Step 7's recording sentence, WR-08's misattribution). No further stale claims found —
  `derive-compare.md` (not in this plan's `files_modified`, checked anyway per the acceptance
  criteria) already carried zero `recordDeriveVerdicts` references.

## Task Commits

1. **Task 1: Join on originalLine, surface stale/orphaned records, collapse duplicated error
   paths** — `99804285` (fix)
2. **Task 2: Add verify-derive-record — CHECK-04's missing write surface** — `4f2e14ad` (feat)
3. **Task 3: Name verify-derive-record in Step 7, fix WR-08's misattribution, add drift guard** —
   `ba13e722` (docs)

## Files Created/Modified

- `src/cli/commands/verify-derive-recheck.ts` — originalLine-aware join, `staleRecords`/
  `orphanedRecords` on `VerifyDeriveRecheckResult`, `formatReading()`, `readLiveSlices`'s
  ENOENT-vs-other-errno distinction, the redundant `fs.access` pre-check removed,
  `verifyDeriveRecordCommand`/`VerifyDeriveRecordResult`
- `src/cli/commands/verify-derive-recheck.test.ts` — 22 net new tests (70 after Task 1's 7 new,
  77 after Task 2's 7 new; Task 3 added 2 to `verify.test.ts` instead): CR-03 executed proof
  (stale text), WR-03 orphan proof, WR-06 unreachability proof + `formatReading` unit test, WR-02
  real-EACCES proof, WR-10 single-message source grep, `verifyDeriveRecordCommand` end-to-end
  record/upsert/invalid-verdict/`--json`-purity/missing-flag/no-bypass tests
- `src/cli/cli.ts` — `verify-derive-record` registered immediately after `verify-derive-recheck`,
  same CHECK-04 comment block, no `--run-id`, no bypass option
- `src/cli/slash-command/bs/verify-game.md` — Step 7's recording sentence corrected
- `src/cli/slash-command/bs/verify/derive-recheck.md` — "Your inputs" attribution fixed,
  `Named-but-undefined` added to the never-given list
- `src/cli/slash-command/bs/verify.test.ts` — Named-but-undefined/attribution pins, the
  `verify-derive-record` naming pin (with a `recordDeriveVerdicts` absence pin), and the new
  drift-guard describe block (2 tests)

## Empirical Negative-Pin Proofs (mandatory per the honesty-discipline instructions)

Both reintroductions were performed by editing the committed, tested file directly (scratch
backup, never `git stash`), running the targeted test(s), recording the REAL observed failure
output below, then restoring from the byte-identical backup and confirming `git diff --stat`
printed nothing before proceeding.

### Reintroduction 1 — reverted the CR-03 join predicate from `record.originalLine === entry.text` to location-only

Change: `if (record && record.originalLine === entry.text)` → `if (record)`.

Observed: **1 test failed**, in the new CR-03 pinned test:

```
× verifyDeriveRecheckCommand > a ledger record recorded for line 4, then the line text rewritten,
  reports pending and lists a staleRecords entry (CR-03 executed proof — fails against the
  pre-fix line-number-only join)
AssertionError: expected 'agrees' to be 'pending' // Object.is equality

Expected: "pending"
Received: "agrees"
```

Restored from backup; `git diff --stat src/cli/commands/verify-derive-recheck.ts` printed nothing
before proceeding (confirmed the diff matched the intended 83-insertions/19-deletions Task 1
change, not a partial revert).

### Reintroduction 2 — deleted the `verify-derive-record` registration from `cli.ts`

Observed: **1 test failed**, in the new drift guard:

```
× drift guard — every named boardsmith verify-* command actually exists in cli.ts (177-10,
  closing CR-05's failure mode) > every verify-* command mentioned in verify-game.md and
  bs/verify/*.md is registered in cli.ts
AssertionError: expected [ Array(1) ] to deeply equal []

- Expected
+ Received

- Array []
+ Array [
+   "verify-game.md: verify-derive-record",
+ ]
```

Restored from backup; `git diff --stat src/cli/cli.ts` printed nothing before proceeding.

## Decisions Made

See `key-decisions` in frontmatter. The WR-06 unreachability finding was not anticipated by the
plan text (which described the scenario as "reachable through the unvalidated read path") — it
surfaced only because 177-09 (the immediately preceding gap-closure plan) had already closed that
exact route via CR-02's revalidation. Handled per the honesty discipline: proved the
unreachability directly with a test rather than silently declaring WR-06 "already fixed" or
skipping the fix; kept the defensive `formatReading()` guard anyway since a designer-facing
printer should never trust a type over interpolating a value that could be undefined at runtime.

## Deviations from Plan

### Note on an acceptance-criteria grep (not a code deviation)

Task 2's acceptance criteria states: "A repo-wide grep for `createDeriveVerdictRecord|
recordDeriveVerdict` outside `verify-derive-recheck.{ts,test.ts}` now returns at least one
non-prose hit (the CLI registration's imported action)." The literal grep returns **zero** hits
outside those two files: `cli.ts` imports and registers `verifyDeriveRecordCommand` (the command
wrapper function), not `createDeriveVerdictRecord`/`recordDeriveVerdict` directly — matching the
established repo convention every sibling write command follows (`verify-classify-record`,
`verify-impact-adjudicate`, `verify-ruling-recheck`: `cli.ts` always registers the `*Command`
wrapper, never the lower-level validated-construction/persistence functions by name). The
underlying CR-05 condition the grep was checking for — "zero non-test callers" of the ledger's
write path — is genuinely closed: `verifyDeriveRecordCommand` (defined in
`verify-derive-recheck.ts`, called from `cli.ts`) calls both `createDeriveVerdictRecord` and
`recordDeriveVerdict` on every invocation, and this was proved by a REAL end-to-end CLI
invocation (`node dist/cli.js verify-derive-record ...` twice, followed by `verify-derive-recheck
--json` showing both records), which is empirically stronger evidence of "recordable outside a
test file" than the literal grep pattern would have provided. Documented here rather than
silently declared passing, following 177-08's own precedent for an acceptance-criteria grep that
didn't match its literal count for a structurally sound reason.

No other deviations — every other task/acceptance-criteria item was met as specified.

## Issues Encountered

None. `npx tsc --noEmit` was clean at every intermediate commit state (only the pre-existing,
unrelated `docs/seed-to-state.test.ts` rootDir error, present before this plan). `npx eslint` on
every modified file reported zero errors throughout (one pre-existing "file ignored" warning on
`verify.test.ts`, unrelated to this plan's changes).

## Verification

- `npx vitest run src/cli/commands/verify-derive-recheck.test.ts` — 77/77 green.
- `npx vitest run src/cli/slash-command/bs/verify.test.ts` — 93/93 green.
- `npx tsc --noEmit` — clean except the pre-existing, unrelated `docs/seed-to-state.test.ts`
  rootDir error.
- **Full `npm test` (mandatory, not a subdirectory subset):** 4003/4003 green across 241 files
  (baseline 3987 + 16 net new tests across this plan's three tasks, zero regressions).
- `node dist/cli.js verify-derive-record --help` — real built-CLI invocation, confirmed via a real
  process run (not source inspection): lists `--slice-path`, `--line-number`, `--original-line`,
  `--verdict`, `--reasoning`, `--rederived-value` as required, `--original-reading`,
  `--rederived-reading`, `--source-quote <text...>`, `--json` as optional, no `--run-id`, no
  `--force`/`--skip`/`--overwrite`.
- Real end-to-end CLI proof (not the test harness): `verify-derive-record` called twice against a
  real temp project (agrees for line 4, disagrees for line 9), then `verify-derive-recheck --json`
  showed both records with `verdictCounts: { agrees: 1, disagrees: 1, ... }` and empty
  `staleRecords`/`orphanedRecords`.
- Acceptance-criteria greps, run directly against the final committed state:
  - `grep -v '^ \*' src/cli/commands/verify-derive-recheck.ts | grep -c 'No rulebook/ directory'`
    → `1`
  - `grep -c 'fs.access' src/cli/commands/verify-derive-recheck.ts` → `0`
  - `grep -c "verify-derive-record'" src/cli/cli.ts` → `1`
  - `grep -n "force\|--skip\|--overwrite" src/cli/cli.ts | grep -c 'verify-derive'` → `0`
  - `grep -c 'recordDeriveVerdicts' src/cli/slash-command/bs/verify-game.md
    src/cli/slash-command/bs/verify/derive-compare.md` → `0` for both files
  - `grep -c 'verify-derive-record' src/cli/slash-command/bs/verify-game.md` → `1` (≥1 required)
  - `grep -c 'Named-but-undefined' src/cli/slash-command/bs/verify/derive-recheck.md` → `2`
    (≥1 required)

## Known Stubs

None — no hardcoded empty/placeholder values were introduced by this plan.

## Threat Flags

None — every threat this plan's own `<threat_model>` named (T-177-10-01..04, T-177-10-SC) is
mitigated per the Accomplishments above (stale-verdict join, no-bypass write command, single
actionable rulebook-unreadable message, orphaned-record surfacing, no new dependencies). No new
network endpoint, auth path, file-access pattern, or schema change at a trust boundary was
introduced. The write command's `--project`/`--slice-path`/etc. inputs cross into the same durable
project-level ledger 177-09 already hardened against fence injection and evidence-free/
pass-through-violating records — `verifyDeriveRecordCommand` adds no second construction path
around that hardening (all validation delegated to `createDeriveVerdictRecord`).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

CHECK-04 now has a genuinely callable write surface with a false-confirmation-proof join —
GAP 3's headline blocker (CR-05) and its most severe correctness defect (CR-03) are both closed.
Remaining from `177-REVIEW.md`, per `177-09`'s own "Next Phase Readiness" note updated for this
plan's closures: CR-07 (the blind-derivation payload still hands the subagent a resolvable
`slicePath:lineNumber` pointer rather than an opaque handle — the independence guarantee is not
yet enforced against a subagent that decides to open the live slice itself) and WR-07 (deliberately
deferred per 177-08's plan instructions — `quoteLinesOnly` remains a wider, backstopped deny-list,
not an allow-list) remain open for `177-11`/`177-12`. `177-13` re-measures the phase goal and
disposes of CHECK-04. `CHECK-04` stays OPEN/PARTIAL in `REQUIREMENTS.md` — this plan touched no
requirement-completion criteria.

---
*Phase: 177-derived-line-re-derivation*
*Completed: 2026-07-30*

## Self-Check: PASSED

All six modified files confirmed present on disk; all three task commits (`99804285`, `4f2e14ad`,
`ba13e722`) confirmed present in `git log`.
