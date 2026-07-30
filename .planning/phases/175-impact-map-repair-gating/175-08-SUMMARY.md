---
phase: 175-impact-map-repair-gating
plan: 08
subsystem: cli
tags: [verify, impact-map, repair-gate, drift-check, staleness-marker, proof, closeout]

requires:
  - phase: 175-impact-map-repair-gating
    plan: 04
    provides: "computeRepairGate/verifyImpactStatusCommand/verifyImpactApplyCommand — the impact map and gated write this plan proves live"
  - phase: 175-impact-map-repair-gating
    plan: 07
    provides: "The live VERIFY-04 gate proof (175-PROOF.md §§1-3d) this plan appends to, plus the adjudication procedure this plan reuses on a fresh one-two-punch copy"
  - phase: 174-verify-classifier
    provides: "174-PROOF.md §8's real, measured stale sets (seven 6/16, one-two-punch 6/11) this plan's marked counts are checked against"
provides:
  - "175-PROOF.md §§4-9 — the real cross-file staleness write on both live reference games, the VERIFY-06 payoff measured (honest NOT-DEMONSTRATED verdict), decision 13's waived path proven LIVE, and the phase-wide closeout"
  - "A real live-discovered bug fix in verify-impact.ts: writeRulesStalenessMarker's SKETCH.md pointer no longer fuses onto the next real bullet line when no blank line separates them"
  - "VERIFY-04, VERIFY-05, VERIFY-06 all CLOSED in REQUIREMENTS.md with 175-PROOF.md section-and-number citations; Phase 175 marked complete in ROADMAP.md"
affects: [176-stale-chunk-repair]

tech-stack:
  added: []
  patterns:
    - "writeRulesStalenessMarker's SKETCH.md insertion never slices past the Status line's own trailing newline — inserting immediately after the line's text and letting the original newline (and whatever follows it) stand untouched, rather than consuming and attempting to resynthesize it"

key-files:
  created:
    - .planning/phases/175-impact-map-repair-gating/175-08-SUMMARY.md
  modified:
    - .planning/phases/175-impact-map-repair-gating/175-PROOF.md
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md
    - .planning/STATE.md
    - src/cli/commands/verify-impact.ts
    - src/cli/commands/verify-impact.test.ts

key-decisions:
  - "The payoff measurement (§5) reports an honest NOT-DEMONSTRATED verdict for a DIFFERENT reason than the plan anticipated: unknown-drift does not dominate on either real reference game (it is 0 in both games' dispositionCounts) — instead, most rules-stale chunks are genuinely drifted (real code changed) for reasons unrelated to the specific rules finding, because both reference games have had substantial ordinary development land since their chunks were last verified. This distinction is stated explicitly rather than folded into the anticipated unknown-drift narrative."
  - "Decision 13's verified(user-waived)+stale+code-changed path is labelled LIVE, not constructed — it occurs naturally on 8 real chunks across both games (seven: best-seven-selection, bonus-point-cards, scoring-run-of-7, table-and-draw; one-two-punch: block, jab, movement-advance-retreat, rest). No synthetic fixture was needed."
  - "The SKETCH.md pointer-insertion bug (found live) was fixed under deviation Rule 1 rather than deferred, since this plan's own acceptance criteria require pasting real, correct fenced bodies and pointer lines from the written copies — a proof of a cross-file write cannot rest on a write path that corrupts one of the two files."
  - "VERIFY-04, VERIFY-05, VERIFY-06 are all closed with citations in this plan, per explicit instruction that 175-08 owns the phase's official closeout — continuing this milestone's discipline of never marking a requirement complete with a bare checkbox (the exact defect that reverted 175-06's premature VERIFY-05/06 closure)."

requirements-completed: [VERIFY-05, VERIFY-06]

duration: ~110min
completed: 2026-07-30
---

# Phase 175 Plan 08: VERIFY-05's Real Cross-File Write, VERIFY-06's Measured Payoff, and Phase Closeout Summary

**The rules-staleness marker's real cross-file write landed on both live reference games exactly matching Phase 174's predicted stale sets (seven 6/16, one-two-punch 6/11, zero symmetric difference) — but a real live bug in the SKETCH.md write path (a fused line when no blank line separated Status from the next bullet) was found and fixed under deviation Rule 1 along the way — and VERIFY-06's real-data payoff measures an honest NOT-DEMONSTRATED verdict: only 1 of 12 real rules-stale chunks across both games closes without re-playtesting, because most stale chunks' code genuinely drifted for reasons unrelated to the rules finding, not because drift-check returned unknown as originally anticipated.**

## Performance

- **Duration:** ~110 min
- **Started:** 2026-07-30
- **Completed:** 2026-07-30
- **Tasks:** 3 completed
- **Files modified:** 6 (1 created, 5 modified)

## Accomplishments

