---
phase: 177-derived-line-re-derivation
plan: 09
subsystem: cli-verify
tags: [ledger, cli, verify-derive-recheck, gap-closure, code-review-fixes]

# Dependency graph
requires:
  - phase: 177-derived-line-re-derivation (plans 01-08)
    provides: CHECK-04's mechanical core — DERIVE_VERDICTS enum, createDeriveVerdictRecord choke
      point, quoteLinesOnly/enumerateDerivedLines/buildBlindDerivePayload (decoration-tolerant,
      backstopped per 177-08), the project-level ledger
provides:
  - Fence-rejecting, evidence-requiring, blind-pass-through-checked createDeriveVerdictRecord
    (7 throw conditions, up from 4)
  - readDeriveVerdicts re-entering createDeriveVerdictRecord on every parsed line — the ledger
    is a second entry path into the type, never a bypass of it
  - recordDeriveVerdict(projectDir, record) — the upsert-append callable the write surface
    (177-10) will call; replaceDeriveVerdicts kept as the explicit, documented full-rewrite path
affects: [177-10, 177-11, 177-12, 177-13, verify-derive-recheck]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Read-path revalidation through the same construction choke point the write path uses —
      a ledger file is a second entry point into a validated type, not an escape hatch from it"
    - "Upsert-by-composite-key (slicePath:lineNumber) via read-merge-write through the single
      durable write path, matching the sibling ledger's append semantics
      (verify-classify.ts's appendLedgerLine) without introducing a second write primitive"
    - "Rename-to-replace + add-singular-upsert: the destructive full-rewrite function keeps its
      capability under an honest name (replaceDeriveVerdicts) while the easy/default path
      (recordDeriveVerdict) becomes the non-destructive one — pit-of-success ordering"

key-files:
  created: []
  modified:
    - src/cli/commands/verify-derive-recheck.ts
    - src/cli/commands/verify-derive-recheck.test.ts

key-decisions:
  - "rederivedValue made a REQUIRED input to createDeriveVerdictRecord (not optional) per the
    plan's own instruction — there were zero non-test callers, so the cost was entirely test-file
    updates (20 existing createDeriveVerdictRecord call sites across the test file needed the new
    field added to keep compiling), not a breaking change to any real caller."
  - "sourceQuotes required non-empty ONLY for agrees/disagrees, never for underivable/
    not-rule-bearing — an underivable verdict has legitimately nothing to cite (WR-05's own
    carve-out, pinned by a dedicated test)."
  - "The three new validation blocks (fence, sourceQuotes, pass-through) were placed AFTER the
    existing verdict-enum/reasoning/disagrees-reading checks, not interleaved, so existing test
    assertions about which error fires first stayed correct without needing to add sourceQuotes/
    rederivedValue-matching to every unrelated test — only the ones that reach the end of the
    validation chain needed the new fields to be semantically valid."
  - "replaceDeriveVerdicts kept exported (not deleted) as the one legitimate full-rewrite path —
    recordDeriveVerdict calls it internally, preserving exactly one durable write path in the
    module (grep-gated: zero fs.writeFile/writeFileSync call sites outside atomicWriteFile)."
  - "Narrowed the test description 'atomicWriteFile is the only durable write' to 'atomicWriteFile
    is the only durable FILE write' (WR-11) — fs.mkdir for the ledger directory is a real,
    accurate exception to the stronger claim, and the task's own action text offered this as the
    alternative to relocating the mkdir call."

requirements-completed: []  # CHECK-04 stays PARTIAL — this is gap-closure plan 2 of 6 (177-08..13)

# Metrics
duration: ~50min
completed: 2026-07-30
---

# Phase 177 Plan 09: Ledger integrity — fence injection, unvalidated read path, destructive recorder Summary

**Closed CR-04 (ledger fence injection via unescaped model-controlled reasoning), CR-02
(readDeriveVerdicts bypassing the single validation choke point), CR-06 (recordDeriveVerdicts
replacing the whole ledger on every call), WR-05 (evidence-free agrees/disagrees), and WR-04 (the
blind underivable/not-rule-bearing pass-through had no code cross-check) — the ledger API GAP 3's
write surface (177-10) will be built on is now fence-safe, revalidating, and non-destructive by
default.**

## Performance

- **Duration:** ~50 min
- **Completed:** 2026-07-30
- **Tasks:** 3/3 completed
- **Files modified:** 2

## Accomplishments

- `createDeriveVerdictRecord` now throws on 7 conditions (up from 4): the original 4 (out-of-enum
  verdict, empty reasoning, disagrees missing either reading) plus three new blocks — a
  `reasoning`/`originalReading`/`rederivedReading` carrying the ledger's own begin/end fence
  marker (CR-04); an `agrees`/`disagrees` verdict with no non-empty `sourceQuotes` entry (WR-05);
  and a `rederivedValue` (the blind stage's own return, now a required input) of
  `underivable`/`not-rule-bearing` paired with a differing `verdict` (WR-04). `rederivedValue` is
  persisted on `DeriveVerdictRecord` so the pass-through rule is auditable in the ledger, not only
  enforced in memory.
- `readDeriveVerdicts` no longer does `JSON.parse(l) as DeriveVerdictRecord` with zero validation.
  Every parsed ledger line now re-enters `createDeriveVerdictRecord`: a malformed-JSON line throws
  one actionable message naming the ledger's relative path and 1-based record index (never a raw
  `SyntaxError`); a valid-JSON-but-invalid record throws through the choke point's own checks —
  never coerced with a silent default. Zero `as DeriveVerdictRecord` casts remain in the module
  (grep-gated).
- `recordDeriveVerdicts` renamed to `replaceDeriveVerdicts` (kept exported as the explicit,
  documented full-rewrite path) and a new `recordDeriveVerdict(projectDir, record)` (singular)
  added: reads the existing ledger, upserts by `slicePath:lineNumber` (existing order preserved,
  the new/updated record appended last so the ledger diff stays reviewable), and writes the merged
  set through `replaceDeriveVerdicts` — so there is still exactly ONE durable write path in the
  module (grep-gated: zero `writeFile(` call sites outside `atomicWriteFile`). The callable
  `verify-game.md` Step 7's documented per-line recording pattern actually needs is now the
  non-destructive one — the pit-of-success inversion CR-06 called for.

## Task Commits

1. **Task 1: Harden the single construction choke point — reject fence markers, require evidence,
   and cross-check the blind pass-through** - `3bd52859` (feat)
2. **Task 2: Make the read path re-enter the same choke point** - `932944f4` (fix)
3. **Task 3: Replace the destructive recorder with an upsert-append callable** - `d773fc55` (fix)

_No plan-metadata commit is included in this list — it is created separately per the execution
protocol's final-commit step._

**Note on commit reconstruction:** all three tasks were authored in a single pass and then split
into task-scoped commits by reconstructing each intermediate state from git blob content (the
same "reconstructed as N task-scoped commits from a single authored pass" pattern documented in
177-02/177-03's summaries) — each intermediate state was independently `tsc --noEmit`-clean and
`vitest run`-green (55/55 after Task 1, 61/61 after Task 2, 64/64 after Task 3) before being
committed, not merely diffed and hoped correct.

## Files Created/Modified

- `src/cli/commands/verify-derive-recheck.ts` — `createDeriveVerdictRecord`'s three new validation
  blocks and `rederivedValue` field; `readDeriveVerdicts`'s per-line revalidation through the choke
  point; `replaceDeriveVerdicts`/`recordDeriveVerdict` split; module header doc updates
- `src/cli/commands/verify-derive-recheck.test.ts` — 20 net new tests (44 → 64): fence-rejection
  (3), sourceQuotes-requirement (4), blind-pass-through (3) tests in the `createDeriveVerdictRecord`
  describe block; a new `readDeriveVerdicts — revalidation through createDeriveVerdictRecord
  (CR-02)` describe block (6 tests: out-of-enum rejection, malformed-JSON actionable message,
  `verdictCounts` never gaining an out-of-enum key, the `as DeriveVerdictRecord` grep-gate, empty
  ledger, round-trip stability); 4 new upsert/append tests in the renamed
  `replaceDeriveVerdicts / recordDeriveVerdict / readDeriveVerdicts` describe block; every existing
  `createDeriveVerdictRecord`/ledger call site updated to supply the now-required `rederivedValue`
  (and `sourceQuotes` where the verdict is `agrees`/`disagrees`)

## Empirical Negative-Pin Proofs (mandatory per the honesty-discipline instructions)

All three reintroductions were performed by editing the committed, tested file directly (via a
scratch backup, not `git stash` — see `destructive_git_prohibition`), running the targeted test(s),
recording the REAL observed failure output below, then restoring from the byte-identical backup
and confirming `git diff --stat src/cli/commands/verify-derive-recheck.ts` printed nothing before
proceeding to the next reversion.

### Reintroduction 1 — deleted the CR-04 fence-rejection block from `createDeriveVerdictRecord`

Observed: **3 tests failed**:

```
× createDeriveVerdictRecord > throws when reasoning contains the ledger BEGIN fence marker,
  naming the field "reasoning"
  → expected [Function] to throw an error — Expected: null / Received: undefined

× createDeriveVerdictRecord > throws when reasoning contains the ledger END fence marker
  (CR-04, the corrupting shape)
  → expected [Function] to throw an error — Expected: null / Received: undefined

× createDeriveVerdictRecord > throws when originalReading or rederivedReading contains a
  ledger fence marker
  → expected [Function] to throw an error — Expected: null / Received: undefined
```

Restored from backup; `git diff --stat` printed nothing before proceeding.

### Reintroduction 2 — reverted `readDeriveVerdicts` to the pre-fix `JSON.parse(l) as DeriveVerdictRecord`

Observed: **4 tests failed** (60 passed), reproducing the reviewer's exact observed shape:

```
× readDeriveVerdicts — revalidation ... > rejects an out-of-enum verdict on read, never reaching
  a NaN/null verdict count (CR-02 executed proof)
  → expected promise to reject, but it resolved with
    [ { verdict: "TOTALLY-BOGUS", ... } ]

× readDeriveVerdicts — revalidation ... > a not-valid-JSON ledger line throws one actionable
  message naming the relative ledger path and record index, never a raw SyntaxError
  → Expected: "rulebook/.derive-recheck/DERIVE-VERDICTS.md"
    Received: "Expected property name or '}' in JSON at position 2 (line 1 column 3)"

× readDeriveVerdicts — revalidation ... > verdictCounts from verifyDeriveRecheckCommand never
  gains a key outside DERIVE_VERDICTS (previously reachable per CR-02)
  → promise resolved instead of rejecting:
    verdictCounts: { "TOTALLY-BOGUS": NaN, "agrees": 0, "disagrees": 0,
                      "not-rule-bearing": 0, "underivable": 0 }

× readDeriveVerdicts — revalidation ... > grep-count: no "as DeriveVerdictRecord" cast remains
  anywhere in the module
  → expected 1 to be 0
```

The `verdictCounts: { "TOTALLY-BOGUS": NaN, ... }` line is a byte-for-byte reproduction of
`177-REVIEW.md`'s CR-02 executed proof (`verdict: TOTALLY-BOGUS` → `NaN`/`null`), obtained
independently in this plan rather than assumed from the review text. Restored from backup;
`git diff --stat` printed nothing before proceeding.

### Reintroduction 3 — made `recordDeriveVerdict` call `replaceDeriveVerdicts([record])` directly (the pre-fix destructive shape)

Observed: **1 test failed** (63 passed):

```
× replaceDeriveVerdicts / recordDeriveVerdict / readDeriveVerdicts > recordDeriveVerdict called
  twice for DIFFERENT locations leaves BOTH records readable — the pattern that previously
  destroyed one (CR-06, fails against the pre-fix API)
  → expected [ { …(9) } ] to have a length of 2 but got 1
```

Restored from backup; `git diff --stat` printed nothing before proceeding. Full suite re-run after
final restore: `npx vitest run src/cli/commands/verify-derive-recheck.test.ts` → 64/64 passing.

## Decisions Made

See `key-decisions` in frontmatter. No decisions departed from the plan's own guidance — the plan
explicitly named the required-field cost ("costs nothing" for real callers, only test-file
mechanical updates) and the WR-11 wording-narrowing option, both of which were taken as specified.

## Deviations from Plan

None beyond the mechanical test-file updates the plan itself anticipated (making `rederivedValue`
required cascades to every existing `createDeriveVerdictRecord` call site in the test file — 20
sites needed the field added to keep compiling; this was named explicitly in the plan's task 1
action text, not discovered mid-execution).

## Issues Encountered

None. `npx tsc --noEmit` was clean at every intermediate commit state (Task 1, Task 2, Task 3), and
`npx eslint` reported zero errors on the modified files throughout.

## Verification

- `npx vitest run src/cli/commands/verify-derive-recheck.test.ts` — 64/64 green.
- `npx tsc --noEmit` — clean (only the pre-existing, unrelated `docs/seed-to-state.test.ts` rootDir
  error, present before this plan).
- **Full `npm test` (mandatory, per the orchestrator's explicit instruction, not a subdirectory
  subset):** 3987/3987 green across 241 files (baseline 3967 + 20 net new tests in this plan, zero
  regressions).
- Acceptance-criteria greps, run directly against the final committed state:
  - `grep -v '^ \*' src/cli/commands/verify-derive-recheck.ts | grep -c 'rederivedValue'` → `8`
    (≥ 3 required)
  - `grep -c 'as DeriveVerdictRecord' src/cli/commands/verify-derive-recheck.ts` → `0`
  - `grep -c 'recordDeriveVerdicts' src/cli/commands/verify-derive-recheck.ts` → `0` (plural name
    fully gone; `replaceDeriveVerdicts`/`recordDeriveVerdict` are what remain)
  - `grep -v '^ \*' src/cli/commands/verify-derive-recheck.ts | grep -c 'writeFile('` → `0`

## Known Stubs

None — no hardcoded empty/placeholder values were introduced by this plan.

## Threat Flags

None — this plan closes findings from the phase's own `177-REVIEW.md`; every file touched
(`verify-derive-recheck.ts`, `verify-derive-recheck.test.ts`) is already covered by that review's
threat model, and this plan's own `<threat_model>` (T-177-09-01..04) was fully mitigated (see
Accomplishments above; no new network endpoint, auth path, file-access pattern, or schema change at
a trust boundary was introduced).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

The ledger API is now safe for `177-10` to build a write surface on: it cannot be corrupted by
model-controlled text (CR-04 closed), cannot silently accept an invalid record from disk (CR-02
closed), and its default recording callable does not destroy prior verdicts (CR-06 closed).
`177-10` through `177-13` remain: CR-05 (no way to record a verdict end-to-end — the missing
`verify-derive-record` CLI command), CR-03 (verdicts joined by line number only, no staleness
detection on edited lines), CR-07 (the payload hands the blind subagent a resolvable file
path/line number), and the remaining warnings (WR-02, WR-03, WR-06, WR-07 deferred, WR-08, WR-10).
CHECK-04 stays OPEN/PARTIAL in `REQUIREMENTS.md` — this plan touched no requirement-completion
criteria.

---
*Phase: 177-derived-line-re-derivation*
*Completed: 2026-07-30*

## Self-Check: PASSED
