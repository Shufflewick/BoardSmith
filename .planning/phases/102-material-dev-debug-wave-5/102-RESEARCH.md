# Phase 102: Material Polish & Dev/Debug Parity (Wave 5) - Research

**Researched:** 2026-06-23
**Domain:** Vue 3 component polish — dev/debug UI, a11y, Slate tokens, CSS material layer
**Confidence:** HIGH (all findings verified against actual source files)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**DEV-01 — DebugPanel reskin + a11y**
- Reskin to Slate tokens (graphite surface, `--bsg-accent` tab, `--bsg-mono` for data, amber-ish syntax via tokens). No raw hex (lint:css stays green).
- Toggle becomes a real `<button aria-expanded>`. Gate bare `D` shortcut behind a modifier (Ctrl/Cmd+D) AND a `contenteditable`/input-focus guard.
- Apply ARIA tabs pattern (`role="tablist"`/`tab`/`tabpanel`, arrow-key nav). On phone, re-dock to a bottom sheet; replace `calc(100vh-280px)` with flex `min-height:0`.

**DEV-02 — dev chrome collapse**
- Dev-server bar auto-collapses to a slim pull-tab, default-collapsed once seated, persisted in `localStorage`. Below 640px, controls become icon-only with a `…` overflow. Cinzel-free (Slate uses Hanken/`--bsg-font`); drop the duplicated game title.

**DEV-03, DEV-04 — restore dev god-mode**
- Seat badge becomes a working seat switcher (wire dead `leaveSeat`/seat-select path, integrate with existing follow-active-seat toggle). Presence strip showing connected/AI/away. Tucked-away read-only "Table setup" panel surfacing `aiSeats`/`aiLevel`/`playerCount`/`gameOptions`/`playerOptions`.

**DEV-05 — voiced states**
- Loading: skeleton with timeout→retry (`AutoRenderer.vue:154`), not a bare spinner forever. Split `UnsupportedTopologyPanel.vue` into friendly player-facing message + dev-only console/Debug guidance block with a real link.

**DEV-06 — history cleanup**
- Player-facing `GameHistory` becomes read-only; move Copy/Clear into `DebugPanel`. Fix the silent un-clear bug (`GameHistory.vue:90`).

**DEV-07 — destructive-action confirm**
- Dev "New game" requires two-click confirm (or small confirm popover), neutral styling, emits broadcast toast so all seats know a restart happened.

**DEV-08 — Slate material layer (dev/standalone only)**
- Replace current plain `var(--bsg-bg)` background with low-opacity SVG noise + screen vignette. Neutral/graphite, not warm. Drop `background-attachment:fixed` if used. Subtle.

### Claude's Discretion

None specified — all decisions are locked above.

### Deferred Ideas (OUT OF SCOPE)

- Host-repo material/grain (`main.css`), host lobby, host connection banner.
- Cross-repo game + MERC verification (Phase 103).
- Editing `gameOptions`/`playerOptions` values in the Table setup panel — read-only display only.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DEV-01 | DebugPanel reskinned in Slate; toggle is `<button aria-expanded>`; `D` shortcut gated; ARIA tabs pattern | Lines 317-326 (shortcut), 1207-1245 (tab markup), 2157 (calc height), CSS font |
| DEV-02 | Dev chrome collapses to pull-tab (default-collapsed, localStorage, icon-only <640px) | DevHost.vue lines 308-337 (in-game chrome); `leaveSeat` dead code at line 196 |
| DEV-03 | Seat badge becomes seat switcher; presence strip shows connected/AI/away | DevHost.vue `seats` ref (already has all needed data); `leaveSeat()` dead code |
| DEV-04 | "Table setup" panel surfaces injected `aiSeats`/`aiLevel`/`playerCount`/`gameOptions`/`playerOptions` | `DevHostConfig` type has all fields; DevHost.vue uses none of them |
| DEV-05 | Skeleton + timeout→retry for loading; split UnsupportedTopologyPanel | AutoRenderer.vue lines 153-155 (bare text); UnsupportedTopologyPanel.vue lines 1-54 |
| DEV-06 | GameHistory read-only; Copy/Clear move to DebugPanel; un-clear bug fixed | GameHistory.vue lines 91-94 (bug), 170-183 (buttons to move) |
| DEV-07 | "New game" two-click confirm + neutral styling + broadcast toast | DevHost.vue `newGame()` line 200-202; Toast composable at `src/ui/composables/useToast.ts` |
| DEV-08 | SVG noise + vignette in dev/standalone chrome; drop `background-attachment:fixed` | host.html (currently bare); DevHost.vue `.dev-host { background: var(--bsg-bg) }` |
</phase_requirements>

---

## Summary

Phase 102 is a polish-and-parity wave touching six files: `DebugPanel.vue`, `DevHost.vue`, `host.html`, `AutoRenderer.vue`, `UnsupportedTopologyPanel.vue`, and `GameHistory.vue`. Phases 98-101 built all the tokens and primitives this phase consumes; no new dependencies are needed.

The two largest behavioral gaps are: (1) the DevHost dev-chrome has had its cosmetic neon replaced (Phase 98/99) but its UX deficits remain — dead `leaveSeat()` code, a static seat badge, config data that is plumbed to the browser and rendered nowhere, and no collapse mechanism; and (2) the `D` keyboard shortcut fires on bare key with only a partial input guard, and the tab markup has no ARIA roles or keyboard navigation.

