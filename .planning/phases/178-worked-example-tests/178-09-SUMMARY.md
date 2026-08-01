---
phase: 178-worked-example-tests
plan: 09
subsystem: skill-prose
tags: [worked-example, check-06, verify-game-md, dispatch-orchestration]

requires:
  - phase: 178-worked-example-tests plan 04
    provides: "verify-example-replay.ts — verifyExampleReplayCommand/verifyExampleRecordCommand, the read/report + sole write surface this step dispatches into"
  - phase: 178-worked-example-tests plan 05
    provides: "verifyExampleTranslateCommand — the second dispatch's byte source"
  - phase: 178-worked-example-tests plan 07
    provides: "extract-example.md (BS-EXAMPLE-EXTRACT-V1) / translate-example.md (BS-EXAMPLE-TRANSLATE-V1) — the two dispatch contracts this step cites"
  - phase: 178-worked-example-tests plan 08
    provides: "build/test.md item 4 (TEST-01) — the build-blocking counterpart whose asymmetry this step preserves; closed the verify-example-record example-inconsistent seam this step relies on"
provides:
  - "src/cli/slash-command/bs/verify-game.md — Step 8 (CHECK-06, advisory, exit 0), Close renumbered to Step 9, extended Context-Economics carve-out, two new Reference Files entries"
affects: [178-10-preregistration, 178-11-sc3-proof]

tech-stack:
  added: []
  patterns:
    - "Step 8 mirrors Step 7's shape exactly (dispatch-then-record-then-format, project-wide, independent of staleness/repair) but is deliberately advisory — the CONTEXT decision 11 asymmetry with build/test.md's build-blocking TEST-01, stated explicitly in Step 8's own closing paragraph rather than left implicit."
    - "The Context-Economics carve-out gained a SECOND, separate paragraph (not an edit to the CHECK-04 paragraph) — the two-observable structure is preserved per payload family, and CHECK-06's extraction observable is the structural INVERSE of CHECK-04's enumerator observable: CHECK-04's enumerator prompt must contain ZERO annotation lines of any family; CHECK-06's extraction prompt legitimately CARRIES Visual (p. lines (that is its entire payload) while still carrying ZERO Derived (p. lines."
    - "Step 7's own test slice boundaries (previously anchored on '## Step 8: Close') were repointed to '## Step 8: Worked-Example Replay' so they scope to Step 7 alone rather than silently absorbing the new step's content — a correctness fix to pre-existing tests, not just a renumbering."

key-files:
  created: []
  modified:
    - src/cli/slash-command/bs/verify-game.md
    - src/cli/slash-command/bs/verify.test.ts

key-decisions:
  - "Cited the two dispatch contracts at their real installed path (${CLAUDE_SKILL_DIR}/../bs-shared/verify/extract-example.md and .../translate-example.md), matching the existing enumerate-facts.md/reconcile-facts.md citation convention — confirmed via install-claude-command.ts that source files under src/cli/slash-command/bs/verify/*.md install under bs-shared/verify/, the same shared namespace root every other verify-game.md Reference Files entry uses."
  - "Never cited verify-example-emit — carried forward from 178-08-SUMMARY's explicit warning: that command is build-side only (one generated test file per CHUNK), and Step 8 has no chunk context to emit into."
  - "The two-mismatch-bucket report language in Step 8 names 'gated on QuoteVerifiedProvenance (decision 12)' explicitly and reuses the exact bucket phrasing verifyExampleReplayCommand's own --json/human report already implements ('mismatch, quotes source-verified' / 'quotes NOT source-verified — a question about the quote, never an accusation against the code') rather than inventing new report language the code doesn't actually produce."

requirements-completed: [CHECK-06]

duration: ~40min
completed: 2026-07-31
---

# Phase 178 Plan 09: verify-game.md Step 8 (CHECK-06) — Advisory Worked-Example Replay Summary

