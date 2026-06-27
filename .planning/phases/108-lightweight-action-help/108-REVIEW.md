---
phase: 108-lightweight-action-help
reviewed: 2026-06-26T00:00:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - src/engine/action/action-builder.ts
  - src/engine/action/types.ts
  - src/session/types.ts
  - src/session/utils.ts
  - src/ui/components/ControlsMenu.vue
  - src/ui/components/GameShell.vue
  - src/ui/components/auto-ui/ActionPanel.vue
  - src/ui/components/helpers/ActionHelpPopover.vue
  - src/ui/composables/useActionControllerTypes.ts
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
---

# Phase 108: Code Review Report

**Reviewed:** 2026-06-26
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Phase 108 adds `.help(text)` on the action builder, propagates `help` through both `buildActionMetadata` and `buildSingleActionMetadata`, delivers it to the client via `ActionMetadata`, and renders it through a shared `ActionHelpPopover` component with a global preference toggle persisted in localStorage.

The core contract is sound: the `help` field is correctly present in `ActionDefinition` (engine/types.ts:460), `ActionMetadata` (session/types.ts:359), and `useActionControllerTypes.ts:106`; both build paths in `session/utils.ts` copy it; XSS is mitigated by using Vue text interpolation only (no `v-html`); the localStorage try/catch fail-safe is correct; and `isActionHelpVisible` is threaded to the custom-UI slot, the dev-UI-switcher `<component>`, `ActionPanel`, and `ControlsMenu` without per-UI branching.

Four warnings remain, all in `ActionHelpPopover.vue` and `ControlsMenu.vue`. Two concern the popover's position calculation; one concerns a misleading label; one concerns a missing prop default. No blockers.

## Warnings

### WR-01: `POPOVER_ESTIMATED_HEIGHT = 80` causes incorrect flip detection and wrong position when flipped

**File:** `src/ui/components/helpers/ActionHelpPopover.vue:65`

**Issue:** The flip-above threshold and the above-position calculation both use a hardcoded `POPOVER_ESTIMATED_HEIGHT = 80`. A popover that contains both `helpText` (multi-line) and `disabledReason` — the expected common case — renders roughly 160–200 px tall (padding 16 px, help body 60–80 px, divider 17 px, "Why disabled:" label 20 px, disabled body 60–80 px). Two separate defects follow:

1. **Flip does not trigger when it should.** The condition on line 73 is:
   ```
   if (top + 80 > window.innerHeight - 8)
   ```
   When the popover is actually 180 px tall, the check passes only when the trigger is within 80 px of the viewport bottom instead of 180 px. The popover overflows the viewport without flipping.

2. **When the flip does trigger, the popover overlaps the trigger.** Line 75 positions the top edge at `rect.top - 80 - 4`. If the actual popover height is 180 px, the popover extends from `rect.top - 84` down to `rect.top + 96`, completely covering the trigger button.

**Fix:** Increase the constant to a conservative upper bound (e.g., 220 px), or — more robustly — compute position after mount using `ResizeObserver` / `el.offsetHeight`. If the static estimate is kept, document the limitation:

```typescript
// Covers single-section (≈80 px) and dual-section (≈200 px) layouts.
// Update if max content grows beyond this estimate.
const POPOVER_ESTIMATED_HEIGHT = 220;
```

---

### WR-02: Caret visually mispoints after right-edge clamping

**File:** `src/ui/components/helpers/ActionHelpPopover.vue:79-83` (JS) and lines 243–244, 264–265 (CSS)

**Issue:** When the right-edge constraint clamps the popover left position:

```typescript
if (left + POPOVER_MAX_WIDTH > window.innerWidth - 8) {
  left = window.innerWidth - POPOVER_MAX_WIDTH - 8;
}
```

the CSS caret remains centered at `left: 50%` of the popover width. If the trigger is near the right edge and the popover is shifted 100 px to the left, the caret points ~100 px to the left of the "?" button. On a crowded action bar with right-aligned buttons, this is visible on nearly every use.

**Fix:** After clamping, compute the caret's offset from the popover left edge and set it as an inline style on the caret element:

```typescript
// After clamping:
const triggerMidX = rect.left + rect.width / 2;
const caretOffset = Math.min(POPOVER_MAX_WIDTH - 12, Math.max(12, triggerMidX - left));
// Pass caretOffset into PopoverPosition and bind it as style on .ahp-caret
```

In the CSS, remove the hardcoded `left: 50%` and use a CSS variable set by the computed style:

```css
.ahp-caret--top,
.ahp-caret--bottom {
  left: var(--ahp-caret-left, 50%);
  transform: translateX(-50%);
}
```

---

### WR-03: "Why disabled:" label is semantically incorrect when the action button is still clickable

**File:** `src/ui/components/auto-ui/ActionPanel.vue:815-820`

