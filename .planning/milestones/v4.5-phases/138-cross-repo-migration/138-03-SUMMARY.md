---
phase: 138-cross-repo-migration
plan: 03
subsystem: cross-repo-migration
tags: [MERC, re-vendor, vitest, TestGame, doAction, GAMES-02]

requires:
  - phase: 137-testing-utilities
    provides: "TestGame.doAction() throw-based contract + tryAction() escape hatch"
  - phase: 138-cross-repo-migration
    plan: 01
    provides: "doAction()-migration classification pattern (success-proof-by-reaching-next-line vs tryAction()-for-loop-control), reused verbatim for MERC"
provides:
  - "MERC (~/Dropbox/MERC/BoardSmith/MERC) re-vendored onto a fresh v4.5 BoardSmith tarball, suite green at 738 tests (matching pre-re-vendor baseline exactly, 0 regressions)"
  - "MERC's pre-existing dirty tree (CSS token rename, regenerated gameId, untracked tarball) captured as its own recoverable WIP commit, isolated from the v4.5 migration"
  - "Empirical confirmation that ENG-05's bare-number followUp resolvers (rebel-economy.ts, rebel-equipment.ts) require zero code changes — live suite green, no BoardSmith src fix needed"
affects: [GAMES-02]

tech-stack:
  added: []
  patterns:
    - "MERC re-vendor: npm pack from ~/BoardSmith -> copy tarball into MERC/vendor/ (gitignored) -> update BOTH dependencies.boardsmith and overrides.boardsmith -> npm install -> npx vitest run"
    - "MERC boardsmith.json: playerCount/$schema stripped, same as the 8 example games (CLIX-01)"

key-files:
  created:
    - ~/Dropbox/MERC/BoardSmith/MERC/vendor/boardsmith-0.0.1-20260703202418.tgz (gitignored, not committed)
  modified:
    - ~/Dropbox/MERC/BoardSmith/MERC/package.json
    - ~/Dropbox/MERC/BoardSmith/MERC/package-lock.json
    - ~/Dropbox/MERC/BoardSmith/MERC/boardsmith.json
    - ~/Dropbox/MERC/BoardSmith/MERC/tests/dictator-hire.test.ts
    - ~/Dropbox/MERC/BoardSmith/MERC/src/ui/components/AssignToSquadPanel.vue (captured as-is in the WIP commit, not altered by this plan)

key-decisions:
  - "Per locked CONTEXT decision, MERC's pre-existing uncommitted tree (boardsmith.json reformat/gameId regen, package.json/-lock pointing at an untracked protocol.tgz, AssignToSquadPanel.vue CSS rename) was committed as-is in a standalone `wip:` commit BEFORE the re-vendor, rather than reconciled or discarded"
  - "True pre-re-vendor baseline established fresh (not trusted from CONTEXT's claimed 738): ran `npx vitest run` against the WIP-committed (pre-re-vendor) vendor tarball first -- confirmed exactly 738 passed / 7 skipped / 28 files, matching the CONTEXT claim"
  - "Zero BoardSmith src/ fixes were required -- the only MERC suite failure was the known TST-01 doAction().success migration in tests/dictator-hire.test.ts (same classification pattern as Plan 01: all 6 call sites are should-always-succeed setup/flow-walking moves, none use result.success for loop control -- the loop's continuation already depends on flowState.availableActions, not the doAction return value)"
  - "ENG-05's dual-shape followUp-arg resolvers (rebel-economy.ts getUnit/getSector, rebel-equipment.ts reEquipContinue) were empirically confirmed to need no changes: MERC's full suite (including the AI/MCTS integration tests that exercise these resolvers) passed green on the first re-vendor run"
  - "Re-vendor commit and test-migration commit split into two commits in MERC (chore: re-vendor ... / test: migrate dictator-hire.test.ts ...) per the locked repudiation-avoidance rule (T-138-07): vendor/manifest changes vs. test-file changes stay separable in history"

metrics:
  duration: "~25 minutes"
  completed: 2026-07-03
---

# Phase 138 Plan 03: MERC Re-Vendor Summary

Re-vendored MERC onto a fresh v4.5 BoardSmith tarball; suite green at exactly the 738-test baseline with zero BoardSmith source changes required.

## What Was Built

1. **WIP commit (Task 1):** MERC's pre-existing dirty tree — `boardsmith.json` (gameId regenerated + reformatted), `package.json`/`package-lock.json` (pointing at an untracked `boardsmith-0.0.1-protocol.tgz`), and `src/ui/components/AssignToSquadPanel.vue` (partial `--bs-*` → `--bsg-*` CSS rename) — was committed as-is, unaltered, in a standalone commit (`24ea03e wip: snapshot in-progress local state before v4.5 re-vendor`), per the locked user decision. This isolates unrelated prior work from the v4.5 migration and keeps it recoverable.

2. **True baseline (Task 1):** Ran `npx vitest run` against the WIP-committed (pre-re-vendor) vendor tarball. Result: **738 passed, 7 skipped, 28 test files, 0 failed** — matching the CONTEXT.md-claimed 738 number exactly, now independently verified rather than trusted blind.

