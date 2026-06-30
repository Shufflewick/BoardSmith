---
phase: 108-lightweight-action-help
plan: "02"
subsystem: ui/components
tags: [popover, tooltip, action-help, parity, a11y, tdd]
dependency_graph:
  requires: [108-01]
  provides: [ActionHelpPopover.vue, ActionPanel-help-wiring]
  affects:
    - src/ui/components/helpers/ActionHelpPopover.vue
    - src/ui/components/helpers/ActionHelpPopover.test.ts
    - src/ui/components/auto-ui/ActionPanel.vue
    - src/ui/components/auto-ui/ActionPanel.test.ts
tech_stack:
  added: []
  patterns:
    - Teleport-to-body fixed-positioned tooltip (mirrors HeatmapOverlay/TutorialOverlay)
    - getBoundingClientRect single-measure popover positioning (RESEARCH Pitfall 4 — stale acceptable)
    - document mousedown + keydown dismiss (mirrors ControlsMenu)
    - CSS border-trick caret top/bottom variants (mirrors BoardMessage)
    - TDD red-green cycle (failing tests committed before implementation)
    - parity fixture test (custom-UI-like div vs AutoUI-like td host)
key_files:
  created:
    - src/ui/components/helpers/ActionHelpPopover.vue
    - src/ui/components/helpers/ActionHelpPopover.test.ts
  modified:
    - src/ui/components/auto-ui/ActionPanel.vue
    - src/ui/components/auto-ui/ActionPanel.test.ts
decisions:
  - "Teleport to body with position:fixed — same pattern as HeatmapOverlay/TutorialOverlay; escapes .actionbar overflow clip"
  - "aria-describedby applied conditionally only when isOpen (RESEARCH Pitfall 3 — no dangling ARIA references)"
  - "Caret uses var(--bsg-surface-3) fill per UI-SPEC (not surface-2 like BoardMessage)"
  - ".action-btn-group uses inline-flex + absolutely-positioned '?' so action-btn intrinsic width is unchanged (RESEARCH Pitfall 5)"
  - "Test for startAction behavior corrected to spy on execute (not start) because selections:[] skips start and goes to executeAction"
metrics:
  duration: "~5 minutes"
  completed: "2026-06-27T01:41:44Z"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 4
---

# Phase 108 Plan 02: ActionHelpPopover + ActionPanel Wiring Summary

Shared Teleport-to-body `ActionHelpPopover.vue` with "?" trigger, `role=tooltip`, caret, reduced-motion guard, and parity fixture test — wired into `ActionPanel.vue` via `.action-btn-group` wrapper with `isActionHelpVisible` and `disabledActions` props.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Failing ActionHelpPopover tests | 98daa3a | ActionHelpPopover.test.ts |
| 1 (GREEN) | Create ActionHelpPopover.vue | bd02604 | ActionHelpPopover.vue |
| 2 (RED) | Failing ActionPanel wiring tests | 5fa66f3 | ActionPanel.test.ts |
| 2 (GREEN) | Wire ActionHelpPopover into ActionPanel | 0bcdcb4 | ActionPanel.vue, ActionPanel.test.ts |

## What Was Built

### Task 1: ActionHelpPopover.vue (shared reveal surface)

- New `src/ui/components/helpers/ActionHelpPopover.vue` — 333 lines.
- Props: `actionName`, `triggerLabel`, `helpText?`, `disabledReason?`.
- Trigger: `<button class="action-help-btn">` with `aria-label="Help for {triggerLabel}"`, `aria-expanded`, `aria-controls`, conditional `aria-describedby` (only when open — RESEARCH Pitfall 3).
- Inline SVG: circled question mark 14×14 (UI-SPEC §2), `aria-hidden="true"`.
- Popover: `<Teleport to="body">` + `v-if="isOpen"`, `role="tooltip"`, `aria-live="polite"`, `id="${actionName}-help-tip"`, `position: fixed` via computed style from `getBoundingClientRect()`.
- Position: below trigger by default; flip above near viewport bottom; right-edge clamp.
- Caret: CSS border-trick top/bottom variants, `var(--bsg-surface-3)` fill (UI-SPEC §3).
- Content: helpText via `{{ }}`, divider only when both sections exist, "Why disabled:" label + reason via `{{ }}`. Zero raw HTML binding (T-108-03).
- Dismiss: `document.addEventListener('mousedown', ...)` + `('keydown', ...)` in `onMounted`/`onUnmounted`; `@mouseleave` hides; `@mouseenter` shows; `@click` toggles.
- Transition: `opacity + translateY(-2px)` over `var(--bsg-dur-fast)`; `@media (prefers-reduced-motion: reduce) { transition: none }`.
- Tests: 19/19 passing covering all behavior cases including parity fixture.