All Phase 101 primitives (`useFocusTrap`, `:focus-visible` ring, reduced-motion block, `Toast` component + `useToast` composable) are in place and ready to reuse. The Slate token set is complete and stable.

**Primary recommendation:** Work file-by-file in dependency order — `GameHistory.vue` (simplest, fixes the un-clear bug first), then `AutoRenderer.vue` + `UnsupportedTopologyPanel.vue` (standalone), then `DebugPanel.vue` (largest, but self-contained inside the iframe), then `DevHost.vue` + `host.html` (outer chrome; add `Toast.vue` to DevHost template).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| ARIA tabs (DebugPanel) | Browser / Client | — | Pure DOM/keyboard interaction; no server round-trip |
| D-shortcut modifier guard | Browser / Client | — | `keydown` handler in DebugPanel, runs in iframe |
| Dev chrome collapse | Browser / Client | — | `localStorage` + Vue ref; purely presentational |
| Seat switcher | Browser/Client (DevHost) + WebSocket | Node CLI host | UI calls `leaveSeat()` + `takeSeat()` which send WS messages; host responds |
| Presence strip | Browser / Client | — | Data already in the `seats` ref (populated by WS `lobby` messages) |
| Table setup panel | Browser / Client | — | Read-only; data is already in `cfg` (DevHostConfig); no new WS needed |
| Restart confirm | Browser / Client | — | Two-click popover; `wsSend({ type:'restart' })` fires on second click |
| Broadcast toast | Browser / Client (all seats) | — | All seats receive `game_state` after restart; toast fires on that event |
| Loading skeleton | Browser / Client | — | AutoRenderer.vue; client-side timer for timeout→retry |
| SVG noise + vignette | Browser / Client | — | Fixed CSS decorative layer in DevHost.vue / host.html |

---

## Standard Stack

No new packages are installed. All tooling is pre-existing.

### Core (already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vue 3 | ≥3.4 | Reactivity, composables | Project standard |
| Vitest | ^2.1.0 | Test runner | Project standard |
| @vue/test-utils | project dep | Vue component testing | Project standard |
| stylelint | ^17.13.0 | `color-no-hex` CSS lint | Enforced since Phase 98 |

### Reusable Phase 101 Primitives (in-repo)
| Asset | Path | API / Key Detail |
|-------|------|-----------------|
| `useFocusTrap` | `src/ui/composables/useFocusTrap.ts` | `useFocusTrap(dialogRef, { escapeToClose?, onClose? })` → `{ open, close, handleKeydown }` |
| Focus-ring CSS | `GameShell.vue` (non-scoped, lines 1739-1743) | `:focus-visible { box-shadow: 0 0 0 2px var(--bsg-bg), 0 0 0 4px var(--bsg-accent); border-radius: var(--bsg-r-sm) }` — applies within the iframe automatically; DevHost outer page needs its own copy |
| Reduced-motion | `GameShell.vue` (non-scoped, lines 1749-1755) | `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; ... } }` — iframe only; DevHost outer page needs its own copy |
| `Toast.vue` | `src/ui/components/Toast.vue` | `<Teleport to="body">`; driven by `useToast()` |
| `useToast` | `src/ui/composables/useToast.ts` | `{ toasts, show, remove, success, error, info, warning }` |

### Package Legitimacy Audit

No new packages are installed in this phase. Section not applicable.

---

## Architecture Patterns

### System Architecture Diagram

```
Outer page (host.html)
  └─ DevHost.vue
       ├─ WebSocket ──► Node CLI host (multiplayer-host.ts)
       │                   ├─ wsSend({ type:'restart' })
       │                   ├─ wsSend({ type:'leave' })
       │                   └─ wsSend({ type:'join', seat:N })
       ├─ Toast.vue [Teleport to body]  ← NEW (DEV-07)
       ├─ SVG noise + vignette layer    ← NEW (DEV-08)
       └─ <iframe :src="cfg.gameUrl">
            └─ GameShell.vue (platform mode)
                 ├─ AutoRenderer.vue     ← Modify (DEV-05)
                 │    └─ UnsupportedTopologyPanel.vue  ← Modify (DEV-05)
                 ├─ GameHistory.vue      ← Modify (DEV-06)
                 └─ DebugPanel.vue       ← Modify (DEV-01)
```

Data flows:
- WS `lobby` frame → `seats` ref in DevHost → presence strip + seat switcher
- `cfg` (DevHostConfig) → `cfg.aiSeats/aiLevel/playerCount/gameOptions/playerOptions` → Table setup panel (read-only)
- `game_state` after restart → show broadcast toast in DevHost
- DebugPanel emits `restart-game` → caught by GameShell → routes to host bridge → `debug:restart` op

### Recommended Project Structure (no new directories)

```
src/
├─ ui/components/
│   ├─ DebugPanel.vue           # DEV-01: ARIA tabs, shortcut guard, reskin
│   ├─ GameHistory.vue          # DEV-06: read-only, un-clear fix
│   └─ auto-ui/
│       ├─ AutoRenderer.vue     # DEV-05: skeleton + timeout→retry
│       └─ archetypes/
│           └─ UnsupportedTopologyPanel.vue  # DEV-05: split player/dev
└─ cli/dev-host/
    ├─ DevHost.vue              # DEV-02/03/04/07/08
    └─ host.html                # DEV-08: noise + vignette layer
```

