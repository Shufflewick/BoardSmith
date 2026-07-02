---
phase: 128-animation-drag-drop-test-story
plan: 01
subsystem: testing
tags: [animation, vitest, ui-composables, test-ergonomics]

# Dependency graph
requires: []
provides:
  - "Vue-free animation test-mode + trace recorder module (`src/ui/composables/useAnimationTestMode.ts`)"
  - "`AnimationTrace` interface (kind/element/from/to/meta) as the contract downstream animation composable plans implement against"
  - "Explicit enable/disable/isEnabled + recordTrace/getAnimationTrace/clearAnimationTrace API, default OFF"
  - "Dual re-export from both `boardsmith/ui` and `boardsmith/testing`"
affects: [128-02, 128-03, 128-04, 128-05, 128-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module-level state + explicit reset-export (mirrors `src/utils/dev.ts`'s `shownWarnings`/`_clearShownWarnings` shape)"
    - "Vue-free composable module deliberately kept import-free of 'vue' so it is safe to statically re-export from a non-Vue subpath (`boardsmith/testing`)"

key-files:
  created:
    - src/ui/composables/useAnimationTestMode.ts
    - src/ui/composables/useAnimationTestMode.test.ts
  modified:
    - src/ui/index.ts
    - src/testing/index.ts

key-decisions:
  - "Test mode is an explicit flag (enableAnimationTestMode/disableAnimationTestMode), default OFF, never merged with or toggled by prefers-reduced-motion — that's a distinct a11y concern, not a test-harness concern (CONTEXT.md decision)"
  - "recordTrace() early-returns when disabled, so stray calls from a composable's normal (non-test) render path are guaranteed no-ops rather than silently accumulating an unbounded buffer"
  - "AnimationTrace.from/to hold container/anchor IDENTITY strings (assertable), with rects/deltas/elementData confined to `meta` — never hidden-info payloads"

requirements-completed: [ANIM-01]

duration: 12min
completed: 2026-07-02
---

# Phase 128 Plan 01: Animation Test-Mode Foundation Summary

**Vue-free `useAnimationTestMode.ts` module (enable/disable/isEnabled + recordTrace/getAnimationTrace/clearAnimationTrace + `AnimationTrace` type), unit-tested and dual-exported from `boardsmith/ui` and `boardsmith/testing`.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-02T16:20:00Z
- **Completed:** 2026-07-02T16:32:01Z
- **Tasks:** 2
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- Created the contract-defining, Vue-free trace recorder module the five downstream animation composables (128-02..06) will consult
- Full unit test coverage of the recorder's behavior (default-off, enable, ordered recording, disabled no-op, clear, disable-without-clear)
- Wired identical named re-exports into both `boardsmith/ui` and `boardsmith/testing` barrels, proving the module is safe to share across a Vue and non-Vue subpath

## Task Commits

Each task was committed atomically:

1. **Task 1: Create the Vue-free animation test-mode + trace module** - `e5aacf6` (feat)
2. **Task 2: Unit-test the recorder + wire re-exports from ui and testing barrels** - `b51dcec` (test)

**Plan metadata:** (this commit)

## Files Created/Modified
- `src/ui/composables/useAnimationTestMode.ts` - Vue-free module: `AnimationTrace` type + enable/disable/isEnabled/recordTrace/getAnimationTrace/clearAnimationTrace
- `src/ui/composables/useAnimationTestMode.test.ts` - 6 vitest cases covering the full recorder contract
- `src/ui/index.ts` - new "Animation test-mode + trace recorder (ANIM-01)" export block
- `src/testing/index.ts` - new "Animation test-mode + trace (ANIM-01)" export block re-exporting from `../ui/composables/useAnimationTestMode.js`

## Decisions Made
- Kept `recordTrace`'s disabled-state guard as an early return (not a conditional wrapper around the push) to make the no-op behavior obvious at a glance — pit of success for future composable authors reading this file.
- No Vue import of any kind (not even `import type`) to make the Vue-free contract trivially verifiable by grep, matching the plan's verification gate.

## Deviations from Plan

None - plan executed exactly as written. The plan's own verification grep (`grep -c "import .*from 'vue'"`) initially matched a doc-comment line that used the literal phrase `` `import type` from 'vue' `` while explaining the Vue-free constraint; reworded the comment (no code change) so the verification gate reads correctly. This is documentation wording only, not a deviation in behavior or scope.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `isAnimationTestModeEnabled()`, `recordTrace()`, and `AnimationTrace` are now importable from both `boardsmith/ui` and `boardsmith/testing`, unblocking plans 128-02 through 128-06 (the five animation composables + direct composable tests + anchor-attribute enforcement).
- No blockers or concerns.

---
*Phase: 128-animation-drag-drop-test-story*
*Completed: 2026-07-02*

## Self-Check: PASSED

- FOUND: src/ui/composables/useAnimationTestMode.ts
- FOUND: src/ui/composables/useAnimationTestMode.test.ts
- FOUND commit: e5aacf6
- FOUND commit: b51dcec
