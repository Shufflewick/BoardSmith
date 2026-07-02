---
phase: 129-migration-games-merc
plan: 03
subsystem: MERC re-vendor + phase-wide verification gate
tags: [migration, merc, re-vendor, grep-sweep, simulate, MIG-03, MIG-04]
dependency-graph:
  requires: [129-01 (non-flagship game migration), 129-02 (flagship test adoption)]
  provides: [MERC re-vendored to v4.4, phase-wide breakage-surface sweep clean, simulate smoke proof]
  affects: ["~/Dropbox/MERC/BoardSmith/MERC/package.json", "~/Dropbox/MERC/BoardSmith/MERC/package-lock.json", "BoardSmith src/testing/dom-leak.ts"]
tech-stack:
  added: []
  patterns: ["boardsmith pack --target <dir> as the single-command re-vendor (pack + copy + package.json ref update + npm install), superseding the old manual npm-pack-then-cp-then-edit procedure documented in RESEARCH", "lazy dynamic import() for opt-in test-only dependencies (@vue/test-utils), mirroring the existing loadAutoUI() pattern"]
key-files:
  created: []
  modified:
    - ~/Dropbox/MERC/BoardSmith/MERC/package.json
    - ~/Dropbox/MERC/BoardSmith/MERC/package-lock.json
    - ~/BoardSmith/src/testing/dom-leak.ts
decisions:
  - "Used `npx boardsmith pack --target ~/Dropbox/MERC/BoardSmith/MERC` (a single CLI command) instead of RESEARCH's manual npm-pack/cp/edit-package.json procedure -- the CLI's --target flag already performs steps 1-4 atomically (pack, copy to vendor/, update both dependencies.boardsmith and overrides.boardsmith refs, run npm install), producing an identical timestamped-tarball result with less room for a copy-paste-timestamp mismatch."
  - "MERC's pre-existing uncommitted package.json version bump (0.0.27 -> 0.0.28) lives on the SAME lines file as the boardsmith re-vendor refs but in a different hunk. Staged the commit by temporarily reverting the version line in the working tree, running `git add`, then restoring the 0.0.28 bump in the working tree -- this stages ONLY the boardsmith-ref hunks in the index while leaving the user's WIP (version bump + AssignToSquadPanel.vue) fully untouched and still uncommitted in the working tree, satisfying the plan's do-not-touch caveat without needing `git add -p`'s interactive prompt."
  - "The re-vendor's first vitest run surfaced a genuine v4.4 regression (not MERC-side): dom-leak.ts's static top-level `import { mount } from '@vue/test-utils'` made Vite eagerly resolve @vue/test-utils for ANY consumer of boardsmith/testing, even code that never calls renderAsSeat. MERC (by design, no DOM-leak test adoption this phase) has no @vue/test-utils installed, so its entire 28-file suite failed to load. Fixed in BoardSmith src/ (never worked around in MERC) by deferring the import behind a dynamic import(), mirroring the existing loadAutoUI() lazy-load pattern in the same file. Re-packed and re-vendored after the fix; MERC suite went green at exactly 738/7."
metrics:
  duration: "~35 minutes"
  completed: "2026-07-02"
---

# Phase 129 Plan 03: MERC Re-vendor + Phase-Wide Verification Gate Summary

