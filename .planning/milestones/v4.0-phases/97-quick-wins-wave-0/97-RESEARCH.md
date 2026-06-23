# Phase 97: Quick Wins (Wave 0) — Research

**Researched:** 2026-06-22
**Domain:** Vue 3 SFC chrome surgery — a11y, error UX, CSS mobile viewport
**Confidence:** HIGH (all findings verified directly from source)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Use the **existing** `useToast` / `Toast.vue` system — no new dependency.
- Replace every `alert()` and silent `console.error` swallow in in-repo chrome with `toast.error(result.error)`.
- Error text must be the actionable `result.error` string — never "something went wrong."
- Every icon-only `<button>` gets an `aria-label`; hamburger also gets `aria-expanded` + `aria-controls`; decorative glyph spans get `aria-hidden="true"`.
- Full dialog semantics / focus-trap → deferred to Phase 101 (A11Y-07).
- Delete Settings and Help from `defaultItems`; remove the `BS` chip and "BoardSmith Dev Mode" footer — deletion only, do NOT relocate Leave/New-Game.
- `100vh` → `100dvh` with `100vh` fallback line immediately before.
- `env(safe-area-inset-*)` on sticky/fixed chrome edges + `viewport-fit=cover` where the engine controls it.
- No `--bsg-*` token work in this phase (that is Phase 98).
- This repo only — do NOT touch ShufflewickPub host files.

### Claude's Discretion
- Toast auto-dismiss timing, stacking, placement: use whatever the existing `Toast.vue` does.
- Whether to extract a `notifyError(result)` helper vs. inline `toast.error` calls: executor's choice; a single shared helper is preferred (DRY).

### Deferred Ideas (OUT OF SCOPE)
- Host-side Wave 0 items (iframe name, Game Over exit, host `viewport-fit`) → HOST-01..04.
- Full toast a11y (role/assertive, dismiss button, auto-timeout) → A11Y-10 (Phase 101).
- Hamburger full dialog semantics + focus trap + Escape → A11Y-07 (Phase 101).
- Dev-server branding/title cleanup → Phase 102 (Wave 5).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| QUICK-01 | Rejected moves/action failures surface `toast.error(result.error)` instead of `alert()` / silent `console.error` | Toast API verified; all call sites located with exact file:line |
| QUICK-02 | Icon-only chrome controls have accessible names; hamburger gets `aria-expanded`/`aria-controls`; decorative glyphs are `aria-hidden` | All affected elements located in HamburgerMenu.vue and ActionPanel.vue |
| QUICK-03 | Dead menu items (Settings/Help) and engine branding (`BS` chip, "BoardSmith Dev Mode") removed | Confirmed no-ops; branding locations verified; CSS dead-code identified |
| QUICK-04 | Shell uses `100dvh` (with `100vh` fallback) | All four `100vh` occurrences located across two files |
| QUICK-05 | Fixed/sticky chrome edges respect `env(safe-area-inset-*)`; `viewport-fit=cover` added where engine controls it | Sticky bar and header located; two engine-controlled HTML files identified |
</phase_requirements>

---

## Summary

Phase 97 is five surgical edits across four Vue SFCs plus two HTML files. Every change is verified below against the actual source — the CONTEXT.md audit line numbers drifted by 0–2 lines; this document carries the corrected anchors.

The toast system is a module-singleton already wired into `GameShell.vue`. `ActionPanel.vue` does not yet import `useToast` — that import is the only new dependency the phase adds. The `100vh` occurrences live in exactly two files (GameShell, HamburgerMenu). The safe-area fix requires adding `viewport-fit=cover` to two engine-controlled HTML files (`host.html` and the scaffold template), while platform-mode hosts are correctly out of scope.

**Primary recommendation:** Treat each requirement as a self-contained commit; all five can be done in a single wave with no ordering dependency between them.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Error feedback (toast) | Browser / Client | — | Toast is UI state rendered at the shell level; engine returns `result.error` strings that the UI surfaces |
| Accessible names | Browser / Client | — | ARIA attributes live in Vue templates; no server involvement |
| Dead-weight removal | Browser / Client | — | Template and CSS deletion only |
| Mobile viewport height | Browser / Client | — | CSS `dvh` unit is a layout fix in scoped styles |
| Safe-area insets | Browser / Client + HTML layer | — | CSS `env()` values applied in scoped styles; `viewport-fit` in HTML `<meta>` |

