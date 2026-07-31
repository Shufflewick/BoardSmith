---
phase: 177-derived-line-re-derivation
plan: 11
subsystem: cli-verify
tags: [targeting, cli, verify-derive-recheck, gap-closure, goal-failure-fix, fact-alignment]

# Dependency graph
requires:
  - phase: 177-derived-line-re-derivation (plans 08-10)
    provides: The decoration-tolerant, backstopped, evidence-required, write-surface-complete
      CHECK-04 mechanical core this plan builds the targeting fix and factAlignment instrument on
      top of — annotationBody's single decoration-normalization site, the construction-site
      backstop, the seven-throw-condition createDeriveVerdictRecord choke point, and
      verifyDeriveRecordCommand as the ledger's only write surface.
provides:
  - blindDeriveHandle(entry) — an opaque sha256-truncated digest replacing the resolvable
    Slice:/Target line: pointer (closes CR-07)
  - focusQuoteWindow(sliceText, lineNumber) — quote-local passage narrowing that treats markdown
    headings as passage boundaries in addition to citation headers (the plan-checker's required
    fix, proven against the real fixture 01-definitions-and-components.md:33)
  - derivePayloadSet(slice, candidates) — the per-slice construction site that also computes
    targetingAmbiguous/sharedFocusWith, the mechanical residual instrument
  - factAlignment ('same-fact' | 'different-fact') — a required FIELD on agrees/disagrees
    DeriveVerdictRecords, never a fifth DERIVE_VERDICTS member (decision 6 held)
  - offTargetDisagreements/genuineDisagreements/targetingAmbiguousCount on
    VerifyDeriveRecheckResult, additive to the unchanged four-key verdictCounts
  - --fact-alignment on boardsmith verify-derive-record, same delegate-validation posture as
    every other optional field
  - Both CHECK-04 subagent contracts (derive-recheck.md, derive-compare.md) updated to the new
    payload shape and the new required return, with a drift guard one level deeper than 177-10's
    command-existence guard
affects: [177-12, 177-13, verify-derive-recheck]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Opaque handle instead of a resolvable coordinate — the target identifier a blind dispatch
      prompt carries is a sha256-truncated digest of (slicePath, lineNumber), never the path or
      number themselves; the mapping back lives with the orchestrator, outside the prompt."
    - "Passage boundaries are BOTH citation headers and markdown headings — a citation header
      found by walking upward from a target line only governs that target if no section heading
      intervenes; an intervening heading severs the passage and yields an honest degraded/empty
      focus window rather than silently attaching to a semantically unrelated preceding passage."
    - "A residual that cannot be resolved without leaking the withheld inference is reported
      per-finding (targetingAmbiguous/sharedFocusWith), never hidden behind a payload that merely
      looks different because its opaque handle always differs regardless of content."
    - "A measurement field is not a verdict — factAlignment answers a separate question from
      verdict and is validated/persisted alongside it, never foldecs into DERIVE_VERDICTS."
    - "A drift guard one level deeper than command-existence: every RETURN field a subagent
      contract declares must correspond to an accepted CLI option on the recording command,
      cross-checked from the two files' live text, not restated as a fixed list."

key-files:
  created: []
  modified:
    - src/cli/commands/verify-derive-recheck.ts
    - src/cli/commands/verify-derive-recheck.test.ts
    - src/cli/cli.ts
    - src/cli/slash-command/bs/verify/derive-recheck.md
    - src/cli/slash-command/bs/verify/derive-compare.md
    - src/cli/slash-command/bs/verify-game.md
    - src/cli/slash-command/bs/verify.test.ts

