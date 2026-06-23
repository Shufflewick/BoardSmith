# Phase 97: Quick Wins (Wave 0) - Pattern Map

**Mapped:** 2026-06-22
**Files analyzed:** 7 modified files + 1 new test file
**Analogs found:** 7 / 7

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/ui/components/GameShell.vue` | component (shell) | event-driven | self (existing `toast.error` at lines 1000-1004) | self-analog |
| `src/ui/components/auto-ui/ActionPanel.vue` | component (panel) | event-driven | `GameShell.vue` useToast import/call | role-match |
| `src/ui/components/HamburgerMenu.vue` | component (nav) | event-driven | RESEARCH.md verified fixes — no prior aria usage | no analog (new pattern) |
| `src/ui/components/GameHeader.vue` | component (chrome) | request-response | `GameShell.vue` scoped `<style>` padding blocks | role-match |
| `src/cli/dev-host/host.html` | config | — | `src/cli/lib/project-scaffold.ts` (same meta tag) | role-match |
| `src/cli/lib/project-scaffold.ts` | utility/scaffold | — | `src/cli/dev-host/host.html` (same meta tag) | role-match |
| `src/ui/components/HamburgerMenu.test.ts` (NEW) | test | — | `src/ui/components/auto-ui/ActionPanel.smoke.test.ts` | exact |

---

## Pattern Assignments

### `src/ui/components/GameShell.vue` (QUICK-01 + QUICK-04 + QUICK-05)

**Self-analog:** already uses `useToast`. The executor copies the existing working call sites to fill in the missing ones.

**Existing useToast import** (line 33):
```typescript
import { useToast } from '../composables/useToast';
```

**Existing useToast instantiation** (line 537):
```typescript
const toast = useToast();
```

**Existing toast.error pattern with result.error** (lines 1000–1004 — copy this pattern for all new call sites):
```typescript
toast.error(result.error || 'Failed to add slot');
// ... and in catch block:
toast.error('Failed to add slot');
```

**alert() call sites to replace** (keep surrounding context, just swap the call):

Line 755 — in a `catch (err)` block, no `result.error` available:
```typescript
// BEFORE:
alert('Failed to create game');
// AFTER:
toast.error(err instanceof Error ? err.message : 'Failed to create game.');
```

Line 826 — input validation, no result object:
```typescript
// BEFORE:
alert('Please enter a game code');
// AFTER:
toast.error('Please enter a game code.');
```

Line 908 — in a `catch (err)` block:
```typescript
// BEFORE:
alert('Failed to join game. Check the game code.');
// AFTER:
toast.error(err instanceof Error ? err.message : 'Failed to join game. Check the game code.');
```

Lines 939, 943 — lobby join, `result.error` IS available at 939:
```typescript
// BEFORE (line 939):
alert(result.error || 'Failed to join lobby');
// AFTER:
toast.error(result.error || 'Failed to join lobby.');

// BEFORE (line 943, in catch):
alert('Failed to join lobby');
// AFTER:
toast.error(err instanceof Error ? err.message : 'Failed to join lobby.');
```

**console.error call sites to ADD toast alongside** (keep the console.error):

Lines 482/495 — undo failed, `result.error` available:
```typescript
// ADD after console.error line:
toast.error(result.error || 'Undo failed.');
```

Line 499 — undo catch block, caught `Error`:
```typescript
// ADD after console.error line:
toast.error(error instanceof Error ? error.message : 'Undo failed.');
```

Line 984 — setReady, `result.error` available:
```typescript
// ADD after console.error line:
toast.error(result.error || 'Failed to mark as ready.');
```

Line 1176 — restartGame catch, caught `Error`:
```typescript
// ADD after console.error line:
toast.error(err instanceof Error ? err.message : 'Failed to restart game.');
```

**100vh → 100dvh fallback pattern** (QUICK-04 — same two-line form for all four occurrences):
```css
/* Apply at lines 1441, 1450, 1482 in GameShell.vue and line 192 in HamburgerMenu.vue */
min-height: 100vh; /* fallback: browsers without dvh support */
min-height: 100dvh;

