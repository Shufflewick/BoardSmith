---
phase: 108-lightweight-action-help
plan: "03"
subsystem: ui
tags: [action-help, controls-menu, game-shell, localstorage, parity]
dependency_graph:
  requires: [108-02]
  provides: [HELP-02]
  affects: [src/ui/components/ControlsMenu.vue, src/ui/components/GameShell.vue]
tech_stack:
  added: []
  patterns:
    - localStorage boolean preference (try/catch, default ON, boardsmith_action_help)
    - menuitemcheckbox toggle pill in Play group (always visible, not AI-gated)
    - teaching-action emit extended with help-toggle (pure client, no platformRequest)
    - dual-path slot prop threading (ActionPanel + #game-board + dev UI-switcher)
key_files:
  created:
    - src/ui/components/ControlsMenu.action-help.test.ts
    - src/ui/components/GameShell.action-help.test.ts
  modified:
    - src/ui/components/ControlsMenu.vue
    - src/ui/components/GameShell.vue
decisions:
  - "help-toggle placed in Play group (not Teaching group) so it shows in non-AI games — mirrors Pitfall 6 finding"
  - "No platformRequest for help-toggle — pure client display preference, persisted via localStorage only"
  - "disabledActions computed via (state as any).disabledActions cast — mirrors actionMetadata pattern"
  - "Harness-based tests (GameShell.tutorial.test.ts pattern) used for localStorage + dual-path coverage"
metrics:
  duration_minutes: 15
  completed_date: "2026-06-27"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 4
---

# Phase 108 Plan 03: ControlsMenu + GameShell Action Help Wiring Summary

**One-liner:** Global "Show action help" localStorage toggle wired from ControlsMenu Play group through GameShell into both ActionPanel (AutoUI) and `#game-board` slot props, with `disabledActions` dead-field wiring completed (HELP-02).

## What Was Built

Two files modified, two test files created:

**ControlsMenu.vue** — New `isActionHelpVisible?: boolean` prop and `'help-toggle'` added to the `teaching-action` emit union. A new `menuitemcheckbox` button ("Show action help") placed in the **Play group** after "Auto end turn" and before "Undo". Uses the identical heatmap toggle template: circled-question-mark SVG, `:aria-checked="isActionHelpVisible"`, `@click="emit('teaching-action','help-toggle')"`, `.toggle :class="{ on: isActionHelpVisible }"`. Critically NOT inside the `v-if="showHint !== undefined"` Teaching group — visible in all games regardless of AI presence.

**GameShell.vue** — Seven coordinated edits:
1. `getActionHelpEnabled()` / `setActionHelpEnabled(value)` helpers keyed `boardsmith_action_help`, try/catch, default true when absent
2. `const isActionHelpVisible = ref(getActionHelpEnabled())` initialized from localStorage
3. `disabledActions` computed from `(state.value?.state as any)?.disabledActions`
4. `handleTeachingAction` extended with `'help-toggle'` branch — flips ref, calls `setActionHelpEnabled`, no `platformRequest`
5. ControlsMenu gets `:is-action-help-visible="isActionHelpVisible"`
6. ActionPanel gets `:is-action-help-visible="isActionHelpVisible"` and `:disabled-actions="isViewingHistory ? undefined : disabledActions"`
7. `#game-board` slot AND dev UI-switcher `<component>` block both get `:is-action-help-visible="isActionHelpVisible"` (parity)

## Tests

**ControlsMenu.action-help.test.ts** (7 tests) — Uses `document.body.querySelectorAll` to find Teleported elements. Covers: render without `showHint`, emit on click, `aria-checked` true/false, `.toggle.on` class, Play-group placement guard.

**GameShell.action-help.test.ts** (21 tests) — Harness-based (mirrors `GameShell.tutorial.test.ts` pattern). Covers: `getActionHelpEnabled` default-ON / stored-false / round-trip; `setActionHelpEnabled` write contracts; toggle handler flip + localStorage write; reload persistence; ActionPanel dual-path binding; `#game-board` slot prop exposure; parity assertion; `disabledActions` from broadcast state / null / undefined.

## Verification

Full suite: **1570 tests, all pass.**

```
npx vitest run → 120 test files, 1570 tests, 0 failures
```

Acceptance criteria verified:
- `grep -c "boardsmith_action_help" GameShell.vue` → 3 (in get/set helpers + key constant)
- `grep -c "is-action-help-visible" GameShell.vue` → 4 (ControlsMenu, ActionPanel, slot, switcher)
- `grep -n "disabled-actions" GameShell.vue` → line 1957 in ActionPanel binding
- Toggle visible with `showHint` undefined (Play group, not Teaching group)

## Deviations from Plan

None — plan executed exactly as written.

## Threat Flags

No new trust boundaries or network endpoints introduced. T-108-05 mitigated: `getActionHelpEnabled` uses try/catch and only interprets `'true'`/`'false'` literal strings; any other stored value (including corrupted/injected data) falls back to the default `true`. T-108-06 mitigated: toggle placement and test verified.

## Self-Check: PASSED

Files exist:
- src/ui/components/ControlsMenu.action-help.test.ts — FOUND
- src/ui/components/GameShell.action-help.test.ts — FOUND
- src/ui/components/ControlsMenu.vue (modified) — FOUND
- src/ui/components/GameShell.vue (modified) — FOUND

Commits:
- 4484b2b test(108-03): add failing tests for Show action help ControlsMenu toggle
- 02d3d29 feat(108-03): add Show action help menuitemcheckbox to ControlsMenu Play group
- 109b052 test(108-03): add harness tests for GameShell action-help localStorage + dual-path parity
- ae81145 feat(108-03): wire isActionHelpVisible + disabledActions in GameShell