---

## Exact Code Locations — What the Planner Needs

### DEV-01: DebugPanel.vue

**File:** `src/ui/components/DebugPanel.vue`

| Concern | Location | Current State | Required Change |
|---------|----------|---------------|-----------------|
| Toggle button | Lines 1183-1193 | `<button type="button" :aria-expanded="panelExpanded">` — already correct | No structural change; ensure no stray `outline:none` |
| Keyboard shortcut | Lines 317-326 | Bare `D` key, guards only `HTMLInputElement`/`HTMLTextAreaElement` | Add `(e.ctrlKey \|\| e.metaKey)` AND `!(e.target as HTMLElement).isContentEditable` guards |
| Shortcut hint text | Line 1199 | `(Press D to toggle)` | Update to new shortcut label |
| Controls tab shortcut label | Lines 1941-1943 | `<kbd>D</kbd> Toggle debug panel` | Update to new key combo |
| Tab markup | Lines 1207-1245 | `<div class="debug-tabs">` with plain `<button>` elements, no ARIA roles | Add `role="tablist"` to container; `role="tab"`, `aria-selected`, `id`, `aria-controls` to each tab; `role="tabpanel"`, `id`, `aria-labelledby` to each content div; Arrow/Home/End keyboard handler |
| Tab CSS | Lines 2072-2099 | Correct colors but missing active indicator on `--bsg-accent` | `active` tab: `border-bottom: 2px solid var(--bsg-accent)` |
| Height constraint | Line 2157 | `.state-display { max-height: calc(100vh - 280px); }` | Remove; rely on flex `min-height:0` on `.tab-content` and `.debug-content` |
| Monospace font | Lines 2162, 2175, 2283 | `'Monaco', 'Menlo', monospace` | Replace with `var(--bsg-mono)` |
| Restart confirm | Lines 443-447 | `window.confirm('Are you sure…')` browser dialog | Replace with two-click in-panel confirm pattern (per DEV-07 pattern below, but this is in the Controls tab of DebugPanel) |
| Phone bottom sheet | None | No `@media` for small viewports | Add `@media (max-width: 639px)` block re-docking drawer to `bottom: 0; left: 0; right: 0; height: 60dvh` |

**6 tabs** in current DebugPanel: `state`, `elements`, `decks`, `actions`, `history`, `controls`. All 6 need ARIA roles wired up.

DebugPanel is mounted **inside the iframe** (GameShell.vue line 1704), so GameShell's non-scoped `:focus-visible` and `@media (prefers-reduced-motion)` CSS already apply. No duplication needed.

### DEV-02: DevHost.vue — bar collapse

**File:** `src/cli/dev-host/DevHost.vue`

| Concern | Location | Current State | Required Change |
|---------|----------|---------------|-----------------|
| In-game chrome template | Lines 308-339 | Permanent `<header class="dev-chrome">` | Add `chromeOpen` ref; wrap bar content in `v-show`; add pull-tab trigger element |
| Chrome display name | Line 312 | `<strong>{{ cfg.displayName }}</strong>` | Delete — iframe GameShell already renders the game title |
| `localStorage` persistence | — | None | Load `chromeOpen` from `localStorage('boardsmith:dev-chrome-open')` on mount; persist on toggle |
| Default-collapsed after seat | — | None | `chromeOpen.value = false` when `mySeat` transitions from `null` to a number |
| Icon-only <640px | Lines 315-337 | Labels visible always | Add `@media (max-width:639px)` block; show icon-only variants; add `…` overflow `<details>` for secondary controls |

### DEV-03/04: DevHost.vue — seat switcher, presence strip, table setup

**File:** `src/cli/dev-host/DevHost.vue`

| Concern | Location | Current State | Required Change |
|---------|----------|---------------|-----------------|
| Seat badge | Line 313 | `<span class="dev-chrome__badge">seat {{ mySeat }}</span>` — static dead text | Replace with a `<button>` toggle for a `<menu>`/popover listing all seats; clicking a seat calls `leaveSeat()` then `takeSeat(target)` |
| `leaveSeat()` | Lines 196-199 | `wsSend({ type: 'leave' }); mySeat.value = null` — function exists but unreferenced in in-game template | Wire to seat switcher; it works as-is |
| Presence strip | `seats` ref line 43 | `SeatInfo[]` with `{ seat, clientId, name, color, connected }` already populated | Render each seat as a pill: `seat.name \|\| 'Seat N'` + `seat.connected` dot + AI indicator (when `!seat.clientId`) |
| Follow toggle | Lines 326-334 | `followActive` button exists, works | Keep; integrate with seat switcher (disable switching while follow-mode is active, or auto-disable follow when switching) |
| Table setup | Lines 16-17 | `cfg.aiSeats`, `cfg.aiLevel`, `cfg.playerCount`, `cfg.gameOptions`, `cfg.playerOptions` exist in `DevHostConfig`; `DevHost.vue` references only `cfg.displayName`, `cfg.colorPalette`, `cfg.gameUrl`, `cfg.gameType` | Add a `tableSetupOpen` ref + collapsible panel; render these fields read-only |