Re-vendored MERC against a freshly packed v4.4 BoardSmith tarball, fixed a genuine v4.4 regression the re-vendor surfaced (an eager `@vue/test-utils` import in `boardsmith/testing`'s DOM-leak utility that broke every consumer without that devDependency installed), got MERC's suite back to its exact 738/7 baseline, and closed out the phase with a repo-wide breakage-surface grep sweep (all 9 repos, zero hits) plus a deterministic `boardsmith simulate` smoke run against hex and checkers.

## What Was Built

**MERC re-vendor** (`~/Dropbox/MERC/BoardSmith/MERC`):
- Ran `npx boardsmith pack --target ~/Dropbox/MERC/BoardSmith/MERC` from the BoardSmith repo — this single command packed a fresh v4.4 tarball, copied it into MERC's `vendor/`, updated both `dependencies.boardsmith` and `overrides.boardsmith` in `package.json` to `file:./vendor/boardsmith-0.0.1-20260702190858.tgz`, and ran `npm install` to regenerate `package-lock.json`.
- First `npx vitest --run` after the pack revealed a genuine regression (see Deviations below); fixed in BoardSmith `src/`, then re-packed (new timestamp `20260702190858`) and re-vendored.
- Final suite result: **28 files, 738 passed | 7 skipped** — exactly matches the pre-migration baseline.
- MERC's own breakage-surface grep sweep: zero `headless-harness` hits; all 7 `.shuffle()` call sites are in-game `Deck`/`Space`-style no-arg calls (`tacticsDeck.shuffle()`, `game.mercDeck.shuffle()`, etc. — never a detached `ElementCollection.shuffle()`); `playUntilComplete` confirmed to resolve to MERC's own local helper (`tests/helpers/auto-play.ts`, imports only `GameRunner` from `boardsmith/runtime`), not a `boardsmith` subpath export.
- Committed `chore: re-vendor boardsmith (v4.4 agent-ergonomics gaps: VIS/SIM/ERR/DRIVE/ANIM/FLOW + MIG)` — commit `87cee4a`, touching only `package.json` + `package-lock.json` (2 files changed, 8 insertions/8 deletions). The user's pre-existing uncommitted WIP (`package.json` version 0.0.27→0.0.28, `AssignToSquadPanel.vue`) was left untouched and still uncommitted in the working tree.

**Phase-wide verification gate:**
- Grep sweep across all 9 repos (8 games + MERC) for `headless-harness` imports, detached `ElementCollection.shuffle()` no-arg calls, and `playUntilComplete` imports from a `boardsmith` subpath: **zero disallowed hits in every repo.**
- `boardsmith simulate --seed <seed> --json` run against hex and checkers: both completed with exit 0, all 10 seeded games per run reaching `"status": "complete"` with a winner. Re-ran hex's exact seed twice and diffed the JSON output byte-for-byte identical, confirming SIM-01's determinism guarantee holds against a real game (not just BoardSmith's own unit tests).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `boardsmith/testing`'s dom-leak.ts eagerly imported `@vue/test-utils`, breaking every consumer without that devDependency**
- **Found during:** Task 1, first `npx vitest --run` in MERC after the initial re-vendor pack
- **Issue:** `src/testing/dom-leak.ts` had a static top-level `import { mount, type VueWrapper } from '@vue/test-utils'`. Because `src/testing/index.ts` re-exports `dom-leak.ts`'s functions from the `boardsmith/testing` barrel, Vite eagerly resolved `@vue/test-utils` for ANY test file importing `boardsmith/testing` at all — even ones that never call `renderAsSeat`/`assertNoHiddenInfoLeak`. MERC has no `@vue/test-utils` installed (correct, by design: MERC does no DOM-leak test adoption this phase, per CONTEXT.md's "MERC: no new test adoption" scope), so all 18 of its 28 test files that import `boardsmith/testing` (for `createTestGame`, etc.) failed at module-resolution time with `Error: Failed to load url @vue/test-utils`.
- **Fix:** Deferred the `@vue/test-utils` import behind a dynamic `import()`, mirroring the file's own existing `loadAutoUI()` lazy-load pattern (which already defers `AutoUI.vue`'s import for an analogous reason — installing a jsdom polyfill before the module graph evaluates). Added a `loadMount()` cached-promise loader; `renderAsSeat` now awaits both `loadAutoUI()` and `loadMount()` via `Promise.all` before calling `mount()`. This is a strict behavior-preserving change for any caller that DOES have `@vue/test-utils` installed (BoardSmith's own 13 dom-leak.test.ts tests, and go-fish's flagship DOM-leak test from Plan 129-02) — the import still happens, just lazily on first actual use instead of eagerly at module load.
- **Files modified:** `~/BoardSmith/src/testing/dom-leak.ts`
- **Verification:** `npx vitest run src/testing/dom-leak.test.ts` (13/13 passed) and the full BoardSmith suite (`npx vitest run` — 159 files, 2081/2081 passed) both green after the fix, confirming no regression to the utility's real behavior. Re-packed the tarball, re-vendored into MERC, and MERC's suite went from 18 failed/10 passed to 28/28 passed at exactly the 738/7 baseline.
- **Commit:** `fb09f4b` (BoardSmith repo)

No other deviations. The re-vendor procedure itself (steps 1-4) collapsed into a single `boardsmith pack --target` invocation rather than RESEARCH's manual multi-step sequence — this is a tooling improvement already available in the CLI (not a plan change), producing an identical end result (timestamped tarball, both `package.json` refs updated, `package-lock.json` regenerated).

## Verification Results

| Check | Result |
|-------|--------|
| MERC suite (`npx vitest --run`) | 28 files, **738 passed \| 7 skipped** — matches baseline exactly |
| MERC `package.json` refs | Both `dependencies.boardsmith` and `overrides.boardsmith` point at `file:./vendor/boardsmith-0.0.1-20260702190858.tgz` |
| MERC breakage-surface grep sweep | Zero `headless-harness` hits; all `.shuffle()` calls confirmed in-game no-arg form; `playUntilComplete` confirmed local |
| MERC commit scope | Only `package.json` + `package-lock.json` touched (2 files); user's WIP (version bump + `AssignToSquadPanel.vue`) untouched, still uncommitted |
| Phase-wide grep sweep (9 repos) | Zero disallowed hits across checkers, cribbage, demo-action-panel, demo-animation, demo-complex-ui, go-fish, hex, polyhedral-potions, MERC |
| `boardsmith simulate` — hex | 10/10 seeded games completed, exit 0; repeat run byte-identical (deterministic) |
| `boardsmith simulate` — checkers | 10/10 seeded games completed, exit 0 |
| BoardSmith's own suite (post-fix) | 159 files, 2081/2081 passed |

## Known Stubs

None.

## Threat Flags

None — this plan's only new BoardSmith `src/` change (the dynamic-import deferral in `dom-leak.ts`) is a pure lazy-loading refactor of an existing test-only code path; no new network endpoints, auth paths, or schema changes.

## Self-Check: PASSED

- `~/Dropbox/MERC/BoardSmith/MERC/package.json` boardsmith refs — FOUND (both point at `boardsmith-0.0.1-20260702190858.tgz`)
- MERC commit `87cee4a` — FOUND (`git log --oneline` in MERC)
- BoardSmith commit `fb09f4b` — FOUND (`git log --oneline` in BoardSmith)
- `~/BoardSmith/src/testing/dom-leak.ts` lazy-import fix — FOUND (verified via Read + passing test run)
- MERC user WIP (`package.json` 0.0.28, `AssignToSquadPanel.vue`) — confirmed still uncommitted in working tree (`git status --short` in MERC shows both as modified, unstaged)
