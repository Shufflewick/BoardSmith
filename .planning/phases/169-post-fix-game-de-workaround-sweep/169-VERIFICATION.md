---
phase: 169-post-fix-game-de-workaround-sweep
verified: 2026-07-22T01:00:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
---

# Phase 169: Post-Fix Game De-Workaround Sweep Verification Report

**Phase Goal:** Once the library/platform/skills fixes have landed and are verified, every workaround and deferment that existed *only* because of a now-fixed bug is removed across all five game repos, each removal gated on its specific fix being verified in the shipped library and each game's suite staying green; the deferred AI opponents are re-verified and closed, and the stale Doom BS-10 filing is reclassified.

**Verified:** 2026-07-22
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth (Success Criterion) | Status | Evidence |
|---|---------|--------|----------|
| 1 | Every now-unneeded workaround across the 5 game repos is removed, gated on its specific fix being verified present | ✓ VERIFIED | `169-CROSSWALK.md` Section 2 grep-verified 12 `Dxx` verdicts against live `src/`; independently re-grepped D1, D8, D9, D24, D32 myself against `/Users/jtsmith/BoardSmith/src` and confirmed the cited file:line evidence is real (`src/session/utils.ts:402` `assertUndoAllowed`, `src/ai/mcts-bot.ts:971,1149` `toJSONForPlayer`, `src/engine/utils/resolve-multiselect.ts:26` `resolveMultiSelect`, `src/engine/element/game.ts:2862-2874` D24 hidden-zone no-childCount-leak, `grep -rn DRAWDROP src/` empty for D32). Actual removals: seven BSR-1 (D24, `concealFromEverySeat` redundant call deleted), seven BSR-5 (D1, docblocks + 5 undo tripwires flipped), BoardSmithGames2/seven BOARDSMITH-BUG-02 (D1, 4-test pinned-defect block flipped + docblocks). Non-removal dispositions (kept-and-noted, no-op, out-of-scope, deferred) are individually justified per row, not silently skipped. |
| 2 | Every game's full suite is green after its workarounds are removed — no regression traded for cleanliness | ✓ VERIFIED | I independently re-ran `npx vitest run` in all 5 repos on the checked-out `sweep/v4.8-dework` branches and the counts match the SUMMARYs exactly: lanternfall 214/214 (5 files), seven 204/205 (1 pre-existing SIM-family failure, logged), one-two-punch 228/228, doom-machine 399/405 (6 pre-existing failures, logged), BoardSmithGames2/seven 370/374 (4 pre-existing failures, logged). All failing counts match `deferred-items.md`'s pre-existing-failure descriptions verbatim (same test names, same symptom). No new failures introduced by the sweep in any repo. |
| 3 | The deferred AI opponents are re-verified and closed — run-003 BSR-12 now builds and passes | ✓ VERIFIED | `169-CROSSWALK.md` Section 1a aggregates a recorded PASS for all 4 AI-bearing repos (lanternfall untracked-WIP PASS, seven scratch-repro PASS, one-two-punch committed-suite PASS, BoardSmithGames2/seven scratch-repro PASS); doom-machine correctly excluded as N/A (solo, no AI). I independently ran one-two-punch's committed `tests/ai.test.ts` — 5/5 pass. Rule stated and honored: "A missing per-repo status forces KEPT-OPEN — never an unevidenced CLOSED"; no status is missing. |
| 4 | The stale Doom BS-10 filing is reclassified as a game-side fix, not re-fixed as a library bug; the `<base href>` gap is folded into a scaffold recommendation | ✓ VERIFIED | `169-CROSSWALK.md` BS-10 row: verified by inspection that `src/rules/cards.ts` (20 refs) + tracker Vue components already use absolute `/cards/*.png` paths, commit `6949fde` predating this sweep — a pre-existing game-side fix, correctly reclassified rather than re-fixed. The dev-host `<base href="/">` gap is recorded as a "RECOMMENDATION (not implemented here)" in the no-op/withdrawn table, explicitly not an engine change. `git diff --stat -- src/` in the library repo confirms zero library `src/` edits this phase. |
| 5 | No workaround is removed whose underlying fix is not verified present (PROC-01 gate) | ✓ VERIFIED | Checked specifically for D32: crosswalk records D32 as **ABSENT** (by design — platform-side per Phase 165) and explicitly notes "not a blocker for any of the 5 repos' sweeps, since no game repo's removal target depends on D32." No repo removed anything gated on D32 or any other ABSENT verdict. All 12 `Dxx` entries actually gating a removal candidate in Section 1 are PRESENT in Section 2. |

**Score:** 5/5 truths verified

### Branch Safety

| Repo | Branch | On master? | Remote push? |
|------|--------|-----------|---------------|
| lanternfall | `sweep/v4.8-dework` | No (master tip unchanged at `a19adfc`) | No remote configured |
| seven | `sweep/v4.8-dework` | No (master tip unchanged at `18a1ee0`) | No remote configured |
| one-two-punch | `sweep/v4.8-dework` | No (master tip unchanged at `e939cac`) | No remote configured |
| doom-machine | `sweep/v4.8-dework` | No (master tip unchanged at `c8472f1`) | No remote configured |
| BoardSmithGames2/seven | `sweep/v4.8-dework` | No (master tip unchanged at `62a8dfd`) | No remote configured |