### Task 2: ActionPanel.vue wiring

- Added `isActionHelpVisible?: boolean` and `disabledActions?: Record<string, string>` to `defineProps`.
- Import of `ActionHelpPopover` added.
- Action button `<button v-for>` loop wrapped in `<div class="action-btn-group">`.
- `<ActionHelpPopover>` rendered with `v-if="isActionHelpVisible && (action.help || disabledActions?.[action.name])"`.
- Undo button remains outside the group (no affordance — plan contract).
- CSS added: `.action-btn-group { display: inline-flex; align-items: stretch; position: relative }` and `.action-help-btn { position: absolute; top: 0; right: 0; ... }` with idle/hover/open states.
- Extended ActionPanel.test.ts with 6 new tests covering all affordance visibility cases.
- 652/652 UI tests passing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test spy corrected from start() to execute()**
- **Found during:** Task 2 GREEN
- **Issue:** Test for "existing .action-btn behavior unchanged" spied on `actionController.start` but with `selections: []`, ActionPanel routes to `executeAction → actionController.execute` (not `start`). The test would never pass with correct implementation.
- **Fix:** Changed spy target to `execute` and asserted `executeSpy.toHaveBeenCalledWith('attack', {})`.
- **Files modified:** `src/ui/components/auto-ui/ActionPanel.test.ts`
- **Commit:** 0bcdcb4

**2. [Rule 2 - Security] v-html string in comments removed**
- **Found during:** Task 1 acceptance gate
- **Issue:** `grep -c "v-html"` acceptance criterion required 0 hits; comments containing "never v-html" produced 2 hits.
- **Fix:** Reworded comments to avoid the literal string ("no raw HTML binding").
- **Files modified:** `src/ui/components/helpers/ActionHelpPopover.vue`
- **Commit:** bd02604

## Known Stubs

None. The component is fully implemented and wired. `isActionHelpVisible` prop is ready for Plan 03 (GameShell) to drive from the global toggle.

## Threat Flags

None beyond the mitigations already in the plan's threat register:
- T-108-03 (XSS via help text): mitigated — zero `v-html=` attribute in ActionHelpPopover.vue confirmed by `grep -c 'v-html=' == 0`. Both helpText and disabledReason rendered via `{{ }}` interpolation. Test asserts `<script>` literal reaches DOM as text, not parsed element.
- T-108-04 (layout DoS): mitigated — `.action-btn-group` uses `inline-flex` + absolutely-positioned "?" so action-btn intrinsic width is unchanged.

## Self-Check: PASSED

Files verified:
- `src/ui/components/helpers/ActionHelpPopover.vue` — exists, 333 lines ✓
- `src/ui/components/helpers/ActionHelpPopover.test.ts` — exists, 19 tests ✓
- `src/ui/components/auto-ui/ActionPanel.vue` — `ActionHelpPopover` count=2 (import + usage) ✓, `action-btn-group` in template and CSS ✓
- `src/ui/components/auto-ui/ActionPanel.test.ts` — 6 new affordance tests added ✓

Commits verified:
- 98daa3a — test(108-02): failing ActionHelpPopover tests (TDD RED)
- bd02604 — feat(108-02): create ActionHelpPopover.vue shared reveal surface
- 5fa66f3 — test(108-02): failing ActionPanel wiring tests (TDD RED)
- 0bcdcb4 — feat(108-02): wire ActionHelpPopover into ActionPanel via .action-btn-group

Test results: 652 UI tests passing (full `npx vitest run src/ui` suite)
