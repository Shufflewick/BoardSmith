---
phase: 138-cross-repo-migration
plan: 01
subsystem: testing
tags: [boardsmith.json, vitest, TestGame, doAction, tryAction, cross-repo-migration]

requires:
  - phase: 137-testing-utilities
    provides: "TestGame.doAction() throw-based contract + tryAction() escape hatch; boardsmith.json manifest playerCount/$schema removal (CLIX-01, Phase 135)"
provides:
  - "8/8 BoardSmithGames example-game manifests cleaned of removed playerCount/$schema keys"
  - "checkers + go-fish test suites migrated to the v4.5 doAction()-throws / tryAction()-for-loop-control contract"
  - "8/8 games build green; 7/8 games with suites all green (200 tests); demo-action-panel documented as a pre-existing no-suite gap"
affects: [138-02, 138-03, GAMES-01, GAMES-02]

tech-stack:
  added: []
  patterns:
    - "doAction() success-proof-by-reaching-next-line (no .success assertion needed, throws on failure)"
    - "tryAction() for loop-termination/failure-detection call sites (never throws, returns ActionExecutionResult)"

key-files:
  created: []
  modified:
    - ~/BoardSmithGames/checkers/boardsmith.json
    - ~/BoardSmithGames/cribbage/boardsmith.json
    - ~/BoardSmithGames/demo-action-panel/boardsmith.json
    - ~/BoardSmithGames/demo-animation/boardsmith.json
    - ~/BoardSmithGames/demo-complex-ui/boardsmith.json
    - ~/BoardSmithGames/go-fish/boardsmith.json
    - ~/BoardSmithGames/hex/boardsmith.json
    - ~/BoardSmithGames/polyhedral-potions/boardsmith.json
    - ~/BoardSmithGames/checkers/tests/tutorial-preset.test.ts
    - ~/BoardSmithGames/go-fish/tests/game.test.ts
    - ~/BoardSmithGames/go-fish/tests/complete-game.test.ts
    - ~/BoardSmithGames/go-fish/tests/no-hidden-info-leak.test.ts
    - ~/BoardSmithGames/go-fish/tests/no-hidden-info-dom-leak.test.ts

key-decisions:
  - "no-hidden-info-leak.test.ts's playSeveralAsks helper reclassified from RESEARCH's 'should always succeed' bucket to the loop-control bucket (tryAction, not bare doAction) — its actual code has the identical break-on-failure loop shape as no-hidden-info-dom-leak.test.ts's driveAFewTurns"

requirements-completed: [GAMES-01]

duration: 20min
completed: 2026-07-04
---

# Phase 138 Plan 01: Cross-Repo Game Migration (manifests + doAction contract) Summary

**Stripped the removed `playerCount`/`$schema` keys from all 8 BoardSmithGames manifests and migrated 13 `doAction().success` call sites (checkers 1, go-fish 12) to the v4.5 throw-based `doAction()`/non-throwing `tryAction()` contract — all 8 games build green, 7/8 suites (200 tests) green, demo-action-panel's no-suite state documented as a pre-existing gap.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-07-04T00:59:48Z
- **Completed:** 2026-07-04T01:19:48Z
- **Tasks:** 3
- **Files modified:** 13 (8 manifests + 5 test files)

## Accomplishments
- All 8 `~/BoardSmithGames/*/boardsmith.json` manifests no longer carry the dead `$schema` URL or the removed `playerCount` key (player count is now sole-sourced from `gameDefinition`, per CLIX-01)
- checkers (`tutorial-preset.test.ts`) and go-fish (`game.test.ts`, `complete-game.test.ts`, `no-hidden-info-leak.test.ts`, `no-hidden-info-dom-leak.test.ts`) migrated off the old `.success`-assertion pattern: "should always succeed" sites now call bare `doAction()` (throws on failure = success proof); loop-termination sites (`playSeveralAsks`, `driveAFewTurns`) switched to `tryAction()` to preserve graceful break-on-failure semantics
- All 8 games' `npx boardsmith build` succeeded; 7 games with test suites (checkers, cribbage, demo-animation, demo-complex-ui, go-fish, hex, polyhedral-potions) all green — 200 tests total, 0 failures
- `npx boardsmith validate` now passes in all 8 repos (previously FAILed on checkers/go-fish due to the stale `.success` TypeScript compile errors)
- Each game committed independently in its own repo; confirmed zero game-repo changes leaked into the BoardSmith working tree

