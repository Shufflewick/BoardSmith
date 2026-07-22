---
requirements-completed: [ZOOM-01, PROC-01]
---

# Plan 158-01 Summary — Auto-Zoom Persistent Available-Space Re-Fit (ZOOM-01, PROC-01)

**Plan:** 158-01 (execute — persistent region-obs + dock-watch re-fit in `useAutoZoom`)
**Completed:** 2026-07-20
**Result:** PASS — `useAutoZoom` now re-fits the board on dock/region changes for the whole component
lifetime (not just once at startup), guarded by a `userControlled` flag so a manual zoom sticks and
`fitZoom()` re-arms it; board content growth still never moves the zoom. PROC-01's RED-before-GREEN and
adversarial-bypass gates both satisfied.

## What was done

1. **Task 1 (RED):** Rewrote the `useAutoZoom.test.ts` harness: `fakeRegion` now returns
   `{ el, setSize }` with getter-backed `clientWidth`/`clientHeight` (was non-writable), and a
   controllable `requestAnimationFrame`/`cancelAnimationFrame` queue (`flushRaf`) is stubbed globally
   since the fix rAF-coalesces re-fits. Added `observerFor(el)` to locate a specific
   `FakeResizeObserver` instance by observed element (post-fix there are two live instances). Added
   `describe('re-fit on available-space change (ZOOM-01)')` with two tests against current, unfixed
   source: a `dockHeight` increase and a region resize after the startup settle both leave `zoomLevel`
   stale. Ran and captured the real failure (see verbatim RED below). All 8 pre-existing AZ-1..AZ-5
   tests stayed green; no production source touched in this commit.
