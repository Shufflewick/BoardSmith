---
phase: 100-ia-responsive-wave-3
reviewed: 2026-06-23T00:00:00Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - src/ui/components/GameShell.vue
  - src/ui/components/ControlsMenu.vue
  - src/ui/components/GameOverCard.vue
  - src/ui/components/PlayersPanel.vue
  - src/ui/components/GameHistory.vue
  - src/ui/components/GameHeader.vue
  - src/ui/components/auto-ui/ActionPanel.vue
  - src/ui/components/auto-ui/AutoUI.vue
  - src/ui/components/auto-ui/renderers/GridBoardRenderer.vue
  - src/ui/components/auto-ui/renderers/HexBoardRenderer.vue
  - src/ui/components/auto-ui/renderers/CardRenderer.vue
  - src/ui/components/auto-ui/renderers/HandRenderer.vue
  - src/ui/components/auto-ui/renderers/DeckRenderer.vue
  - src/ui/components/auto-ui/archetypes/GridBoardTemplate.vue
  - src/cli/dev-host/DevHost.vue
findings:
  critical: 1
  warning: 4
  info: 3
  total: 8
status: issues_found
---

# Phase 100: Code Review Report

**Reviewed:** 2026-06-23
**Depth:** standard
**Files Reviewed:** 15
**Status:** issues_found

## Summary

Reviewed the Phase 100 IA & Responsive Wave 3 (Slate UI) changes. The overall
architecture is sound — origin checks in the postMessage boundary are correct,
the ResizeObserver and MediaQueryList are cleaned up on unmount, and winnerSeats
validation is proper. One blocker was found: the hex board renderer is missing the
`@dragover` handler required by the HTML drag-and-drop API, making drops to hex
cells permanently broken. Four warnings cover: the dock ResizeObserver failing to
attach in non-platform startup paths, the dev host never sending the heartbeat the
connection-dot depends on, game history not clearing on restart/rematch, and
`platformRequest` outgoing messages using `'*'` as the postMessage target origin.

---

## Critical Issues

### CR-01: `HexBoardRenderer.vue` — drop events never fire on hex cells

**File:** `src/ui/components/auto-ui/renderers/HexBoardRenderer.vue:205-208`

**Issue:** The HTML drag-and-drop API requires the `dragover` event handler to call
`event.preventDefault()` before the browser will fire the `drop` event on an
element. `HexBoardRenderer` attaches `@drop="handleHexDrop($event, cell)"` on each
`<g>` group but has **no `@dragover` handler**. The browser therefore treats hex
cells as "no-drop" targets: the drag cursor shows the prohibition symbol and the
`drop` event is silently swallowed. Drag-and-drop to hex cells is 100% broken
regardless of the `isDropTarget` state.

`GridBoardRenderer.vue` line 214 has the correct pattern:
```html
@dragover="handleDragOver($event, cell)"
@drop="handleDrop($event, cell)"
```

**Fix:** Add a `handleHexDragOver` function and bind it alongside the existing drop
handler. Matches the `GridBoardRenderer` approach exactly.

```typescript
// In <script setup>
function handleHexDragOver(event: DragEvent, cell: GameElement) {
  if (!boardInteraction?.isDragging) return;
  if (!isCellDropTarget(cell)) return;
  event.preventDefault();
  event.dataTransfer!.dropEffect = 'move';
}
```

```html
<!-- In <template>, on the <g> element -->
<g
  v-for="cell in (element.children ?? [])"
  :key="cell.id"
  class="hex-cell-group"
  :transform="`translate(${getCellPosition(cell).x}, ${getCellPosition(cell).y})`"
  @click="handleHexClick(cell)"
  @dragover="handleHexDragOver($event, cell)"
  @drop="handleHexDrop($event, cell)"
>
```

---

## Warnings

### WR-01: `GameShell.vue` — `dockObserver` never attaches in non-platform startup

