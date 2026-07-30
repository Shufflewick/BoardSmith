---
phase: 174-verify-classifier
plan: 04
subsystem: verify-pipeline
tags: [verify-pipeline, classification, ledger, cli, chunk-staleness]

requires:
  - phase: 174-verify-classifier (174-02)
    provides: "verify-run.ts's exported ledger helpers (atomicWriteFile, appendLedgerLine, parseLedgerBody, resolveLedgerState, ledgerFilePath, readLedgerOrThrow, RUN_ID_RE) and the ClassificationRecord schema"
  - phase: 174-verify-classifier (174-03)
    provides: "verify-classify.ts's pure mechanical core — pairSlices, resolveProvenance, deriveStale, ruleBearingLines, the enumerated code constants"
provides:
  - "src/cli/commands/verify-classify.ts — verifyClassifyPairsCommand, verifyClassifyRecordCommand, verifyClassifyStatusCommand, RULE_DELTA_SEVERITY, computeChunkVerdicts"
  - "src/cli/cli.ts — verify-classify-pairs/-record/-status registered beside verify-run-status"
  - "verify-run.ts's ClassificationRecord widened with optional quotedPass1/quotedPass2, the load-bearing retention decision 18 requires"
affects:
  - "174-05/174-06/174-07 — the skill-text/subagent-dispatch plans that make these commands reachable from /bs-verify-game"
  - "Phase 175 — consumes verify-classify-status --json's chunkVerdicts[] as its impact-map input"

tech-stack:
  added: []
  patterns:
    - "Line-level attribution via verbatim-quote substring match, not group-membership — the mechanism decision 18 introduces to keep a single group's MAX-severity delta from smearing across every chunk that merely shares a page-overlap group"
    - "One shared severity-order constant (RULE_DELTA_SEVERITY) consulted by every roll-up, never a duplicated if/else chain"
    - "Ledger record is the only source of truth for the staged/classified side; never a directory scan (restated from staging-dispatch.md's discipline for classification)"

key-files:
  created: []
  modified:
    - src/cli/commands/verify-classify.ts
    - src/cli/commands/verify-classify.test.ts
    - src/cli/commands/verify-run.ts
    - src/cli/cli.ts

decisions:
  - "Applied 174-CONTEXT.md decision 18 (added after this plan was authored) in place of the plan's original Task 3 text: chunk staleness is derived from a classification record's quotedPass1 matched against the specific live slice(s) a chunk cites — never from the pair/group verdict wholesale. Real reference games pair into exactly one group each (174-03-SUMMARY.md), so group-verdict-keyed chunk staleness would fail the phase's own goal (one sharper line marking every chunk stale)."
  - "Widened verify-run.ts's ClassificationRecord (174-02) with optional quotedPass1/quotedPass2 fields, retained on the persisted ledger record — decision 18 makes this retention load-bearing, not merely informative, since the line-level attribution above depends on the quote surviving past the record call."
  - "00-visual-survey.md is excluded from the live rule-slice set the same way ingest-archive.ts's ingestRelabelCommand already excludes it (presentation-by-design, no Derived lines) — matched precisely because the real seven fixture carries one and it is not a rule slice."
  - "cosmetic records contribute their pairId to a chunk's chunkVerdicts.pairIds[] (they were evaluated) but never bump severity and never require a quote — only sharper/contradictory/unclassified are narrowed by quote-match; a quote-less unclassified record (nothing to attribute) conservatively broadens to every one of the chunk's cited live slices in that pair, per decision 8."
  - "Did NOT run requirements.mark-complete for VERIFY-01/VERIFY-03/VERIFY-07 despite them appearing in this plan's frontmatter — plans 174-05/06/07 build the skill-text/subagent-dispatch integration that makes these CLI commands reachable from /bs-verify-game, and this project's own history (REQUIREMENTS.md's note on Phase 173) treats a premature completion mark as a defect class to avoid, not a formality."

metrics:
  duration: "~1 session"
  completed: "2026-07-30"
---

# Phase 174 Plan 04: Verify-Classify CLI Surface + Per-Chunk Verdict Roll-Up Summary

Three run-scoped commands (`verify-classify-pairs`/`-record`/`-status`) that make classification
recordable, resumable, and reportable at both the page-region and per-chunk granularity — with the
per-chunk half rebuilt around 174-CONTEXT.md decision 18's late amendment (verbatim-quote line
attribution) instead of the plan's original group-verdict roll-up, because the real reference games
measurably collapse to one pairing group each.

## What was built

