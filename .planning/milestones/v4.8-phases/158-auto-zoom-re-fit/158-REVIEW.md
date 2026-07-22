---
phase: 158-auto-zoom-re-fit
reviewed: 2026-07-20T00:00:00Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - src/ui/composables/useAutoZoom.ts
  - src/ui/components/GameShell.vue
findings:
  critical: 0
  warning: 0
  info: 1
  total: 1
status: clean
---

# Phase 158: Code Review Report

**Reviewed:** 2026-07-20T00:00:00Z
**Depth:** standard
**Files Reviewed:** 2
**Status:** clean

## Summary

Reviewed `useAutoZoom.ts` (the persistent region/dock re-fit + `userControlled` guard) and confirmed `GameShell.vue`'s diff is exactly the single `scrollbar-gutter: stable` CSS line described.

Traced all six requested risk areas; none produced a real defect:

1. **Feedback loop** — `regionObserver` observes `.boardregion`, which is `flex: 1; overflow: auto` (`GameShell.vue:2692-2708`); its border-box is sized by the flex parent, not by its zoomed child's content, so a zoom write can't change the observed box. `scrollbar-gutter: stable` (added this diff) additionally prevents a fit landing near the overflow boundary from toggling the scrollbar and perturbing `clientWidth`. Covered by test "a scrollbar-toggle-sized region change settles rather than oscillating."
2. **rAF leak/cancellation** — exactly one scheduler (`scheduleRefit`, `useAutoZoom.ts:136-142`); the region-el watch routes its "catch iframe/host resize" call through `scheduleRefit()` rather than a raw rAF (`useAutoZoom.ts:164-167`), so `teardownRefit()`'s single `cancelAnimationFrame(pendingFrame)` (line 149-152) covers every trigger path. `onUnmounted` calls both `endStartup()` and `teardownRefit()` (line 174-177). No orphan rAF.
3. **`userControlled` correctness** — set only in `setZoom` (line 184), cleared only in `fitZoom` (line 193); `scheduleRefit`'s callback checks it at fire-time, not schedule-time (line 140), so a pending rAF scheduled just before a `setZoom` call correctly no-ops instead of stomping the user's choice. `onBoardResize`/startup fitting and `fitZoom` both bypass the flag entirely (call `measureAndFit()` directly), matching the documented contract. No path leaves auto-refit permanently dead for a user who never manually zoomed — the flag starts `false` and only startup/manual paths touch it.
4. **Teardown completeness** — `onUnmounted` disconnects the region observer, cancels the pending rAF, and disconnects/nulls the board observer + clears the settle timer via `endStartup()`. `dockHeight` is a plain `watch(..., {flush:'post'})`, auto-stopped by Vue on unmount (no `flush:'sync'`/manual stop needed). No leak.
5. **Null-ref safety** — `measureAndFit` early-returns `false` if `boardEl.value`/`regionEl.value` is null (line 73); since the rAF is cancelled on unmount before it could fire against a detached ref, and the board's own `ResizeObserver` is disconnected in the same teardown, there's no reachable path that reads a null ref past unmount.
6. **Double-observe** — the `regionEl` watch disconnects any existing `regionObserver` before creating a new one (line 158-159), so a re-fired watch (e.g. region element swap) can't double-observe.

Test coverage (`useAutoZoom.test.ts`) directly exercises the adversarial cases called out here: manual-zoom-not-overridden, fitZoom-re-arms, unmount-no-leak-no-refit-after, and the scrollbar-toggle-settles case — all present and passing per the file's existing test list.

## Info

### IN-01: `setZoom` doesn't cancel an in-flight `pendingFrame`

**File:** `src/ui/composables/useAutoZoom.ts:182-186`
**Issue:** `setZoom` calls `endStartup()` but not `teardownRefit()`/`cancelAnimationFrame`. If a region/dock change scheduled a `pendingFrame` just before the user drags the slider, that rAF still fires (harmlessly, since the callback checks `userControlled` at fire-time and no-ops). Not a bug — just a redundant scheduled callback that does nothing — but worth a one-line comment so a future reader doesn't "fix" it into an unnecessary cancellation call, or conversely doesn't assume `pendingFrame` is always cleared when `userControlled` flips true.
**Fix:** Optional; a comment near `setZoom` noting "`pendingFrame`, if any, is left to fire and no-op via the `userControlled` check in `scheduleRefit`" would preempt confusion. No functional change needed.

---

_Reviewed: 2026-07-20T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