**Issue:** Tutorial-gated actions appear in `disabledActions` with a reason string, but they remain in `availableActions` and their button is rendered with only `:disabled="isExecuting"`. The "?" popover shows "Why disabled:" over a fully-clickable button. From a user perspective, the label says the action cannot be used while the button plainly can be clicked.

This confuses the distinction between the `disabled` HTML attribute (which prevents interaction) and the tutorial gate (which may allow or redirect the interaction server-side). A player clicking the button after reading "Why disabled:" will be surprised when the action begins normally.

**Fix:** Either:

- Rename the label to something neutral that does not assert non-functionality, for example "Note:" or "Tutorial:" — this requires only a one-line change in `ActionHelpPopover.vue`:

```html
<!-- Before -->
<span class="ahp-disabled-label">Why disabled:</span>

<!-- After -->
<span class="ahp-disabled-label">Note:</span>
```

- Or, if the intent is that `disabledActions` entries ARE truly unexecutable (gate blocks server-side), add `:disabled="!!disabledActions?.[action.name] || isExecuting"` to the action button and keep the label, making the visual state match.

---

### WR-04: `isActionHelpVisible` prop has no default — `aria-checked` is absent instead of `"false"`

**File:** `src/ui/components/ControlsMenu.vue:44` (props), `186` (binding)

**Issue:** `isActionHelpVisible?: boolean` has no default in `withDefaults`. When the prop is omitted, Vue binds `undefined` to `:aria-checked`, which removes the attribute entirely from the rendered DOM. A `role="menuitemcheckbox"` element with no `aria-checked` attribute has an implicit value of `"false"` per ARIA spec, so screen readers report the item as unchecked — the behavior is technically valid but the contract is fragile. Any consumer that forgets to pass the prop gets a state-less checkbox.

**Fix:** Add the missing default:

```typescript
const props = withDefaults(defineProps<{
  // ...
  isActionHelpVisible?: boolean;
}>(), {
  openUp: false,
  align: 'right',
  isActionHelpVisible: false,   // add this
});
```

## Info

### IN-01: `DEBUG_HMR = false` produces permanently dead conditional code

**File:** `src/ui/components/GameShell.vue:23-26`

**Issue:**

```typescript
const DEBUG_HMR = false;
function hmrLog(...args: unknown[]) {
  if (DEBUG_HMR) console.log('[HMR-DEBUG]', ...args);
}
```

`DEBUG_HMR` is a compile-time constant `false`. The `if (DEBUG_HMR)` branch in `hmrLog` is permanently dead. Vite tree-shakes this in production, but in dev builds every `hmrLog(...)` call site pays a function-call cost for a no-op. The eleven call sites in GameShell also add noise to code review.

**Fix:** Remove `DEBUG_HMR`, `hmrLog`, and all call sites. If HMR tracing is needed again, gate it with `import.meta.env.DEV` rather than a hardcoded constant.

---

### IN-02: `.action-help-btn` styles live in `ActionPanel`'s scoped CSS, not in `ActionHelpPopover`

**File:** `src/ui/components/auto-ui/ActionPanel.vue:1181-1202`

**Issue:** The positioning and sizing of the "?" trigger button (`position: absolute; top: 0; right: 0; min-width: 24px; min-height: 24px`) are defined in `ActionPanel.vue`'s `<style scoped>`. The scoped attribute is injected into `ActionHelpPopover`'s root button element because Vue propagates parent scoped attributes to child component root elements — so this works today.

However, `ActionHelpPopover.vue`'s own header comment says it is "used by both ActionPanel (AutoUI) and custom UI slots." If a game author imports and uses `ActionHelpPopover` directly in a custom board, the button will render without any absolute positioning, sizing, or z-index, producing an inline unstyled element.

**Fix:** Move the `.action-help-btn` rule block into `ActionHelpPopover.vue`'s own `<style scoped>`. `ActionPanel` can then remove its duplicate rule. This makes the component self-contained.

---

### IN-03: Tooltip closes on `mousedown` inside the popover body on touch

**File:** `src/ui/components/helpers/ActionHelpPopover.vue:115-123`

**Issue:** `handleOutsideClick` only exempts clicks inside `triggerRef.value`; it has no knowledge of the teleported popover element. `ControlsMenu.handleOutsideClick` checks both `menuRoot` and `menuRef` separately (ControlsMenu.vue:105-113). On touch devices, tapping anywhere in the visible popover content area triggers `mousedown`, which `handleOutsideClick` treats as an outside click and calls `hide()`. A user tapping the popover to select or re-read text will close it.

This is the expected semantic for a `role="tooltip"` (tooltips are not interactive and should dismiss on outside interaction), and the spec comment lists "outside mousedown" as a dismiss trigger. The discrepancy with ControlsMenu (which IS interactive) is intentional. No fix is required for the current use case, but if `ActionHelpPopover` is later extended with selectable text or a copy button, a `popoverRef` exclusion will be needed.

---

_Reviewed: 2026-06-26_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