## Task Commits

Each game repo carries its own commit (game repos are separate from BoardSmith, per scope discipline):

1. **checkers** - `b0d7153` (chore: migrate to boardsmith v4.5 — manifest + doAction throw contract)
2. **cribbage** - `8234646` (chore: migrate to boardsmith v4.5 — manifest only)
3. **demo-action-panel** - `c45deb5` (chore: migrate to boardsmith v4.5 — manifest only)
4. **demo-animation** - `9c89bf8` (chore: migrate to boardsmith v4.5 — manifest only)
5. **demo-complex-ui** - `b0b625c` (chore: migrate to boardsmith v4.5 — manifest only)
6. **go-fish** - `58d0689` (chore: migrate to boardsmith v4.5 — manifest + doAction throw contract)
7. **hex** - `0e4aa1a` (chore: migrate to boardsmith v4.5 — manifest only)
8. **polyhedral-potions** - `ffead1c` (chore: migrate to boardsmith v4.5 — manifest only)

**Plan metadata:** (BoardSmith commit follows this SUMMARY — see final_commit)

_Note: No BoardSmith-repo source changes in this plan — pure consumer-repo migration._

## Per-Repo Migration Ledger

| Repo | Manifest edit | Test-file edit | Suite result (before → after) | Build result |
|------|---------------|-----------------|-------------------------------|--------------|
| checkers | `$schema`+`playerCount` removed | `tutorial-preset.test.ts:73-77` — dropped `.success` assertion | 37/38 → 38/38 | PASS |
| cribbage | `$schema`+`playerCount` removed | none | 22/22 (unchanged) | PASS |
| demo-action-panel | `$schema`+`playerCount` removed | none | no suite (pre-existing gap, documented below) | PASS |
| demo-animation | `$schema`+`playerCount` removed | none | 9/9 (unchanged) | PASS |
| demo-complex-ui | `$schema`+`playerCount` removed | none | 4/4 (unchanged) | PASS |
| go-fish | `$schema`+`playerCount` removed | `game.test.ts:338,343`, `complete-game.test.ts:174,179,234,239` — dropped `.success` assertions; `no-hidden-info-leak.test.ts:37`, `no-hidden-info-dom-leak.test.ts:34,38` — switched to `tryAction()` (loop-control) | 72/84 → 84/84 | PASS |
| hex | `$schema`+`playerCount` removed | none | 19/19 (unchanged) | PASS |
| polyhedral-potions | `$schema`+`playerCount` removed | none | 24/24 (unchanged) | PASS |

**Known gap:** `demo-action-panel` has no test suite at all (no test files, no `test` script) — this is a pre-existing condition, not something introduced or masked by this migration. GAMES-01's "every suite green" requirement is vacuously satisfied for this repo. Per CONTEXT's scope discipline ("no opportunistic refactors"), no suite was authored.

## Files Created/Modified
- `~/BoardSmithGames/{checkers,cribbage,demo-action-panel,demo-animation,demo-complex-ui,go-fish,hex,polyhedral-potions}/boardsmith.json` - removed dead `$schema` key and removed `playerCount` key (both no longer read by the CLI; player count is sole-sourced from `gameDefinition`)
- `~/BoardSmithGames/checkers/tests/tutorial-preset.test.ts` - dropped `const result =`/`expect(result.success)` around a "should always succeed" `doAction()` call
- `~/BoardSmithGames/go-fish/tests/game.test.ts` - same fix, 1 site
- `~/BoardSmithGames/go-fish/tests/complete-game.test.ts` - same fix, 2 sites
- `~/BoardSmithGames/go-fish/tests/no-hidden-info-leak.test.ts` - `playSeveralAsks` helper switched `doAction()` → `tryAction()` to preserve the break-on-failure loop
- `~/BoardSmithGames/go-fish/tests/no-hidden-info-dom-leak.test.ts` - `driveAFewTurns` helper switched `doAction()` → `tryAction()`, same reason