- Ran the real `verify-impact-apply` write on fresh `cp -R` copies of BOTH reference games (`seven`, no adjudication needed — real finding is `sharper`; `one-two-punch`, adjudicated `resolved` reusing plan 07's own adjudication direction) — measured marked-chunk counts (6 and 6) matched `174-PROOF.md` §8's predicted stale sets (`seven` 6/16, `one-two-punch` 6/11) exactly, zero symmetric difference
- **Found and fixed a real live bug** (see Deviations): `writeRulesStalenessMarker`'s SKETCH.md insertion fused the new pointer line onto the very next real bullet with no newline between them, whenever no blank line separated the Status line from what followed — the more common real shape (`one-two-punch`'s `block`/`movement-advance-retreat` entries). Fixed and re-proved on the exact real data that first exposed it.
- Proved write order, `Marker:`-last authority, the untouched `Status:` enum, and cold-resume parseability on both written copies — `chunk-provenance-status`/`drift-check --json` parse every chunk (17/17 `seven`, 12/12 `one-two-punch`) with zero parse failures
- Measured VERIFY-06's real payoff: `seven` — 0 of 6 stale chunks close without re-playtesting (all 6 genuinely drifted); `one-two-punch` — 1 of 6 closes without re-playtesting (`final-acceptance`, real `drift-check: clean`). Overall: 1 of 12 (8.3%) across both games — **honestly reported as NOT DEMONSTRATED**, for a reason distinct from the anticipated `unknown-drift`-dominant failure mode (measured `unknown-drift: 0` in both games' real dispositions)
- Proved decision 13's `verified (user-waived)` + stale + code-changed path **LIVE** (not constructed) on 8 real chunks across both games, and decision 11's `Re-verified (no code change):` stamp on the one real close-without-replaytest chunk
- Confirmed both `~/BoardSmithGames` originals byte-identical throughout (whole-tree sha256 diff empty at every checkpoint; a transient, non-reproducible `git status` flicker on two untracked-per-`git ls-files` `seven` paths was disclosed rather than hidden, with the authoritative byte-level manifest comparison never once showing a difference)
- Closed VERIFY-04, VERIFY-05, VERIFY-06 in `REQUIREMENTS.md` with `175-PROOF.md` section-and-number citations (never a bare checkbox); marked Phase 175 complete in `ROADMAP.md` with a Result paragraph naming both what was proven and what was measured and found wanting

## Task Commits

1. **Task 1 (fix found live) — SKETCH.md pointer-insertion bug** - `2a470612` (fix)
2. **Tasks 1+2: VERIFY-05 real cross-file write + VERIFY-06 measured payoff (175-PROOF.md §4-6, plus §7-9 closeout content)** - `74d2b4b7` (docs)
3. **Task 3: close VERIFY-04/05/06 with citations; mark Phase 175 complete** - `5f9a1a66` (docs)

**Plan metadata:** (this commit)

## Files Created/Modified

- `.planning/phases/175-impact-map-repair-gating/175-PROOF.md` (modified) - Appended §§4-9: VERIFY-05's real write, VERIFY-06's measured payoff, decision 13's live path, what's still unproven, how to re-run every proof, and the final originals-untouched confirmation
- `src/cli/commands/verify-impact.ts` (modified) - Fixed `writeRulesStalenessMarker`'s SKETCH.md insertion to never slice past the Status line's own trailing newline
- `src/cli/commands/verify-impact.test.ts` (modified) - Added a regression test reproducing the exact real fused-line shape
- `.planning/REQUIREMENTS.md` (modified) - VERIFY-04/05/06 marked `[x]` with citations; traceability table updated
- `.planning/ROADMAP.md` (modified) - Phase 175 marked `[x]` complete with a Result paragraph; 175-08 checked off
- `.planning/STATE.md` (modified, by hand — `gsd-sdk query state.*` NOT used per the known tooling-corruption warning) - Current Position, `stopped_at`, progress counters updated

## Decisions Made