/* For the height: variant at line 1450: */
height: 100vh; /* fallback: browsers without dvh support */
height: 100dvh;
```

**Safe-area insets on sticky action bar** (QUICK-05 — lines 1552-1568):
```css
/* Replace the single padding: 12px 15px; with three axis declarations: */
.game-shell__action-bar {
  /* ... existing properties unchanged ... */
  padding-top: 12px; /* keep as-is — bar does not touch top edge */
  padding-bottom: max(12px, env(safe-area-inset-bottom));
  padding-left: max(15px, env(safe-area-inset-left));
  padding-right: max(15px, env(safe-area-inset-right));
}

@media (min-width: 768px) {
  .game-shell__action-bar {
    padding-bottom: max(16px, env(safe-area-inset-bottom));
    padding-left: max(20px, env(safe-area-inset-left));
    padding-right: max(20px, env(safe-area-inset-right));
  }
}
```

---

### `src/ui/components/auto-ui/ActionPanel.vue` (QUICK-01 + QUICK-02)

**Analog:** `src/ui/components/GameShell.vue` (useToast import + call pattern)

**Add import** (place after the existing `import { ref, computed, watch, inject } from 'vue'` at line 16):
```typescript
import { useToast } from '../../composables/useToast';
```
Note the relative path difference: ActionPanel is one directory deeper than GameShell.

**Add instantiation** (place after the `const actionController = _actionController;` assignment, around line 36):
```typescript
const toast = useToast();
```

**Line 675 — setSelectionValue, result.error available:**
```typescript
// BEFORE:
console.error('Selection failed:', result.error);
return;
// AFTER:
console.error('Selection failed:', result.error);
toast.error(result.error || 'Selection failed.');
return;
```

**Lines 730/733 — executeAction, result.error and caught Error:**
```typescript
// BEFORE (line 730):
console.error('Action failed:', result.error);
// AFTER:
console.error('Action failed:', result.error);
toast.error(result.error || 'Action failed.');

// BEFORE (line 733, catch block):
console.error('Execute action error:', err);
// AFTER:
console.error('Execute action error:', err);
toast.error(err instanceof Error ? err.message : 'Failed to execute action.');
```

**QUICK-02 — cancel button (line 804):**
```html
<!-- BEFORE: -->
<button class="cancel-btn" @click="cancelAction">✕</button>

<!-- AFTER: -->
<button class="cancel-btn" @click="cancelAction" aria-label="Cancel action">
  <span aria-hidden="true">✕</span>
</button>
```

**QUICK-02 — clear-selection buttons (line 813):**
```html
<!-- BEFORE: -->
<button class="clear-selection-btn" @click="clearSelection(key as string)">✕</button>

<!-- AFTER: -->
<button
  class="clear-selection-btn"
  @click="clearSelection(key as string)"
  :aria-label="`Clear ${key}`"
>
  <span aria-hidden="true">✕</span>
</button>
```

---

### `src/ui/components/HamburgerMenu.vue` (QUICK-02 + QUICK-03 + QUICK-04)

**No close analog for aria usage** — this is the first aria-label introduced in this component. The fix patterns come directly from RESEARCH.md verified source.

**QUICK-02 — hamburger button (line 70–74):**
```html
<!-- BEFORE: -->
<button class="hamburger-btn" @click="toggleMenu" :class="{ open: isOpen }">
  <span class="bar"></span>
  <span class="bar"></span>
  <span class="bar"></span>
</button>

<!-- AFTER: -->
<button
  class="hamburger-btn"
  @click="toggleMenu"
  :class="{ open: isOpen }"
  aria-label="Open menu"
  :aria-expanded="isOpen"
  aria-controls="hamburger-menu-drawer"
>
  <span class="bar"></span>
  <span class="bar"></span>
  <span class="bar"></span>
</button>
```
Note: `.bar` spans are CSS-drawn bars (no text/glyph content) — they do NOT need `aria-hidden`.

**QUICK-02 — drawer id must match aria-controls (line 81):**
```html
<!-- BEFORE: -->
<div v-if="isOpen" class="menu-drawer">

<!-- AFTER: -->
<div v-if="isOpen" id="hamburger-menu-drawer" class="menu-drawer">
```

**QUICK-02 — close button (line 87):**
```html
<!-- BEFORE: -->
<button class="close-btn" @click="closeMenu">X</button>

<!-- AFTER: -->
<button class="close-btn" @click="closeMenu" aria-label="Close menu">
  <span aria-hidden="true">X</span>
