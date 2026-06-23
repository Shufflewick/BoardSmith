---
phase: 102-material-dev-debug-wave-5
reviewed: 2026-06-23T00:00:00Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - src/ui/components/DebugPanel.vue
  - src/ui/components/GameHistory.vue
  - src/ui/components/GameShell.vue
  - src/ui/components/auto-ui/AutoRenderer.vue
  - src/ui/components/auto-ui/archetypes/UnsupportedTopologyPanel.vue
  - src/cli/dev-host/DevHost.vue
  - src/ui/components/DebugPanel.shortcut.test.ts
  - src/ui/components/DebugPanel.tabs.test.ts
  - src/ui/components/auto-ui/AutoRenderer.loading.test.ts
  - src/cli/dev-host/DevHost.seats.test.ts
  - src/cli/dev-host/DevHost.restart.test.ts
  - src/ui/components/GameHistory.test.ts
findings:
  critical: 2
  warning: 3
  info: 3
  total: 8
status: issues_found
---

# Phase 102: Code Review Report

**Reviewed:** 2026-06-23
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found

## Summary

Phase 102 delivers dev/debug chrome polish: DebugPanel ARIA tabs, two-click restart confirm, GameHistory read-only fix, AutoRenderer skeleton+retry, DevHost collapse/seat-switcher/presence strip, and Slate material layer. The core ideas are sound, but two features ship broken-by-design (retry event silently dropped; chrome re-collapses on every seat switch), and three warnings cover dangling timers, un-dismissible menus, and an always-visible overflow duplicate. Tests pass the behaviors they check but don't cover the cross-component wiring gaps.

---

## Critical Issues

### CR-01: `retry` event from AutoRenderer is emitted but never handled — retry button does nothing

**File:** `src/ui/components/auto-ui/AutoRenderer.vue:157` / `src/ui/components/auto-ui/AutoUI.vue:39`

**Issue:** `AutoRenderer` emits `'retry'` when the user clicks "Retry" after the 8-second loading timeout. `AutoUI.vue` — the only mount point — renders `<AutoRenderer>` without a `@retry` handler:

```html
<!-- AutoUI.vue:39 — no @retry -->
<AutoRenderer
  :game-view="gameView"
  :player-seat="playerSeat"
  :presentation="presentation"
/>
```

The `handleRetry()` function (AutoRenderer line ~152-156) correctly resets `loadTimedOut` and re-arms the timer, but `emit('retry')` propagates to nothing. No reconnect, no WebSocket operation, no upstream side-effect is triggered. The Retry button therefore cycles the 8-second skeleton timer indefinitely while the connection remains broken — exactly the failure mode the affordance is supposed to fix. DEV-05 spec requires a "timeout→retry affordance" that actually retries.

**Fix:** Either (a) handle `@retry` in `AutoUI.vue` and propagate it to `GameShell` which owns the WS connection, or (b) move the reconnect trigger into `handleRetry()` via an injected callback. The simplest wire-up:

```html
<!-- AutoUI.vue -->
<AutoRenderer
  :game-view="gameView"
  :player-seat="playerSeat"
  :presentation="presentation"
  @retry="emit('retry')"
/>
```

Then `AutoUI` emits `retry` upward to `GameShell`, which can call the appropriate reconnect path (or forward to the client SDK). The alternative of injecting a reconnect callback keeps `AutoRenderer` dependency-free.

---

### CR-02: `seatedWithoutStoredPreference` never cleared — chrome auto-collapses on every seat switch

**File:** `src/cli/dev-host/DevHost.vue:311-317`

**Issue:** The watcher that auto-collapses the chrome bar when the dev first takes a seat uses a `let seatedWithoutStoredPreference = false` flag. The flag is set `true` in `onMounted` if no stored preference exists, and is **never set to `false`** after the first auto-collapse fires:

```js
watch(mySeat, (newSeat, oldSeat) => {
  if (newSeat !== null && oldSeat === null && seatedWithoutStoredPreference) {
    chromeOpen.value = false;
    // Do NOT persist here...           ← flag stays true forever
  }
});
```