**AI seat detection pattern**: `cfg.aiSeats` is an array of 1-indexed seat numbers (e.g., `[2, 3]`). Cross-reference with `seats` to add "AI" label.

### DEV-05: AutoRenderer.vue + UnsupportedTopologyPanel.vue

**AutoRenderer.vue** (`src/ui/components/auto-ui/AutoRenderer.vue`)

| Concern | Location | Current State | Required Change |
|---------|----------|---------------|-----------------|
| Loading state | Lines 153-155 | `<p>Waiting for game state…</p>` | Replace with skeleton (3-4 animated placeholder bars) + a `ref<number>(0) retryCount`, `setTimeout` (e.g. 8s) → show retry button; `@media (prefers-reduced-motion)` static skeleton |

**UnsupportedTopologyPanel.vue** (`src/ui/components/auto-ui/archetypes/UnsupportedTopologyPanel.vue`)

| Concern | Location | Current State | Required Change |
|---------|----------|---------------|-----------------|
| Single combined message | Lines 20-29 | One amber panel for all users | Split into: (1) player-facing `<p>` (no raw dev terms); (2) `v-if="isDev"` block with dev guidance + link. Need a prop or inject for `isDev` |

**`isDev` mechanism**: GameShell provides platform context. Check if `inject('platformRequest')` is available as the dev indicator — DebugPanel already uses this injection. In `UnsupportedTopologyPanel`, inject `platformRequest`: if present → dev context → show dev block.

### DEV-06: GameHistory.vue

**File:** `src/ui/components/GameHistory.vue`

**The un-clear bug (line 90-94):**
```typescript
// Current (buggy)
function clearHistory() {
  processedMessages.value = [];   // ← array cleared
  messageCounter = 0;             // ← counter reset
}
// Watcher fires on next props.messages change:
const startIndex = processedMessages.value.length;  // ← 0 after clear
if (newMessages.length > startIndex) {              // ← TRUE immediately
  for (let i = startIndex; i < newMessages.length; i++) { // ← re-adds ALL from i=0
```
**Fix:** Track `clearedAt` as the index in `props.messages` where clear happened. The watcher should always process from `max(processedMessages.value.length, clearedAt)` to avoid re-adding cleared entries when new messages arrive.

**Copy/Clear removal** (lines 170-183): The `<div v-if="!isCollapsed" class="header-buttons">` block renders the Copy and Clear buttons. Remove both from GameHistory template. `copyHistory()` and `clearHistory()` functions stay (they move to DebugPanel).

**Adding to DebugPanel**: A "history" tab already exists in DebugPanel (line 1238). The action history there is the debug action trace timeline, not the player-facing game messages. DEV-06's Copy/Clear controls belong in the Controls tab section of DebugPanel — or a new dedicated history utility section in the Controls tab.

### DEV-07: DevHost.vue — restart confirm + broadcast toast

**File:** `src/cli/dev-host/DevHost.vue`

| Concern | Location | Current State | Required Change |
|---------|----------|---------------|-----------------|
| `newGame()` | Lines 200-202 | `wsSend({ type: 'restart' })` — immediate, no confirm | Add `restartConfirming: ref(false)`; first click sets it true (shows "Are you sure?"); second click calls `newGame()`; auto-cancel after timeout; Escape resets |
| Button styling | Line 335 `.btn--start` | Already ghost-ish (transparent bg, `var(--bsg-ink-2)` text) but can feel like a CTA | Ensure styling is clearly secondary/ghost — no accent fill |
| Toast on restart | — | No toast | All seats receive `game_state` after restart; handle in `onHostMessage case 'game_state'` — add a flag `justRestarted` OR add a new WS message type `restart_ack` from the host; call `toast.info('Game restarted by seat N')` |
| Toast.vue import | — | Not imported in DevHost | Add `import Toast from '../../ui/components/Toast.vue'` and `<Toast />` to the template |
| `useToast` import | — | Not used in DevHost | Add `import { useToast } from '../../ui/composables/useToast.js'` |

**Broadcast toast mechanics**: The Node host already broadcasts `game_state` to all clients after restart. In `onHostMessage`, when `msg.type === 'game_state'` and the game appears to have been freshly reset (turn=0, no history), show a brief toast. Alternatively, add a `type: 'restart_ack'` message from the host — cleaner but requires multiplayer-host.ts change.

**Simplest clean approach**: add a `pendingRestart: ref(false)` flag. `newGame()` sets it. `onHostMessage` clears it and calls `toast.info()` when the next `game_state` arrives with `pendingRestart.value === true`.

### DEV-08: host.html + DevHost.vue — material layer

**host.html** (`src/cli/dev-host/host.html`): Currently bare minimal HTML, no background styling at all. The spec describes the plain dark `var(--bsg-bg)` background as reading like "TV static" at scale. DEV-08 adds a subtle SVG `feTurbulence` noise layer + CSS vignette.

There are **no** `--bsg-grain` or `--bsg-vignette` tokens in `theme.ts` yet. They are described in the spec (around line 184) but not in the current `src/ui/theme.ts`. Two options:

1. **Add tokens to `theme.ts`** (`--bsg-grain-opacity`, `--bsg-grain` data URI) — cleaner for future reuse
2. **Inline in DevHost.vue** — simpler, self-contained