---

## Standard Stack

No new packages. This phase uses only what is already installed.

| Asset | Location | Notes |
|-------|----------|-------|
| `useToast` composable | `src/ui/composables/useToast.ts` | Module-singleton; `toast.error(msg, duration?)` default 4000 ms |
| `Toast.vue` | `src/ui/components/Toast.vue` | Already teleports to `<body>`; already mounted inside `<GameShell>` |
| `@vue/test-utils` | devDependency | Used for component tests (vitest + jsdom) |
| `vitest` | devDependency (^2.1.0) | Test runner; run with `npm test` |

---

## Package Legitimacy Audit

> **No new packages installed in this phase.** Section not applicable.

---

## QUICK-01 — Verified Call Sites

### Toast API (verified from source)

```typescript
// src/ui/composables/useToast.ts — lines 14-66
const toast = useToast();      // call this once per component
toast.error(message: string, duration = 4000)   // shows red toast
toast.success(message: string, duration = 2000)
toast.info(message: string, duration = 2000)
toast.warning(message: string, duration = 3000)
```

`toasts` is declared at module scope (`const toasts = ref<Toast[]>([])`), making it a process-wide singleton — any component that calls `useToast()` pushes to the same list that `Toast.vue` renders. [VERIFIED: src/ui/composables/useToast.ts:11]

`Toast.vue` is already mounted in `GameShell.vue` (template line 1435: `<Toast />`). It uses `Teleport to="body"` so it renders above all other UI regardless of where in the component tree `toast.error()` is called. [VERIFIED: src/ui/components/Toast.vue:8]

`GameShell.vue` already imports and calls `useToast` (line 33: `import { useToast }...`; line 537: `const toast = useToast()`). [VERIFIED: src/ui/components/GameShell.vue:33,537]

**ActionPanel.vue does NOT import `useToast`** — this import is missing and must be added. [VERIFIED: src/ui/components/auto-ui/ActionPanel.vue — no useToast import]

### `alert()` calls to replace — GameShell.vue

All five are player-facing; all produce modal blocks that freeze the UI.

| Line | Code | Replacement | result.error available? |
|------|------|-------------|-------------------------|
| 755 | `alert('Failed to create game')` | `toast.error('Failed to create game.')` | No — catch(err); use `err instanceof Error ? err.message : 'Failed to create game.'` |
| 826 | `alert('Please enter a game code')` | `toast.error('Please enter a game code.')` | N/A — validation, no server result |
| 908 | `alert('Failed to join game. Check the game code.')` | `toast.error('Failed to join game. Check the game code.')` | No — catch(err) |
| 939 | `alert(result.error \|\| 'Failed to join lobby')` | `toast.error(result.error \|\| 'Failed to join lobby.')` | **Yes** — `result.error` is in scope |
| 943 | `alert('Failed to join lobby')` | `toast.error('Failed to join lobby.')` | No — catch(err) |

Note: CONTEXT.md cited line 825; actual line is **826**. CONTEXT cited line 944; actual is **943**. Both off by 1.

### Silent `console.error` calls to add toast alongside — GameShell.vue

These should keep the `console.error` for diagnostics AND add a `toast.error` for the player.

| Line | Context | result.error available? | Recommended toast message |
|------|---------|------------------------|--------------------------|
| 482 | `handleUndo()` platform path — `if (!result.success) console.error('Undo failed:', result.error)` | **Yes** | `toast.error(result.error \|\| 'Undo failed.')` |
| 495 | `handleUndo()` dev path — `console.error('Undo failed:', result.error)` | **Yes** | `toast.error(result.error \|\| 'Undo failed.')` |
| 499 | `handleUndo()` catch block — `console.error('Undo error:', error)` | No — caught `Error` | `toast.error(error instanceof Error ? error.message : 'Undo failed.')` |
| 984 | `handleSetReady()` — `console.error('Failed to set ready:', result.error)` | **Yes** | `toast.error(result.error \|\| 'Failed to mark as ready.')` |
| 1176 | `handleRestartGame()` — `console.error('Failed to restart game:', err)` | No — caught Error | `toast.error(err instanceof Error ? err.message : 'Failed to restart game.')` |

