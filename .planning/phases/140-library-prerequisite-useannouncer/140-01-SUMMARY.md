---
phase: 140-library-prerequisite-useannouncer
plan: 01
subsystem: ui
tags: [vue, composable, a11y, provide-inject, boardsmith-ui]

requires: []
provides:
  - "useAnnouncer()/provideAnnouncer()/createAnnouncer()/ANNOUNCER_KEY exported from boardsmith/ui"
  - "GameShell provides an announcer wired to its existing live-region refs and postMessage relay"
affects: [141-templates, 142-bs-ingest-rules, 143-146-bs-build-chunk, ui-a11y-floor]

tech-stack:
  added: []
  patterns:
    - "createX(options) factory + provideX(instance) + useX() inject-with-undefined-default, mirroring useAnimationEvents/createAnimationEvents"
    - "devWarn(key, message) for one-time dev-mode warnings instead of hand-rolled warned flags"

key-files:
  created:
    - src/ui/composables/useAnnouncer.ts
    - src/ui/composables/useAnnouncer.test.ts
    - src/ui/components/GameShell.announcer.test.ts
  modified:
    - src/ui/components/GameShell.vue
    - src/ui/index.ts

key-decisions:
  - "announce() return type is void, not Promise<void> — clear-then-set is fire-and-forget internally via nextTick().then()"
  - "clear-then-set runs unconditionally on every announce() call (no duplicate-detection branch), matching the locked 'no queue' philosophy"
  - "useAnnouncer() never returns undefined — no-provider path returns a no-op { announce } + devWarn('useAnnouncer-no-provider', ...) exactly once"
  - "No new live-region DOM nodes or refs — createAnnouncer receives GameShell's existing politeMessage/assertiveMessage refs and emitAnnounce function by reference"

patterns-established:
  - "useAnnouncer/provideAnnouncer/createAnnouncer is the library-level pattern any future BS Skills chunk (custom UI or AutoUI) uses to announce state changes without touching GameShell"

requirements-completed: [LIB-01]

duration: 4min
completed: 2026-07-04
---

# Phase 140 Plan 01: Library Prerequisite — useAnnouncer() Summary

**`useAnnouncer()` composable added to `boardsmith/ui`, writing through GameShell's existing live-region refs and postMessage relay with zero new DOM nodes**

## Performance

- **Duration:** 4 min
- **Started:** 2026-07-04T17:43:23Z
- **Completed:** 2026-07-04T17:46:50Z
- **Tasks:** 2
- **Files modified:** 5 (3 created, 2 modified)

## Accomplishments
- `useAnnouncer()`/`provideAnnouncer()`/`createAnnouncer()`/`ANNOUNCER_KEY` implemented in `src/ui/composables/useAnnouncer.ts`, mirroring the `useAnimationEvents` provide/inject shape exactly
- GameShell now provides an announcer wired to its pre-existing `politeMessage`/`assertiveMessage` refs and `emitAnnounce` postMessage relay — no new live-region DOM nodes introduced
- Public export added to `src/ui/index.ts` alongside `useBoardSize`
- Component test proves custom-UI/AutoUI parity (both descendant types receive the identical injected announcer and drive the same ref) and proves the `boardsmith-a11y` postMessage relay fires on every announce

## Task Commits

Each task was committed atomically:

1. **Task 1: Create useAnnouncer composable + unit tests** - `bbbe138b` (feat)
2. **Task 2: Wire GameShell, export publicly, prove parity + relay** - `23da5d41` (feat)

_Note: Tasks were marked `tdd="true"` in the plan; tests were authored alongside the implementation in a single commit per task rather than split RED/GREEN commits, since each task's `<action>` block specified test file + implementation file together as one atomic unit of behavior. Both test files were fully green before each commit._

## Files Created/Modified
- `src/ui/composables/useAnnouncer.ts` - `createAnnouncer`/`provideAnnouncer`/`useAnnouncer`/`ANNOUNCER_KEY`/`UseAnnouncerReturn`/`CreateAnnouncerOptions`; clear-then-set write-through to caller-supplied refs, no-provider no-op+devWarn fallback
- `src/ui/composables/useAnnouncer.test.ts` - Unit tests: Symbol/function shape, polite/assertive routing, clear-then-set duplicate pass-through, emitAnnounce firing, no-provider warn-once
- `src/ui/components/GameShell.vue` - Imports `createAnnouncer, provideAnnouncer`; wires `const announcer = createAnnouncer({ politeMessage, assertiveMessage, emitAnnounce }); provideAnnouncer(announcer);` immediately after the existing animation-events wiring
- `src/ui/components/GameShell.announcer.test.ts` - jsdom test proving custom-UI/AutoUI parity (shared injected announcer, shared live-region ref) and the postMessage relay shape
- `src/ui/index.ts` - Public export block: `useAnnouncer, provideAnnouncer, createAnnouncer, ANNOUNCER_KEY, type UseAnnouncerReturn`

## Decisions Made
- Matched the plan's locked A1/A2 resolutions verbatim: `void` return type, clear-then-set unconditional on every call
- `useAnnouncer.test.ts` required a jsdom override (`// @vitest-environment jsdom`) rather than the default node env used by `useAnimationEvents.test.ts`, because the no-provider warn-once case needs `inject()` to run inside a real mounted component (via a `withSetup()` helper built on `@vue/test-utils`'s `mount()`) — the animation-events analog never exercises its no-op injector directly, so this test surface is new and needs a DOM
- Component parity test deliberately avoids mounting the full `GameShell.vue` (per the precedent set by `GameShell.live-region.test.ts`'s own documented rationale — extensive client/session mocking would be required); instead it mounts minimal inline `defineComponent` descendants that exercise the identical `createAnnouncer`/`provideAnnouncer`/`useAnnouncer` wiring GameShell installs

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `useAnnouncer()` is now available for any future BS Skills chunk (custom UI or AutoUI) to announce state changes, satisfying LIB-01 and the ROADMAP's SC-1/SC-2/SC-3 success criteria
- Full test suite green (178 files / 2386 tests), including the pre-existing `GameShell.live-region.test.ts` (no regression)
- `npx tsc --noEmit` shows only pre-existing, unrelated test-file looseness errors (none touch `useAnnouncer.ts`, `GameShell.vue`, `GameShell.announcer.test.ts`, or `src/ui/index.ts`) — out of scope per the plan's threat model and SCOPE BOUNDARY rule
- No blockers for Phase 141 (TMPL) or downstream BS Skills phases

---
*Phase: 140-library-prerequisite-useannouncer*
*Completed: 2026-07-04*

## Self-Check: PASSED

All created files exist on disk; both task commits (`bbbe138b`, `23da5d41`) found in git log.