**Task 1 — `verify-classify-pairs`.** `verifyClassifyPairsCommand` resolves a run (most recent, or
`--run-id`), reads the ledger's recorded staged units (never a staging-directory scan —
`staging-dispatch.md`'s discipline, restated), reads the live `rulebook/*.md` tree (excluding
`INDEX.md` and `00-visual-survey.md`, mirroring `ingest-archive.ts`'s existing exclusion), pairs them
via `pairSlices()`, and resolves `resolveProvenance()` per group as a sibling map keyed by `pairId`
(never a field on `SlicePair`, keeping it pure/no-I/O). A recorded-but-missing staged file is reported
as a warning and folded into the pair set as its own unpaired finding, never silently dropped. An
unknown `--run-id` lists the runs that do exist; an out-of-`rulebook/`-bound `--live-slice` filter is
refused before any read. Verified against a real recorded run over the archived `seven` fixture
(5 tests, `pairs-1..5`).

**Task 2 — `verify-classify-record`.** `verifyClassifyRecordCommand` looks up the matching `SlicePair`
by `pairId` from the same pairing path, assigns `units`/`liveSlices`/`stagedSlices` straight across
with no collapsing step, and appends exactly one classification line through the same
`atomicWriteFile`/`appendLedgerLine` path `verify-run-record` hardened in 173-08. `stale` and
`provenance` are computed here and have no corresponding CLI option — an out-of-enum or missing
`--label` normalizes to `unclassified` with a stderr warning naming the received value, never
throwing; `sharper`/`contradictory` additionally require both `--quoted-pass1`/`--quoted-pass2`
non-empty (whitespace-only counts as empty), demoting to `unclassified` with a warning naming which
quote was absent otherwise. 11 tests (`ledger-1..6`, `unclassified-1..5`) prove append-only byte
preservation, re-classification's last-write-wins resolution, and every quote/label edge case.

**Task 3 — `verify-classify-status` + per-chunk roll-up + CLI registration.** Registered all three
commands in `cli.ts` beside `verify-run-status`. `verifyClassifyStatusCommand` reports
`pendingPairs` (`paired`-kind groups with no recorded verdict — `presentation-only`/`unpaired-slice`
groups are excluded from `pendingPairs` but still counted in `summary`), summary counts including
`cosmeticPct` computed over classified verdicts on `paired`, rule-bearing pairs only (decision 17:
presentation-only groups never enter numerator or denominator), and `chunkVerdicts[]` — the per-chunk
staleness view this Summary's Deviations section covers below. Registered with real `--help`/`--json`
child-process tests against the actual CLI entry point (`cli-1`, `cli-2`), never only in-process
calls.

## Task Commits

1. **Task 1: verify-classify-pairs** - `14d1da5d` (feat)
2. **Task 2: verify-classify-record** - `869016c1` (feat)
3. **Task 3: verify-classify-status + chunk roll-up + CLI registration** - `5ad42fa3` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `src/cli/commands/verify-classify.ts` — the three commands, `resolveRunId`/`listRunIds`/
  `computeRunPairs` shared helpers, `RULE_DELTA_SEVERITY`, `computeChunkVerdicts`
- `src/cli/commands/verify-classify.test.ts` — 30 new tests across pairs/ledger/unclassified/status/
  chunk/CLI-registration blocks
- `src/cli/commands/verify-run.ts` — `ClassificationRecord.quotedPass1`/`quotedPass2` (optional),
  parsed by `parseLedgerBody`'s classification branch
- `src/cli/cli.ts` — `verify-classify-pairs`/`-record`/`-status` registrations

## Decisions Made

See frontmatter `decisions` — the headline one is applying CONTEXT.md decision 18 in place of this
plan's own original Task 3 text, since decision 18 was added to the phase's CONTEXT.md after this
plan was authored and explicitly instructs doing so.

## Deviations from Plan

### Auto-fixed / Amendment-driven Issues

**1. [Plan amendment — decision 18 supersedes original Task 3] Chunk staleness rebuilt around
line-level quote attribution, not group-verdict roll-up**
- **Found during:** Task 3, before writing any chunk-verdict code — the plan amendment supplied with
  this execution explicitly named this as required, not discovered independently.
- **Issue:** The plan's original Task 3 action text specified chunk verdict = MAX severity over the
  *pairs* a chunk cites. Decision 18 (dated after the plan was authored) proves this fails the phase's
  own goal: because real rulebooks measurably collapse to one pairing group each (174-03-SUMMARY.md's
  corrective follow-up — genuine cross-page prose bridges every page span into one group), a
  group-verdict-keyed roll-up would mark the game's ONLY group `sharper` from a single line anywhere
  in the rulebook, and therefore mark every chunk citing anything in that group stale — the exact
  "second run flags everything" failure this phase exists to prevent.