2. **Task 2 (GREEN):** Added `userControlled` (false by default; `setZoom` sets it true; `fitZoom`
   clears it), a persistent `ResizeObserver` on `regionEl` (observed directly, no `.closest`), and
   `watch(dockHeight, scheduleRefit)`. Both triggers coalesce through a single `scheduleRefit()` —
   one `pendingFrame`-guarded `requestAnimationFrame` per cascade, calling `measureAndFit()` only when
   `!userControlled`. The region-wiring "catch iframe/host resize the RO may miss" catch-up is routed
   through `scheduleRefit()` itself (not a second untracked rAF) so `teardownRefit()`'s
   `cancelAnimationFrame(pendingFrame)` always covers it — this closes a real leak I found while
   getting Task 2 green (see Deviations). `endStartup()` now only stops the startup BOARD observer;
   the region observer and dock watch are torn down only in `teardownRefit()`/`onUnmounted`. Corrected
   the file header comment (it claimed the zoom "stops for good" — now states the real contract).
   Also added `scrollbar-gutter: stable` to `.boardregion` in `GameShell.vue` (plan-check WARNING #1)
   so a fit landing near the overflow boundary can't toggle the scrollbar and create a
   clientWidth/Height feedback path.
3. **Task 3 (adversarial):** Added `describe('adversarial: user zoom + content-growth guard
   (ZOOM-01)')` — five tests that actually attempt to defeat each guard rather than merely assert its
   presence: manual `setZoom` survives the exact dock+region change that re-fits an un-controlled
   player; `fitZoom()` re-arms auto-refit for a later change; board content growth alone (no
   dock/region change) does not move the zoom; the persistent region observer disconnects on unmount
   and a post-unmount dock/region change does not resurrect a re-fit (plan-check WARNING #2); a
   scrollbar-toggle-sized (~15px) repeated region change settles rather than drifting. Ran the full
   suite to confirm no collateral breakage.

## PROC-01 verbatim RED output (Task 1, before any fix)

```
 ❯ src/ui/composables/useAutoZoom.test.ts (10 tests | 2 failed) 72ms
   × useAutoZoom > re-fit on available-space change (ZOOM-01) > re-fits when dockHeight grows after the startup fit has settled
     → expected 2 to be 1 // Object.is equality
   × useAutoZoom > re-fit on available-space change (ZOOM-01) > re-fits when the region resizes after the startup fit has settled
     → expected 2 to be 1 // Object.is equality

 Test Files  1 failed (1)
      Tests  2 failed | 8 passed (10)
```
Both failures were the real defect — `zoomLevel` staying at the stale startup fit (2.0) instead of
re-fitting to the new available-space value (1.0) — not a mechanical/import error. All 8 negative
controls (pre-existing AZ tests) passed, proving the harness rewrite didn't break anything.

## PROC-01 verbatim GREEN output (Task 2, after the fix)

```
 ✓ src/ui/composables/useAutoZoom.test.ts (10 tests) 71ms

 Test Files  1 passed (1)
      Tests  10 passed (10)
```

## Adversarial verification (Task 3, real attack attempted)

- Manual `setZoom(0.8)` followed by the EXACT dock-height increase + region resize that re-fits an
  un-controlled player → `zoomLevel` unchanged at 0.8.
- `fitZoom()` after that → re-fits to the current space AND clears the guard; a subsequent dock/region
  change then re-fits again to the new space.
- Board `setSize(800, 900)` with no dock/region change and no observer fired → `zoomLevel` unchanged
  (the board is genuinely unobserved post-startup, so nothing can trigger a re-fit for it).
- `wrapper.unmount()` → the region `ResizeObserver.disconnected` flips true; a subsequent
  `dockHeight`/region change (even calling `.fire()` directly on the disconnected observer) does not
  move `zoomLevel`.
- Three alternating ~15px region-size toggles (simulating a scrollbar appearing/disappearing) →
  `zoomLevel` after the third toggle equals the value after the first (settles, does not drift).

All five held. 15/15 `useAutoZoom.test.ts` tests pass.

## Verification

- `npx vitest run src/ui/composables/useAutoZoom.test.ts` — 15/15 pass.
- `npm test` — **195 files / 2817 tests pass**, above the pre-phase baseline (195/2810 — the +7 are
  this plan's new tests; nothing regressed), including all 12 `GameShell.*.test.ts` files (150 tests)
  after the `scrollbar-gutter: stable` CSS addition.
- Grep gate: `grep -v '^\s*\*\|^\s*//' src/ui/composables/useAutoZoom.ts | grep -c 'userControlled'` →
  4 (≥3 required: declared, set in `setZoom`, cleared in `fitZoom`, checked in `scheduleRefit`).
- Grep gate: `grep -c 'new ResizeObserver' src/ui/composables/useAutoZoom.ts` → 2 (startup board obs +
  persistent region obs); `grep -q 'watch(dockHeight' src/ui/composables/useAutoZoom.ts` → found.
- Grep gate: `grep -c 'stops for good\|never move the zoom' src/ui/composables/useAutoZoom.ts` → 0
  (header comment corrected).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Untracked catch-up rAF could not be cancelled by teardown**
- **Found during:** Task 2, while getting the Task 1 RED tests green.
- **Issue:** The first implementation wired the region-observer's "catch iframe/host resize the RO
  may miss" fallback as a raw `requestAnimationFrame(scheduleRefit)` call, separate from the
  `pendingFrame`-tracked coalescing scheduler. This frame wasn't cancellable by `teardownRefit()`'s
  `cancelAnimationFrame(pendingFrame)`, and in a test where the flush was delayed, it fired late and
  read the CURRENT (by-then-grown) board size — breaking the AZ-3 content-growth exclusion
  (`0.6666... !== 1.0`).
- **Fix:** Routed the catch-up through `scheduleRefit()` itself (a single coalescing point for both
  the region observer AND the mount-time catch-up), so it is always tracked by `pendingFrame` and
  always covered by `teardownRefit()`'s cancellation.
- **Files modified:** `src/ui/composables/useAutoZoom.ts`.
- **Commit:** `519daa20`.

**2. [Rule 1 - Bug] AZ-3 test needed an explicit early flush to stay deterministic**
- **Found during:** Task 2, same investigation as above.
- **Issue:** After Fix 1, the mount-time catch-up frame is real (fires ~1 frame after mount in
  practice) but AZ-3 didn't flush it until the very end of the test, well after simulating mid-game
  content growth — an artifact of test timing, not implementation behavior, but it made the test
  flaky against the fix's realistic timing.
- **Fix:** AZ-3 now calls `flushRaf()` immediately after the initial `nextTick()`, consuming the
  mount-time catch-up frame before any subsequent settle/growth simulation — matching real-world
  timing where the catch-up frame is essentially immediate.
- **Files modified:** `src/ui/composables/useAutoZoom.test.ts`.
- **Commit:** `519daa20`.

Both fixes were discovered and resolved within Task 2's GREEN work before any commit; no separate
fix-up commit was needed.

### Auth gates
None encountered.

## Known Stubs
None — no stub patterns introduced.

## Threat Flags
None — this plan implements the mitigation specified in its own threat model (T-158-01: the
scrollbar-gutter CSS + rAF-coalescing + epsilon guard, verified adversarially in Task 3's
scrollbar-toggle test) and no new, unlisted security-relevant surface was introduced.

## Self-Check: PASSED

- `src/ui/composables/useAutoZoom.ts` (`userControlled`, persistent region observer, `watch(dockHeight`) — FOUND
- `src/ui/composables/useAutoZoom.test.ts` (`describe('re-fit on available-space change (ZOOM-01)')`, `describe('adversarial...')`) — FOUND
- `src/ui/components/GameShell.vue` (`scrollbar-gutter: stable`) — FOUND
- Commit `84f6f500` (RED) — FOUND in `git log`
- Commit `519daa20` (GREEN) — FOUND in `git log`
- Commit `7edbc9fc` (adversarial + full suite) — FOUND in `git log`
