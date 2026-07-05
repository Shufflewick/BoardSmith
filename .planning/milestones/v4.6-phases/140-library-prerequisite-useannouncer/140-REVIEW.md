---
phase: 140-library-prerequisite-useannouncer
reviewed: 2026-07-04T18:02:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - src/ui/composables/useAnnouncer.ts
  - src/ui/composables/useAnnouncer.test.ts
  - src/ui/components/GameShell.announcer.test.ts
  - src/ui/components/GameShell.vue
  - src/ui/index.ts
findings:
  critical: 0
  warning: 0
  info: 3
  total: 3
status: issues_found
---

# Phase 140: Code Review Report (Iteration 2)

**Reviewed:** 2026-07-04T18:02:00Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found (info only — no blockers, no warnings)

## Summary

Re-review after commit `315bc390` (fix for iteration-1 WR-01/WR-02). Verified the fixes are sound:

**WR-01 (deferred write clobbering GameShell announcements) — RESOLVED.** All five GameShell live-region write sites (GameShell.vue:1759, 1766, 1781, 1798, 1821) now call `announcer.announce()` instead of assigning the refs directly. Grep confirms zero remaining direct `politeMessage`/`assertiveMessage` assignments anywhere in `src/ui` outside the ref declarations (GameShell.vue:343-344), the `createAnnouncer` wiring (line 360), and the template bindings (lines 1920-1921). With a single write path, same-tick collisions resolve via `nextTick` callbacks executing in registration order, so the docstring's "last-write-wins in call order" contract (useAnnouncer.ts:35) now holds by construction — the exact pit-of-success fix recommended in iteration 1.

**WR-02 (divergent write disciplines / no duplicate re-announce for GameShell writes) — RESOLVED.** GameShell announcements now get the same clear-then-set semantics as descendant announcements, so repeated identical messages (e.g., disconnect → reconnect → disconnect) re-fire the live region. The duplicated `politeMessage.value = text; emitAnnounce(...)` pairs are gone; `emitAnnounce` is now invoked solely inside `createAnnouncer` (single chokepoint, no dead code left behind).

The new guard comment (GameShell.vue:1750-1754) accurately documents why raw synchronous writes are forbidden. All `if (text)` guards were preserved around helpers that can return `''` (`announceTurnChange`, `announceConnectionChange`, `announceOpponentTurn`); `announceGameOver` never returns empty (verified in liveRegionAnnouncer.ts:37-41), so its unguarded call is correct. No behavioral regressions found: the only observable change is GameShell announcements now committing one microtask later, which is imperceptible to assistive technology and is exactly what enables duplicate re-announcement.

Verification: `useAnnouncer.test.ts` (7), `GameShell.announcer.test.ts` (3), and `GameShell.live-region.test.ts` (14) all pass — 24/24.

No new issues introduced by the fix. The three info items from iteration 1 remain open (they were not in the fix scope) and are carried forward below.

## Narrative Findings (AI reviewer)

## Info

### IN-01: `announce('')` unguarded in the public composable; relay fires for messages that may never render (carried from iteration 1)

**File:** `src/ui/composables/useAnnouncer.ts:69-80`
**Issue:** `announce('')` from a game UI clears the live region and posts a relay message with empty text for no effect. Separately, when two `announce()` calls hit the same target ref in one tick, `emitAnnounce` fires for both but only the last message renders in the live region — a future host-page relay would announce text the in-page region never showed. GameShell's own call sites are all guarded, so this only affects external game code calling the public API.
**Fix:** Early-return on empty/whitespace-only messages (`if (!message.trim()) return;`) and add a comment noting the relay is fire-per-call while the live region is last-render-wins.

### IN-02: GameShell's actual announcer wiring (lines 360-361) still has no direct test coverage (carried from iteration 1)

**File:** `src/ui/components/GameShell.announcer.test.ts:10-14`
**Issue:** The wiring tests mount inline replica components rather than the real GameShell.vue (documented rationale, consistent with the GameShell.live-region.test.ts precedent). This gap now covers more surface than in iteration 1: the five watcher call sites converted in commit `315bc390` (GameShell.vue:1756-1822) are also untested — if a watcher regressed to a raw ref assignment, or `provideAnnouncer` were dropped from line 361, all tests would stay green.
**Fix:** Acceptable given the established precedent; note as a known gap in phase verification. A browser smoke test (trigger a turn change, inspect the `role="status"` node at GameShell.vue:1920) would close it.

### IN-03: Misleading dev warning when `useAnnouncer()` is called outside component setup (carried from iteration 1)

**File:** `src/ui/composables/useAnnouncer.ts:98-110`
**Issue:** Called with no current component instance, Vue's `inject()` returns `undefined` (after Vue's own "inject() can only be used inside setup" warning), and `devWarn` then reports "no ancestor GameShell providing an announcer" — the wrong diagnosis for that failure mode. Behavior remains safe (no-op announcer returned).
**Fix:** Optionally check `getCurrentInstance()` first and emit a distinct message ("useAnnouncer() must be called during component setup"). Low priority; sibling composables share the same gap.

---

_Reviewed: 2026-07-04T18:02:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