- **Fix:** `computeChunkVerdicts` narrows each non-cosmetic classification record to only the live
  slice(s) whose own text contains that record's `quotedPass1` (decision 9's mandatory verbatim
  live-side quote), then intersects that with the chunk's own citations. Two chunks citing the SAME
  pair group but different live slices within it can land on different verdicts. `cosmetic` never
  narrows (it has no quote and never bumps severity); a quote-less `unclassified` record broadens
  conservatively rather than narrowing to nothing (decision 8: never silently clean where the tool was
  blind).
- **Files modified:** `src/cli/commands/verify-classify.ts` (`computeChunkVerdicts`,
  `RULE_DELTA_SEVERITY`), `src/cli/commands/verify-run.ts` (`ClassificationRecord.quotedPass1`/
  `quotedPass2`, widened parse branch), `src/cli/commands/verify-classify.test.ts` (a dedicated
  `decision-18` test: two chunks citing the same pair group, only the one whose cited live slice
  contains the quoted line is stale).
- **Verification:** `npx vitest run src/cli/commands/verify-classify.test.ts -t chunk` — 9/9 passed,
  including the new decision-18 regression test proving the phase goal in miniature.
- **Committed in:** `5ad42fa3` (Task 3 commit)

**2. [Rule 1 - Bug] `00-visual-survey.md` was initially treated as a live rule slice**
- **Found during:** Task 1's `pairs-1` test against the real `seven` fixture — the file's own
  cross-page prose (`(p.1)`/`(p.2)` asides throughout) merged it into the single real pairing group,
  producing a 4-live-slice group instead of the measured 3.
- **Issue:** `computeRunPairs`'s live-file listing initially included every `rulebook/*.md` file
  except `INDEX.md`. `00-visual-survey.md` is a real file under `rulebook/` in the archived fixture,
  but it is presentation-by-design (the UI-`ask` handoff artifact, not a rule slice) —
  `ingest-archive.ts`'s `ingestRelabelCommand` already excludes it by name for the same reason.
- **Fix:** Added the identical exclusion (`e.name !== '00-visual-survey.md'`) to `computeRunPairs`'s
  live-file filter.
- **Files modified:** `src/cli/commands/verify-classify.ts`
- **Verification:** `pairs-1` asserts the paired group's `liveSlices` are exactly the 3 real rule
  slices, matching 174-03-SUMMARY.md's measured count.
- **Committed in:** `14d1da5d` (Task 1 commit)

---

**Total deviations:** 2 (1 plan-amendment-driven rebuild explicitly instructed by decision 18, 1
auto-fixed bug found via the real fixture). No scope creep — both were necessary for correctness
against the phase's own stated goal and the real archived data.

## Issues Encountered

None beyond the deviations above — no blockers, no auth gates, no package installs.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All three `verify-classify-*` commands are reachable through the real `boardsmith` CLI entry
  point, exit 0 on findings (unpaired slices, presentation-only groups, unclassified verdicts), and
  are the only write path into the classification ledger.
- `verify-classify-status --json`'s `pendingPairs[]` is ready for plan 174-05's
  `classification-dispatch.md` resume logic; `chunkVerdicts[]` is ready for Phase 175's impact map.
- **Not done here, and not this plan's job:** the classification subagent contract, the
  `classification-dispatch.md` skill delegate, and `verify-game.md`'s Step 4 rewrite — those are
  174-05/06/07's scope. VERIFY-01/VERIFY-03/VERIFY-07 remain open in REQUIREMENTS.md until a live
  `/bs-verify-game` run through those plans proves the whole chain, matching this project's standing
  discipline against premature completion marks.

## Self-Check: PASSED

- FOUND: `src/cli/commands/verify-classify.ts` (verifyClassifyPairsCommand,
  verifyClassifyRecordCommand, verifyClassifyStatusCommand, RULE_DELTA_SEVERITY,
  computeChunkVerdicts)