</button>
```

**QUICK-03 — defaultItems array (lines 55–62). Replace entire array:**
```typescript
// BEFORE (lines 55–62):
const defaultItems: MenuItem[] = [
  { id: 'new-game', label: 'New Game', icon: '+' },
  { id: 'divider-1', label: '', divider: true },
  { id: 'settings', label: 'Settings', icon: 'cog' },
  { id: 'help', label: 'Help', icon: '?' },
  { id: 'divider-2', label: '', divider: true },
  { id: 'leave', label: 'Leave Game', icon: 'X' },
];

// AFTER:
const defaultItems: MenuItem[] = [
  { id: 'new-game', label: 'New Game', icon: '+' },
  { id: 'leave', label: 'Leave Game', icon: 'X' },
];
```

**QUICK-03 — BS chip (lines 83–86). Remove the logo-icon span, keep logo-text:**
```html
<!-- BEFORE: -->
<div class="logo">
  <span class="logo-icon">BS</span>
  <span class="logo-text">{{ gameTitle }}</span>
</div>

<!-- AFTER: -->
<div class="logo">
  <span class="logo-text">{{ gameTitle }}</span>
</div>
```
Also remove the `.logo-icon` CSS block (lines 214–225 in the scoped style section).

**QUICK-03 — drawer-footer (lines 127–130). Remove entire div:**
```html
<!-- REMOVE: -->
<div class="drawer-footer">
  <span class="version">BoardSmith Dev Mode</span>
</div>
```
Also remove the `.drawer-footer` and `.version` CSS blocks (lines 347–355 in the scoped style section).

**QUICK-04 — 100vh → 100dvh (line 192 in scoped styles):**
```css
/* BEFORE: */
.menu-drawer {
  /* ... */
  height: 100vh;
  /* ... */
}

/* AFTER: */
.menu-drawer {
  /* ... */
  height: 100vh; /* fallback: browsers without dvh support */
  height: 100dvh;
  /* ... */
}
```

---

### `src/ui/components/GameHeader.vue` (QUICK-05)

**Analog:** `src/ui/components/GameShell.vue` scoped styles — same `max()` + `env()` padding pattern.

**Safe-area insets on top header** (line 97 in scoped styles):
```css
/* BEFORE: */
.game-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  /* ... */
}

/* AFTER: */
.game-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: max(10px, env(safe-area-inset-top));
  padding-bottom: 10px;
  padding-left: max(12px, env(safe-area-inset-left));
  padding-right: max(12px, env(safe-area-inset-right));
  /* ... */
}
```

**Desktop override** (line 275–277 in scoped styles — `padding: 12px 20px`):
```css
@media (min-width: 768px) {
  .game-header {
    padding-top: max(12px, env(safe-area-inset-top));
    padding-bottom: 12px;
    padding-left: max(20px, env(safe-area-inset-left));
    padding-right: max(20px, env(safe-area-inset-right));
  }
}
```

---

### `src/cli/dev-host/host.html` (QUICK-05)

**Analog:** `src/cli/lib/project-scaffold.ts` line 200 — identical meta tag content.

Current line 5:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0">
```

After fix:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
```

---

### `src/cli/lib/project-scaffold.ts` (QUICK-05)

**Analog:** `src/cli/dev-host/host.html` — same meta tag at the source of truth for scaffolded game pages.

Inside `generateIndexHtml()` at line 200, the string being built contains:
```typescript
// BEFORE (inside template string):
content="width=device-width, initial-scale=1.0"