key-decisions:
  - "Task 1 and Task 2 were committed together in a single commit (3899120d) rather than as two
    separate task commits. Both tasks touch the exact same 2-3 files (verify-derive-recheck.ts/
    .test.ts, cli.ts) and the implementation was authored as one coherent pass because
    focusQuoteWindow (Task 1) and derivePayloadSet (Task 2) share the same focus-passage
    computation and are naturally interleaved in the file — factAlignment's validation sits right
    next to the pass-through check Task 1's neighboring code already touches. Splitting via
    interactive staging after the fact risked producing a mid-state that doesn't compile or pass
    tests on its own, which is worse than one honestly-scoped combined commit. Task 3 (the
    skill-text files) touches a fully disjoint file set and was committed separately (e10213d2)."
  - "focusQuoteWindow treats a markdown heading as a passage-severing boundary during the UPWARD
    walk from the target line, not just during the downward boundary search — this is the
    plan-checker's required fix. Without it, a target line separated from its nearest citation
    header by an intervening heading would silently attach to that header's (semantically
    unrelated) passage. Proven empirically: reverting just the upward-walk heading check made the
    pinned regression test (keyed to the real fixture 01-definitions-and-components.md:33) fail
    with the exact wrong-passage output the plan checker predicted."
  - "Two independently-degraded (empty-focus) candidates are never reported as sharing a focus
    passage with each other in derivePayloadSet — an empty focus is a 'could not be narrowed'
    signal, not proof two candidates are about the same fact. Only a real, non-empty, identical
    passage counts as a targeting collision. This is a deliberate design choice beyond what the
    plan's acceptance criteria explicitly tested, added because the alternative (treating all
    empty-focus candidates as mutually ambiguous) would manufacture false sharedFocusWith
    relationships between unrelated degraded lines."
  - "isQuoteLine was extracted as the single predicate quoteLinesOnly and focusQuoteWindow both
    route through, mirroring the module's own established annotationBody single-choke-point
    shape — never two independently-maintained notions of 'what counts as a quote line'."

requirements-completed: []  # CHECK-04 stays OPEN/PARTIAL — this is gap-closure plan 4 of 6 (177-08..13)

# Metrics
duration: ~110min
completed: 2026-07-30
---

# Phase 177 Plan 11: Opaque target handle, quote-local focus narrowing, and factAlignment Summary

**Closed CR-07 (the blind-derivation payload no longer hands the subagent a resolvable
`slicePath:lineNumber` pointer — `blindDeriveHandle` is now the ONLY target identifier a blind
prompt carries) and the phase's own self-reported goal failure from `177-PROOF.md` §3 (the
targeting-collapse where every multi-candidate slice in the real corpus re-derived the same
dominant fact regardless of nominal target) via `focusQuoteWindow`'s quote-local passage
narrowing — including the plan-checker's required fix treating markdown headings as passage
boundaries — plus the `factAlignment` instrument that mechanically separates a genuine content
disagreement from a targeting artifact.**

## Performance

- **Duration:** ~110 min
- **Completed:** 2026-07-30
- **Tasks:** 3/3 completed
- **Files modified:** 7

## Accomplishments

- **CR-07 closed.** `buildBlindDerivePayload` no longer emits `Slice: {path}` or
  `Target line: {path}:{lineNumber}` anywhere — `grep -c 'Slice: ' verify-derive-recheck.ts`
  returns 0. The ONLY target identifier a blind dispatch prompt carries is
  `blindDeriveHandle(entry)`, a stable sha256-truncated (12 hex char) digest of
  `${slicePath}:${lineNumber}`. The mapping back to `(slicePath, lineNumber)` lives with the
  orchestrator, never inside the prompt — a subagent with file-read tools has no path or line
  number in the payload to act on even if it tried. Empirically proven: reintroducing the old
  `Slice:`/`Target line:` lines failed 2 real tests with the exact leaked-coordinate output.
- **The phase's own measured goal failure addressed.** `focusQuoteWindow(sliceText, lineNumber)`
  partitions a slice's quote lines into the target's own citation passage (`focus`) and the rest
  (`rest`), walking upward from the target line to the nearest `p.N, <label>:` citation header,
  then downward through the line before the next citation header, markdown heading, or end of
  slice. Verified against the real 5-candidate `seven`/`01-definitions-and-components.md` slice
  (`177-PROOF.md`'s own cited collapse evidence): lines 8 and 14 (Set-example and Run-example
  illustrations) now get genuinely DIFFERENT focus passages; lines 19 and 21 (both about deck
  composition) correctly share ONE focus passage (a real collision, not a bug); line 33 gets the
  honest degraded empty-focus case.