## Decisions Made
- Reclassified `no-hidden-info-leak.test.ts`'s `playSeveralAsks` helper from the plan's literal "should always succeed → delete assertion" bucket into the loop-control bucket. Reading the actual code showed it has the identical `if (!result.success) break;` loop-termination shape as `no-hidden-info-dom-leak.test.ts`'s `driveAFewTurns` — deleting the assertion (per the plan's literal Task 2(a) instruction) would have made the helper throw and abort the test on the very failure condition it's designed to detect. Applied Pitfall 3's classification rule directly from the source instead of the plan's derived table. This is a Rule 1 (bug) auto-fix — the plan's classification for this one site was incorrect; the underlying "detect failure, don't assert success" rule from the RESEARCH doc was followed faithfully.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in plan's own classification] `no-hidden-info-leak.test.ts` needed `tryAction()`, not assertion-deletion**
- **Found during:** Task 2
- **Issue:** 138-01-PLAN.md Task 2(a) classified `no-hidden-info-leak.test.ts:37` (+ downstream `.success` read) as a "should always succeed" site needing assertion deletion. The actual code (`playSeveralAsks` helper) is a `for` loop with `if (!result.success) break;` — identical in structure to the plan's own Task 2(b) `driveAFewTurns` loop-control classification.
- **Fix:** Switched `testGame.doAction(...)` → `testGame.tryAction(...)` in `playSeveralAsks`, keeping `if (!result.success) break;` intact — same fix pattern the plan correctly specified for `driveAFewTurns`.
- **Files modified:** `~/BoardSmithGames/go-fish/tests/no-hidden-info-leak.test.ts`
- **Verification:** `npx vitest run` in go-fish — all 84 tests pass, including the 4 `no-hidden-info-leak` seed tests that exercise this helper.
- **Committed in:** `58d0689` (go-fish repo commit)

---

**Total deviations:** 1 auto-fixed (1 bug in plan's own classification table)
**Impact on plan:** Correct behavior preserved (loop gracefully stops on no-legal-move rather than throwing); no scope creep — fix stayed within the plan's already-declared file/task boundary.

## Issues Encountered
None — the only surprise was the single misclassification above, caught by `npx boardsmith validate`'s TypeScript compile check and confirmed by reading the actual source before editing (per `<read_first>` guidance).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- GAMES-01 (the 8-game portion) is satisfied: all 8 manifests migrated, all 8 builds green, 7/8 suites green (200 tests, 0 failures), demo-action-panel's no-suite state documented as a pre-existing gap.
- Plan 138-02/138-03 (MERC re-vendor, GAMES-02, Playwright smokes per CONTEXT) are unblocked — this plan's scope was strictly the 8 example games in `~/BoardSmithGames/`; MERC's pre-existing uncommitted tree state (flagged in 138-RESEARCH.md) is untouched and still needs a checkpoint decision in a later plan.
- No BoardSmith `src/` changes were needed in this plan (all breaking-change categories beyond manifest/doAction returned zero hits per RESEARCH) — the library's own 175-file/2368-test suite was not touched or re-run here.

---
*Phase: 138-cross-repo-migration*
*Completed: 2026-07-04*

## Self-Check: PASSED

All 8 game-repo commits verified present via `git log --oneline --all` in their respective repos (checkers b0d7153, cribbage 8234646, demo-action-panel c45deb5, demo-animation 9c89bf8, demo-complex-ui b0b625c, go-fish 58d0689, hex 0e4aa1a, polyhedral-potions ffead1c). SUMMARY.md file confirmed present at its stated path. BoardSmith metadata commit confirmed present.
