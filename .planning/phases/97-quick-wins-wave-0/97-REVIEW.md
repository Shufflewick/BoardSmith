---
phase: 97-quick-wins-wave-0
reviewed: 2026-06-22T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - src/cli/dev-host/host.html
  - src/cli/lib/project-scaffold.ts
  - src/ui/components/GameHeader.vue
  - src/ui/components/GameShell.vue
  - src/ui/components/HamburgerMenu.test.ts
  - src/ui/components/HamburgerMenu.vue
  - src/ui/components/auto-ui/ActionPanel.test.ts
  - src/ui/components/auto-ui/ActionPanel.vue
findings:
  critical: 1
  warning: 3
  info: 1
  total: 5
status: issues_found
---

# Phase 97: Code Review Report

**Reviewed:** 2026-06-22
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Phase 97 ("quick wins wave 0") makes surgical a11y, error-feedback, and mobile-viewport changes across four source files and adds two test files. The `viewport-fit=cover` additions are correct in both the dev-host HTML and the scaffold template. The `100vh → 100dvh` fallback ordering (old value first, new value second) is correct in all four instances — older browsers keep `100vh`, modern ones override with `100dvh`. The `env(safe-area-inset-*)` expressions use `max(Xpx, env(...))` which degrades to the fixed pixel value when the inset is unavailable or zero. Toast replacement of `alert()` is directionally correct and passes real server error strings in almost all paths.

Three issues require fixes before shipping, and one is a blocker: the desktop action-bar refactor silently regressed `padding-top` from 16px to 12px. Additionally the hamburger button carries a permanently-static "Open menu" label that contradicts its expanded state for screen reader users, one catch block was left without a toast, and the `execute()` result guard allows silent failures when `result.error` is absent.

---

## Critical Issues

### CR-01: Desktop action-bar `padding-top` regressed from 16px to 12px

**File:** `src/ui/components/GameShell.vue:1578-1583`

**Issue:** The original desktop media query used the shorthand `padding: 16px 20px`, which set top and bottom to 16px. The refactored version replaces it with three individual longhand declarations (`padding-bottom`, `padding-left`, `padding-right`) but omits `padding-top`. On viewports ≥ 768px, `padding-top` now inherits the mobile base value of `12px` instead of the intended `16px`. This is a measurable visual regression in the action bar appearance on desktop.

**Before (effective):** top=16px, bottom=16px, left=20px, right=20px on desktop  
**After (effective):** top=12px (mobile default leaked through), bottom=max(16px,…), left=max(20px,…), right=max(20px,…)

**Fix:**
```css
@media (min-width: 768px) {
  .game-shell__action-bar {
    padding-top: 16px;   /* ← add this; was lost in shorthand → longhand conversion */
    padding-bottom: max(16px, env(safe-area-inset-bottom));
    padding-left: max(20px, env(safe-area-inset-left));
    padding-right: max(20px, env(safe-area-inset-right));
  }
}
```

---

## Warnings

### WR-01: `executeAction` toast is silently suppressed when `result.error` is absent

**File:** `src/ui/components/auto-ui/ActionPanel.vue:732-734`

**Issue:** The guard `if (!result.success && result.error)` means that when `actionController.execute()` returns `{ success: false }` with no `error` field, no toast fires and the user gets zero feedback. The `setSelectionValue` path at line 678 correctly handles this with `result.error || 'Selection failed.'`. The `execute` path is inconsistent and will silently drop any rejection where the controller does not populate `error`.

**Fix:**
```ts
const result = await actionController.execute(actionName, filteredArgs);
if (!result.success) {
  console.error('Action failed:', result.error);
  toast.error(result.error || 'Failed to execute action.');
}
```

### WR-02: `handleSetReady` catch block never shows a toast

**File:** `src/ui/components/GameShell.vue:992-994`

**Issue:** This is the only catch block in the set of functions touched by this phase that was not updated to call `toast.error`. If a network error occurs while setting ready status, the user sees nothing — the error is silently consumed after `console.error`. Every other catch block in `handleUndo`, `joinGame`, `handleJoinLobby`, and `handleRestartGame` was updated to show a toast.

**Fix:**
```ts
} catch (err) {
  console.error('Failed to set ready:', err);
  toast.error(err instanceof Error ? err.message : 'Failed to mark as ready.');
}
```

### WR-03: `aria-label="Open menu"` is static and contradicts `aria-expanded="true"`

**File:** `src/ui/components/HamburgerMenu.vue:70`

**Issue:** The hamburger button has a hard-coded `aria-label="Open menu"`. When `isOpen` is true and `aria-expanded="true"` is also present, some screen readers announce "Open menu button, expanded" — the label says "open" while the state says "expanded (i.e., already open)." The test at `HamburgerMenu.test.ts:22` only asserts `toBeTruthy()` on the label and does not assert its value, so this inconsistency is not caught. Per WAI-ARIA authoring practices for disclosure buttons, the accessible name should either be state-neutral ("Menu") or update to match the action available.

**Fix (option A — neutral label):**
```vue
aria-label="Menu"
```

**Fix (option B — dynamic label):**
```vue
:aria-label="isOpen ? 'Close menu' : 'Open menu'"
```
If option B is chosen, the test assertion should also be updated:
```ts
expect(btn.attributes('aria-label')).toBe('Open menu');
// and after click:
expect(btn.attributes('aria-label')).toBe('Close menu');
```

---

## Info

### IN-01: `aria-label` on clear-selection buttons exposes raw internal argument names

**File:** `src/ui/components/auto-ui/ActionPanel.vue:823`

**Issue:** `` :aria-label="`Clear ${key}`" `` uses the camelCase action argument key (e.g., `targetCard`, `fromSpace`) as the screen-reader label. Screen reader users hear "Clear targetCard" rather than a human-readable description. The `getSelectionDisplay` function already has the machinery to produce display strings from keys; a helper along those lines would give a better accessible name.

**Fix:** Use the argument's display name from action metadata rather than the raw key, or at minimum convert camelCase to words:
```ts
// simple inline conversion
:aria-label="`Clear ${(key as string).replace(/([A-Z])/g, ' $1').trim().toLowerCase()}`"
```
or use whatever `getSelectionDisplay` or action metadata exposes for the argument label.

---

_Reviewed: 2026-06-22_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