- **The plan-checker's required fix implemented and pinned.** `focusQuoteWindow` treats markdown
  headings (`^#`) as passage boundaries during the UPWARD walk, not just as a downward boundary —
  a heading encountered before any citation header severs the target from whatever citation
  header sits above that heading. Proven against the exact fixture the plan checker cited
  (`174-FIXTURES/seven/live/01-definitions-and-components.md:33` — the `Derived (p.1): Card art is
  minimal...` line, severed from the nearest ABOVE citation header `p.1, Play Testers:` by the
  intervening `## Visual notes (p.1)` heading): the focus window is correctly empty, never the
  wrong-but-distinct Play Testers passage. Empirically proven by reverting: removing just the
  upward-walk heading check failed the pinned regression test with the real observed
  `expected [ 'p.1, Play Testers:', …(1) ] to deeply equal []` output — the exact wrong-passage
  bug the plan checker predicted, reproduced live.
- **`buildBlindDerivePayload` restructured** to emit the handshake token, `Target: {handle}`, and
  either (a) a labelled Focus-passage section plus a labelled Context section (when a passage was
  located), or (b) an explicit DEGRADED fallback naming that no passage could be located, followed
  by the full quote set as background context — never silently identical to the success case.
  `entry.text` remains structurally unread (asserted behaviorally, not by grep).
- **`derivePayloadSet(slice, candidates)` computes the mechanical residual.** For each candidate
  in a slice, it reports `sharedFocusWith` (other candidates sharing an identical NON-EMPTY focus
  passage) and `targetingAmbiguous` (true iff `sharedFocusWith` is non-empty). Two independently
  degraded (empty-focus) candidates are deliberately never reported as sharing a passage with each
  other — an empty focus means "could not be narrowed," not "proven to be the same fact." Verified
  against the real 5-candidate slice: lines 19/21 correctly flip `targetingAmbiguous: true` with
  `sharedFocusWith` naming each other; lines 8/14/33 correctly report `false`/`[]`.
- **`factAlignment` ('same-fact' | 'different-fact') added as a required FIELD, never a fifth
  verdict.** `DERIVE_VERDICTS` still has exactly 4 members (`grep -c "DERIVE_VERDICTS = Object.freeze"`
  returns 1; `DERIVE_VERDICTS.length` is still 4). `createDeriveVerdictRecord` throws on any
  `agrees`/`disagrees` record missing a valid `factAlignment`, and passes it through unchanged for
  `underivable`/`not-rule-bearing` (no rederived reading to align). Empirically proven: removing
  the validation block failed 3 pinned tests.