Given the scope guardrail (no host-repo changes, dev-only), option 2 is safer.

**SVG noise pattern**: Use an inline `<div class="dev-grain">` fixed layer with:
```css
/* In DevHost.vue scoped style */
.dev-grain {
  position: fixed; inset: 0; pointer-events: none; z-index: 0;
  opacity: 0.08;
  background-image: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
}
.dev-vignette {
  position: fixed; inset: 0; pointer-events: none; z-index: 1;
  background: radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.5) 100%);
}
```
Note: `color-no-hex` stylelint only covers `src/ui/**/*.vue`. `DevHost.vue` is at `src/cli/dev-host/DevHost.vue` — **NOT** covered by the lint rule. However, the opacity value here is in a data URI context, not a CSS color literal, so it should be lint-safe anyway. The `rgba(0,0,0,0.5)` in the vignette IS a hex-equivalent color; use `var(--bsg-bg)` with opacity via `color-mix` if possible to stay token-clean.

**`background-attachment:fixed`**: Currently absent from DevHost.vue — the guard in CONTEXT.md is a reminder for new code. Do not add `background-attachment:fixed` to the new grain layer.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Toast notifications | A new per-component toast mechanism | `useToast()` + existing `Toast.vue` | Phase 101 already built ARIA-correct role=status/alert with dismiss |
| Focus trap for confirm popover | Manual tab/Escape handling | `useFocusTrap()` from Phase 101 | Phase 101 handles Tab-wrap, Escape, inert siblings |
| Keyboard shortcut modifier detection | Custom key combo registry | `e.ctrlKey \|\| e.metaKey` inline in `handleKeyDown` | One-liner; no library needed |
| ARIA tabs keyboard nav | Custom grid nav | Standard tabs pattern (see Code Examples) | Well-established pattern; hand-rolling adds bugs |

---

## Common Pitfalls

### Pitfall 1: The `clearHistory` Un-Clear Bug
**What goes wrong:** `clearHistory()` sets `processedMessages.value = []`. On the next watcher trigger, `startIndex = processedMessages.value.length = 0`. Since `props.messages.length > 0`, the watcher iterates from `i=0` and re-adds ALL original messages. The UI appears to clear, then immediately re-populates on the next state update.
**Root cause:** The watcher's `startIndex` is derived from `processedMessages.length`, which was reset to 0. The watcher has no concept of "I already processed these up to index N before the clear."
**Fix:** Introduce `let lastProcessedSourceIndex = 0`. `clearHistory()` sets `processedMessages.value = []` but does NOT reset `lastProcessedSourceIndex`. The watcher starts from `lastProcessedSourceIndex`, which skips all pre-clear messages. Only truly new messages (index > `lastProcessedSourceIndex`) are added.

### Pitfall 2: ARIA Tabs Arrow-Key Focus vs. Tab Key
**What goes wrong:** ARIA tabs pattern uses arrow keys to navigate between tabs (not Tab key). Tab should move focus OUT of the tablist entirely. Implementing this incorrectly causes double-Tab behavior.
**Fix:** All inactive tabs get `tabindex="-1"`; active tab gets `tabindex="0"`. Arrow keys change which tab is active AND move focus. Tab key follows browser default (moves to next focusable outside the tablist).

### Pitfall 3: `contenteditable` Guard for Keyboard Shortcut
**What goes wrong:** The DebugPanel's `D` guard only checks `HTMLInputElement` and `HTMLTextAreaElement`. Users can have contenteditable elements (e.g., a `<div contenteditable>` in a custom UI) — typing "D" in one would open the debug panel.
**Fix:** Add `!(e.target as HTMLElement).isContentEditable` to the guard.

### Pitfall 4: Toast.vue is Not Available in Outer DevHost Page
**What goes wrong:** Toast.vue uses `inject` from Vue — it must be within a component tree. DevHost.vue runs in the outer page (not inside GameShell). If Toast.vue is not explicitly added to DevHost.vue's template, `useToast().show()` calls will add toasts to the global array but they will never render.
**Fix:** Import `Toast.vue` in DevHost.vue and add `<Toast />` to the template.

### Pitfall 5: `color-no-hex` Lint Scope
**What goes wrong:** Assuming DevHost.vue is covered by `npm run lint:css` and that any color literal in its `<style scoped>` block will fail CI.
**Reality:** `stylelint 'src/ui/**/*.vue'` — DevHost.vue is at `src/cli/dev-host/DevHost.vue`, outside the `src/ui/**` glob. It is NOT linted. However, use `var(--bsg-*)` tokens anyway for consistency and to make it theme-switchable.

### Pitfall 6: focus-ring CSS Scope
**What goes wrong:** Assuming GameShell's non-scoped `:focus-visible` rule applies to DevHost.vue's outer-page elements.
**Reality:** GameShell's non-scoped CSS only applies within the iframe document. The DevHost chrome (outer page) has its own document. DebugPanel IS in the iframe, so it inherits. The DevHost pull-tab, seat switcher, confirm button, etc. do NOT inherit — they need a local `:focus-visible` rule in DevHost.vue's scoped style.

