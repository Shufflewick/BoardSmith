---
phase: 121-game-merc-migration
subsystem: engine + cross-repo
tags: [migration, pit-02, built-in-exemption, re-vendor, MERC]
requirements: [MIG-01, MIG-02]
completed: "2026-07-01"
mode: scouting-driven (minimal scope, user-chosen)
---

# Phase 121: Game & MERC Migration — Summary

**One-liner:** Migration scouting proved the new v4.3 surface against every real game; the only code change needed was one `src/` guard fix (PIT-02 must exempt built-in element classes). All 7 game suites, BoardSmith (1873), and the re-vendored MERC canary (738/7) are green.

## Approach (per user scope decisions, 2026-07-01)

- **PIT-02 gap fix:** "Seed built-ins into registry."
- **MIG-01 adoption:** "Minimal — green + guard fix" (don't refactor already-clean games).
- **MERC:** "Re-vendor + verify now."

## What Was Done

### 1. src/ guard fix — PIT-02 built-in-element-class exemption (commit on main)
Scouting ran all 7 game test suites against current BoardSmith (guards live via the `node_modules/boardsmith` symlink). **6/7 already green**; only **polyhedral-potions failed** (21 tests), all from one root cause: PIT-02 threw on the framework built-in `Die`, queried internally by `DicePool.getDice()` → `this.all(Die)`. The game registers only its subclass `IngredientDie`; PIT-02's criterion targets *custom* classes, so flagging a framework built-in was a false positive.

Fix (`src/engine/element/game.ts`, `game-element.ts`, `types.ts`):
- Seed all built-in element classes (GameElement, Space, Piece, Card, Hand, Deck, Die, DicePool, Grid, GridCell, HexGrid, HexCell) into `classRegistry` at construction — so polymorphic base-class queries resolve and PIT-02 only ever flags unregistered CUSTOM classes.
- Made `registerElements` AND `createElement` auto-registration **override the built-in default seed** with the class actually registered/instantiated (tracked via `_ctx._builtinSeededNames`), so a custom class sharing a built-in name is never silently shadowed (fixes serialization round-trip for such classes).
- Regression test: a flow querying built-in `Die` unregistered no longer throws; existing array-persistence / restore-snapshot tests (which use local classes named `Die`/`Card`/`Hand`) stay green via the override.

### 2. MIG-01 adoption — none required (reuse-not-rebuild)
Scanned all games for hand-rolled patterns the new APIs replace (`{value,display}` arg construction, manual legal-move enumeration, low-level `resolveChoices`/`selectionStep`, snapshot JSON parsing). Found none: the only hits were correct `chooseFrom` choice definitions and legitimate `JSON.parse(JSON.stringify(getSnapshot()))` serialization round-trip tests. Games already delegate move enumeration to the framework MCTS (which uses Phase 117's `enumerateLegalMoves` internally), so they benefit transparently. No game code changed.

### 3. MERC re-vendor + verify (commit in ~/Dropbox/MERC/BoardSmith/MERC)
`npm pack` → `boardsmith-0.0.1-20260701000512.tgz` → `MERC/vendor/`; updated both `package.json` refs (dependencies + overrides) + `package-lock.json`; `npm install`; `vitest --run`. Committed `chore: re-vendor boardsmith ...` (2 tracked files; `vendor/` is gitignored, matching prior re-vendor commits). Left the user's pre-existing uncommitted `AssignToSquadPanel.vue` change untouched.

## Verification

| Target | Result |
|--------|--------|
| BoardSmith full suite | 138 files, **1873 passed** |
| BoardSmith lint | baseline only (3 pre-existing no-shadow errors + 1 pre-existing warning) |
| hex / go-fish / checkers / cribbage / demo-animation / demo-complex-ui | all green (unchanged) |
| polyhedral-potions | **21 failures → 24 passed** after the src/ fix |
| MERC canary (re-vendored) | 28 files, **738 passed \| 7 skipped** |

## Notes / Follow-ups

- The PIT-02 fix is a genuine authoring-guard improvement beyond migration: it also fixes the silent-shadowing footgun where a custom class shares a built-in name.
- `demo-action-panel` has no test suite (unchanged).
- MERC's `vendor/` accumulates old tarballs (gitignored); not pruned (no user request).
</content>
