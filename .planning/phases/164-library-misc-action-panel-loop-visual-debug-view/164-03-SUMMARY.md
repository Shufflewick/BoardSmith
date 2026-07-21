---
phase: 164-library-misc-action-panel-loop-visual-debug-view
plan: 03
subsystem: ui
tags: [vue3, action-panel, gameshell, actionMetadata, dock-suppression, pit-of-success]

# Dependency graph
requires:
  - phase: 164-02
    provides: contrastInk helper pattern (independent, no direct code dependency)
provides:
  - "ActionDefinition.suppressFromDock / ActionBuilder.suppressFromDock() / ActionMetadata.suppressFromDock — per-action dock-visibility channel mirroring `manual`"
  - "ActionPanel.visibleActions filter — suppressed actions absent from the rendered dock, still present in props/board substrate"
  - "GameShell.platformActionPanelEscapeHatch prop (renamed from suppressActionPanel) + allDockActionsSuppressed computed + turn-strip fallback"
affects: [166-skilldef-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-action UI hint metadata channel: ActionDefinition field -> builder method -> buildActionMetadata spread -> ActionMetadata field (mirrors the existing `manual` precedent exactly)"
    - "Escape-hatch fencing: rename a blunt all-or-nothing prop to a loud, doc-marked platform-only name rather than deprecate/dual-support"

key-files:
  created:
    - src/ui/components/auto-ui/ActionPanel.dock-suppression.test.ts
    - src/ui/components/GameShell.action-panel-suppression.test.ts
  modified:
    - src/engine/action/types.ts
    - src/engine/action/action-builder.ts
    - src/engine/element/action-metadata.ts
    - src/engine/element/action-metadata.test.ts
    - src/session/types.ts
    - src/ui/components/auto-ui/ActionPanel.vue
    - src/ui/components/GameShell.vue
    - src/ui/composables/useBoardActionBridge.ts

key-decisions:
  - "suppressFromDock is metadata-only: buildActionMetadata never removes a suppressed action from the returned map, and ActionPanel filters only the RENDERED dock buttons (visibleActions), leaving actionsWithMetadata / props / the board substrate (useBoardActionBridge) fully populated -- suppression never becomes an availability or authorization gate."
  - "allDockActionsSuppressed returns false (not vacuously true) when metadata is absent or availableActions is empty, avoiding an Array.prototype.every() vacuous-truth trap that would wrongly suppress the dock on a fresh/empty state."
  - "Escape hatch renamed platformActionPanelEscapeHatch (CONTEXT's own suggested name, locked per RESEARCH's Open Question #1) so Phase 166 SKILLDEF-03 can grep for a stable identifier."

patterns-established:
  - "Per-action dock-visibility hint rides the existing actionMetadata channel end-to-end (engine type -> builder -> buildActionMetadata -> session ActionMetadata -> UI filter), matching the `manual` precedent exactly -- any future per-action UI hint should follow this same three-layer shape."

requirements-completed: [LIBX-01, PROC-01]

duration: 25min
completed: 2026-07-21
---

# Phase 164 Plan 03: Per-Action Dock Suppression + Escape-Hatch Fencing Summary

**Per-action `.suppressFromDock()` rides the existing `actionMetadata` channel (mirroring `manual` exactly) to hide one action's dock button while it stays fully board-executable; the blunt `suppressActionPanel` prop is renamed to the loud, platform-only `platformActionPanelEscapeHatch`, and GameShell now falls back to the bare turn-prompt strip whenever every available action's dock button is suppressed — never a silent zero-indicator board.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-07-21T19:55:22Z (STATE.md last_updated at plan start)
- **Completed:** 2026-07-21T20:00:57Z
- **Tasks:** 3/3 completed
- **Files modified:** 8 (2 new test files, 6 modified source/test files)

## Accomplishments
- Threaded a new `suppressFromDock` per-action metadata flag through the entire engine->UI channel (ActionDefinition -> ActionBuilder -> buildActionMetadata -> ActionMetadata), exactly mirroring the existing `manual` flag's three-layer shape — no new metadata mechanism invented.
- ActionPanel's `visibleActions` computed now filters the rendered dock by `suppressFromDock`, while `actionsWithMetadata` (feeding both props and the board substrate) stays untouched — a suppressed action remains fully clickable via `useBoardInteraction`.
- GameShell's blunt `suppressActionPanel` prop is renamed to `platformActionPanelEscapeHatch` (fully removed from source; zero remaining references in `src/`), with an updated JSDoc explicitly telling game authors to use per-action `.suppressFromDock()` instead, and a new `allDockActionsSuppressed` computed drives the same turn-strip fallback path as the escape hatch — the dock and the turn indicator can never both disappear.
- `useBoardActionBridge.ts`'s doc comment updated to reference the new name and mark it platform-only, de-documenting it as an ordinary author-facing option.

## Task Commits

Each task was committed atomically:

1. **Task 1: Engine per-action suppressFromDock channel (mirror `manual`)** - `51b78306` (feat)
2. **Task 2: ActionPanel dock filter (visibleActions)** - `3c2212bf` (feat)
3. **Task 3: GameShell escape-hatch rename + all-suppressed turn-prompt fallback** - `9b9b4bc9` (feat)

**Plan metadata:** (this commit, follows)

_Note: all three tasks were TDD (`tdd="true"`) — each commit above bundles the source implementation together with its RED-then-GREEN test file, since the plan's own instructions specified writing production code and its test in the same atomic task rather than separate RED/GREEN commits._

## Files Created/Modified
- `src/engine/action/types.ts` - Added `suppressFromDock?: boolean` to `ActionDefinition`, JSDoc explicitly states "not a security control"
- `src/engine/action/action-builder.ts` - Added `.suppressFromDock(): this` builder method, mirrors `.manual()`
- `src/engine/element/action-metadata.ts` - `buildActionMetadata` spreads `suppressFromDock: true` into the returned metadata when set, omitted otherwise (matches the `manual` spread pattern)
- `src/engine/element/action-metadata.test.ts` - New `describe('buildActionMetadata: suppressFromDock ...')` block: 3 tests (emits when set, omits when unset, does not remove the action from the metadata map)
- `src/session/types.ts` - Added `suppressFromDock?: boolean` to `ActionMetadata`
- `src/ui/components/auto-ui/ActionPanel.vue` - `visibleActions` computed changed from a passthrough to `.filter(a => !a.suppressFromDock)`
- `src/ui/components/auto-ui/ActionPanel.dock-suppression.test.ts` - New file: 2 component tests (suppressed button absent/sibling present; suppressed action still in props)
- `src/ui/components/GameShell.vue` - Renamed `suppressActionPanel` -> `platformActionPanelEscapeHatch` (prop decl, default, both v-if usages); added `allDockActionsSuppressed` computed; turn-strip v-if now `platformActionPanelEscapeHatch || allDockActionsSuppressed`; ActionPanel-mount v-if now `!platformActionPanelEscapeHatch && !allDockActionsSuppressed`
- `src/ui/components/GameShell.action-panel-suppression.test.ts` - New file: harness-based tests mirroring GameShell's exact template conditions (all-suppressed fallback, some-un-suppressed mount, escape-hatch regression, no-metadata default, turn-indicator-always-present) plus direct source-string assertions confirming the old name is fully gone and the new name/computed are wired at all required sites
- `src/ui/composables/useBoardActionBridge.ts` - Doc-comment reference to `suppressActionPanel` replaced with `platformActionPanelEscapeHatch`, marked platform-only

## Decisions Made
- Locked the escape-hatch identifier as `platformActionPanelEscapeHatch` (CONTEXT's own suggested example), since Phase 166's SKILLDEF-03 will reference it by name — no further bikeshedding needed downstream.
- `allDockActionsSuppressed` explicitly returns `false` (not the vacuous-truth `true` that a bare `.every()` on an empty array would produce) when there is no metadata or `availableActions` is empty, so a fresh/uninitialized state never accidentally triggers the fallback path.
- Did NOT touch the `:2439-2447` history-guard props in GameShell.vue (`isViewingHistory ? [] : ...`) — explicitly out of scope per the plan's interface notes; those belong to plan 164-04 (LIBX-04).

## Deviations from Plan

None — plan executed exactly as written. All three tasks matched their `<action>` instructions verbatim; no Rule 1-4 fixes were required.

## Verification

```
npx vitest run src/engine/element/action-metadata.test.ts src/ui/components/auto-ui/ActionPanel.dock-suppression.test.ts src/ui/components/GameShell.action-panel-suppression.test.ts
```
→ 3 files, 24 tests, all passing.

Additional regression sweep (not required by the plan, run as a sanity check before closing): `ActionPanel.test.ts`, `ActionPanel.smoke.test.ts`, `GameShell.ia.test.ts`, `GameShell.action-help.test.ts`, `useBoardActionBridge.test.ts`, `GameShell.game-over.test.ts`, `GameShell.tutorial.test.ts` — all green (107 + 43 = 150 additional tests), confirming no regression in the ActionPanel/GameShell suites this plan touches.

`grep -c "suppressActionPanel" src/ui/components/GameShell.vue src/ui/composables/useBoardActionBridge.ts` → 0/0 (old name fully removed from source). `grep -c "platformActionPanelEscapeHatch" src/ui/components/GameShell.vue` → 4 (decl, default, both v-if usages).

Awareness grep (no edit, per plan's verification step): `grep -rn "suppressActionPanel" ~/BoardSmithGames` found only documentation references in the `seven` game's `BOARDSMITH-REQUESTS.md`/`SKETCH.md`/`DECISIONS.md`/chunk files — specifically **BSR-11**, a filed request asking for exactly the per-action dock-suppression capability this plan just delivered. No source-code usage in any sibling game; nothing to fix (library-only phase, game-repo edits explicitly out of scope). Flagged here for the future cross-repo pass that closes BSR-11 against `seven`.

`npx tsc --noEmit` was run against the full repo; all pre-existing errors are unrelated to this plan's files (confirmed via `git stash` comparison for `action-metadata.test.ts`'s two pre-existing `state.availableActions` possibly-undefined errors). One tsc error was introduced and immediately fixed in `ActionPanel.dock-suppression.test.ts` (an untyped `wrapper.props('name')` call-site — replaced with a single typed cast of `wrapper.props()`).

## Self-Check

- `test -f src/engine/action/types.ts && grep -q suppressFromDock src/engine/action/types.ts` → FOUND
- `test -f src/engine/action/action-builder.ts && grep -q suppressFromDock src/engine/action/action-builder.ts` → FOUND
- `test -f src/engine/element/action-metadata.ts && grep -q suppressFromDock src/engine/element/action-metadata.ts` → FOUND
- `test -f src/session/types.ts && grep -q suppressFromDock src/session/types.ts` → FOUND
- `test -f src/ui/components/auto-ui/ActionPanel.vue && grep -q suppressFromDock src/ui/components/auto-ui/ActionPanel.vue` → FOUND
- `test -f src/ui/components/GameShell.vue && grep -q platformActionPanelEscapeHatch src/ui/components/GameShell.vue` → FOUND
- `test -f src/ui/components/auto-ui/ActionPanel.dock-suppression.test.ts` → FOUND
- `test -f src/ui/components/GameShell.action-panel-suppression.test.ts` → FOUND
- Commit `51b78306` → FOUND in `git log --oneline --all`
- Commit `3c2212bf` → FOUND in `git log --oneline --all`
- Commit `9b9b4bc9` → FOUND in `git log --oneline --all`

## Self-Check: PASSED
