---
phase: 102-material-dev-debug-wave-5
plan: "05"
subsystem: ui
tags: [vue, devhost, toast, svg, css-custom-properties, vitest]

requires:
  - phase: 102-material-dev-debug-wave-5/102-03
    provides: DevHost chrome collapse, seat switcher, presence strip, table setup panel

provides:
  - Two-click confirm guard on dev "New game" (restartConfirming ref + 5-second auto-cancel)
  - Broadcast toast after restart via pendingRestart + game_state handler
  - Toast component mounted in DevHost template for toasts to render on the outer page
  - SVG fractalNoise grain layer (DEV-08) — fixed, opacity 0.07, token-clean
  - Radial vignette layer (DEV-08) — fixed, color-mix with --bsg-bg, no raw hex
  - DevHost.restart.test.ts — 5 tests covering DEV-07 confirm/toast behaviors

affects: [102-cross-repo-verification, DEV-07, DEV-08]

tech-stack:
  added: []
  patterns:
    - "Two-click confirm: restartConfirming ref + auto-cancel setTimeout; second click sends WS and resets"
    - "Broadcast toast via pendingRestart flag: set before wsSend, cleared on game_state, fires toast.info"
    - "Fixed decorative layers: position:fixed; z-index:0/1; pointer-events:none; content at z-index:2"
    - "SVG data URI encoding: # → %23, < → %3C, > → %3E in background-image url()"

key-files:
  created:
    - src/cli/dev-host/DevHost.restart.test.ts
  modified:
    - src/cli/dev-host/DevHost.vue

key-decisions:
  - "pendingRestart flag set in newGame() before wsSend to guarantee toast fires exactly when the fresh game_state arrives at all seats"
  - "Two-click confirm window set to 5 seconds — long enough to confirm intentionally, short enough to not leave the button in limbo"
  - "btn--confirming uses danger-tinted border + text (color-mix) with NO accent fill to honor neutral/ghost styling"
  - "dev-grain and dev-vignette are fixed children of .dev-host, not absolutely-positioned, to cover the viewport regardless of content height"
  - "Toast component mounted in DevHost template (not GameShell) because DevHost is the outer page; Teleport to body still works correctly"

patterns-established:
  - "Destructive-action confirm: restartConfirming + auto-cancel timer pattern is reusable for other dev-only destructive actions"

requirements-completed: [DEV-07, DEV-08]

duration: 8min
completed: 2026-06-23
---

# Phase 102 Plan 05: Two-click restart confirm, broadcast toast, and Slate material layer (DEV-07/08) Summary

**Dev "New game" guarded by two-click confirm with 5-second auto-cancel and per-seat broadcast toast; dev chrome background replaced with URL-encoded SVG fractalNoise grain + radial vignette using --bsg-bg color-mix tokens**

## Performance

- **Duration:** 8 min
- **Started:** 2026-06-23T06:41:35Z
- **Completed:** 2026-06-23T06:49:12Z
- **Tasks:** 2
- **Files modified:** 2 (DevHost.vue modified, DevHost.restart.test.ts created)

## Accomplishments
- `handleNewGameClick()` guards the destructive restart: first click arms `restartConfirming` + 5-second auto-cancel timer; second click executes `newGame()` and clears state
- `pendingRestart` flag set before `wsSend({ type:'restart' })` and cleared in `onHostMessage('game_state')` so every seat receives a `toast.info('Game restarted')` when the fresh state arrives
- `<Toast />` component added to DevHost template (outside GameShell iframe) so toasts render on the outer dev page
- Both New game buttons (overflow menu + wide bar) updated to `handleNewGameClick` with dynamic label "Confirm restart?" during confirm state; `btn--confirming` class adds subtle danger-tinted border (no accent CTA fill)
- `.dev-grain`: `position:fixed; inset:0; z-index:0; opacity:0.07; background-image: url()` with URL-encoded SVG `feTurbulence type="fractalNoise"` data URI — neutral/graphite, no background-attachment:fixed
- `.dev-vignette`: `position:fixed; inset:0; z-index:1` with `radial-gradient` from `transparent` to `color-mix(in srgb, var(--bsg-bg) 70%, transparent)` — no raw hex literals
- Content wrappers `.dev-host__center`, `.dev-chrome`, `.dev-host__stage` given `position:relative; z-index:2` to sit above decorative layers
- `DevHost.restart.test.ts`: 5 tests (vitest jsdom, fake timers, FakeWebSocket pattern from seats.test.ts), all green

## Task Commits

Each task was committed atomically:

1. **Task 1: Two-click restart confirm + broadcast toast** - `2155424` (feat)
2. **Task 2: Slate material layer (SVG noise + vignette)** - `9dbd9f3` (feat)

## Files Created/Modified
- `src/cli/dev-host/DevHost.vue` — imports Toast + useToast; restartConfirming/pendingRestart refs; handleNewGameClick(); newGame() sets pendingRestart; game_state handler fires toast; dev-grain and dev-vignette template divs + CSS; z-index stacking for content above decorative layers
- `src/cli/dev-host/DevHost.restart.test.ts` — NEW: 5 tests for two-click confirm, auto-cancel, and broadcast toast (vitest jsdom, FakeWebSocket, vi.useFakeTimers)

## Decisions Made
- Used `pendingRestart` flag (set before wsSend, cleared on game_state) rather than modifying `multiplayer-host.ts` — keeps scope small and test surface clean per research Open Question #3
- `btn--confirming` uses `color-mix(in srgb, var(--bsg-danger) 60%, transparent)` border + `var(--bsg-danger)` text to signal danger state without CTA fill, honoring CLAUDE.md neutral/ghost requirement
- SVG grain uses `stitchTiles='stitch'` so the 200x200 tile repeats seamlessly
- Fixed (not absolute) positioning for decorative layers so they cover the full viewport independent of flex layout

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. TDD RED/GREEN cycle completed in one pass; all 5 tests passed after implementation.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- DEV-07 and DEV-08 requirements satisfied
- Phase 102 Wave 5 complete (all five plans: 102-01 through 102-05 done)
- Ready for Phase 103 cross-repo verification gate

---
*Phase: 102-material-dev-debug-wave-5*
*Completed: 2026-06-23*
