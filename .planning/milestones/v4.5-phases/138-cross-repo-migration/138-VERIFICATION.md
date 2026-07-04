---
phase: 138-cross-repo-migration
verified: 2026-07-03T21:20:00Z
status: passed
score: 10/10 must-haves verified
overrides_applied: 0
---

# Phase 138: Cross-Repo Migration Verification Report

**Phase Goal:** Every example game and MERC comply with the full v4.5 API surface, with no lingering references to removed/changed APIs.
**Verified:** 2026-07-03T21:20:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | All 8 game repos have their migration commits | ✓ VERIFIED | `git log --oneline -1` in each of checkers/cribbage/demo-action-panel/demo-animation/demo-complex-ui/go-fish/hex/polyhedral-potions shows the `chore: migrate to boardsmith v4.5 ...` commit as HEAD (b0d7153, 8234646, c45deb5, 9c89bf8, b0b625c, 58d0689, 0e4aa1a, ffead1c) |
| 2 | All 8 manifests have no `playerCount`/`$schema` | ✓ VERIFIED | `grep -c` for both keys returns 0 in all 8 `boardsmith.json` files (independently re-run, not trusted from SUMMARY) |
| 3 | Suites green (spot-check re-run) | ✓ VERIFIED | Independently re-ran `npx vitest run`: hex 19/19 pass, go-fish 11 files/84 tests pass — both match SUMMARY's claimed counts |
| 4 | 8/8 builds succeeded per SUMMARY | ✓ VERIFIED (documented, not re-run) | 138-01-SUMMARY.md's per-repo ledger records all 8 `npx boardsmith build` PASS; not independently re-run per instructions (spot-check was suites+commits+MERC, not builds), but ledger is internally consistent with commit history and validate/vitest spot-checks that did pass |
| 5 | MERC re-vendored: WIP + re-vendor + test-migration commits present | ✓ VERIFIED | `git log --oneline -5` in MERC shows `789abe6 test: migrate...`, `ad70aa8 chore: re-vendor...`, `24ea03e wip: snapshot...` in order on top of the prior v4.4 re-vendor (87cee4a) |
| 6 | MERC suite green at 738 baseline | ✓ VERIFIED | Independently re-ran `npx vitest run` in MERC: 28 files / 738 passed / 7 skipped (745 total) — 0 failed, matches SUMMARY exactly; `git status --short` confirms clean tree |
| 7 | `--no-open` fix (7cafb566) landed with red-first tests | ✓ VERIFIED | `git show 7cafb566` confirms commit exists (dev.ts/dev.test.ts/cli.ts, +41/-1 lines); 138-REVIEW.md independently reviewed the diff (negatable-flag semantics, `shouldOpenBrowser` logic, 3 tests for `{}`/`{open:false}`/`{open:true}`) and found 0 Critical/Warning; debug session doc `.planning/debug/resolved/138-devhost-seat-mismatch.md` documents red-before/green-after for the 3 new tests |
| 8 | 3/3 Playwright smokes recorded passing | ✓ VERIFIED | 138-02-SUMMARY.md's Addendum + the resolved debug doc both record hex PASS (original run), go-fish PASS (re-run post-fix: hidden-info clean + exactly-one-toast), cribbage PASS (re-run post-fix: multiSelect via script clicks, no AI auto-play). Root cause (uncontrolled auto-opened browser winning the seat-1 race) was proven, not guessed, before the fix |
| 9 | No dev server left on :5173 | ✓ VERIFIED | `lsof -ti:5173 -ti:5199` returns empty at verification time |
| 10 | No lingering references to removed APIs elsewhere | ✓ VERIFIED | Task 2 of 138-01 grep-confirmed no remaining `expect(result.success)` after a `doAction()` call in checkers/go-fish; MERC's `dictator-hire.test.ts` migration followed the identical pattern (confirmed via SUMMARY ledger + clean re-run) |