- **`VerifyDeriveRecheckResult` gains `offTargetDisagreements`, `genuineDisagreements`, and
  `targetingAmbiguousCount`**, all additive to the unchanged four-key `verdictCounts` shape (Phase
  179's consumer still gets the same shape it depends on). A `disagrees` + `different-fact` record
  increments `offTargetDisagreements` and NOT `genuineDisagreements`; both counts (and
  `targetingAmbiguousCount`) appear in `--json`, and the human-readable report prints both
  disagreement classes under separate headings plus a `TARGETING-AMBIGUOUS` line per ambiguous
  finding — the irreducible residual reported honestly, never hidden behind a payload that merely
  looks different.
- **`--fact-alignment` registered on `boardsmith verify-derive-record`** in `cli.ts`, same
  optional-CLI-flag-plus-delegated-validation posture as `--original-reading`/`--rederived-reading`.
- **Both subagent contracts updated by reference, without a phrase list.** `derive-recheck.md`'s
  "Your inputs" describes the `Target: {handle}` / Focus-passage / Context payload shape and states
  plainly that no slice path or line number is given because none exists in the prompt.
  `derive-compare.md`'s RETURN block requires `factAlignment`, defined by the question it answers
  plus two worked examples drawn from measured real data (`one-two-punch:52`'s genuine same-fact
  disagreement, `seven:8`'s different-fact targeting artifact) — no keyword or trigger-phrase list.
  `verify-game.md` Step 7 names the `--fact-alignment` flag.
- **A new drift guard closes the contract-drift path one level deeper than 177-10's
  command-existence guard.** `verify.test.ts` now cross-checks that every field
  `derive-compare.md`'s RETURN object declares has a matching `--option` on `verify-derive-record`
  in `cli.ts`. Empirically proven: with `--fact-alignment` removed from a parsed (in-memory only —
  the real file was never touched) copy of `cli.ts`'s source, the guard fails with `factAlignment`
  reported missing; against the real file it passes.

## Task Commits

1. **Tasks 1 & 2 (combined — see Deviations): opaque handle, focus narrowing, and factAlignment** —
   `3899120d` (feat)
2. **Task 3: update both subagent contracts and add the RETURN-fields-to-CLI-options drift guard**
   — `e10213d2` (docs)

## Files Created/Modified

- `src/cli/commands/verify-derive-recheck.ts` — `blindDeriveHandle`, `focusQuoteWindow`
  (`CITATION_HEADER_RE`, `MARKDOWN_HEADING_RE`, shared `isQuoteLine` predicate),
  `buildBlindDerivePayload` restructured (opaque handle, Focus/Context sections, DEGRADED
  fallback), `derivePayloadSet`, `FACT_ALIGNMENTS`/`FactAlignment`/`isFactAlignment`,
  `DeriveVerdictRecord.factAlignment`, `createDeriveVerdictRecord`'s new validation block,
  `readDeriveVerdicts` factAlignment pass-through, `DeriveRecheckFinding`/
  `VerifyDeriveRecheckResult` extended (`factAlignment`, `targetingAmbiguous`,
  `sharedFocusWith`, `targetingAmbiguousCount`, `offTargetDisagreements`,
  `genuineDisagreements`), `verifyDeriveRecheckCommand`'s per-slice ambiguity computation and
  extended printer, `verifyDeriveRecordCommand`'s `factAlignment` option plumbing, module header
  doc comment updated to describe the CR-07 closure
- `src/cli/commands/verify-derive-recheck.test.ts` — 23 net new tests (100 total, up from 77):
  `blindDeriveHandle` stability/no-collision/content-independence, `focusQuoteWindow` unit tests
  (above-first-header, in-passage, heading-severed, header-immediately-below-heading), the
  fixture-keyed plan-checker regression test, the real 5-candidate pairwise-distinctness test,
  `derivePayloadSet` real-fixture and independently-degraded tests, `factAlignment` throw/pass
  tests plus a ledger round-trip test, and the `offTargetDisagreements`/`genuineDisagreements`/
  `targetingAmbiguousCount` behavioral tests; existing `agrees`/`disagrees` fixtures across the
  file updated with `factAlignment: 'same-fact'`
- `src/cli/cli.ts` — `--fact-alignment <same-fact|different-fact>` option on `verify-derive-record`
- `src/cli/slash-command/bs/verify/derive-recheck.md` — "Your inputs" rewritten for the
  `Target: {handle}`/Focus/Context payload shape; never-given list gains "the slice's file path or
  the target line's line number"
- `src/cli/slash-command/bs/verify/derive-compare.md` — RETURN block gains required
  `factAlignment`, defined by its question plus two real worked examples
- `src/cli/slash-command/bs/verify-game.md` — Step 7 names `--fact-alignment`
- `src/cli/slash-command/bs/verify.test.ts` — 7 net new tests (100 total, up from 93): CR-07
  no-resolvable-pointer pin, Focus/Context description pins, factAlignment RETURN-block pins,
  the `different-fact`-is-reportable pin, the `--fact-alignment` Step-7 pin, and the new
  RETURN-fields-to-CLI-options drift guard (2 tests)

## Empirical Negative-Pin Proofs (mandatory per the honesty-discipline instructions)

All three reintroductions were performed by editing the committed, tested file directly (scratch
backup at `/tmp/verify-derive-recheck.ts.bak`, never `git stash`), running the targeted test(s),
recording the REAL observed failure output below, then restoring from the byte-identical backup
and confirming `git diff --stat src/cli/commands/verify-derive-recheck.ts` printed the SAME
392-insertions/32-deletions diff both before and after each reintroduction (never a partial
revert).

### Reintroduction 1 — removed the upward-walk markdown-heading boundary check from `focusQuoteWindow` (the plan-checker's required fix)

Change: `if (MARKDOWN_HEADING_RE.test(line)) break;` deleted from the upward walk, leaving only the
citation-header check.

Observed: **1 test failed**, in the fixture-keyed regression test pinned to the plan checker's own
cited case:

```
× buildBlindDerivePayload > 174-FIXTURES/seven/live/01-definitions-and-components.md:33 — a
  Derived line severed from its nearest citation header by an intervening "## Visual notes (p.1)"
  heading gets an EMPTY focus window, never the unrelated preceding "p.1, Play Testers:" passage
AssertionError: expected [ 'p.1, Play Testers:', …(1) ] to deeply equal []

- Expected
+ Received

- Array []
+ Array [
+   "p.1, Play Testers:",
+   "\"Patrick Galagan, Brian Hoffman, Bev Smith, ...\"",
+ ]
```

This is the exact wrong-passage bug the plan-checker's required fix names, reproduced live rather
than assumed. Restored from backup; `git diff --stat` matched the pre-reintroduction diff exactly.

### Reintroduction 2 — reintroduced the resolvable `Slice:`/`Target line:` pointer alongside the opaque handle (the CR-07 leak vector)

Change: added `Slice: ${slice.path}` and `Target line: ${entry.slicePath}:${entry.lineNumber}`
back into the payload's assembled `lines` array.

Observed: **2 tests failed**, both asserting the leak directly:

```
× buildBlindDerivePayload > never contains "Slice: " or a resolvable "Target line:" pointer —
  the CR-07 leak vector
AssertionError: expected '...' not to contain 'Slice: '

× buildBlindDerivePayload > for every one of the 22 real Derived lines, the payload contains
  neither slicePath nor the standalone lineNumber token...
AssertionError: expected 'BS-DERIVE-V1\nSlice: rulebook/01-defi…' not to contain
  'rulebook/01-definitions-and-components.md'
```

Restored from backup; `git diff --stat` matched the pre-reintroduction diff exactly.

### Reintroduction 3 — deleted `createDeriveVerdictRecord`'s `factAlignment` validation block

Change: the `if (input.verdict === 'agrees' || input.verdict === 'disagrees') { if
(!input.factAlignment...) throw ... }` block removed entirely.

Observed: **3 tests failed**, all expecting a throw that no longer fired:

```
× factAlignment (177-11) > THROWS for a disagrees record with no factAlignment
× factAlignment (177-11) > THROWS for an agrees record with no factAlignment
× factAlignment (177-11) > THROWS for an out-of-enum factAlignment value
AssertionError: expected [Function] to throw an error

- Expected:
null

+ Received:
undefined
```

Restored from backup; `git diff --stat` matched the pre-reintroduction diff exactly. Full suite
re-run after each restore confirmed 100/100 green in `verify-derive-recheck.test.ts`.

## Decisions Made

See `key-decisions` in frontmatter. The most consequential deviation from the plan's literal task
structure is documented there: Tasks 1 and 2 share the exact same files and were authored as one
coherent pass (the focus-passage computation `focusQuoteWindow` builds is the same computation
`derivePayloadSet` consumes to detect sharing), so they were committed together rather than split
via after-the-fact interactive staging, which risked a non-compiling intermediate commit. Task 3's
fully disjoint file set was committed separately, preserving the spirit of per-task atomic commits
where the files genuinely allow it.

## Deviations from Plan

### Combined Task 1 + Task 2 commit (not a code deviation, a commit-structure deviation)

- **Found during:** Task 2, when staging for commit.
- **Issue:** the plan lists Task 1's files as `verify-derive-recheck.ts`/`.test.ts` and Task 2's
  files as the same two plus `cli.ts`. Both tasks' implementations are deeply interleaved within
  the same functions and describe blocks (e.g., `derivePayloadSet` calls `focusQuoteWindow`
  directly; the `factAlignment` validation sits in the same `if` chain Task 1's neighboring
  pass-through check occupies).
- **Resolution:** committed both tasks together in a single commit (`3899120d`) with a message
  naming both tasks explicitly, rather than attempting a risky after-the-fact `git add -p` split
  that could produce a commit that doesn't compile or pass tests on its own.
- **Files affected:** `src/cli/commands/verify-derive-recheck.ts`,
  `src/cli/commands/verify-derive-recheck.test.ts`, `src/cli/cli.ts`
- **Commit:** `3899120d`

No other deviations — every other task/acceptance-criteria item was met as specified, including
the plan-checker's required fix (markdown headings as focus-window passage boundaries) and its
fixture-keyed regression test.

## Issues Encountered

None. `npx tsc --noEmit` was clean at every intermediate commit state (only the pre-existing,
unrelated `docs/seed-to-state.test.ts` rootDir error, present before this plan). `npx eslint` on
every modified file reported zero errors (two pre-existing "file ignored" warnings on the two test
files, unrelated to this plan's changes, matching 177-10's own precedent).

## Verification

- `npx vitest run src/cli/commands/verify-derive-recheck.test.ts` — 100/100 green (up from 77).
- `npx vitest run src/cli/slash-command/bs/verify.test.ts` — 100/100 green (up from 93).
- `npx tsc --noEmit` — clean except the pre-existing, unrelated `docs/seed-to-state.test.ts`
  rootDir error.
- **Full `npm test` (mandatory, not a subdirectory subset):** 4033/4033 green across 241 files
  (baseline 4003 + 30 net new tests across this plan's three tasks, zero regressions).
- Acceptance-criteria greps, run directly against the final committed state:
  - `grep -c 'Slice: ' src/cli/commands/verify-derive-recheck.ts` → `0`
  - `grep -c "DERIVE_VERDICTS = Object.freeze" src/cli/commands/verify-derive-recheck.ts` → `1`
    (array still has exactly four members — decision 6 held)
  - `grep -c 'Target line:' src/cli/slash-command/bs/verify/derive-recheck.md` → `0`
  - `grep -c 'factAlignment' src/cli/slash-command/bs/verify/derive-compare.md` → `4` (≥2 required)
  - `grep -c 'fact-alignment' src/cli/slash-command/bs/verify-game.md` → `1` (≥1 required)
- Three empirical negative-pin proofs (see above), all observed failing as predicted, all restored
  clean.

## Known Stubs

None — no hardcoded empty/placeholder values were introduced by this plan.

## Threat Flags

None — every threat this plan's own `<threat_model>` named (T-177-11-01 through T-177-11-05,
T-177-11-SC) is mitigated per the Accomplishments above (opaque handle, positional focus-window
computation never reading `entry.text`, required `factAlignment` splitting off-target from genuine
disagreements, mechanically-computed `targetingAmbiguous` never suppressed, no new dependencies).
T-177-11-05 (a blind subagent opening the live slice despite the handle, via its file-read tools)
remains explicitly `accept`ed per the plan's own threat model — sandboxing the dispatch's tools is
out of scope for this phase's `claude -p` harness; the prompt-level prohibition is retained and the
limitation is disclosed here rather than silently assumed closed. No new network endpoint, auth
path, or schema change at a trust boundary was introduced.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

The mechanism this plan built is designed but NOT yet re-measured against the real corpus — that
is `177-12`'s job (re-running the live proof against a pre-registered prediction, honestly
reporting whether the mechanism actually reduces the targeting-collapse artifact rate measured in
`177-PROOF.md` §3, or whether the residual `targetingAmbiguous` cases dominate the real corpus the
way the un-narrowed payload did). This plan does NOT claim the fix works on live dispatch data —
only that it is structurally sound (proven by unit test against the real fixture text) and that the
instrument to measure the residual honestly exists. `177-13` re-measures the phase goal and
disposes of `CHECK-04`. `CHECK-04` stays OPEN/PARTIAL in `REQUIREMENTS.md` — this plan touched no
requirement-completion criteria.

---
*Phase: 177-derived-line-re-derivation*
*Completed: 2026-07-30*

## Self-Check: PASSED

All seven modified files confirmed present on disk; both task commits (`3899120d`, `e10213d2`)
confirmed present in `git log`.