// AFTER:
content="width=device-width, initial-scale=1.0, viewport-fit=cover"
```

---

### `src/ui/components/HamburgerMenu.test.ts` (NEW — QUICK-02)

**Analog:** `src/ui/components/auto-ui/ActionPanel.smoke.test.ts` — exact same harness structure.

**Full template to copy and adapt:**
```typescript
// @vitest-environment jsdom
/**
 * HamburgerMenu accessibility tests — QUICK-02
 *
 * Verifies ARIA attributes on the hamburger toggle button:
 *   - aria-label present
 *   - aria-expanded reflects open/closed state
 *   - aria-controls targets the drawer id
 *   - close button has aria-label
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import HamburgerMenu from './HamburgerMenu.vue';

describe('HamburgerMenu accessibility (QUICK-02)', () => {
  it('hamburger button has aria-label, aria-expanded=false, and aria-controls when closed', () => {
    const wrapper = mount(HamburgerMenu, {
      props: { gameTitle: 'Test Game' },
    });

    const btn = wrapper.find('.hamburger-btn');
    expect(btn.attributes('aria-label')).toBeTruthy();
    expect(btn.attributes('aria-expanded')).toBe('false');
    expect(btn.attributes('aria-controls')).toBe('hamburger-menu-drawer');
  });

  it('hamburger button aria-expanded becomes true after click', async () => {
    const wrapper = mount(HamburgerMenu, {
      props: { gameTitle: 'Test Game' },
    });

    const btn = wrapper.find('.hamburger-btn');
    await btn.trigger('click');

    expect(btn.attributes('aria-expanded')).toBe('true');
  });

  it('drawer gets id matching aria-controls when open', async () => {
    const wrapper = mount(HamburgerMenu, {
      props: { gameTitle: 'Test Game' },
    });

    await wrapper.find('.hamburger-btn').trigger('click');

    const drawer = wrapper.find('#hamburger-menu-drawer');
    expect(drawer.exists()).toBe(true);
  });

  it('close button has aria-label', async () => {
    const wrapper = mount(HamburgerMenu, {
      props: { gameTitle: 'Test Game' },
    });

    await wrapper.find('.hamburger-btn').trigger('click');

    const closeBtn = wrapper.find('.close-btn');
    expect(closeBtn.attributes('aria-label')).toBeTruthy();
  });
});
```

---

## Shared Patterns

### useToast import path convention

The path alias depends on depth relative to `src/ui/composables/`:

| File location | Import path |
|---------------|-------------|
| `src/ui/components/*.vue` (GameShell depth) | `'../composables/useToast'` |
| `src/ui/components/auto-ui/*.vue` (ActionPanel depth) | `'../../composables/useToast'` |

**Instantiation is always the same one-liner in `<script setup>`:**
```typescript
const toast = useToast();
```

### Error message pattern

Three variants depending on what is in scope:

```typescript
// 1. result.error available (server action result):
toast.error(result.error || 'Fallback message.');

// 2. Caught Error object:
toast.error(err instanceof Error ? err.message : 'Fallback message.');

// 3. Plain string validation (no result/err):
toast.error('Validation message.');
```

Always keep existing `console.error(...)` calls — only ADD `toast.error(...)` alongside them (except for `alert()` replacements where there was no console.error).

### aria-hidden on Unicode glyph spans

Any button that contains a Unicode symbol as its only visible content:
```html
<button aria-label="[Descriptive label]">
  <span aria-hidden="true">[GLYPH]</span>
</button>
```

Applies to: `✕` (U+2715) in ActionPanel cancel and clear-selection buttons, and `X` (ASCII) in HamburgerMenu close button.

Does NOT apply to: HamburgerMenu hamburger button `.bar` spans — these have no text content, they are CSS-drawn shapes.

### dvh fallback order (critical)

Always `100vh` on the line IMMEDIATELY before `100dvh` — never reversed:
```css
height: 100vh;    /* MUST come first — fallback for browsers without dvh */
height: 100dvh;   /* overrides when unit is supported */
```

### env() safe-area-inset with max()

Always use `max(<original-value>, env(safe-area-inset-*))` to preserve minimum padding on non-notched devices:
```css
padding-bottom: max(12px, env(safe-area-inset-bottom));
padding-left: max(15px, env(safe-area-inset-left));
padding-right: max(15px, env(safe-area-inset-right));
```

Requires `viewport-fit=cover` in the HTML `<meta name="viewport">` or `env()` evaluates to `0px`.

---

## No Analog Found

No files are fully without analog. All files have either a self-analog (GameShell.vue toast usage) or a close role-match. The `HamburgerMenu.test.ts` is the only genuinely new file, and it copies the `ActionPanel.smoke.test.ts` harness exactly.

---

## Metadata

**Analog search scope:** `src/ui/components/`, `src/ui/composables/`, `src/cli/`
**Files read:** `useToast.ts`, `GameShell.vue` (targeted reads), `ActionPanel.vue` (targeted reads), `HamburgerMenu.vue` (full), `GameHeader.vue` (full), `ActionPanel.smoke.test.ts` (full), `ActionPanel.interaction.test.ts` (partial)
**Pattern extraction date:** 2026-06-22