- The payoff measurement's NOT-DEMONSTRATED verdict is stated for the REAL reason the data shows (most stale chunks genuinely drifted for reasons unrelated to the rules finding), explicitly distinguished from the anticipated `unknown-drift`-dominant failure mode, which did not occur (`unknown-drift: 0` in both games' real dispositions) — reporting the actual mechanism rather than forcing the data into the anticipated shape.
- Decision 13's waived-reopen path is labelled LIVE because it occurs naturally on 8 real chunks; no constructed fixture was built or needed.
- The SKETCH.md fusion bug was fixed under deviation Rule 1 (a bug directly encountered performing this task's own action, on the exact write path this plan proves) rather than deferred — a cross-file-write proof cannot rest on a write path that corrupts one of the two files it writes.
- Both a "seven had no adjudication needed" branch (real finding is `sharper`) and a "one-two-punch needed adjudication" branch (real finding is `contradictory`) were exercised live, matching each game's own real, distinct classification outcome rather than forcing both games through the same code path.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `writeRulesStalenessMarker`'s SKETCH.md insertion fused the new pointer line onto the next real bullet with no newline between them**
- **Found during:** Task 1, the first real `verify-impact-apply` write on `one-two-punch`'s `block` chunk
- **Issue:** The insertion code sliced PAST the Status line's own trailing newline character and re-added exactly one `'\n'` BEFORE the new pointer line, but none AFTER it. This was invisible when a blank line already separated the Status line from what followed (the unit-test fixture's own shape happened to mask it in one direction while still triggering it in the other — see below), but on real reference-game data where the very next SKETCH.md line was another bullet with no blank separator (e.g. `one-two-punch`'s `block`/`movement-advance-retreat` entries, each followed immediately by a `- Test script (outcome-based): ...` bullet), the consumed newline was never replaced, fusing the pointer line and the next bullet's text into one corrupted line.
- **Fix:** Insert immediately after the Status line's own text WITHOUT ever slicing past its trailing newline, so the original newline (and everything after it) is never consumed or resynthesized. Added a regression test (`verify-impact.test.ts`) reproducing the exact real shape, asserting the pointer line's own text is byte-exact and the following line is the untouched original bullet on its own line — the existing test's `startsWith`-only assertion could not catch this, since the fused string still legitimately started with the expected prefix.
- **Files modified:** `src/cli/commands/verify-impact.ts`, `src/cli/commands/verify-impact.test.ts`
- **Commit:** `2a470612`
- **Verification:** `npm test` 3826/3826 green (3825 baseline + 1 new regression test); `npx tsc --noEmit` clean apart from the pre-existing, unrelated `docs/seed-to-state.test.ts` rootDir warning. Re-proved on fresh `cp -R` copies of both reference games after the fix — the pre-fix copies that first exposed the bug were discarded, never reused for any measurement in this plan's proof.

None else — the rest of the plan executed exactly as written.

## Issues Encountered

- **An honest surprise, measured and reported rather than smoothed to the plan's own anticipated shape:** both reference games' `drift-check` returned mostly `drifted`, not mostly `unknown` as `REQUIREMENTS.md`'s VERIFY-06 note and this plan's own `<the_measurement_that_matters_most>` anticipated. Both games in fact carry real `## Verified Commit Hash` values recorded per-chunk (they are pre-provenance only in the `## Verified Against` / Phase 171 sense, not in the `## Verified Commit Hash` / Phase 172 sense). What dominates instead is that both games have had substantial ordinary development land in their manifest files since each chunk's last verified commit, unrelated to the specific rulebook-page classification this phase's finding touches. Reported plainly in `175-PROOF.md` §4/§5 rather than reconciled to the anticipated narrative.
- A transient, non-reproducible `git status --porcelain` flicker on `~/BoardSmithGames/seven` (two phantom deleted `.boardsmith/*` entries, neither tracked per `git ls-files`, neither present on disk) appeared twice during this session, both times resolving to clean on immediate re-runs. Disclosed in `175-PROOF.md` §4 rather than hidden; the authoritative whole-tree sha256 manifest comparison (the actual measured proof this plan's bar requires) never once showed a difference.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 175 (Impact Map & Repair Gating) is now fully complete: all 8 plans executed, VERIFY-04/05/06 all closed in `REQUIREMENTS.md` with citations, and the phase marked complete in `ROADMAP.md`.
- Phase 176 (Stale-Chunk Repair) can now consume this phase's real impact map and line-level attributions directly — `verifyImpactStatusCommand`'s `--json` output (`entries[].attributions[]`, `entries[].gate`) is exactly the contract Phase 176 needs, and this plan's real data shows Phase 176 will have real work to do: 11 of 12 real rules-stale chunks across both reference games genuinely need re-playtesting (`reopen-playtest`), not merely a re-verification stamp.
- The `lineFindings[]` multi-delta persistence gap (only the max-severity quote pair is retained per pair) remains open and is explicitly routed to Phase 176's repair-scoping input contract (`175-PROOF.md` §7) — neither reference game's real finding is a multi-delta pair, so it still cannot be exercised live.
- No blockers identified for Phase 176.

---
*Phase: 175-impact-map-repair-gating*
*Completed: 2026-07-30*

## Self-Check: PASSED

All 6 modified/created files confirmed present on disk (`.planning/phases/175-impact-map-repair-gating/175-08-SUMMARY.md`, `175-PROOF.md`, `src/cli/commands/verify-impact.ts`, `src/cli/commands/verify-impact.test.ts`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`); all three commit hashes (`2a470612`, `74d2b4b7`, `5f9a1a66`) confirmed in `git log`. `npm test`: 3826/3826 green (3825 baseline + 1 new regression test). `npx tsc --noEmit` clean apart from the pre-existing, unrelated `docs/seed-to-state.test.ts` rootDir warning. Both `~/BoardSmithGames` originals (`seven` at `a03f38d4792af9dfc7c798be69686fc3230f54dd`, `one-two-punch` at `7e69471bd8980a854f3e351f2f486e1fb6f712b9`) confirmed byte-identical (whole-tree sha256 diff empty) before and after the entire session.