Note: CONTEXT.md cited line 494; actual is **495**.

### Out-of-scope `console.error` calls in GameShell.vue

The following are infrastructure/setup errors NOT reachable during normal player-facing game actions — leave them as `console.error` only:

| Lines | Why excluded |
|-------|-------------|
| 365, 383, 410 | Inside `fetchPickChoices`/`cancelPendingAction`/`pickStep` option callbacks — failures return `{success:false, error:...}` to the controller, which owns the error path |
| 549 | `fetchPlayerOptions()` — dev-time game definition fetch, not player action |
| 803 | Lobby WebSocket connection error — infrastructure, not turn action |
| 956 | `handleUpdateLobbyName()` — silent update; lobby state won't visually regress |
| 1003, 1020, 1037, 1054, 1071, 1088, 1105 | Already have `toast.error()` calls immediately after the console.error |
| 1116 | `[Leave] Failed to leave position` — cleanup path, player is already transitioning away |

### Silent `console.error` calls to add toast alongside — ActionPanel.vue

`ActionPanel.vue` must add `import { useToast } from '../../composables/useToast';` and call `const toast = useToast()` in `<script setup>`.

| Line | Function | Code | result.error available? |
|------|----------|------|------------------------|
| 675 | `setSelectionValue()` | `console.error('Selection failed:', result.error)` | **Yes** — `result` from `actionController.fill()` |
| 730 | `executeAction()` | `console.error('Action failed:', result.error)` | **Yes** — `result` from `actionController.execute()` |
| 733 | `executeAction()` catch | `console.error('Execute action error:', err)` | No — caught `Error` |

Note: CONTEXT.md cited `ActionPanel.vue (~729)`; the `console.error` is actually at line **730** (line 729 is the `const result = await ...` assignment).

**Surrounding code for line 675 (setSelectionValue):**
```typescript
// ActionPanel.vue:672–677
const result = await actionController.fill(name, value);
if (!result.valid) {
  console.error('Selection failed:', result.error);
  // ADD: toast.error(result.error || 'Selection failed.')
  return;
}
```
The early `return` keeps the panel interactive — no "re-enable" step needed; the controller did not enter the executing state.

**Surrounding code for lines 728–737 (executeAction):**
```typescript
// ActionPanel.vue:728–737
try {
  const result = await actionController.execute(actionName, filteredArgs);
  if (!result.success && result.error) {
    console.error('Action failed:', result.error);
    // ADD: toast.error(result.error)
  }
} catch (err) {
  console.error('Execute action error:', err);
  // ADD: toast.error(err instanceof Error ? err.message : 'Failed to execute action.')
} finally {
  boardInteraction?.clear();
  emit('cancelSelection');
}
```
The `finally` block already clears board state — no additional re-enable needed.

---

## QUICK-02 — Verified Accessible-Name Gaps

### HamburgerMenu.vue — hamburger button (line 70)

```html
<!-- CURRENT (line 70–74) -->
<button class="hamburger-btn" @click="toggleMenu" :class="{ open: isOpen }">
  <span class="bar"></span>
  <span class="bar"></span>
  <span class="bar"></span>
</button>
```

Missing: `aria-label`, `aria-expanded`, `aria-controls`. The three `.bar` spans have no text content — they are CSS-drawn bars, not Unicode glyphs — so they do **not** need `aria-hidden`. [VERIFIED: HamburgerMenu.vue:70–74]

The open-state ref: `const isOpen = ref(false)` at line 36. [VERIFIED: HamburgerMenu.vue:36]

The drawer element at line 81: `<div v-if="isOpen" class="menu-drawer">` — has no `id`. [VERIFIED: HamburgerMenu.vue:81]

Fix:
```html
<!-- hamburger-btn: add aria attrs -->
<button
  class="hamburger-btn"
  @click="toggleMenu"
  :class="{ open: isOpen }"
  aria-label="Open menu"
  :aria-expanded="isOpen"
  aria-controls="hamburger-menu-drawer"
>

<!-- menu-drawer div: add id -->
<div v-if="isOpen" id="hamburger-menu-drawer" class="menu-drawer">
```

