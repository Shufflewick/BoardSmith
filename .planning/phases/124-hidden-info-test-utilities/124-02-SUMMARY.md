---
phase: 124-hidden-info-test-utilities
plan: 02
subsystem: testing
tags: [visibility, hidden-info, testing, view-diff, playerView]

# Dependency graph
requires: [124-01]
provides:
  - "diffPlayerViews(viewA, viewB) in src/testing/view-diff.ts"
  - "ViewDiffResult interface { onlyInA, onlyInB, attributeDiffs, describe() }"
  - "Exported from boardsmith/testing barrel"
affects: [124-03, 129-migration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Positional (index-aligned) tree walk classified purely by each node's __hidden flag -- never by id -- to sidestep the engine's intentional id-anonymization asymmetry (stable id for individually-hidden elements vs fresh synthetic negative ids per call for zone-hidden children)"

key-files:
  created:
    - src/testing/view-diff.ts
    - src/testing/view-diff.test.ts
  modified:
    - src/testing/index.ts

key-decisions:
  - "Classification is purely __hidden-flag based, never id-based -- avoids the synthetic-id trap (zone-hidden children get fresh negative ids per serialization call) while still correctly correlating individually-hidden elements (which keep a stable id but toggle __hidden per viewing seat) without any explicit id bookkeeping"
  - "hiddenA !== hiddenB -> onlyIn[the visible side], and the walk never recurses into a redacted subtree, so identity/values are never leaked through onlyIn or attributeDiffs"
  - "attributeDiffs is scoped to nodes visible on BOTH sides only; a playerView-hook-injected per-seat attribute on a shared node is correctly surfaced, proving there is no playerView blind spot"

patterns-established:
  - "FlowDebugInfo-style result shape: plain data fields (onlyInA/onlyInB/attributeDiffs) first, describe(): string last, no class"

requirements-completed: [VIS-02]

# Metrics
duration: 15min
completed: 2026-07-02
---

# Phase 124 Plan 02: Per-Seat View Diffing (VIS-02) Summary

**`diffPlayerViews` walks two seats' FINAL per-seat trees (`toJSONForPlayer`, post-`playerView`) positionally and classifies purely by each node's `__hidden` flag, never by id, so the engine's intentional zone-hidden-vs-individually-hidden id-anonymization asymmetry never produces spurious diff noise.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-07-02
- **Tasks:** 2/2
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments

- `src/testing/view-diff.ts` exports `diffPlayerViews(viewA: PlayerStateView, viewB: PlayerStateView): ViewDiffResult`, returning `{ onlyInA, onlyInB, attributeDiffs, describe() }` (data fields first, `describe()` last, `FlowDebugInfo` convention).
- The walk is positional (index-aligned, mirroring `debug.ts`'s `findDiffs` recursion strategy) and classifies each aligned node pair purely by `attributes.__hidden === true` — no id comparisons anywhere in the file (grep-verified: zero `.id` accesses), which sidesteps both hidden-element id shapes correctly:
  - An owner-only hand card (visible to its owner, anonymized with a fresh synthetic negative id for the other seat) is reported once, on the correct `onlyIn*` side — never double-counted as removed+added.
  - A standalone individually-hidden element (`showOnlyTo`, stable positive id preserved on both sides per WR-02) toggles only its `__hidden` flag between seats and is likewise reported exactly once, never as an `attributeDiff` (which would leak its value/identity).
  - An identical-count fully-hidden zone (both seats see anonymized placeholders with fresh synthetic ids) produces zero `onlyIn`/`attributeDiffs` noise, since both sides are hidden and the walk stops without recursing or diffing.
- `attributeDiffs` operates on `PlayerStateView.state` = `game.toJSONForPlayer(seat)` **after** any `GameClass.playerView` post-transform, so a hook that injects a per-seat-different attribute on an otherwise-shared, both-visible node is correctly surfaced as a real diff — there is no playerView blind spot.
- `describe()` renders a readable multi-line summary of the three buckets, mirroring `describeFlowPosition`'s formatting style.
- `diffPlayerViews`/`ViewDiffResult` exported from `boardsmith/testing` under a new "Per-seat view diffing (VIS-02)" section comment, matching the VIS-01 export block convention.

## Task Commits

Each task was committed atomically:

1. **Task 1: view-diff.ts (diffPlayerViews) + tests** - `cf0206c` (feat)
2. **Task 2: Barrel export + full-suite check** - `7d39937` (feat)

## Files Created/Modified

- `src/testing/view-diff.ts` - `diffPlayerViews`/`ViewDiffResult`, positional `__hidden`-flag-only tree walk
- `src/testing/view-diff.test.ts` - 2-seat fixture (owner-only hands, standalone individually-hidden shared card, fully-hidden deck, `playerView` hook attribute injection) exercising all required behaviors
- `src/testing/index.ts` - new "Per-seat view diffing (VIS-02)" export block

## Decisions Made

- Classification is entirely `__hidden`-flag based, never id-based. This was the key design choice per RESEARCH Open Question 1: id-based diffing would either misreport identical anonymized zones as spurious structural changes (fresh synthetic ids per call) or fail to recognize an individually-hidden element as "the same element" across seats requiring special-case id matching. The flag-only approach handles both id shapes uniformly with no special-casing.
- `hiddenA !== hiddenB` (present on both sides structurally, redacted on exactly one) classifies as `onlyIn[visible side]` and stops — no attribute diffing and no recursion, since either would leak the hidden side's identity/value through the diff output (T-124-03 mitigation).
- `hiddenA && hiddenB` stops without recursing — a redacted placeholder's "children" (if any) are not reliable/comparable, and diffing them would risk leaking redacted content.
- Only nodes visible on BOTH sides are attribute-diffed, and the walk operates on the post-`playerView` tree, so a `playerView` hook's content stripping or per-seat attribute injection is inherently reflected with no separate handling needed (T-124-08 mitigation).

## Deviations from Plan

None - plan executed exactly as written. All acceptance criteria (grep confirms no id-based correlation, both hidden-element id branches exercised, `npx vitest run src/testing/view-diff.test.ts` green, `npm test` full suite green, `npx tsc --noEmit` no new errors) verified directly.

## Issues Encountered

None - both tasks' tests passed on first implementation; no auto-fixes were required.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- VIS-02 is complete and exported from `boardsmith/testing`; ready for VIS-03 (DOM-leak test utility for rendered per-seat UIs), the remaining plan in this phase.
- `diffPlayerViews` composes cleanly with VIS-01's `isElementVisible`/`getVisibleElements` (both final-tree derived) as the phase's two primary hidden-info verification primitives.
- No blockers identified.

---
*Phase: 124-hidden-info-test-utilities*
*Completed: 2026-07-02*

## Self-Check: PASSED

All created/modified files exist on disk; both task commits (`cf0206c`, `7d39937`) verified present in git log.
