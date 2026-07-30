---
phase: 176-stale-chunk-repair
plan: 06
subsystem: cli
tags: [audit-lens-dispatch, repair-gate, claude-p-dispatch, live-bug-discovery, lexicon-regression]

# Dependency graph
requires:
  - phase: 176-stale-chunk-repair
    plan: "176-02"
    provides: resolveStagedSlicePaths, planVerifyEpisodeRound/resolveVerifyEpisodeNumber, appendAuditRoundHeading/writeAppendedAuditRound, recomputeRepairGatePostRepair
  - phase: 176-stale-chunk-repair
    plan: "176-05"
    provides: 176-PROOF.md §1-3 (CHECK-01 full-corpus live proof), the resolveFreshTranscription superseded-slices finding this plan promotes to a fix
  - phase: 175-impact-map-repair-gating
    provides: 175-FIXTURES/174-07-contradictory's committed fresh staged transcriptions, verifyImpactStatusCommand/ImpactMapEntry
provides:
  - "176-PROOF.md §3b — CHECK-01's constructed-lexicon regression closing the verdict-distribution gap (resolved-by-source + contradicted, 2/2 constructed cases)"
  - "176-PROOF.md §4-§5 — CHECK-02's live proof: real lens dispatch on a stated 2-of-12 subset, decision 17 proven in both games, paired pre/post-repair gate readings"
  - "176-PROOF.md 'What is still unproven' + 'How to re-run every proof' — phase-wide closing sections"
  - "Phase 176 closed: CHECK-01 and CHECK-02 both marked Complete in REQUIREMENTS.md with section-and-number citations; 176-VALIDATION.md signed off; ROADMAP.md Result paragraph"