### HamburgerMenu.vue — close button (line 87)

```html
<!-- CURRENT (line 87) -->
<button class="close-btn" @click="closeMenu">X</button>
```

"X" is a plain ASCII letter with no accessible label. Fix:
```html
<button class="close-btn" @click="closeMenu" aria-label="Close menu">
  <span aria-hidden="true">X</span>
</button>
```

### ActionPanel.vue — cancel button (line 805)

```html
<!-- CURRENT (line 804–805) -->
<button class="cancel-btn" @click="cancelAction">✕</button>
```

`✕` (U+2715 MULTIPLICATION X) will be read by screen readers as "multiplication x". Fix:
```html
<button class="cancel-btn" @click="cancelAction" aria-label="Cancel action">
  <span aria-hidden="true">✕</span>
</button>
```

### ActionPanel.vue — clear-selection buttons (line 813)

```html
<!-- CURRENT (line 812–814) -->
<button class="clear-selection-btn" @click="clearSelection(key as string)">✕</button>
```

Same `✕` glyph. The `key` variable (the selection name) is in scope. Fix:
```html
<button
  class="clear-selection-btn"
  @click="clearSelection(key as string)"
  :aria-label="`Clear ${key}`"
>
  <span aria-hidden="true">✕</span>
</button>
```

### GameHeader.vue — no icon-only buttons

`GameHeader.vue` does not contain any icon-only buttons directly. The hamburger is delegated to the `<HamburgerMenu>` component (mounted at GameHeader line 48). The zoom-reset button (line 58) has both a `title` attribute and visible text content (`{{ zoomPercent }}%`), so it is already accessible. No GameHeader.vue changes are needed for QUICK-02.

**CONTEXT.md anchor correction:** CONTEXT cited `GameHeader.vue (~58)` as an a11y gap. The actual code shows the zoom-reset button at line 58 is not icon-only (it shows `99%`-style text). This anchor appears to be an audit drift artifact. [VERIFIED: src/ui/components/GameHeader.vue:58]

---

## QUICK-03 — Verified Dead-Weight Locations

### Settings and Help menu items — HamburgerMenu.vue lines 57, 59

```typescript
// HamburgerMenu.vue:55–62
const defaultItems: MenuItem[] = [
  { id: 'new-game', label: 'New Game', icon: '+' },         // line 56 — KEEP
  { id: 'divider-1', label: '', divider: true },             // line 57 — remove (redundant after Settings/Help gone)
  { id: 'settings', label: 'Settings', icon: 'cog' },       // line 58 — REMOVE (no-op)
  { id: 'help', label: 'Help', icon: '?' },                  // line 59 — REMOVE (no-op)
  { id: 'divider-2', label: '', divider: true },             // line 60 — remove (redundant after above)
  { id: 'leave', label: 'Leave Game', icon: 'X' },          // line 61 — KEEP
];
```

Confirmed no-op: `handleMenuItemClick()` in GameShell.vue (lines 1198–1203) only acts on `'leave'` and `'new-game'`. Neither `settings` nor `help` is handled. [VERIFIED: src/ui/components/GameShell.vue:1198–1203]

```typescript
// GameShell.vue:1198–1203 — only these two ids are handled
function handleMenuItemClick(id: string) {
  if (id === 'leave') {
    leaveGame();
  } else if (id === 'new-game') {
    leaveGame();
  }
}
```

After removing `settings` and `help`, both `divider-1` and `divider-2` become adjacent dead weight. Remove all four items (`divider-1`, `settings`, `help`, `divider-2`), leaving only `new-game` and `leave` in `defaultItems`.

### `BS` chip — HamburgerMenu.vue template line 84

```html
<!-- HamburgerMenu.vue:82–86 (drawer-header logo block) -->
<div class="logo">
  <span class="logo-icon">BS</span>       <!-- line 84 — REMOVE -->
  <span class="logo-text">{{ gameTitle }}</span>  <!-- KEEP -->
</div>
```

The `.logo-icon` CSS block (lines 213–225) also becomes dead code and must be removed.