**File:** `src/ui/components/GameShell.vue:627-631`

**Issue:** The `dockObserver` (ResizeObserver for `--bsg-dock-h`) is created in
`onMounted` and immediately tries to observe `actionbarRef.value`. However,
`actionbarRef` points to `<div class="actionbar" ref="actionbarRef">`, which lives
inside `<div v-if="currentScreen === 'game'"` (line 1400). In non-platform mode
`currentScreen` initializes to `'lobby'` (line 183), so the actionbar element is not
in the DOM when `onMounted` fires. `actionbarRef.value` is `null`; the `if
(actionbarRef.value) dockObserver.observe(...)` guard is true, nothing is observed,
and the observer is never re-attached when the screen later transitions to `'game'`.

In **platform mode** (`currentScreen` starts as `'game'`) this works correctly.
The standalone/lobby path is documented as deprecated ("A game ONLY runs through
the production path"), but the code remains and the bug is invisible until someone
exercises that path.

**Fix:** Watch `actionbarRef` to attach the observer when the element becomes
available:

```typescript
// After the dockObserver is created in onMounted, add:
watch(actionbarRef, (el) => {
  if (el && dockObserver) dockObserver.observe(el);
}, { immediate: true });
```

Or replace the one-shot `if` guard with the watch so the observer attaches
regardless of startup screen.

---

### WR-02: `DevHost.vue` — heartbeat never sent; connection dot always amber/red

**File:** `src/cli/dev-host/DevHost.vue` (no specific line — feature entirely absent)

**Issue:** `GameShell.vue` lines 231–232 and 752–765 implement connection health
tracking driven by `heartbeat` postMessages from the host. `connectionHealth` starts
as `'connecting'` and degrades to `'stale'` after 10 seconds without a heartbeat.
The connection dot (visible in platform mode, including the DevHost iframe) displays
`var(--bsg-away)` until a heartbeat arrives and `var(--bsg-warn)` after 10 s.

`DevHost.vue` sends `init`, `game_state`, `server_response`, and dev-switcher
messages but **never sends `{ type: 'heartbeat', source: 'shufflewick' }`**. The
connection dot in the dev host is therefore permanently amber (stale after 10 s),
misleading developers about connection health during local testing. The feature is
wired and tested in GameShell but has no sender on the dev side.

**Fix:** In `DevHost.vue` — the simplest approach: send a heartbeat immediately
after any game-state message is delivered, and on a 5 s interval while connected:

```typescript
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

function startHeartbeats() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => {
    postToGame({ type: 'heartbeat' });
  }, 5_000);
  postToGame({ type: 'heartbeat' }); // immediate first beat
}

// Call startHeartbeats() inside onHostMessage when connected becomes true,
// and clear in onUnmounted.
```

---

### WR-03: `GameHistory.vue` — history not cleared on game restart or rematch

**File:** `src/ui/components/GameHistory.vue:40-69`

**Issue:** The watcher that populates `processedMessages` only ever appends:

```typescript
const startIndex = processedMessages.value.length;
if (newMessages.length > startIndex) {
  // append new messages
}
```

When a game is restarted (`handleRestartGame`) or a new game is started
(`handleMenuItemClick('new-game')`), `state.value` is replaced and
`gameMessages` (derived from `state.value?.state?.messages`) resets to `[]`.
The watcher sees `newMessages.length = 0 < processedMessages.value.length`, the
condition is false, and **the history panel retains every message from the previous
game**. The user must manually click "Clear" to remove stale history. This is
particularly confusing for "Rematch" where the old game log visually bleeds into
the new game.

**Fix:** Detect array shrinkage and reset the panel:

```typescript
watch(
  () => props.messages,
  (newMessages) => {
    // If the message source reset (restart/new game), clear our processed list
    if (newMessages.length < processedMessages.value.length) {
      processedMessages.value = [];
      messageCounter = 0;
    }
    const startIndex = processedMessages.value.length;
    if (newMessages.length > startIndex) {
      for (let i = startIndex; i < newMessages.length; i++) {
        // ... existing append logic
      }
    }
  },
  { immediate: true, deep: true }
);
```

---

### WR-04: `GameShell.vue` — `platformRequest` sends with `'*'` target origin

**File:** `src/ui/components/GameShell.vue:347-354`

**Issue:** `platformRequest` broadcasts outgoing messages containing game action
payloads (action names, selection args, player identifiers) using the wildcard target
origin `'*'`:

```typescript
window.parent.postMessage({
  source: 'shufflewick-game',
  type: 'server_request',
  requestId,
  op,
  payload: cloneable,
}, '*');            // ← any embedding page receives this
```

The `isOriginAllowed` guard correctly restricts **incoming** messages to trusted
origins. Outgoing messages are not symmetrically locked. Any page that embeds the
game iframe (including a malicious one) would receive `server_request` frames
containing game operation names, player seat numbers, and selection values.

In production the primary risk is disclosure of game-action data (not authentication
credentials, since those flow through the WS relay). However, the pattern contradicts
the `trustedOrigins` prop's intent: origin filtering is only half-enforced.

**Fix:** Use the specific trusted origin as the target when it is configured:

```typescript
function platformRequest(op: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const cloneable = toCloneablePayload(op, payload);
  // Target the first trusted origin, fall back to '*' when unconfigured (existing behaviour)
  const targetOrigin = props.trustedOrigins?.[0] ?? '*';
  return new Promise((resolve) => {
    // ... same as before ...
    window.parent.postMessage({
      source: 'shufflewick-game',
      type: 'server_request',
      requestId,
      op,
      payload: cloneable,
    }, targetOrigin);
  });
}
```

---

## Info

### IN-01: `GameHeader.vue` — import after first use of `computed`

**File:** `src/ui/components/GameHeader.vue:37-39`

**Issue:** `computed` is used on line 37 (`const zoomPercent = computed(...)`) but
imported on line 39 (`import { computed } from 'vue'`). JavaScript module imports
are hoisted so this is not a runtime error, but it is misleading and violates the
convention that imports appear at the top of the script block. Any maintainer
reading the file top-to-bottom sees `computed` used before it is "declared" and may
incorrectly suspect a bug.

**Fix:** Move the import to the top of the `<script setup>` block alongside the
existing component imports.

---

### IN-02: `GameOverCard.vue` — unused `idx` variable in `v-for`

**File:** `src/ui/components/GameOverCard.vue:84-85`

**Issue:**

```html
v-for="(player, idx) in winners"
:key="player.seat"
```

`idx` is declared but never referenced. The shape class for each winner is computed
via `players.findIndex(p => p.seat === player.seat)` (line 91) — the index into the
full `players` array rather than into the `winners` subset. The logic is correct but
`idx` is dead code.

**Fix:** Remove `idx` from the destructuring:

```html
v-for="player in winners"
```

---

### IN-03: `GameShell.vue` — `Math.random()` used for persistent player ID generation

**File:** `src/ui/components/GameShell.vue:59`

**Issue:**

```typescript
id = Math.random().toString(36).substring(2) + Date.now().toString(36);
```

`Math.random()` is not cryptographically secure. The generated IDs are also short
(~11 base-36 characters). For a localStorage-persisted player identity that is used
for seat-claiming and session resumption, the collision probability is low but
non-zero, and the IDs are predictable in environments where `Math.random()` is
seeded deterministically (e.g., some test harnesses or headless browsers). A
malicious actor who can predict the ID could hijack a player's seat claim.

**Fix:** Use `crypto.randomUUID()` (available in all target environments):

```typescript
id = crypto.randomUUID();
localStorage.setItem(LOCAL_KEY, id);
```

The same pattern applies to the same-browser joiner ID generated at line 959.

---

_Reviewed: 2026-06-23_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