**Wired CHECK-06 into `/bs-verify-game` as a new Step 8 (Worked-Example Replay) between the existing CHECK-04 step and the Close, renumbered Close to Step 9 with every cross-reference updated, extended the Context-Economics carve-out with a second, separate paragraph preserving the two-observable structure for CHECK-06's payloads (noting the extraction prompt's observable INVERTS relative to CHECK-04's enumerator), and pinned all of it with 14 new regression tests including a step-numbering guard demonstrated against two mutated fixtures.**

## Performance

- **Duration:** ~40 min
- **Tasks:** 2 completed
- **Files modified:** 2 (`verify-game.md`, `verify.test.ts`)

## Accomplishments

- **Task 1 — Step 8 (CHECK-06) and the renumbered Close.** Inserted `## Step 8: Worked-Example Replay (CHECK-06)` between Step 7 (CHECK-04) and the Close, which is now `## Step 9: Close (VERIFY-02)`. Step 8 mirrors Step 7's shape: runs `boardsmith verify-example-replay --json` project-wide and independent of staleness/repair; dispatches each pending slice's `extractionPayload` UNCHANGED to a subagent carrying `extract-example.md`'s `BS-EXAMPLE-EXTRACT-V1` handshake; obtains the second dispatch's bytes from `boardsmith verify-example-translate --slice-path <p> --extraction <f> --json` (stated as the ONLY source of translation bytes — no `GameApiSurface`/`exportedSymbols` narration in the step's own prose) and dispatches each `translationPayload` to a second subagent carrying `translate-example.md`'s `BS-EXAMPLE-TRANSLATE-V1` handshake, two separate dispatches, never one combined pass; records through exactly ONE `verify-example-record` invocation per slice; runs each translated test with the project's own test runner, the verdict coming from the observed pass/fail, never `verdictHint`; reports by formatting `verify-example-replay --json`'s output, raw counts and a per-slice breakdown, never a percentage, explicitly naming the corpus-too-small case; reports the two provenance-gated mismatch buckets (quotes source-verified / quotes NOT source-verified) distinctly per decision 12; names a zero-examples slice as a real ingest-contract finding, never a tuning signal; and closes stating the check exits 0 and is deliberately asymmetric with `build/test.md`'s build-blocking TEST-01 — it must never gate the Close. Updated Step 0's clean-close cross-reference ("Step 8, below" → "Step 9, below") and Step 7's own "same discipline Step 8's Close already holds" reference to Step 9. Added two Reference Files entries for `extract-example.md`/`translate-example.md` in the existing one-line bullet style, each naming its contract's token and hard rule (`example-inconsistent` never picks a side; `unexecutable` requires a named reason). Extended the Context-Economics carve-out with a second, separate "Context-Economics carve-out for CHECK-06's dispatch prompts (Step 8)" paragraph — placed before Step 0 alongside the existing CHECK-04 carve-out, never merged into it — naming the extraction prompt's inverted observable (ZERO `Derived (p.` lines, legitimately carrying BOTH quote lines and `Visual (p.` lines) and the translation prompt's legitimate carriage of the extracted spec's source text plus the game's exported API surface.
- **Task 2 — regression pins.** Added a `verify-game.md — CHECK-06 routing and Reference Files (178-09)` describe block (11 tests): Step 8's position immediately before Close; Step 0's cross-reference now naming Step 9; both handshake tokens and all three command names (including `verify-example-translate` as the cited producer of translation bytes) scoped to Step 8's own text; the exit-0/never-gates/asymmetric-with-TEST-01 sentence; the two-bucket provenance reporting language; the zero-examples-is-a-finding sentence and the absence of any digit-percent reporting instruction; the `formatted, never computed` discipline; the absence of `GameApiSurface`/`exportedSymbols` prose inside Step 8's own text; both new Reference Files entries; a step-numbering guard asserting `## Step N:` headings parse to exactly `[0,1,2,3,4,5,6,7,8,9]` with Close last; and two mutated-fixture regression-detector proofs (a duplicated Step 8 heading with Step 9 missing entirely; a skipped step number via Step 8 renamed to Step 10) confirming the guard actually fails on both failure shapes, not just passing on the real file. Extended the existing Context-Economics carve-out describe block with 2 new tests: the new carve-out paragraph's inverted-observable language, and confirmation it is a second, separate paragraph (never an in-place edit to the CHECK-04 carve-out) still living before `## Step 0:`. Fixed three pre-existing Step 7 tests whose slice boundaries were hardcoded to `'## Step 8: Close'` — repointed to `'## Step 8: Worked-Example Replay'` so they scope to Step 7's own text rather than silently swallowing the new Step 8's content between the old anchor and the new Step 9.

## Task Commits

1. Task 1 + Task 2 — `b1b1230c` (feat: wire CHECK-06 into /bs-verify-game as advisory Step 8)

## Files Modified

- `src/cli/slash-command/bs/verify-game.md` — new Step 8 (CHECK-06), Close renumbered to Step 9, extended Context-Economics carve-out, two new Reference Files entries
- `src/cli/slash-command/bs/verify.test.ts` — new `CHECK-06 routing and Reference Files` describe block (11 tests), 2 new carve-out extension tests, 1 test-count fix (nine → ten numbered steps), 3 pre-existing test slice-boundary fixes

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Four pre-existing tests hardcoded the retired '## Step 8: Close' anchor**
- **Found during:** Task 1/2, immediately after inserting the new Step 8 heading (before running tests) — grepped for every remaining `'## Step 8: Close'` occurrence rather than waiting to discover it via a test failure.
- **Issue:** `verify.test.ts` had four tests (`'has a Step 8 naming Close'`, `'Step 7 names both contracts by path'`, `'Step 7 names verify-derive-check --json'`, `'Step 7 names all three pinned model ids'`) slicing Step 7's content up to the literal string `'## Step 8: Close'`, which no longer exists once Step 8 became `## Step 8: Worked-Example Replay` and Close moved to Step 9. Left unfixed, `skill.indexOf('## Step 8: Close')` would return `-1`, and the resulting `.slice(startIdx, -1)` would run to end-of-file — silently absorbing the new Step 8 AND Step 9's content into what each test believes is "Step 7's own text," rather than failing loudly.
- **Fix:** Repointed all four anchors to `'## Step 8: Worked-Example Replay'` (or `'## Step 9: Close'` for the standalone Close-existence test), correctly re-scoping each to Step 7's own text.
- **Files modified:** `src/cli/slash-command/bs/verify.test.ts`.
- **Commit:** `b1b1230c` (same commit as Task 1/2).

**2. [Rule 1 - Bug] A newly-written test's own regex forbade the word "percentage" inside a sentence instructing AGAINST reporting one**
- **Found during:** First test run after Task 2's new describe block.
- **Issue:** `expect(step8).not.toMatch(/\d+%|percentage/i)` failed against Step 8's own legitimate sentence "Report raw counts and a per-slice breakdown, never a percentage" — the word "percentage" appearing in an instruction NOT to report one is not itself a percentage-bearing instruction.
- **Fix:** Narrowed the regex to `/\d+%/` only — a literal digit-percent pattern (e.g. "42%") is the actual defect this assertion exists to catch; the word "percentage" in prose is expected and correct.
- **Files modified:** `src/cli/slash-command/bs/verify.test.ts`.
- **Commit:** `b1b1230c` (same commit).

None beyond the two auto-fixed items above.

---

**Total deviations:** 2 auto-fixed (both Rule 1 — test-correctness bugs caught before commit, no production-file bugs).

## Issues Encountered

None beyond the two auto-fixed items above.

## User Setup Required

None — no external service configuration required.

## Confirmation of what_must_be_right

1. **Advisory, exit 0, never gates the Close (D-11).** Confirmed: Step 8's closing paragraph states "Findings are reported and this check exits 0 ... deliberately asymmetric with `build/test.md`'s own worked-example step (TEST-01), which is build-blocking ... this check must NEVER be used as a gate on the Close." `verifyExampleReplayCommand` itself (plan 04) never assigns `process.exitCode`, confirmed by its own JSDoc and 178-04's tests — the prose and the code agree. Pinned by a dedicated test asserting the exit-0/never-gates/asymmetric sentence, scoped to Step 8's own text.
2. **Close renumbers to Step 9.** Confirmed: `grep -n "^## Step " verify-game.md` lists Steps 0-9 contiguously, Step 8 is Worked-Example Replay, Step 9 is Close. Every internal cross-reference to the old "Step 8, below" (Step 0's clean-close line) and "Step 8's Close" (Step 7's own formatted-never-computed sentence) now names Step 9. `grep -n "Step 8, below"` returns nothing.
3. **Context-Economics carve-out preserves the TWO-OBSERVABLE structure, and the inversion is stated explicitly.** The new CHECK-06 paragraph is a SEPARATE paragraph from the CHECK-04 one (never merged), preserving per-payload-family observables. It states plainly: CHECK-06's extraction prompt (`BS-EXAMPLE-EXTRACT-V1`) legitimately carries BOTH quote lines AND `Visual (p.` lines (the opposite of CHECK-04's enumerator, which must carry ZERO of any annotation family) while still carrying ZERO `Derived (p.` lines — no exception applies to that one observable, since a worked example is never itself a `Derived` line.
4. **"Formatted, never computed."** Step 8's report paragraph states verbatim: "Report by formatting `boardsmith verify-example-replay --json`'s output — **formatted, never computed** by this skill, the same discipline Step 7 and Step 9's Close already hold."
5. **`QuoteVerifiedProvenance` gating visible in the prose (D-12).** Step 8 states: "Report the two mismatch buckets distinctly, gated on `QuoteVerifiedProvenance` (decision 12): mismatches where the supporting quote is source-verified, and mismatches where it is NOT — the latter is a question about the quote, never an accusation against the code" — naming the two report buckets `verifyExampleReplayCommand`'s own output already implements (plan 04), not flattened into one.
6. **Regression pins (PROC-01/PROC-02 pattern).** 14 new tests total: 11 in the new `CHECK-06 routing and Reference Files` describe block, 2 extending the carve-out block, plus the step-count/CHECK-ID-range fix. The step-numbering guard is proven as a real regression detector against two independently constructed mutated fixtures (duplicate heading; skipped heading), not merely asserted to pass on the unmutated file.

## Next Phase Readiness

Plan 178-10 (pre-registration, per CONTEXT decision 13) should know:

- **Both pipeline sides are now fully wired.** `build/test.md` item 4 (178-08, build-blocking) and `verify-game.md` Step 8 (this plan, advisory) both dispatch the same two contracts (`extract-example.md`/`translate-example.md`) and the same three commands (`verify-example-replay`/`verify-example-translate`/`verify-example-record`), with the record-side `example-inconsistent` seam (178-08's prerequisite fix) already closed — a real dispatch chain hitting `seven`'s Run example will not crash on either side.
- **The asymmetry is real and load-bearing, not decorative.** `build/test.md`'s `disagrees` routes back to `build`; `verify-game.md`'s Step 8 exits 0 unconditionally and is explicitly forbidden from gating the Close. Any pre-registration work comparing the two sides' behavior should expect and verify this divergence, not treat it as a bug.
- **Step 8 never cites `verify-example-emit`** (build-side only, one file per CHUNK) — Step 8 has no chunk context. If plan 178-10/178-11's proof work needs a generated test artifact from the verify side, it does not exist by design; Step 8's artifact is the ledger record (`ExampleReplayRecord`) and the report, not a written test file.
- **The corpus is tiny (~5-6 examples across all three reference games)** — 178-10's pre-registration should expect single-digit example counts per game and plan its "could this ever pass?" check (decision 14) against that scale, not a CHECK-04-sized corpus.
- No blockers. Full suite green (4306/247, +14 tests from this plan's 4292/247 entering baseline, 0 subtracted, 0 failing).

---
*Phase: 178-worked-example-tests*
*Completed: 2026-07-31*

## Self-Check: PASSED

`src/cli/slash-command/bs/verify-game.md`, `src/cli/slash-command/bs/verify.test.ts` confirmed
present/modified on disk; commit `b1b1230c` confirmed present in `git log`.