### "BoardSmith Dev Mode" footer — HamburgerMenu.vue lines 127–130

```html
<!-- HamburgerMenu.vue:127–130 -->
<div class="drawer-footer">
  <span class="version">BoardSmith Dev Mode</span>
</div>
```

Remove the entire `drawer-footer` div (it has no other content). The `.drawer-footer` and `.version` CSS blocks (lines 347–355) also become dead code and must be removed.

---

## QUICK-04 — Verified 100vh Locations

Exactly four occurrences of `100vh` exist in in-repo chrome files. None appear in ActionPanel.vue or GameHeader.vue.

| File | Line | Rule | Context |
|------|------|------|---------|
| `GameShell.vue` | 1441 | `min-height: 100vh;` | `.game-shell` root element |
| `GameShell.vue` | 1450 | `height: 100vh;` | `.game-shell--platform` (platform/iframe mode) |
| `GameShell.vue` | 1482 | `min-height: 100vh;` | `.game-shell__game` (game screen wrapper) |
| `HamburgerMenu.vue` | 192 | `height: 100vh;` | `.menu-drawer` (the slide-in panel) |

[VERIFIED: grep output, all four files]

CONTEXT.md anchor correction:
- CONTEXT cited GameShell.vue ~1451; actual is **1450**
- CONTEXT cited GameShell.vue ~1483; actual is **1482**
- CONTEXT cited HamburgerMenu.vue ~192; actual is **192** ✓

Fix pattern (same for all four):
```css
/* existing line — rename comment to signal it's a fallback */
min-height: 100vh; /* fallback: browsers without dvh support */
min-height: 100dvh;
```

---

## QUICK-05 — Verified Sticky/Fixed Chrome Edges + viewport-fit

### GameShell.vue — sticky action bar (line 1552)

```css
/* GameShell.vue:1552–1562 */
.game-shell__action-bar {
  position: sticky;
  bottom: 0;
  left: 0;
  right: 0;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(10px);
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  padding: 12px 15px;
  z-index: 100;
}
```

The bar is `sticky` at `bottom:0` and spans left/right — it sits against all three bottom/left/right device edges. Add safe-area padding:
```css
padding-bottom: max(12px, env(safe-area-inset-bottom));
padding-left: max(15px, env(safe-area-inset-left));
padding-right: max(15px, env(safe-area-inset-right));
```

The desktop override at line 1565–1568 raises the padding to `16px 20px` — needs the same treatment:
```css
@media (min-width: 768px) {
  .game-shell__action-bar {
    padding-bottom: max(16px, env(safe-area-inset-bottom));
    padding-left: max(20px, env(safe-area-inset-left));
    padding-right: max(20px, env(safe-area-inset-right));
  }
}
```

### GameHeader.vue — top header bar (line 97)

```css
/* GameHeader.vue:97–105 */
.game-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  ...
}
```

`game-header` is not `position:fixed/sticky` but it is the topmost element in the `100dvh` flex column. With `viewport-fit=cover`, the safe-area-inset-top is the space the status bar or notch occupies. Add:
```css
padding-top: max(10px, env(safe-area-inset-top));
padding-left: max(12px, env(safe-area-inset-left));
padding-right: max(12px, env(safe-area-inset-right));
```

The desktop override at line 275–277 (`padding: 12px 20px`) also needs the same treatment.

### HamburgerMenu.vue — full-height drawer overlay

`.menu-overlay` is `position:fixed; top:0; left:0; right:0; bottom:0` (lines 177–185) — covers viewport entirely, no padding needed.

`.menu-drawer` is `position:fixed; top:0; left:0; width:280px; height:100vh` (lines 187–197) — after QUICK-04 converts to `100dvh`, the top-left corner is at the device edge. For maximum correctness the drawer's inner `drawer-header` padding could absorb `safe-area-inset-top`, but this is on the left edge (not top/bottom for most phones in portrait) and the spec does not call it out. Omit drawer insets in this phase.

### viewport-fit=cover — engine-controlled HTML files

Two engine-controlled HTML files carry the viewport meta without `viewport-fit=cover`:

| File | Line | Current value |
|------|------|---------------|
| `src/cli/dev-host/host.html` | 5 | `content="width=device-width, initial-scale=1.0"` |
| `src/cli/lib/project-scaffold.ts` | 200 | `content="width=device-width, initial-scale=1.0"` (inside `generateIndexHtml()`) |

Fix: append `, viewport-fit=cover` to the `content` attribute value in both files.

**Note:** In platform (iframe) mode, the host page (ShufflewickPub) controls the outer viewport meta — that is HOST-04 and out of scope. The two engine-controlled files above serve the dev-server and scaffolded standalone game pages. [VERIFIED: src/cli/dev-host/host.html:5; src/cli/lib/project-scaffold.ts:200]

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Toast notifications | Custom notification div, store, or event bus | `useToast()` already in repo | Already tested, already mounted in GameShell, global singleton |
| Accessible button labels | Custom screen-reader-only CSS spans | Native `aria-label` attribute | Zero CSS, understood by all assistive tech |
| dvh unit fallback | JS height calculation / ResizeObserver | CSS cascading (two `height:` lines) | Browsers ignore unknown units, so second line wins if dvh supported |
| Safe-area insets | JS to detect notch height | `env(safe-area-inset-*)` + `max()` | Native CSS; handles all device geometries automatically |

---

## Common Pitfalls

### Pitfall 1: ActionPanel missing `useToast` import
**What goes wrong:** `toast` is undefined at runtime; all `toast.error()` calls throw ReferenceError silently under Vue's template error boundary.
**Root cause:** `ActionPanel.vue` currently has no `useToast` import.
**How to avoid:** Add `import { useToast } from '../../composables/useToast';` and `const toast = useToast();` to `<script setup>` before adding any `toast.error()` calls.
**Warning signs:** Console shows `ReferenceError: toast is not defined` during test mount.

### Pitfall 2: Removing `defaultItems` dividers leaves UI with a stray separator
**What goes wrong:** Deleting only `settings` and `help` but keeping `divider-1` and `divider-2` creates adjacent or leading/trailing dividers in the menu.
**How to avoid:** Remove `settings`, `help`, `divider-1`, and `divider-2` together. The remaining `defaultItems` array should be `[new-game, leave]`.

### Pitfall 3: `dvh` fallback order wrong
**What goes wrong:** If the `100dvh` line appears BEFORE `100vh`, browsers that support dvh use it correctly, but browsers that don't ignore `100dvh` and fall back to... nothing (the property was never set to `100vh`). Actually both lines are valid CSS and the second overrides if the unit is supported.
**How to avoid:** Keep `100vh` on the line IMMEDIATELY before `100dvh`. Browsers without dvh support parse `100dvh` as invalid and keep `100vh`. Browsers with dvh support also see `100vh` but immediately override with `100dvh` since they're the same property.

### Pitfall 4: `aria-controls` target id must match exactly and must be in the DOM
**What goes wrong:** `aria-controls="hamburger-menu-drawer"` requires the drawer to have `id="hamburger-menu-drawer"`. Since the drawer is `v-if="isOpen"`, it is removed from the DOM when closed — `aria-controls` will point to a nonexistent element when the drawer is closed. This is acceptable per ARIA spec (the referenced element can be absent when the control is collapsed), but it must be exactly right when open.
**How to avoid:** Ensure the `id` on `.menu-drawer` exactly matches the `aria-controls` value on the hamburger button.

### Pitfall 5: `env(safe-area-inset-*)` without `viewport-fit=cover` silently evaluates to 0
**What goes wrong:** Adding `env(safe-area-inset-bottom)` to CSS has no effect unless the HTML viewport meta includes `viewport-fit=cover`. Without it, the browser returns 0 for all inset values, so notches and home indicators are not avoided.
**How to avoid:** Add `viewport-fit=cover` to both engine-controlled HTML files as part of this phase. Verify with a physical iPhone in Safari or iOS Simulator.
**Warning signs:** `env(safe-area-inset-bottom)` evaluates to `0px` in DevTools (check computed styles on the action bar).

---

## Architecture Patterns

### Recommended changes summary per file