affects: [177-derived-line-re-derivation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Superseded-subfolder exclusion: filter staged-slice enumeration on path SEGMENTS (never a substring match), so a legitimately-named slice containing the word 'superseded' with no directory component is never wrongly excluded"
    - "quiet option cascade: an internal composing caller suppresses ALL of a composed command's console output (not just its json branch) by adding quiet to the shared options shape, mirroring ingest-archive.ts's established precedent"
    - "Section-scoped append: appendAuditRoundHeading now inserts before the next top-level heading following a named section, falling back to end-of-document append only when that section is genuinely last — preserves every existing synthetic-fixture test unchanged while fixing the real-document case"

key-files:
  created:
    - .planning/phases/176-stale-chunk-repair/176-FIXTURES/lexicon/resolved-by-source-discard-draw-limit/{RULING.md,TRANSCRIPTION.md,EXPECTED.md}
    - .planning/phases/176-stale-chunk-repair/176-FIXTURES/lexicon/contradicted-bid-tiebreak/{RULING.md,TRANSCRIPTION.md,EXPECTED.md}
    - .planning/phases/176-stale-chunk-repair/176-06-SUMMARY.md
  modified:
    - src/cli/commands/verify-ruling-recheck.ts (superseded/ exclusion, ADDED ITEM 1)
    - src/cli/commands/verify-ruling-recheck.test.ts
    - src/cli/commands/verify-impact.ts (ImpactMapEntry.pairIds carried forward, quiet cascade)
    - src/cli/commands/verify-impact.test.ts
    - src/cli/commands/verify-repair.ts (verifyRepairStatusCommand's quiet:true call, appendAuditRoundHeading section-scoped insert)
    - src/cli/commands/verify-repair.test.ts
    - src/cli/commands/drift-check.ts (quiet option)
    - src/cli/commands/chunk-provenance.ts (quiet option)
    - src/cli/commands/verify-classify.ts (quiet option)
    - src/cli/commands/verify-run.ts (VerifyRunOptions.quiet)
    - .planning/phases/176-stale-chunk-repair/176-PROOF.md
    - .planning/phases/176-stale-chunk-repair/176-VALIDATION.md
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md

key-decisions:
  - "ADDED ITEM 1 promoted from a 176-05 finding to a fix: resolveFreshTranscription's recursive readdir excluded superseded/ subfolder content, filtered on path segments so a legitimately-named 'superseded' slice with no directory component is still resolved. Regression test copies the real committed 174-07-contradictory fixture byte-for-byte."
  - "ADDED ITEM 2: 2 hand-built CONSTRUCTED lexicon pairs (following Phase 174's 7-pair precedent) close the verdict-distribution gap 176-05 honestly flagged. still-needed proven on real data (60/60); resolved-by-source/contradicted proven correct-when-called-for only on constructed input. CHECK-01 stays Complete on the same disposition basis Phase 174 used for VERIFY-03's own real-data gap — the first constructed fixture draft was itself caught wrong by a real dispatch distinguishing a Derived line from literal source prose, recorded as evidence not discarded."
  - "Two REAL bugs found live while running this plan's own Task 1 tooling for the first time against real stale chunks, both fixed (Rule 1/3 -- blocking issues, not out-of-scope pre-existing noise): (1) ImpactMapEntry dropped ChunkVerdict's own pairIds field, making verify-repair --json throw on every real stale chunk; (2) verify-repair --json's stdout was contaminated by nested commands' human reports regardless of the composing caller's own --json flag, fixed via a quiet option cascade across 4 command modules. A third bug -- appendAuditRoundHeading appending past a real CHUNK.md's trailing sections instead of within Findings Ledger -- was also found and fixed the same way, demonstrated corrected on the real seven/best-seven-selection and one-two-punch/block CHUNK.md files."
  - "Lens-run subset: 2 of 12 real stale chunks audited (best-seven-selection, block) -- both already at 3 build-era audit rounds (decision 17's exact target) AND both ui:touches|major, chosen deliberately to cover decision 17 in BOTH reference games with the minimum dispatch count, per decision 15's explicit cost-containment allowance. The 4th (design-review) lens was identified as required for both but not dispatched (needs a live dev-server/browser harness) -- stated, not hidden."
  - "Post-repair gate readings show NO disposition change for either audited chunk (decision 16 forbids fixing reference-game content, so no rules-layer code moved during this pass) -- honestly recorded as the 'repair changed nothing' arm, restating 175-PROOF.md §5's own 1-of-12 baseline rather than manufacturing a new payoff. The 'would have been wrong' case is cited to 176-02's own synthetic two-commit git fixture test."
  - "CHECK-02 marked Complete: the shipped mechanism (selectStaleChunks) processes every stale chunk unconditionally in code; this plan's 2-of-12 dispatch is a cost-contained PROOF sample, not a cap in the mechanism itself. Same disposition-basis precedent this milestone already established for CHECK-01/VERIFY-03."

patterns-established:
  - "quiet cascade for internal command composition: json:false alone is insufficient to suppress a composed command's own print branch; a dedicated quiet flag, propagated down every composition layer, is the only structurally sound suppression."
  - "Section-scoped markdown append: locate the next top-level heading after a named section and insert before it, falling back to EOF append when no trailing section exists -- generalizable to any future CHUNK.md section that must stay append-only without corrupting document structure."

requirements-completed: [CHECK-02]

# Metrics
duration: ~4h
completed: 2026-07-30
---

# Phase 176 Plan 06: Real Lens Run, Paired Gate Readings, and Phase Closeout Summary

**2 of 12 real stale chunks audited with 6 real fresh-context lens dispatches (15 findings, decision 17 proven live in both reference games), paired pre/post-repair gate readings showing no disposition change, and two live correctness bugs found + fixed in CHECK-02's own shipped mechanics along the way — plus a constructed-lexicon regression closing CHECK-01's verdict-distribution gap. Phase 176 is now closed: both CHECK-01 and CHECK-02 marked Complete with section-and-number citations.**

## Performance

- **Duration:** ~4h
- **Tasks:** 3/3 completed, plus 2 added items and 3 live bug fixes
- **Files modified:** 14 (3 fixture files created, 11 modified)

## Accomplishments

- **ADDED ITEM 1 — fixed, not just reported.** `resolveFreshTranscription`'s recursive readdir
  excluded `slices/superseded/` content (176-05's reported-but-unfixed finding), filtered on path
  segments so a legitimately-named slice is never wrongly excluded. Regression test copies the
  real committed `174-07-contradictory` fixture byte-for-byte.
- **ADDED ITEM 2 — the verdict-distribution gap closed honestly.** 2 hand-built CONSTRUCTED lexicon
  pairs (following Phase 174's 7-pair precedent) dispatched via real `claude -p` against the
  unmodified `verify/ruling-recheck.md` contract: one exercising `resolved-by-source`, one
  exercising `contradicted`. Both matched (2/2). The first-drafted `resolved-by-source` fixture was
  itself caught wrong by a real dispatch correctly distinguishing a `Derived` (transcriber-inference)
  line from literal source prose — recorded as evidence, not discarded. `still-needed` remains
  proven only on real data (60/60); the other two labels proven only on constructed input — recorded
  explicitly, never blended into the real-corpus counts. CHECK-01 stays Complete, same disposition
  basis Phase 174 used for VERIFY-03's own real-data gap.
- **Two REAL, live-discovered bugs fixed in CHECK-02's own shipped mechanics** — found the moment
  this plan's own tooling was run against real data for the first time:
  1. `ImpactMapEntry` dropped `ChunkVerdict`'s own `pairIds` field, making
     `boardsmith verify-repair --json` throw `entry.pairIds is not iterable` on EVERY real stale
     chunk in both reference games. Fixed by carrying the field forward verbatim.
  2. `verify-repair --json`'s stdout was contaminated by three nested commands' human reports
     regardless of the composing caller's own `--json` flag. Fixed with a `quiet` option cascaded
     across `verifyImpactStatusCommand`, `verifyClassifyStatusCommand`, `driftCheckCommand`, and
     `chunkProvenanceStatusCommand`, following the established `ingest-archive.ts` precedent.
  3. `appendAuditRoundHeading` appended past a real `CHUNK.md`'s trailing sections
     (`## Revision Rounds`, `## Build Manifest`, `## Verified Commit Hash`) instead of within
     `## Findings Ledger` — never caught because every synthetic test fixture ended right after
     Findings Ledger. Fixed to insert before the next `## ` heading, demonstrated corrected on the
     real `best-seven-selection` and `block` `CHUNK.md` files via a real `diff`.
  All three regression-tested; `npm test` 3893/3893 green throughout, zero regressions.
- **Real lens run, 2 of 12 stale chunks, coverage stated explicitly.** `best-seven-selection`
  (`seven`) and `block` (`one-two-punch`) — both already at 3 build-era audit rounds (decision 17's
  exact target, demonstrated in BOTH games) and both `ui:touches|major`. 6 real fresh-context
  `claude -p` dispatches (fidelity/visibility/undo × 2 chunks) against the unmodified
  `build/audit.md` templates, surfacing 15 real findings (1 high, 6 medium, 8 low; 0 fixed, per
  decision 16). A visibility lens genuinely repointed a dangling symlink and ran the real
  `diffPlayerViews`/`assertNoHiddenInfoLeak` harness live. Two independently-dispatched lenses on
  `block` converged on the same root defect from different angles — direct evidence for the 3-lens
  independence design. The 4th (design-review) lens was identified as required for both chunks but
  NOT dispatched (needs a live dev-server/browser harness) — stated, not hidden. All 12 stale
  chunks enumerated with an explicit AUDITED/NOT-AUDITED reason each.
- **Paired pre/post-repair gate readings.** Both audited chunks show NO disposition change
  (`reopen-playtest`, `drifted`, both times) — honestly recorded as the "repair changed nothing"
  arm, since decision 16 forbids fixing reference-game content. Restates `175-PROOF.md` §5's own
  1-of-12 baseline rather than manufacturing a new payoff; the "would have been wrong" case is
  cited to 176-02's own synthetic two-commit git fixture test, the only place it is proven.
- **Phase closeout.** `176-PROOF.md` gained "What is still unproven" (9 items) and "How to re-run
  every proof" (literal commands). `REQUIREMENTS.md`: CHECK-02 marked Complete (mechanism never
  capped in code; proof on a stated cost-contained subset). `176-VALIDATION.md` signed off
  (`nyquist_compliant: true`, every verification-map row re-confirmed green). `ROADMAP.md` Phase
  176 Result paragraph names the measured numbers.

## Task Commits

Each task was committed atomically:

1. **ADDED ITEM 1: exclude superseded/ slices from resolveFreshTranscription** - `e2ca4f6e` (fix)
2. **ADDED ITEM 2: CHECK-01 lexicon regression** - `55a04baf` (docs)
3. **Live bug fix: ImpactMapEntry.pairIds + verify-repair stdout contamination** - `33973995` (fix)
4. **Live bug fix: appendAuditRoundHeading section placement** - `da65cffb` (fix)
5. **Task 1+2: real lens run + paired gate readings** - `12bb2271` (docs)
6. **Task 3: phase closeout** - `d2c0432e` (docs)

## Files Created/Modified

- `src/cli/commands/verify-ruling-recheck.ts` / `.test.ts` — superseded/ exclusion + regression tests
- `src/cli/commands/verify-impact.ts` / `.test.ts` — `ImpactMapEntry.pairIds`, `quiet` option
- `src/cli/commands/verify-repair.ts` / `.test.ts` — `quiet:true` call site, section-scoped append + regression tests
- `src/cli/commands/drift-check.ts`, `chunk-provenance.ts`, `verify-classify.ts`, `verify-run.ts` — `quiet` option cascade
- `.planning/phases/176-stale-chunk-repair/176-FIXTURES/lexicon/*/` — 2 constructed lexicon pairs
- `.planning/phases/176-stale-chunk-repair/176-PROOF.md` — §3b, §4, §5, closing sections
- `.planning/phases/176-stale-chunk-repair/176-VALIDATION.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` — closeout

## Decisions Made

See key-decisions above.

## Deviations from Plan

**Rule 1/3 fixes (blocking issues, found live while executing this plan's own Task 1):**

1. **[Rule 1 - Bug] `ImpactMapEntry` dropped `pairIds`** — Found running `boardsmith verify-repair
   --json` for the first time against a real stale chunk. Fixed by carrying `ChunkVerdict.pairIds`
   forward verbatim in `buildImpactMapEntry`. Files: `verify-impact.ts`. Commit: `33973995`.
2. **[Rule 3 - Blocking] `verify-repair --json` stdout contaminated** — Found in the same run;
   `JSON.parse(stdout)` failed on concatenated human-report text. Fixed with a `quiet` cascade.
   Files: `verify-impact.ts`, `verify-repair.ts`, `drift-check.ts`, `chunk-provenance.ts`,
   `verify-classify.ts`, `verify-run.ts`. Commit: `33973995`.
3. **[Rule 1 - Bug] `appendAuditRoundHeading` mis-placement** — Found writing this plan's own
   verify-episode round onto the real `best-seven-selection`/`block` CHUNK.md files (not a
   synthetic fixture). Fixed to insert before the next `## ` heading following `## Findings
   Ledger`. Files: `verify-repair.ts`. Commit: `da65cffb`.

None of these three are the ADDED ITEM 1 finding (a separate, already-anticipated fix) — all three
were discovered fresh during this plan's own real-data execution.

## Issues Encountered

None beyond the three bugs above, all fixed and regression-tested.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 176 (Stale-Chunk Repair) is CLOSED. CHECK-01 and CHECK-02 both Complete in
  `REQUIREMENTS.md`, `176-VALIDATION.md` signed off, `ROADMAP.md` Result paragraph recorded.
- Carried-forward unproven items (see `176-PROOF.md` "What is still unproven" for the full list):
  native Task/Agent-tool dispatch (unresolved throughout this phase); `resolved-by-source`/
  `contradicted` on real data (constructed-only); 10 of 12 stale chunks not audited (cost
  containment); the 4th design-review lens not dispatched; Pitfall 1's "would have been wrong"
  case proven only at the mechanics level; VERIFY-06's payoff still not demonstrated on these two
  games; anchor density, `lineFindings[]` multi-delta persistence gap, and SC-2's thin evidence
  base all inherited unchanged from prior phases.
- `npm test`: 3893/3893 green (baseline 3886 at 176-05's close + 7 new tests across this plan's
  fixes, zero regressions).
- Both `~/BoardSmithGames` originals confirmed byte-identical across this ENTIRE phase (176-01
  through 176-06) — every mutation happened inside `cp -R` scratch copies only.

---
*Phase: 176-stale-chunk-repair*
*Completed: 2026-07-30*
