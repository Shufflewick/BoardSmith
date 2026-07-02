---
phase: 124-hidden-info-test-utilities
plan: 01
subsystem: testing
tags: [visibility, hidden-info, testing, assertions, playerView]

# Dependency graph
requires: []
provides:
  - "isElementVisible(element, seat) / getVisibleElements(game, seat) standalone functions in src/testing/visibility.ts"
  - "TestGame.isElementVisible / TestGame.getVisibleElements methods"
  - "assertHidden(element, seat) / assertVisible(element, seat) assertion helpers"
  - "All exported from boardsmith/testing barrel"
affects: [124-02, 124-03, 129-migration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Visibility derived from Game.toJSONForPlayer(seat) final tree (element presence + non-__hidden), with element.isVisibleTo used only as a fast path when GameClass.playerView is undefined"

key-files:
  created:
    - src/testing/visibility.ts
    - src/testing/visibility.test.ts
  modified:
    - src/testing/test-game.ts
    - src/testing/assertions.ts
    - src/testing/assertions.test.ts
    - src/testing/index.ts

key-decisions:
  - "Visibility judged on the FINAL post-playerView tree, not on element.isVisibleTo alone, so a game's static playerView hook cannot silently drift from what test assertions see"
  - "isVisibleTo used only as a fast path when GameClass.playerView is undefined (provably safe — no post-transform runs)"
  - "assertHidden/assertVisible call isElementVisible (not element.isVisibleTo directly) so assertions inherit the same playerView-honoring derivation"
  - "assertHidden's surviving-attribute-keys list is read from the element's node in the FINAL tree (Object.keys(node.attributes), excluding __hidden), not from the raw unfiltered element.toJSON().attributes"

patterns-established:
  - "Standalone function + TestGame delegate method pair (mirrors getPlayerView/getFlowDebugInfo convention from v4.3)"

requirements-completed: [VIS-01]

# Metrics
duration: 10min
completed: 2026-07-01
---

# Phase 124 Plan 01: Per-Seat Visibility Utilities (VIS-01) Summary

**`isElementVisible`/`getVisibleElements`/`assertHidden`/`assertVisible` derived from `Game.toJSONForPlayer(seat)`'s final serialized tree, honoring a game's `static playerView` post-transform instead of stopping at `element.isVisibleTo`.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-07-01T21:24Z (approx, based on commit history)
- **Completed:** 2026-07-01T21:34Z
- **Tasks:** 2/2
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments
- `src/testing/visibility.ts` exports `isElementVisible`/`getVisibleElements`, deriving verdicts from the actual wire bytes (`game.toJSONForPlayer(seat)`) rather than re-deriving visibility rules — a fast path uses `element.isVisibleTo(seat)` only when `GameClass.playerView` is undefined (provably equivalent in that case).
- A dedicated static-`playerView` fixture proves the post-transform is honored: `isElementVisible` returns `false` for a card the hook strips from the final tree even though `element.isVisibleTo(seat)` returns `true`.
- `TestGame.isElementVisible`/`getVisibleElements` delegate to the standalone functions, mirroring the existing `getPlayerView` passthrough convention.
- `assertHidden`/`assertVisible` in `assertions.ts` call `isElementVisible` (not `element.isVisibleTo` directly), so assertion failures are judged on the same final-tree derivation; `assertHidden`'s failure message lists the attribute keys that actually survive into the seat's final view.
- All four new symbols (`isElementVisible`, `getVisibleElements`, `assertHidden`, `assertVisible`) are exported from the `boardsmith/testing` barrel.

## Task Commits

Each task was committed atomically:

1. **Task 1: visibility.ts + TestGame visibility methods** - `1e695ba` (feat)
2. **Task 2: assertHidden/assertVisible + barrel exports** - `0752bea` (feat)

## Files Created/Modified
- `src/testing/visibility.ts` - `isElementVisible`/`getVisibleElements` standalone functions, derived from `toJSONForPlayer` with `isVisibleTo` fast path
- `src/testing/visibility.test.ts` - owner/hidden/count-only/all-visible/spectator coverage, fast-path parity assertion, static-playerView post-transform fixture
- `src/testing/test-game.ts` - `TestGame.isElementVisible`/`getVisibleElements` delegating methods
- `src/testing/assertions.ts` - `assertHidden`/`assertVisible` with final-tree-accurate failure messages
- `src/testing/assertions.test.ts` - pass/throw cases for both assertions, message-content checks, playerView-fixture case
- `src/testing/index.ts` - new "Hidden-info visibility utilities (VIS-01)" export block; `assertHidden`/`assertVisible` added to the assertion helpers block

## Decisions Made
- Visibility is judged on the FINAL post-`playerView` tree (`game.ts:2813-2816`), never on `element.isVisibleTo` alone, per the locked CONTEXT.md decision ("visibility computed from the SAME serialization path the wire uses").
- `isVisibleTo` is retained only as a fast path for the common case (no `static playerView` defined), avoiding a full `toJSONForPlayer` serialization on every check when it isn't needed.
- The surviving-attribute-keys list in `assertHidden`'s failure message is derived from the FINAL tree's node attributes, not the raw unfiltered element JSON, so it never misreports keys a `playerView` hook already stripped.

## Deviations from Plan

None - plan executed exactly as written. All acceptance criteria (grep checks for `toJSONForPlayer`/`GameClass.playerView`/`isVisibleTo` usage, delegate methods, barrel exports) verified directly.

## Issues Encountered

None - both tasks' tests passed on first implementation; no auto-fixes were required.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- VIS-01 utilities are complete and exported from `boardsmith/testing`; ready for VIS-02/VIS-03 (view diffing, DOM-leak test utility) in subsequent plans of this phase, which can build on `isElementVisible`/`getVisibleElements` as their visibility primitive.
- No blockers identified.

---
*Phase: 124-hidden-info-test-utilities*
*Completed: 2026-07-01*

## Self-Check: PASSED

All created/modified files exist on disk; both task commits (`1e695ba`, `0752bea`) verified present in git log.