```
src/ui/components/
├── GameShell.vue         — QUICK-01 (5 alerts + 5 console.errors)
├── HamburgerMenu.vue     — QUICK-02 (2 a11y), QUICK-03 (2+2 deletions), QUICK-04 (1 dvh), QUICK-05 (no change)
├── GameHeader.vue        — QUICK-05 (safe-area padding)
└── auto-ui/
    └── ActionPanel.vue   — QUICK-01 (3 console.errors + 1 import), QUICK-02 (2 a11y)

src/cli/
├── dev-host/host.html               — QUICK-05 (viewport-fit)
└── lib/project-scaffold.ts          — QUICK-05 (viewport-fit in generateIndexHtml)
```

### notifyError helper (Claude's Discretion — preferred)

Rather than repeating `toast.error(result.error || 'fallback')` in multiple places, a small helper collocated with each component reduces drift:

```typescript
// Could be a tiny module at src/ui/utils/notifyError.ts
// or inline in each component that needs it
function notifyError(toast: ReturnType<typeof useToast>, result: { error?: string }, fallback: string) {
  toast.error(result.error || fallback);
}
```

The planner may decide to inline `toast.error(...)` directly (simpler) or extract a helper (DRY). Either is valid for this phase.

---

## Validation Architecture

`workflow.nyquist_validation` is not set in `.planning/config.json`, so it is treated as **enabled**.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest ^2.1.0 + @vue/test-utils ^2.4.11 |
| Config | `vitest.config.*` (or inferred from `vite.config.*`) in project root |
| Quick run | `npm test` |
| Full suite | `npm test` |
| jsdom env | `// @vitest-environment jsdom` comment at top of component test files |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| QUICK-01 | `toast.error()` called when `actionController.fill()` returns `{valid:false}` | Unit | `npm test -- ActionPanel.test` | ✅ (extend existing) |
| QUICK-01 | `toast.error()` called when `actionController.execute()` returns `{success:false}` | Unit | `npm test -- ActionPanel.test` | ✅ (extend existing) |
| QUICK-01 | No `alert()` calls remain in src/ui/ | Source assertion | `grep -r "alert(" src/ui/ \| wc -l` == 0 | N/A |
| QUICK-02 | Hamburger button has `aria-label`, `aria-expanded`, `aria-controls` | Unit | `npm test -- HamburgerMenu.test` | ❌ Wave 0 gap |
| QUICK-02 | After open, hamburger `aria-expanded="true"` | Unit | `npm test -- HamburgerMenu.test` | ❌ Wave 0 gap |
| QUICK-02 | Cancel button in ActionPanel has `aria-label="Cancel action"` | Unit | `npm test -- ActionPanel.smoke.test` (extend) | ✅ (extend) |
| QUICK-03 | `defaultItems` has no entry with id `settings` or `help` | Source assertion | `grep -n "settings\|help" src/ui/components/HamburgerMenu.vue` | N/A |
| QUICK-03 | No `logo-icon` span or "BoardSmith Dev Mode" in HamburgerMenu template | Source assertion | `grep -n "logo-icon\|BoardSmith Dev Mode" src/ui/components/HamburgerMenu.vue` | N/A |
| QUICK-04 | Each `100vh` in chrome files is immediately followed by `100dvh` | Source assertion | Manual review or `grep -A1 "100vh" src/ui/components/{GameShell,HamburgerMenu}.vue` | N/A |
| QUICK-05 | `env(safe-area-inset-bottom)` present in `.game-shell__action-bar` | Source assertion | `grep "safe-area-inset" src/ui/components/GameShell.vue` | N/A |
| QUICK-05 | `viewport-fit=cover` in host.html and project-scaffold.ts | Source assertion | `grep "viewport-fit" src/cli/dev-host/host.html src/cli/lib/project-scaffold.ts` | N/A |