3. **Re-vendor (Task 2):** `npm pack` from `~/BoardSmith` produced `boardsmith-0.0.1.tgz`, copied into `~/Dropbox/MERC/BoardSmith/MERC/vendor/boardsmith-0.0.1-20260703202418.tgz` (gitignored, matching the historical pattern — only the manifest/lock files are tracked). Updated both `dependencies.boardsmith` and `overrides.boardsmith` in `package.json` to the new tarball path. Stripped `$schema` and `playerCount` from `boardsmith.json` (CLIX-01, same fix as the 8 example games in Plan 01). Ran `npm install` to regenerate `package-lock.json`.

4. **Iterate to green (Task 3):** First post-re-vendor run surfaced exactly **1 failure**: `tests/dictator-hire.test.ts:28` — `TypeError: Cannot read properties of undefined (reading 'success')`, the same TST-01 `doAction()`-throws-instead-of-returning migration already handled for checkers/go-fish in Plan 01. Classified all 6 `doAction()` call sites in the file (lines 27, 39, 53, 97, 127, 131 per RESEARCH):
   - All 6 are "should always succeed" setup/flow-walking moves — the flow-walking `while` loop's continuation logic depends on `flowState.availableActions`/`flowState.currentPlayer`, never on `result.success`. No site needed `tryAction()`.
   - Removed the now-invalid `result` capture/console.log/`.success` assertions; calls became bare `testGame.doAction(...)` statements (throwing on failure is itself the success proof, per the established Plan 01 pattern).
   - Re-ran the suite: **738 passed, 7 skipped, 28 files, 0 failed** — identical to the pre-re-vendor baseline, confirming no regression and no BoardSmith gap surfaced.

5. **ENG-05 empirical confirmation:** RESEARCH §5 had already read-verified (statically) that MERC's bare-number followUp resolvers (`rebel-economy.ts` `getUnit`/`getSector`, `rebel-equipment.ts` `reEquipContinue`) are dual-shape-tolerant. This plan's live full-suite run (including the AI/MCTS integration tests that actually exercise these resolvers via `followUp.args`) passed with 0 failures related to this category — empirically closing Open Question 1 from RESEARCH. **No BoardSmith `src/` fix was required.**

6. **Commits (MERC):**
   - `24ea03e` — `wip: snapshot in-progress local state before v4.5 re-vendor`
   - `ad70aa8` — `chore: re-vendor boardsmith (v4.5 pit-of-success hardening: SEC/ENG/RST/SESS/UIX/CLIX/SDK/TST + GAMES)`
   - `789abe6` — `test: migrate dictator-hire.test.ts off doAction().success assertions`

7. **BoardSmith suite verified still green:** `npm run test` in `~/BoardSmith` — **175 files / 2368 tests, all passed**, no regression from this plan (no BoardSmith src was touched, so this is a confirmation, not a new fix).

## MERC Migration Ledger

| Item | Baseline (pre-re-vendor) | Post-re-vendor (first run) | Post-fix (final run) |
|------|--------------------------|------------------------------|------------------------|
| Test files | 28 | 28 (1 failed) | 28 (0 failed) |
| Tests | 738 passed / 7 skipped | 737 passed / 1 failed / 7 skipped | 738 passed / 7 skipped |
| Failures | — | `tests/dictator-hire.test.ts` — `doAction().success` (TST-01) | 0 |
| Where fixed | — | — | MERC test file (not BoardSmith src — pure test-migration, category (a) per plan's own classification) |
| BoardSmith src gaps found | — | — | None (ENG-05 confirmed already-tolerant; no other gap surfaced) |

## Deviations from Plan

None — plan executed exactly as written. The single surfaced failure was pre-anticipated by RESEARCH (§2, MERC dictator-hire.test.ts) and resolved via the same classification method already validated in Plan 01, with no need to invoke Rules 1-4 beyond the plan's own explicit test-migration instructions.

## Self-Check: PASSED

- `~/Dropbox/MERC/BoardSmith/MERC/vendor/boardsmith-0.0.1-20260703202418.tgz` — FOUND
- `~/Dropbox/MERC/BoardSmith/MERC/package.json` references `boardsmith-0.0.1-20260703202418.tgz` in both `dependencies` and `overrides` — FOUND
- `~/Dropbox/MERC/BoardSmith/MERC/boardsmith.json` has 0 `$schema`/`playerCount` hits — FOUND (verified via grep during Task 2)
- Commit `24ea03e` (wip) — FOUND in `git log --oneline`
- Commit `ad70aa8` (chore: re-vendor) — FOUND in `git log --oneline`
- Commit `789abe6` (test: migrate) — FOUND in `git log --oneline`
- MERC `npx vitest run`: 738 passed / 7 skipped / 0 failed — CONFIRMED (final run)
- BoardSmith `npm run test`: 175 files / 2368 tests passed — CONFIRMED
