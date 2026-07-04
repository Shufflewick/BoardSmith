---
phase: 140-library-prerequisite-useannouncer
fixed_at: 2026-07-04T19:56:30Z
review_path: .planning/phases/140-library-prerequisite-useannouncer/140-REVIEW.md
iteration: 1
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 140: Code Review Fix Report

**Fixed at:** 2026-07-04T19:56:30Z
**Source review:** .planning/phases/140-library-prerequisite-useannouncer/140-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 2 (fix_scope: critical_warning — IN-01..IN-03 out of scope)
- Fixed: 2
- Skipped: 0

## Fixed Issues

### WR-01: Deferred `nextTick` write can clobber a later GameShell announcement — "last-write-wins" contract is not honored

**Files modified:** `src/ui/components/GameShell.vue`
**Commit:** 315bc390
**Applied fix:** Applied the review's preferred pit-of-success fix: routed all five of GameShell's direct live-region write sites (`isMyTurn` watcher, `connectionStatus` watcher, game-over watcher, `awaitingPlayerNames` watcher, `errorTick` watcher) through `announcer.announce(text)` / `announcer.announce(text, { assertive: true })` instead of raw ref assignment. All writers now share one scheduling discipline (clear-then-set on `nextTick`), so last-write-wins holds by construction — the deferred commits run in call order via the `nextTick` promise queue. The duplicated `emitAnnounce(...)` calls at each site were removed (`announce()` fires the relay internally). Added a comment above the watchers documenting the single-write-path invariant so raw ref assignment doesn't creep back in. Verified `politeMessage`/`assertiveMessage` are now written only by `createAnnouncer` (grep confirms only the ref declarations, the `createAnnouncer` wiring, and the two template render sites remain).

### WR-02: Two divergent write disciplines to the same live-region refs; GameShell's direct writes never re-announce duplicates

**Files modified:** `src/ui/components/GameShell.vue`
**Commit:** 315bc390
**Applied fix:** Same change as WR-01 (the review explicitly names one shared fix for both findings, so they were applied as a single atomic commit). `createAnnouncer` is now the single chokepoint for live-region writes; repeated identical GameShell announcements (e.g., disconnect → reconnect → disconnect producing the same text) now re-announce via clear-then-set, matching descendant behavior.

## Verification

- Targeted suites: `src/ui/composables/useAnnouncer.test.ts` (7), `src/ui/components/GameShell.announcer.test.ts` (3), `src/ui/components/GameShell.live-region.test.ts` (14) — all 24 pass.
- Full suite: `npm test` — 178 files, 2386 tests, all pass.

---

_Fixed: 2026-07-04T19:56:30Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