- FOUND: `src/cli/commands/verify-classify.test.ts` (82 tests total in file; 30 added this plan)
- FOUND: `src/cli/cli.ts` (verify-classify-pairs/-record/-status registered)
- FOUND: `src/cli/commands/verify-run.ts` (ClassificationRecord.quotedPass1/quotedPass2)
- FOUND commit `14d1da5d` (feat(174-04): verify-classify-pairs)
- FOUND commit `869016c1` (feat(174-04): verify-classify-record)
- FOUND commit `5ad42fa3` (feat(174-04): verify-classify-status + chunk roll-up + CLI registration)
- `npx vitest run src/cli/commands/verify-classify.test.ts` — 52/52 passed
- `npm test` — 3676/3676 passed (full suite; baseline 3648 + 28 new tests this plan across
  pairs/ledger/unclassified/status/chunk/cli-registration — no regression)
- `npx tsc --noEmit -p .` — clean (only the pre-existing, unrelated
  `docs/seed-to-state.test.ts` rootDir diagnostic)

## Corrective follow-up (2026-07-29): FALSE-CLEAN hole in `computeChunkVerdicts` quote narrowing

Decision 18's narrowing (`if (affected.length === 0) continue;`) treated "the quote doesn't match
any of THIS chunk's own cited live slices" as a single situation. It is really two, and the code
could not tell them apart:

- **(a)** the quote matches some OTHER live slice in the pair, one this chunk doesn't cite —
  genuinely not this chunk's problem, the narrowing working exactly as designed.
- **(b)** the quote matches NO live slice in the pair AT ALL — the subagent paraphrased instead of
  quoting verbatim, a line was re-wrapped, whitespace/punctuation drifted, or the live slice could
  not be read. This is the tool being blind, not proof the chunk is unaffected — and a real
  `sharper`/`contradictory` verdict evaporated silently, with no trace in `--json`.

(b) is exactly the failure mode this milestone keeps catching (172 decision 10's `drift-unknown`,
PROV-03's `unknown`, decision 8's `unclassified`-is-stale, decision 2b's `unknown` provenance): a
verify pass reporting clean precisely where it was blind. A second, smaller instance of the same
class lived in `liveText()`, which cached a failed `fs.readFile` as `''` — an unreadable or missing
live slice therefore silently matched no quote, feeding straight into (b) rather than being
surfaced.

**Fix (`src/cli/commands/verify-classify.ts`, `computeChunkVerdicts`):**
- Before narrowing, the quote is now checked against the PAIR's whole `liveSlices` set (not just
  this chunk's citations). That single check distinguishes (a) from (b).
- Case (b) — the quote matches nothing in the pair — broadens conservatively to every one of the
  chunk's own cited live slices (the same fallback the no-quote branch already used) and is
  additionally pushed into a `warnings` set surfaced in the command's `--json` output (the existing
  `warnings: string[]` convention this module already uses for unpaired slices, malformed labels,
  and missing quotes — no new channel invented).
- `liveText()` no longer collapses a read failure to `''`. It now caches `null` (never silently
  treated as "read fine, empty"), and any live slice that could not be read is treated the same way
  as an unattributable quote: surfaced in `warnings` and broadened conservatively rather than
  silently excluded.
- The `computeChunkVerdicts` doc comment is corrected to explain both branches of
  `affected.length === 0` instead of asserting the single (now-disproven) meaning.
- Case (a)'s narrowing is unchanged and still proven correct by both the pre-existing `decision-18`
  test and a new explicit assertion that no unattributable warning fires when the quote genuinely
  lands elsewhere in the pair.

**Tests added** (`src/cli/commands/verify-classify.test.ts`, 52 → 54):
- `decision-18-corrective-a` — a paraphrased quote matching neither live slice in a pair: both
  citing chunks go stale and the `--json` warnings report the pair id, "does not match verbatim",
  and the record's rule-delta label.
- `decision-18-corrective-b` — a cited live slice that becomes unreadable between pairing and
  chunk-verdict computation (simulated via a `vi.spyOn(fs, 'readFile')` that lets the first,
  pairing-time read through and rejects the second, chunk-verdict-time read): the citing chunk goes
  stale and the warnings report "could not be read", proving an unreadable slice is surfaced rather
  than silently absorbed.
- The existing `decision-18` test (case a) gained an explicit assertion that no unattributable
  warning fires — proving the fix does not over-broaden and destroy decision 18's original purpose.

**Verification:**
- `npx vitest run src/cli/commands/verify-classify.test.ts` — 54/54 passed (52 baseline + 2 new).
- `npx vitest run` (full suite) — 3678/3678 passed (3676 baseline + 2 new; no regressions).
- `npx eslint src/cli/commands/verify-classify.ts` — clean.

**Committed in:** `83411485` (fix(174-04): close FALSE-CLEAN hole in computeChunkVerdicts quote
narrowing).
