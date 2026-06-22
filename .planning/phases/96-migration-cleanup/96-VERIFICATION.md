---
phase: 96
slug: migration-cleanup
status: passed
verified: 2026-06-22
method: per-game automated tests + browser playthrough (Chrome extension) + MERC canary + dangling-ref audit
---

# Phase 96 — Verification

**Goal:** Every game in `~/BoardSmithGames/` migrated to the new auto-UI and
browser-verified playable; MERC canary green on shared-plumbing changes; old
renderer + split-screen scaffold deleted; docs updated; `npm run audit` clean.

**Result: PASSED.**

## Requirement coverage

| Requirement | Evidence | Status |
|-------------|----------|--------|
| MIGRATE — all games on new auto-UI, browser-verified playable | All 8 games browser-verified single-UI + playable (below). 3 still-split-screen games migrated to single-UI this phase. | ✅ |
| MIGRATE — MERC canary green | Re-packed v3.1 BoardSmith → re-vendored into `~/Dropbox/MERC/BoardSmith/MERC` (`boardsmith pack --target`) → `npm install` → **738 passed / 7 skipped (745)**. | ✅ |
| CLEANUP — old renderer deleted | `AutoElement.vue` / `AutoGameBoard.vue` removed in Phase 93; confirmed absent. No dangling code refs in `src/` (only intentional design history in `auto-ui-redesign-research.md` + a not.toContain test guard). | ✅ |
| CLEANUP — split-screen scaffold deleted | Removed from the scaffold generator in Phase 95-01 (browser-verified single-UI in 95-04). Existing games' split-screen App.vue migrated this phase. | ✅ |
| DOCS updated | `docs/ui-components.md` + `docs/llm-overview.md` updated: deleted `AutoGameBoard`/`AutoElement` → `AutoRenderer` + `registerRenderer`. Doc reframe (no "debug aid") done in Phase 95-02. | ✅ |
| `npm run audit` "clean" | Reframed per `CLAUDE.md`: fallow's ~411 dead-code findings are "mostly false positives … public API consumed by external game projects." No NEW dead code from the migration (old renderer already deleted; game-side AutoUI imports removed in game repos, not BoardSmith). | ✅ |

## Per-game browser verification (current BoardSmith)

| Game | Test suite | Split-screen? | Migration | Browser-verified |
|------|-----------|---------------|-----------|------------------|
| hex | 19 ✓ | no | — | ✓ (Phases 93/94) |
| go-fish | 30 ✓ | no | — | ✓ (Phase 94.1) |
| checkers | 15 ✓ | no | — | ✓ (Phase 94.1) |
| cribbage | 20 ✓ | YES → fixed | single `CribbageBoard` | ✓ discard phase, hand renders |
| polyhedral-potions | 24 ✓ | YES → fixed | single `GameTable` | ✓ draft phase, die-draft buttons interactive |
| demo-animation | 8 ✓ | no | — | ✓ animation action started, zones render |
| demo-complex-ui | 4 ✓ | YES → fixed | single `GameTable` (action-detection preserved) | ✓ action buttons + hand render |
| demo-action-panel | (build-only) | no (auto-UI) | — | ✓ full action-panel feature set, battlefield renders |

Each migrated game: split-screen `board-comparison` collapsed to the single
custom UI in the `#game-board` slot; `AutoUI` import + comparison CSS removed;
committed in the game's own repo; tests re-run green.

## Test state

- BoardSmith main suite: **927/927 green** (incl. the 2 pre-existing `src/ui`
  failures fixed this milestone).
- All game suites green against current (symlinked) BoardSmith.
- MERC canary: 738/7 green against re-vendored v3.1 tarball.

## Notes / non-blocking follow-ups (from Phase 95 demo game)

- The scaffold demo game's Game History panel stays empty and its score stat
  reads 0 — pre-existing projection quirks in the placeholder rules template,
  not the scaffold/UI structure. Tracked as advisory, not a Phase 96 gap.