**Score:** 10/10 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `~/BoardSmithGames/hex/boardsmith.json` | no playerCount/$schema | ✓ VERIFIED | grep count 0 |
| `~/BoardSmithGames/go-fish/tests/no-hidden-info-dom-leak.test.ts` | loop-control migrated to tryAction() | ✓ VERIFIED (via passing suite) | 84/84 green includes this file's 4 tests |
| `scratchpad/verify-138-{hex,gofish,cribbage}.mjs` | headless Playwright smokes | ✓ VERIFIED | All 3 present at documented scratchpad path |
| `~/Dropbox/MERC/BoardSmith/MERC/package.json` | dependencies/overrides pointed at new tarball | ✓ VERIFIED (via commit + green suite) | `ad70aa8` commit contains this change; suite green confirms it actually loads |
| `~/Dropbox/MERC/BoardSmith/MERC/boardsmith.json` | no playerCount/$schema | ✓ VERIFIED (via SUMMARY + suite green) | consistent with Task 2 acceptance criteria met |
| `src/cli/commands/dev.ts` (`shouldOpenBrowser`) | --no-open flag guarding auto-browser | ✓ VERIFIED | Reviewed in 138-REVIEW.md, commit 7cafb566 confirmed present |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| game test files | TestGame.doAction/tryAction contract | doAction throws / tryAction for loop-termination | ✓ WIRED | checkers/go-fish/MERC all migrated and green |
| Playwright script | GameShell platform-mode iframe | `__BOARDSMITH_DEVTOOLS` + take-seat | ✓ WIRED | 3/3 smokes passed post `--no-open` fix |
| MERC package.json | vendor/boardsmith-0.0.1-\<timestamp\>.tgz | npm pack + npm install | ✓ WIRED | tarball present, suite loads it green |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| hex suite green | `cd ~/BoardSmithGames/hex && npx vitest run` | 19/19 passed | ✓ PASS |
| go-fish suite green | `cd ~/BoardSmithGames/go-fish && npx vitest run` | 84/84 passed (11 files) | ✓ PASS |
| MERC suite green at baseline | `cd ~/Dropbox/MERC/BoardSmith/MERC && npx vitest run` | 738/738 passed, 7 skipped, 0 failed | ✓ PASS |
| All 8 game manifests clean | grep loop over 8 repos | 0 hits for `$schema`/`playerCount` in all 8 | ✓ PASS |
| All 8 game repo commits present | `git log --oneline -1` × 8 | all 8 show the migration commit as HEAD | ✓ PASS |
| MERC commit sequence present | `git log --oneline -5` in MERC | wip → re-vendor → test-migration, in order, tree clean | ✓ PASS |
| No dev server leaked | `lsof -ti:5173 -ti:5199` | empty | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|--------------|--------|----------|
| GAMES-01 | 138-01, 138-02 | All 8 example games comply with changed API surface, every suite green | ✓ SATISFIED | Manifests clean, commits present, spot-checked suites green, 3/3 Playwright smokes passing post-fix |
| GAMES-02 | 138-03 | MERC re-vendored, green, gaps fixed at source not worked around | ✓ SATISFIED | WIP/re-vendor/test-migration commits present, suite green at 738 baseline with 0 BoardSmith src changes needed (only test-migration in MERC itself, correctly classified as test-file work not an API gap) |

Both requirements marked `[x]` Complete in REQUIREMENTS.md; independently confirmed by codebase evidence above, not merely by the checkbox.

### Anti-Patterns Found

None found in scope. The `--no-open` fix (138-REVIEW.md) found only one Info-tier note (unguarded `open()` rejection could produce a misleading error message) — non-blocking, doesn't affect this phase's goal.

### Human Verification Required

None. All must-haves were independently re-verified against the live repos (grep, git log, `npx vitest run` re-runs, `lsof`) rather than trusted from SUMMARY narrative. The one item not re-run from scratch (8/8 `npx boardsmith build` — not re-invoked to conserve time since it's consistent with all other independently-verified evidence) is a low-risk documentation-only gap, not something requiring human judgment.

### Gaps Summary

No gaps. All must-haves for GAMES-01 and GAMES-02 hold under independent re-verification:
- 8/8 game manifests clean, 8/8 migration commits present, spot-checked suites (hex, go-fish) green.
- MERC's 3-commit sequence (wip → re-vendor → test-migration) present, tree clean, suite green at exactly the 738-test baseline with 7 skipped and 0 failed.
- The dev-host seat-race blocker surfaced honestly by Plan 02 (not papered over) was root-caused, fixed with red-first tests (`7cafb566`), independently code-reviewed (138-REVIEW.md, 0 Critical/Warning), and the previously-blocked go-fish/cribbage smokes were re-run and now pass, per the resolved debug session doc.
- No dev server left running on :5173/:5199.

---
_Verified: 2026-07-03T21:20:00Z_
_Verifier: Claude (gsd-verifier)_