### Pitfall 7: SVG Data URI in CSS — URL Encoding
**What goes wrong:** Embedding raw SVG as a CSS `background-image` data URI fails if special characters (`#`, `<`, `>`, etc.) are not URL-encoded.
**Fix:** Use `%23` for `#`, encode `<` as `%3C`, `>` as `%3E`, or wrap in double-quotes inside the data URI. The `feTurbulence` inline example in Code Examples uses pre-encoded form.

---

## Code Examples

Verified patterns from project source:

### ARIA Tabs Pattern (standard HTML spec)
```html
<!-- Source: https://www.w3.org/WAI/ARIA/apg/patterns/tabs/ (ASSUMED: training knowledge) -->
<div role="tablist" aria-label="Debug">
  <button
    v-for="(tab, i) in tabs"
    :key="tab.id"
    role="tab"
    :aria-selected="activeTab === tab.id"
    :aria-controls="`panel-${tab.id}`"
    :id="`tab-${tab.id}`"
    :tabindex="activeTab === tab.id ? 0 : -1"
    @click="selectTab(tab.id)"
    @keydown="handleTabKeydown"
  >{{ tab.label }}</button>
</div>
<div
  v-for="tab in tabs"
  :key="tab.id"
  role="tabpanel"
  :id="`panel-${tab.id}`"
  :aria-labelledby="`tab-${tab.id}`"
  :hidden="activeTab !== tab.id"
>...</div>
```
```typescript
// Arrow key handler for ARIA tabs
function handleTabKeydown(e: KeyboardEvent) {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (!keys.includes(e.key)) return;
  e.preventDefault();
  const ids = tabs.map(t => t.id);
  const idx = ids.indexOf(activeTab.value);
  if (e.key === 'ArrowRight') selectTab(ids[(idx + 1) % ids.length]);
  if (e.key === 'ArrowLeft') selectTab(ids[(idx - 1 + ids.length) % ids.length]);
  if (e.key === 'Home') selectTab(ids[0]);
  if (e.key === 'End') selectTab(ids[ids.length - 1]);
  // Focus the newly-selected tab button
  nextTick(() => {
    document.getElementById(`tab-${activeTab.value}`)?.focus();
  });
}
```

### D-Shortcut Guard (updated)
```typescript
// Source: DebugPanel.vue lines 317-326 (current), updated pattern
function handleKeyDown(e: KeyboardEvent) {
  // Guard 1: typing in any text input / select / textarea
  if (e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLSelectElement ||
      e.target instanceof HTMLTextAreaElement) return;
  // Guard 2: typing in any contenteditable element
  if ((e.target as HTMLElement).isContentEditable) return;
  // Require modifier: Ctrl+D (Windows/Linux) or Cmd+D (Mac)
  if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
    e.preventDefault(); // prevent browser "Add to bookmarks" (Cmd+D)
    togglePanel();
  }
}
```

### GameHistory Un-Clear Fix
```typescript
// Source: GameHistory.vue logic analysis — correct fix pattern
let lastProcessedSourceIndex = 0;

watch(
  () => props.messages,
  (newMessages) => {
    // Only process messages we haven't seen yet
    for (let i = lastProcessedSourceIndex; i < newMessages.length; i++) {
      const msg = newMessages[i];
      const text = typeof msg === 'string' ? msg : msg.text;
      const type = typeof msg === 'object' && msg.type
        ? (msg.type as 'action' | 'system' | 'error') : 'action';
      if (text) {
        processedMessages.value.push({ id: messageCounter++, text, timestamp: new Date(), type });
      }
    }
    lastProcessedSourceIndex = newMessages.length;
    // scroll...
  },
  { immediate: true, deep: true }
);

function clearHistory() {
  processedMessages.value = [];
  // Do NOT reset lastProcessedSourceIndex — that would re-add old messages
}
```

### Two-Click Confirm Pattern (DEV-07)
```typescript
// Source: CONTEXT.md DEV-07 decision — standard two-click pattern
const restartConfirming = ref(false);
let restartConfirmTimer: ReturnType<typeof setTimeout> | null = null;

function handleNewGameClick() {
  if (!restartConfirming.value) {
    restartConfirming.value = true;
    restartConfirmTimer = setTimeout(() => { restartConfirming.value = false; }, 5000);
  } else {
    if (restartConfirmTimer) clearTimeout(restartConfirmTimer);
    restartConfirming.value = false;
    newGame();
  }
}
```
```html
<button type="button" class="btn btn--ghost" @click="handleNewGameClick">
  {{ restartConfirming ? 'Confirm restart?' : 'New game' }}
</button>
```

### Broadcast Toast on Restart (DEV-07)
```typescript
// Source: useToast.ts API; pattern for pending-restart flag
import { useToast } from '../../ui/composables/useToast.js';
const toast = useToast();

const pendingRestart = ref(false);

function newGame() {
  pendingRestart.value = true;
  wsSend({ type: 'restart' });
}

function onHostMessage(msg) {
  // ... existing cases ...
  case 'game_state':
    if (pendingRestart.value) {
      pendingRestart.value = false;
      toast.info('Game restarted');
    }
    // ... rest of handling ...
}
```