### Sampling Rate
- **Per task commit:** `npm test -- --reporter=verbose 2>&1 | tail -20`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/ui/components/HamburgerMenu.test.ts` — covers QUICK-02 aria-label + aria-expanded on hamburger button
- [ ] Extend `src/ui/components/auto-ui/ActionPanel.smoke.test.ts` — assert cancel-btn has `aria-label`
- [ ] Extend `src/ui/components/auto-ui/ActionPanel.test.ts` — assert `toast.error` called on `fill()` failure and `execute()` failure (requires mocking `useToast`)

---

## Security Domain

> `security_enforcement` not set in config; treat as enabled.

| ASVS Category | Applies | Notes |
|---------------|---------|-------|
| V5 Input Validation | No | No new user input added |
| V2 Authentication | No | No auth changes |
| V3 Session Management | No | No session changes |

No new attack surface introduced. Replacing `alert()` with `toast.error()` is strictly additive from a security standpoint — the same error strings that were being shown in modal dialogs are now shown in toasts. `result.error` strings originate in the engine/session and are already player-facing; no new data is exposed.

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|-----------------|--------|
| `100vh` on mobile | `100dvh` with `100vh` fallback | Fixes sticky bar clipping under iOS Safari toolbar |
| `alert()` for errors | `toast.error()` | Non-blocking; player can retry without dismissing a modal |
| No `aria-label` on icon buttons | `aria-label` + `aria-hidden` on glyphs | Screen readers announce the button purpose, not the glyph character name |

**dvh browser support:** `100dvh` is supported in Safari 15.4+, Chrome 108+, Firefox 109+. Older browsers silently fall back to `100vh`. [ASSUMED — training data; support data may have expanded since]

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `dvh` browser support: Safari 15.4+, Chrome 108+, Firefox 109+ | State of the Art | If support is narrower, fallback `100vh` still works; no functional regression |
| A2 | `aria-controls` pointing to a `v-if`-conditional element is acceptable per ARIA spec | QUICK-02 pitfall | If spec requires element to be always present, the drawer must use `v-show` instead of `v-if` — but this is a Phase 101 concern |

---

## Open Questions

1. **`isExecuting` state after failed `execute()` in ActionPanel**
   - What we know: `executeAction()` calls `actionController.execute()`, which manages `isExecuting` internally. The `finally` block clears board state.
   - What's unclear: Does the controller guarantee `isExecuting` is reset to `false` when `execute()` returns `{success: false}`? If not, the panel could be stuck in a disabled state after a failed action.
   - Recommendation: Verify by reading `useActionController.ts` before implementing QUICK-01 on ActionPanel. If `isExecuting` is not auto-reset, add a manual reset after the `toast.error()` call. (This is a Prove Before Fix check for the executor, not a blocker for planning.)

2. **`notifyError` helper vs. inline `toast.error` calls**
   - CONTEXT.md leaves this to Claude's Discretion.
   - Recommendation: Extract a single `notifyError(toast, result, fallback)` helper if touching 3+ call sites in the same component; inline otherwise. Pragmatic choice at execution time.

---

## Environment Availability

> Step 2.6: SKIPPED — this phase is code/CSS edits only; no external tools, services, or CLIs are required beyond the standard dev environment.

---

## Sources

### Primary (HIGH confidence)
- `src/ui/composables/useToast.ts` — full file read; verified API surface
- `src/ui/components/Toast.vue` — full file read; verified teleport and render behavior
- `src/ui/components/GameShell.vue` — full file read; all alert/console.error/100vh/safe-area locations verified by grep
- `src/ui/components/HamburgerMenu.vue` — full file read; all a11y gaps, branding, 100vh verified
- `src/ui/components/GameHeader.vue` — full file read; confirmed no icon-only buttons, no 100vh
- `src/ui/components/auto-ui/ActionPanel.vue` — full file read; console.error and a11y gaps verified
- `src/cli/dev-host/host.html` — full file read; viewport meta at line 5 verified
- `src/cli/lib/project-scaffold.ts` — lines 195–213 read; viewport meta at line 200 verified

### Secondary (MEDIUM confidence)
- MDN Web Docs: `env()` CSS function and `viewport-fit=cover` — [ASSUMED; standard browser API]
- MDN Web Docs: `dvh` CSS unit browser compatibility — [ASSUMED; training-data era support table, see A1]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all assets verified in source
- Architecture: HIGH — changes are surgical with exact file:line anchors
- Pitfalls: HIGH — each verified against actual code

**Research date:** 2026-06-22
**Valid until:** 2026-07-22 (stable domain — CSS/a11y/Vue SFC patterns change slowly)