Switching seats calls `leaveSeat()` (sets `mySeat → null`) then `takeSeat()` (server responds with `joined`, sets `mySeat → newSeat`). The transition `null → newSeat` satisfies the watcher condition **every time**. With `seatedWithoutStoredPreference` still `true`, the chrome bar collapses on every seat switch until the user manually toggles it (which writes `localStorage` and makes the stored-preference branch win on the NEXT reload). A developer switching seats mid-session will have the chrome repeatedly yanked closed.

The test (`DevHost.seats.test.ts`) does not simulate the `{ type: 'joined' }` response after `switchSeat`, so it never triggers the watcher re-entry and the bug is invisible to the test suite.

**Fix:** Clear the flag after the auto-collapse so it only fires once per session:

```js
watch(mySeat, (newSeat, oldSeat) => {
  if (newSeat !== null && oldSeat === null && seatedWithoutStoredPreference) {
    seatedWithoutStoredPreference = false;   // ← add this line
    chromeOpen.value = false;
  }
});
```

---

## Warnings

### WR-01: `restartConfirmTimer` not cleared in DebugPanel `onUnmounted` — dangling timer

**File:** `src/ui/components/DebugPanel.vue:279, 382-384`

**Issue:** `restartConfirmTimer` (a `ref<ReturnType<typeof setTimeout> | null>`) is set when the user clicks "Restart game" for the first time. If the component unmounts while the 5-second confirm window is open (e.g., a page transition), the timeout fires after unmount and writes to the dead component's refs. `DevHost.vue` correctly clears its equivalent timer in `onUnmounted` (line 335: `if (restartConfirmTimer !== null) clearTimeout(restartConfirmTimer)`), but `DebugPanel` does not:

```js
// DebugPanel.vue — current onUnmounted (line 382-384)
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
  // ← restartConfirmTimer.value is never cleared
});
```

**Fix:**
```js
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
  if (restartConfirmTimer.value !== null) {
    clearTimeout(restartConfirmTimer.value);
    restartConfirmTimer.value = null;
  }
});
```

---

### WR-02: DevHost seat-switcher dropdown and Table-setup panel have no outside-click or Escape dismissal

**File:** `src/cli/dev-host/DevHost.vue:268-270, 271-272`

**Issue:** Both `seatSwitcherOpen` and `tableSetupOpen` are simple boolean refs toggled only by clicking their trigger buttons. There is no document click-outside handler and no `keydown` Escape listener to close them. Once opened:

- Clicking anywhere else in the page leaves them open.
- Keyboard users cannot dismiss them without clicking the trigger again.

This violates ARIA combobox/menu-button patterns (Escape should close a disclosure widget) and the general "Pit of Success" principle — the open state is sticky in a confusing way.

Note: the `<details>`/`<summary>` overflow menu does NOT have this problem because the browser gives `<details>` native click-outside semantics.

**Fix:** Add a composable or inline `onMounted` that listens for `keydown` Escape and document `click` outside the relevant container, setting the ref to `false`. The project's existing `useFocusTrap` pattern or a small dedicated `useClickOutside` composable is appropriate.

```js
// Pattern for each dropdown
function closeSeatSwitcherOnEscape(e: KeyboardEvent) {
  if (e.key === 'Escape') seatSwitcherOpen.value = false;
}
onMounted(() => document.addEventListener('keydown', closeSeatSwitcherOnEscape));
onUnmounted(() => document.removeEventListener('keydown', closeSeatSwitcherOnEscape));
```

---

### WR-03: DevHost overflow `<details>` lacks `display:none` default — controls duplicated on wide screens

**File:** `src/cli/dev-host/DevHost.vue` CSS section (media query block at bottom)