### useFocusTrap Usage (for new DevHost confirm popover)
```typescript
// Source: src/ui/composables/useFocusTrap.ts lines 57-60
// [VERIFIED: src/ui/composables/useFocusTrap.ts]
import { useFocusTrap } from '../../ui/composables/useFocusTrap.js';
const confirmPopoverRef = ref<HTMLElement | null>(null);
const { open: openTrap, close: closeTrap, handleKeydown: trapKeydown } = useFocusTrap(
  confirmPopoverRef,
  { escapeToClose: true, onClose: () => { restartConfirming.value = false; } }
);
```

### SVG Noise + Vignette (DEV-08)
```css
/* Source: [ASSUMED] standard SVG feTurbulence pattern; no existing grain in repo */
.dev-grain {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  opacity: 0.07;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}
.dev-vignette {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 1;
  background: radial-gradient(
    ellipse at 50% 50%,
    transparent 35%,
    color-mix(in srgb, var(--bsg-bg) 70%, transparent) 100%
  );
}
```
Note: `color-mix(in srgb, var(--bsg-bg) 70%, transparent)` avoids any hex literal and is theme-aware (adapts to dark/light mode). Place both divs as direct children of `.dev-host`, positioned before `<header>` and `<main>`, so they sit behind all content.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `window.confirm()` for destructive ops | Two-click inline confirm | CLAUDE.md `always_confirm_destructive` | `window.confirm()` still present in DebugPanel `restartGame()` (line 444) and `rewindToAction()` (line 1138) — Phase 102 replaces only `restartGame()`; `rewindToAction()` can keep native confirm (debug-only, less critical) |
| Bare `D` shortcut | Modifier + contenteditable guard | Phase 102 (DEV-01) | Prevents firing when user types "d" anywhere in the page |
| Static seat badge | Working seat switcher | Phase 102 (DEV-03) | `leaveSeat()` has been dead code since the function was written |
| Plain loading text | Skeleton + timeout→retry | Phase 102 (DEV-05) | Better user experience during connection |

**Deprecated/outdated in Phase 102:**
- `window.confirm()` in `DebugPanel.restartGame()` — replaced with two-click pattern
- `'Monaco', 'Menlo', monospace` in DebugPanel CSS — replaced with `var(--bsg-mono)`
- Static seat badge `<span>` in DevHost — replaced with interactive seat switcher
- Copy/Clear buttons in GameHistory sidebar — moved to DebugPanel

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | ARIA tabs arrow-key pattern (ArrowLeft/Right/Home/End) per W3C APG | Code Examples | Low — this is the standard pattern; wrong key bindings would confuse keyboard users |
| A2 | `(e.ctrlKey \|\| e.metaKey) && e.key === 'D'` won't conflict with other browser shortcuts on Mac/Win | DEV-01 shortcut decision | Low — Ctrl+D is "Add Bookmark" on most browsers, but `e.preventDefault()` blocks it; Cmd+D is "Add Bookmark" on Safari/Chrome Mac — need to verify no game UIs bind Cmd+D |
| A3 | SVG `feTurbulence` data URI approach for noise (DEV-08) | Code Examples | Low — standard technique, but Safari sometimes renders feTurbulence differently than Chrome |
| A4 | `pendingRestart` flag approach is sufficient for broadcast toast (DEV-07); no new WS message type needed | DEV-07 pattern | Low — works when only one client initiates restart; if multiple clients could restart simultaneously, a `restart_ack` WS message would be cleaner |
| A5 | `inject('platformRequest')` being present is a reliable dev-context indicator for UnsupportedTopologyPanel | DEV-05 | Medium — this works today because DebugPanel uses the same check; could break if `platformRequest` is ever provided in non-dev contexts |

---

## Open Questions

1. **Confirm shortcut key**
   - What we know: CONTEXT.md says "e.g. Ctrl/Cmd+D won't conflict — pick a safe combo"
   - What's unclear: Ctrl+D / Cmd+D = "Add Bookmark" in most browsers; needs `e.preventDefault()`. Alternative: `Shift+D` is less standard but also less likely to conflict.
   - Recommendation: Use `Ctrl/Cmd+D` with `e.preventDefault()`. The planner can document the chosen key in the task.

2. **Table setup panel: read-only display format**
   - What we know: DEV-04 says "read-only display is fine; editing is not required." `gameOptions` and `playerOptions` are `DevOptionDef[]` arrays with `id`, `type`, `label`, `default`, `choices`, `min`, `max`.
   - What's unclear: Display format for complex option types (choices, ranges).
   - Recommendation: Simple `<dl>/<dt>/<dd>` structure showing `label: default` for each option.

3. **`restart_ack` WS message vs `pendingRestart` flag**
   - What we know: Simplest approach uses a client-side flag; cleaner approach adds a new WS message.
   - What's unclear: Whether multiplayer-host.ts needs a WS protocol change.
   - Recommendation: Use the `pendingRestart` flag approach to avoid touching `multiplayer-host.ts` (reduces scope and test surface).

---

## Environment Availability

