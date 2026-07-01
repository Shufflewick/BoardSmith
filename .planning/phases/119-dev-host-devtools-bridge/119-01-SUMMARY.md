---
phase: 119-dev-host-devtools-bridge
plan: 01
subsystem: testing
tags: [vitest, vue-test-utils, jsdom, data-attributes, auto-ui]

# Dependency graph
requires:
  - phase: 105-structural-parity
    provides: anchorAttrs single-source pattern + single-source guard test
provides:
  - DOM-mount parity proof that all four AutoUI renderers emit data-bs-el-id matching element.id
  - data-element-id (FLIP alias) confirmed present on all four renderer roots
affects: [119-dev-host-devtools-bridge]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "mountWithInteraction wrapper: defineComponent with provideBoardInteraction in setup, renders renderer via h(). Reusable pattern for renderer DOM-attribute tests."
    - "Die3D stub: { global: { stubs: { Die3D: ... } } } in mount options to avoid jsdom WebGL/canvas deps without affecting root attributes under test."

key-files:
  created:
    - src/ui/components/auto-ui/renderers/renderers.devtools-attrs.test.ts
  modified: []

key-decisions:
  - "DEV-01 is verification-only: data-bs-el-id was already emitted via v-bind=selectableAttrs. No renderer .vue files modified."
  - "Die3D stubbed in jsdom tests to avoid WebGL/canvas runtime failures; data attribute emission comes from DieRenderer's own root, unaffected by stub."
  - "CardRenderer elementNotation falls back to element.name when attributes.notation is absent; test asserts data-bs-el-notation equals element.name."

patterns-established:
  - "Renderer devtools-attr tests: use mountWithInteraction + wrapper.find('.root-class').element.getAttribute() to assert DOM data attributes set via v-bind spread."

requirements-completed: [DEV-01]

# Metrics
duration: 8min
completed: 2026-06-30
---

# Phase 119 Plan 01: DEV-01 data-bs-el-id Parity Test Summary

**DOM-mount parity proof confirming all four AutoUI renderers already emit `data-bs-el-id` + `data-element-id` via `v-bind="selectableAttrs"` — no renderer source touched.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-06-30T19:17:00Z
- **Completed:** 2026-06-30T19:25:00Z
- **Tasks:** 1 of 1
- **Files modified:** 1 (new test file only)

## Accomplishments

- Created `renderers.devtools-attrs.test.ts` with 13 tests across all four AutoUI renderers (PieceRenderer, SpaceRenderer, DieRenderer, CardRenderer)
- Each renderer asserts `root.getAttribute('data-bs-el-id') === String(42)` and `root.getAttribute('data-element-id') !== null`
- Name/notation anchor attrs also asserted where the element identity carries them
- Single-source guard (`anchorAttrs.test.ts`) stays green — confirmed zero renderer `.vue` files modified
- `git diff --name-only` shows only the new test file, no renderer source touched

## Task Commits

Each task was committed atomically:

1. **Task 1: DOM-mount parity test for data-bs-el-id across all four AutoUI renderers** - `b72e5d3` (test)

**Plan metadata:** (final commit below)

## Files Created/Modified

- `src/ui/components/auto-ui/renderers/renderers.devtools-attrs.test.ts` — 13-test suite asserting data-bs-el-id + data-element-id on all four renderer roots via mountWithInteraction wrapper pattern

## Decisions Made

- DEV-01 is a verification plan only — the attribute was already emitted via `v-bind="selectableAttrs"` → `useSelectable.attrs` → `anchorAttrs(identity())`. Adding inline `:data-bs-el-id` literals would have broken the single-source guard.
- Die3D stubbed with `{ global: { stubs: { Die3D: ... } } }` to prevent jsdom WebGL/canvas failures. Root `data-*` attribute emission is on `DieRenderer`'s own `.die-container` element, entirely unaffected by the stub.
- CardRenderer test asserts `data-bs-el-notation === element.name` because `elementNotation` falls back to `element.name` when `attributes.notation` is absent (this is the correct CardRenderer behavior, not a quirk).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Vue warnings for missing injections (`presentation`, `selectableElements`, `selectedElements`) appeared in stderr during tests, but are benign — those injections either have safe defaults (`ref(null)`) or are null-checked in the renderer code. All 13 tests pass. The warnings match what `CardRenderer.a11y.test.ts` also produces in isolation.

## Next Phase Readiness

- DEV-01 verified: `[data-bs-el-id="<id>"]` resolves the correct element in both custom UI and AutoUI
- Ready for 119-02 (DEV-02 postMessage bridge) and 119-03 (DEV-03 CustomEvent dispatch)

---
*Phase: 119-dev-host-devtools-bridge*
*Completed: 2026-06-30*