**Issue:** The template renders two copies of the secondary controls (Follow / New game / Table setup): one inside `<details class="dev-chrome__overflow">` (meant for narrow/phone) and one inside `.dev-chrome__bar-wide` (meant for wide screens). The CSS correctly hides `.dev-chrome__bar-wide` at `max-width: 639px`, but it never hides `.dev-chrome__overflow` at wider widths. `<details>` elements default to `display:block`, so on screens wider than 639px both sets of controls are visible simultaneously — the "…" button and the inline buttons appear side-by-side. Clicking "New game" in the overflow and then "Confirm restart?" inline (or vice versa) would work since both call the same handler, but the duplicate UI is confusing.

**Fix:** Hide the overflow widget by default and show only at narrow widths:

```css
/* Add outside the media query: */
.dev-chrome__overflow {
  display: none;
}

/* The media query already has: */
@media (max-width: 639px) {
  .dev-chrome__bar-wide { display: none; }
  .dev-chrome__overflow { display: block; }
}
```

---

## Info

### IN-01: JSDoc comment for `switchSeat` is attached to `optionDefaultLabel` instead

**File:** `src/cli/dev-host/DevHost.vue:274-295`

**Issue:** The 10-line JSDoc block (lines 274-284) describes the semantics of `switchSeat` (follow auto-disable, canTake guard, host-authority note). It is immediately followed by a second doc comment and the `optionDefaultLabel` function body, not `switchSeat`. The function it documents appears several lines later with only inline comments. This is a docs ordering error introduced when `optionDefaultLabel` was inserted between the doc and its intended target.

**Fix:** Move the JSDoc immediately above `switchSeat`:

```js
/** Resolve the display label for an option's default value. */
function optionDefaultLabel(...): string { ... }

/**
 * Switch to a different seat: ...
 */
function switchSeat(target: number): void { ... }
```

---

### IN-02: `restartConfirmTimer` stored as `ref<>` instead of plain `let` in DebugPanel

**File:** `src/ui/components/DebugPanel.vue:279`

**Issue:** `restartConfirmTimer` is declared as `ref<ReturnType<typeof setTimeout> | null>(null)`. A timer ID has no reactive consumers — nothing in the template or any computed binds to it. Storing it as a ref causes Vue to track reads/writes unnecessarily. `DevHost.vue` uses a plain `let restartConfirmTimer: ReturnType<typeof setTimeout> | null = null` for the same purpose, which is the correct pattern.

**Fix:**
```js
// Replace:
const restartConfirmTimer = ref<ReturnType<typeof setTimeout> | null>(null);
// With:
let restartConfirmTimer: ReturnType<typeof setTimeout> | null = null;
// Update all accesses: remove .value
```

---

### IN-03: `hasMessages` computed exposed from GameHistory but unused — Copy button always enabled

**File:** `src/ui/components/GameHistory.vue:137-138` / `src/ui/components/DebugPanel.vue` Controls tab

**Issue:** `GameHistory` exposes `hasMessages` via `defineExpose`. Nothing in `GameShell` or `DebugPanel` reads it. Meanwhile, the Copy button in DebugPanel's Controls tab has no `:disabled` binding:

```html
<button class="debug-btn small" @click="emit('copy-history')">Copy</button>
```

The old implementation disabled Copy when `processedMessages.length === 0`. That guard is now invisible at the UI layer (though `copyHistory()` still short-circuits internally). The `hasMessages` export appears to be the intended solution but the wire-up was never completed.

**Fix:** In `GameShell`, read `historyPanel?.hasMessages?.value` and pass it as a prop to `DebugPanel`, or forward it via an emitted event. Alternatively, bind `:disabled` on the Copy button to a computed that calls through to `historyPanel.value?.hasMessages.value`. This restores the affordance that tells the dev there is nothing to copy.

---

_Reviewed: 2026-06-23_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

---

## Fixes Applied

All fixes applied 2026-06-23. Vitest suite: 1245 tests, all green (baseline 1243 + 2 new tests). lint:css: exit 0.

### CR-01: Retry event wired — real reconnect path

**Resolution:** Fixed.
**Commit:** `055904c`
**Files:** `src/ui/components/auto-ui/AutoUI.vue`, `src/ui/components/GameShell.vue`, `src/cli/dev-host/DevHost.vue`, `src/ui/components/auto-ui/AutoUI.retry.test.ts`