All 5 sweep commits are file-scoped, independently confirmed via `git show --stat` against the actual commit objects (not just SUMMARY claims): lanternfall `2c66931` (2 files), seven `7708361` (5 files), one-two-punch `7e69471` (2 files), doom-machine `4cd3a95` (3 files), BoardSmithGames2/seven `51be171` (3 files). None of the game repos have a configured git remote, so "no push happened" is structurally guaranteed.

Two repos have pre-existing dirty/untracked state on their sweep branches (lanternfall: modified `src/rules/index.ts` + untracked `ai.ts`/`ai-smoke.test.ts`, file-dated 2026-07-16, six days before the sweep; one-two-punch: deleted `.boardsmith/runtime-*` build artifacts). Neither is staged in the sweep commits (`git show --stat` confirms exact file lists) and both are consistent with the SUMMARYs' own description of them as pre-existing, deliberately-excluded state.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `.planning/phases/169-post-fix-game-de-workaround-sweep/169-CROSSWALK.md` | Dxx↔BUG-n crosswalk + fix-present checklist + final BSR-12 verdict + 5-repo reconciliation | ✓ VERIFIED | 263 lines; all 5 repos' ledgers covered row-by-row (Section 1), 12-row fix-present checklist with grep evidence (Section 2), aggregated BSR-12 verdict (Section 1a), full reconciliation (Section 1b). |
| `.planning/phases/169-post-fix-game-de-workaround-sweep/deferred-items.md` | Pre-existing failures logged, not masked | ✓ VERIFIED | 3 entries (seven SIM-family, doom-machine 6-test family, BoardSmithGames2/seven 4-test family) with symptom, root-cause hypothesis, and disposition; all match my independently-run suite output exactly. |
| 5× `169-0{2..6}-SUMMARY.md` | Per-repo sweep record | ✓ VERIFIED | All present, cross-checked against actual git history and live test runs (see truths above). |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| lanternfall suite green post-sweep | `cd ~/BoardSmithGames/lanternfall && npx vitest run` (on `sweep/v4.8-dework`) | 214/214 passed (5 files) | ✓ PASS |
| seven suite green (1 pre-existing failure) | `cd ~/BoardSmithGames/seven && npx vitest run` | 204/205 passed, failure = logged SIM-family item | ✓ PASS |
| one-two-punch suite green | `cd ~/BoardSmithGames/one-two-punch && npx vitest run` | 228/228 passed | ✓ PASS |
| doom-machine suite (6 pre-existing failures) | `cd ~/BoardSmithGames/doom-machine && npx vitest run` | 399/405 passed, failures = logged deck-secrecy family | ✓ PASS |
| BoardSmithGames2/seven suite (4 pre-existing failures) | `cd ~/BoardSmithGames2/seven && npx vitest run` | 370/374 passed, failures = logged mess-childCount family | ✓ PASS |
| one-two-punch committed AI suite | `cd ~/BoardSmithGames/one-two-punch && npx vitest run tests/ai.test.ts` | 5/5 passed | ✓ PASS |
| Library repo `src/` untouched by sweep | `git diff --stat -- src/` in BoardSmith repo | empty | ✓ PASS |
| Library repo suite still green | `npm run test -- --run` in BoardSmith repo | 3138/3138 passed (216 files) | ✓ PASS |
| D32 correctly absent, nothing removed for it | `grep -rn "DRAWDROP" src/` in BoardSmith repo | no matches | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SWEEP-01 | 169-01..06 | Five-repo gated de-workaround sweep, AI re-verify + close, BS-10 reclassify | ✓ SATISFIED | See truths 1–4 above. |
| PROC-01 | 169-01..06 | Fix→test→adversarial-verify discipline; no defect closed on green build alone; gate honored | ✓ SATISFIED | Crosswalk gate genuinely enforced (D32 correctly left ABSENT/no-op); each removal cites PRESENT verdict with real grep evidence; each kept-and-noted item documents an actual removal *attempt* that regressed tests (lanternfall BUG 7 turned `a11y.test.ts` red; one-two-punch BUG 3's `assertPlanLockHolds` turned 4 tests red) — this is adversarial verification, not a rubber stamp. |

### Anti-Patterns Found

None. No TBD/FIXME/XXX, no placeholder returns, no masked failures — pre-existing failures are explicitly logged to `deferred-items.md` with symptom, hypothesis, and recommendation rather than silently skipped or hidden.

### Human Verification Required

None. All claims in this phase are independently re-checkable by grep/git/vitest, and I re-ran every one rather than trusting the SUMMARYs.

### Gaps Summary

No gaps. Independent re-verification (grepping the library source for each cited `Dxx` fix, re-running all 5 game suites from scratch on their sweep branches, inspecting actual git commit contents via `git show --stat`, and confirming branch/remote safety) confirms the SUMMARY and CROSSWALK claims are accurate, not merely asserted. The one process deviation worth noting for the record (not a gap): doom-machine's and BoardSmithGames2/seven's Task 1 baselines were NOT green (contrary to their plans' literal wording expecting a green baseline) — both SUMMARYs report this honestly rather than mis-stating it, and I independently confirmed the reported failure counts are accurate and unchanged by the sweep.

---

*Verified: 2026-07-22*
*Verifier: Claude (gsd-verifier)*
