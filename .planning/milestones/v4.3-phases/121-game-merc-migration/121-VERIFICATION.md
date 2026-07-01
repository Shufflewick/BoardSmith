---
status: passed
phase: 121-game-merc-migration
verified: 2026-07-01
must_haves_verified: 3
must_haves_total: 3
method: full cross-repo suite runs (BoardSmith + 7 games + re-vendored MERC)
---

# Phase 121 Verification — Game & MERC Migration

**Status: PASSED** — all 3 success criteria TRUE.

## Success Criteria

1. **All `~/BoardSmithGames/` example games adopt the new APIs where they replace hand-rolled patterns, and every game test suite passes.**
   ✅ Adoption is reuse-not-rebuild: no game had a hand-rolled pattern the new introspection/test APIs replace (verified by scan); games get the new enumeration transparently via the framework MCTS. All suites pass: hex 19, go-fish 78, checkers 38, cribbage 20, polyhedral-potions 24 (was 21 failing before the src/ fix), demo-animation 8, demo-complex-ui 4. (demo-action-panel has no tests.)

2. **BoardSmith's own test suite passes with the new surface.**
   ✅ 138 files, 1873 passed. Lint at baseline (3 pre-existing no-shadow errors + 1 pre-existing warning). One `src/` change: PIT-02 built-in-element-class exemption + authoritative-instantiated-class override (+ regression test).

3. **The MERC vendored canary is re-vendored against the new surface and verified green.**
   ✅ Re-vendored to `boardsmith-0.0.1-20260701000512.tgz` (both package.json refs + lockfile updated, committed `chore: re-vendor`); `vitest --run` → 28 files, 738 passed | 7 skipped.

## Notes

- Migration surfaced exactly one real `src/` gap (PIT-02 firing on framework-internal `DicePool.all(Die)`), fixed with a built-in-class exemption — consistent with the roadmap's "minimal BoardSmith src/ changes only to close gaps migration surfaces."
- No human verification outstanding.
</content>