AutoUI.vue adds `defineEmits<{ retry: [] }>()` and `@retry="emit('retry')"` on AutoRenderer. GameShell.vue destructures `refreshState` and `reconnect` from `useGame`, adds a `handleRetry()` function (platform mode: posts `request-state` to the host; standalone: calls `refreshState()` + `reconnect()`), and wires `@retry="handleRetry"` on the `<component>` switcher. DevHost.vue handles the `request-state` message by re-sending `lastInitSeat` and `lastGameState` to the iframe. New test in `AutoUI.retry.test.ts` proves the event forwards from AutoRenderer through AutoUI.

### CR-02: seatedWithoutStoredPreference cleared after first auto-collapse

**Resolution:** Fixed.
**Commit:** `9205e60`
**Files:** `src/cli/dev-host/DevHost.vue`, `src/cli/dev-host/DevHost.seats.test.ts`

Added `seatedWithoutStoredPreference = false;` immediately before `chromeOpen.value = false;` in the mySeat watcher so the auto-collapse fires exactly once per session. New regression test opens chrome after first auto-collapse, switches seat, simulates the `{ type: 'joined' }` response, and asserts chrome remains open.

### WR-01: restartConfirmTimer cleared in DebugPanel onUnmounted

**Resolution:** Fixed (combined with IN-02 in same commit).
**Commit:** `c305bae`
**Files:** `src/ui/components/DebugPanel.vue`

Added `clearTimeout(restartConfirmTimer)` in `onUnmounted` so the 5-second confirm callback cannot write to dead refs after a page transition. Implemented as part of the IN-02 ref→let conversion (see IN-02).

### WR-02: Escape and outside-click dismissal for DevHost dropdowns

**Resolution:** Fixed.
**Commit:** `a78d27e`
**Files:** `src/cli/dev-host/DevHost.vue`

Added `handleChromeKeydown` (Escape closes both `seatSwitcherOpen` and `tableSetupOpen`) and `handleChromeClick` (click outside the seat-switcher container closes it). Both listeners registered in `onMounted` and cleaned up in `onUnmounted`. Added `ref="seatSwitcherRef"` to the seat-switcher container for click-outside detection.

### WR-03: DevHost overflow display:none default

**Resolution:** Skipped — already correct in current code.

The CSS block for `.dev-chrome__overflow` already contains `display: none` as the default (with `display: block` inside `@media (max-width: 639px)`). The reviewer's finding did not reflect the actual file state at fix time.

### IN-01: switchSeat JSDoc moved above switchSeat

**Resolution:** Fixed.
**Commit:** `2690b2b`
**Files:** `src/cli/dev-host/DevHost.vue`

Moved the 10-line JSDoc block to sit immediately above `switchSeat`. Added `/** Resolve the display label… */` above `optionDefaultLabel` in its place.

### IN-02: restartConfirmTimer converted to plain let

**Resolution:** Fixed (combined with WR-01).
**Commit:** `c305bae`
**Files:** `src/ui/components/DebugPanel.vue`

Replaced `ref<ReturnType<typeof setTimeout> | null>(null)` with `let restartConfirmTimer: ReturnType<typeof setTimeout> | null = null`. All `.value` accesses updated. Matches the DevHost.vue pattern for the same variable.

### IN-03: hasMessages wired to disable Copy button

**Resolution:** Fixed.
**Commit:** `c869152`
**Files:** `src/ui/components/DebugPanel.vue`, `src/ui/components/GameShell.vue`

Added `historyHasMessages?: boolean` (default: `false`) to `DebugPanelProps`. Controls tab Copy button now has `:disabled="!props.historyHasMessages"`. GameShell passes `:history-has-messages="historyPanel?.hasMessages.value ?? false"` to DebugPanel, completing the wire from `GameHistory.hasMessages` → GameShell → DebugPanel → button disabled state.

---

_Fixed: 2026-06-23_
_Fixer: Claude (gsd-code-fixer)_