This phase makes no new external dependencies and requires no external services. All tooling is pre-existing.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Vitest | Test suite | ✓ | ^2.1.0 | — |
| @vue/test-utils | Component tests | ✓ | project dep | — |
| stylelint | CSS lint | ✓ | ^17.13.0 | — |

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^2.1.0 |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `npm run test` |
| Full suite command | `npm run test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DEV-01 | D-shortcut does NOT fire inside `contenteditable` | unit | `vitest run src/ui/components/DebugPanel.shortcut.test.ts` | ❌ Wave 0 |
| DEV-01 | D-shortcut does NOT fire without modifier | unit | same file | ❌ Wave 0 |
| DEV-01 | D-shortcut fires on Ctrl/Cmd+D | unit | same file | ❌ Wave 0 |
| DEV-01 | Tab markup has correct ARIA roles (tablist/tab/tabpanel) | unit | `vitest run src/ui/components/DebugPanel.tabs.test.ts` | ❌ Wave 0 |
| DEV-06 | `clearHistory()` does not re-populate on next message | unit | `vitest run src/ui/components/GameHistory.test.ts` | ❌ Wave 0 |
| DEV-06 | GameHistory sidebar mode has no Copy/Clear buttons | unit | same file | ❌ Wave 0 |
| DEV-07 | `newGame()` requires two clicks (single click only sets confirm state) | unit | `vitest run src/cli/dev-host/DevHost.restart.test.ts` | ❌ Wave 0 |
| DEV-07 | Broadcast toast fires after game_state received post-restart | unit | same file | ❌ Wave 0 |
| DEV-03 | Presence strip renders seat name + connected status | unit | `vitest run src/cli/dev-host/DevHost.seats.test.ts` | ❌ Wave 0 |
| DEV-05 | AutoRenderer skeleton shows after timeout | unit | `vitest run src/ui/components/auto-ui/AutoRenderer.loading.test.ts` | ❌ Wave 0 |

**Note:** All DevHost tests require `// @vitest-environment jsdom`. Vue component tests use `@vue/test-utils` `mount`.

### Sampling Rate
- **Per task commit:** `npm run test`
- **Per wave merge:** `npm run test && npm run lint:css`
- **Phase gate:** Full suite (1186 + new tests) green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/ui/components/DebugPanel.shortcut.test.ts` — covers DEV-01 keyboard guard
- [ ] `src/ui/components/DebugPanel.tabs.test.ts` — covers DEV-01 ARIA tabs
- [ ] `src/ui/components/GameHistory.test.ts` — covers DEV-06 un-clear fix
- [ ] `src/cli/dev-host/DevHost.restart.test.ts` — covers DEV-07 two-click confirm + toast
- [ ] `src/cli/dev-host/DevHost.seats.test.ts` — covers DEV-03 presence strip
- [ ] `src/ui/components/auto-ui/AutoRenderer.loading.test.ts` — covers DEV-05 skeleton

---

## Security Domain

No security-critical changes in this phase. The phase modifies dev-only chrome (DebugPanel, DevHost) and presentation components. No new auth, session management, cryptography, or input validation surfaces are introduced.

The only mild security-relevant concern:
- **UnsupportedTopologyPanel dev block** (DEV-05): Do not put game IDs, stack traces, element attribute names, or internal paths in the dev guidance block. CLAUDE.md: "Never leak implementation details."

---

## Sources

### Primary (HIGH confidence — verified against source files)
- `src/ui/components/DebugPanel.vue` — shortcut (lines 317-326), tabs (1207-1245), height (2157), font (2162/2175), restart confirm (443-447)
- `src/ui/components/GameHistory.vue` — un-clear bug (lines 91-94), Copy/Clear buttons (170-183)
- `src/cli/dev-host/DevHost.vue` — newGame (200-202), leaveSeat (196-199), seat badge (313), followActive (46, 203-205, 326-334), cfg usage
- `src/cli/dev-host/config-types.ts` — DevHostConfig type with all fields
- `src/cli/dev-host/host.html` — confirmed minimal; no existing grain
- `src/ui/components/auto-ui/AutoRenderer.vue` — loading state (153-155)
- `src/ui/components/auto-ui/archetypes/UnsupportedTopologyPanel.vue` — full file
- `src/ui/composables/useFocusTrap.ts` — API signature
- `src/ui/components/Toast.vue` — Teleport, role=status/alert
- `src/ui/composables/useToast.ts` — full API
- `src/ui/theme.ts` — token definitions (--bsg-accent, --bsg-mono, surfaces, no grain tokens)
- `src/ui/components/GameShell.vue` lines 1739-1755 — focus-ring and reduced-motion CSS
- `.stylelintrc.cjs` — `color-no-hex: true`, zero exclusions, glob `src/ui/**/*.vue`

### Secondary (MEDIUM confidence)
- `planning/boardsmith-ui-redesign-spec.md` lines 757-855 (Wave 5 dev-chrome redesign spec)
- `planning/boardsmith-ui-redesign-spec.md` lines 1342-1354 (Wave 5 deliverables)

### Tertiary (LOW confidence)
- W3C APG tabs pattern (training knowledge — standard, but not fetched this session)

---

## Metadata

**Confidence breakdown:**
- Source file locations: HIGH — all verified via Read tool
- Bug root cause analysis: HIGH — watcher logic traced manually
- Dead code identification: HIGH — grep confirmed zero template references for `leaveSeat`
- ARIA tabs pattern: MEDIUM — standard, but exact attribute names from training
- SVG noise technique: ASSUMED — standard web technique, no Context7 lookup

**Research date:** 2026-06-23
**Valid until:** 2026-07-23 (stable internal codebase; no external deps changing)
