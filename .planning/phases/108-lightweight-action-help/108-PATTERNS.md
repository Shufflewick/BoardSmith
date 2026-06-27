# Phase 108: Lightweight Action Help — Pattern Map

**Mapped:** 2026-06-26
**Files analyzed:** 9 new/modified files
**Analogs found:** 9 / 9

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/engine/action/types.ts` | model | transform | `prompt?: string` field in same file (line 433) | exact |
| `src/engine/action/action-builder.ts` | utility | transform | `.prompt()` builder method (lines 95–98) | exact |
| `src/session/types.ts` | model | transform | `prompt?: string` in `ActionMetadata` (line 358) | exact |
| `src/session/utils.ts` | utility | transform | `prompt: actionDef.prompt` copy in both build functions (lines 75, 112) | exact |
| `src/ui/composables/useActionControllerTypes.ts` | model | transform | `prompt?: string` in UI `ActionMetadata` (line 104) | exact |
| `src/ui/components/helpers/ActionHelpPopover.vue` | component | request-response | `HeatmapOverlay.vue` (Teleport + fixed positioning); `BoardMessage.vue` (caret CSS + animation) | role-match |
| `src/ui/components/auto-ui/ActionPanel.vue` | component | request-response | existing `ActionPanel.vue` (modify in-place) | exact |
| `src/ui/components/ControlsMenu.vue` | component | event-driven | heatmap toggle block (lines 264–277) + emits (line 58) | exact |
| `src/ui/components/GameShell.vue` | component | request-response | `getPlayerName()` localStorage (lines 88–96); `isHeatmapVisibleProp` computed (line 674); `handleTeachingAction` (lines 681–717); ActionPanel wiring (lines 1916–1929) | exact |

---

## Pattern Assignments

### `src/engine/action/types.ts` (model, transform)

**Analog:** `src/engine/action/types.ts` — `prompt?: string` at line 433

**Core pattern — add after `undoable?: boolean` (line 454):**
```typescript
// src/engine/action/types.ts lines 429-455
export interface ActionDefinition {
  name: string;
  /** User-facing prompt */
  prompt?: string;
  selections: Selection[];
  condition?: ConditionConfig;
  execute: (args: Record<string, unknown>, context: ActionContext) => ActionResult | void;
  /**
   * Whether this action can be undone (default: true).
   */
  undoable?: boolean;
  // ADD: mirror `prompt` exactly — display-only, never a predicate
  /** Help text shown to players on hover/tap. Display-only; never a predicate. */
  help?: string;
}
```

---

### `src/engine/action/action-builder.ts` (utility, transform)

**Analog:** `.prompt()` builder method, lines 92–98

**Core pattern — add immediately after `.prompt()` (line 98):**
```typescript
// src/engine/action/action-builder.ts lines 92-98
/**
 * Set the user-facing prompt for this action
 */
prompt(prompt: string): this {
  this.definition.prompt = prompt;
  return this;
}

// ADD: identical shape — same return type, same `this.definition` pattern
/**
 * Set the player-facing help text for this action.
 * Shown in the action help popover on hover/tap.
 * Display-only; never used as a predicate.
 */
help(text: string): this {
  this.definition.help = text;
  return this;
}
```

---

### `src/session/types.ts` (model, transform)

**Analog:** `prompt?: string` in `ActionMetadata` interface, lines 356–360

**Core pattern — add `help` to the existing interface:**
```typescript
// src/session/types.ts lines 353-360
/**
 * Action metadata for auto-UI generation
 */
export interface ActionMetadata {
  name: string;
  prompt?: string;
  help?: string;       // ADD — mirrors prompt exactly
  selections: PickMetadata[];
}
```

Note: `disabledActions?: Record<string, string>` already exists on `PlayerGameState` at line 447 — no change needed there.

---

### `src/session/utils.ts` (utility, transform)

**Analog:** `prompt: actionDef.prompt` copy at line 75 (buildActionMetadata) and line 112 (buildSingleActionMetadata)

**CRITICAL — both functions must be updated in the same commit (see Pitfall 1 in RESEARCH.md).**

**buildActionMetadata — core pattern (lines 73–77):**
```typescript
// src/session/utils.ts lines 73-77
metadata[actionName] = {
  name: actionName,
  prompt: actionDef.prompt,
  help: actionDef.help,       // ADD — same position as prompt, same pattern
  selections: pickMetas,
};
```

**buildSingleActionMetadata — core pattern (lines 111–115):**
```typescript
// src/session/utils.ts lines 111-115
return {
  name: actionName,
  prompt: actionDef.prompt,
  help: actionDef.help,       // ADD — same position as prompt, same pattern
  selections: pickMetas,
};
```

---

### `src/ui/composables/useActionControllerTypes.ts` (model, transform)

**Analog:** `prompt?: string` in UI `ActionMetadata`, lines 102–106

**Core pattern:**
```typescript
// src/ui/composables/useActionControllerTypes.ts lines 102-106
export interface ActionMetadata {
  name: string;
  prompt?: string;
  help?: string;       // ADD — mirrors session/types.ts exactly
  selections: PickMetadata[];
}
```

---

### `src/ui/components/helpers/ActionHelpPopover.vue` (component, request-response) — NEW FILE

**Primary analog:** `src/ui/components/helpers/HeatmapOverlay.vue` (Teleport + getBoundingClientRect + fixed positioning + reduced-motion)
**Secondary analog:** `src/ui/components/helpers/BoardMessage.vue` lines 250–354 (caret CSS border-trick + fade transition + reduced-motion guard)
**Tertiary analog:** `src/ui/components/ControlsMenu.vue` lines 102–118 (outside-click + Escape dismiss pattern)

**Script section — Teleport + positioning (from HeatmapOverlay.vue lines 70–87 and TutorialOverlay.vue):**
```typescript
// From HeatmapOverlay.vue — getBoundingClientRect is the standard fixed-positioning approach
function measure() {
  const el = document.querySelector(selector);
  if (!el) return;
  const rect = el.getBoundingClientRect();
  // compute cx/cy from rect — used for position: fixed + transform: translate(-50%,-50%)
}
```

For ActionHelpPopover, adapt to anchor below the trigger button:
```typescript
function computePosition(triggerEl: HTMLElement) {
  const rect = triggerEl.getBoundingClientRect();
  let top = rect.bottom + 4;
  let left = rect.left;
  // Flip above if too close to viewport bottom
  const POPOVER_ESTIMATED_HEIGHT = 80;
  if (top + POPOVER_ESTIMATED_HEIGHT > window.innerHeight - 8) {
    top = rect.top - POPOVER_ESTIMATED_HEIGHT - 4;
  }
  // Right-edge constraint
  const POPOVER_MAX_WIDTH = 240;
  if (left + POPOVER_MAX_WIDTH > window.innerWidth - 8) {
    left = window.innerWidth - POPOVER_MAX_WIDTH - 8;
  }
  return { top, left };
}
```

**Outside-click + Escape dismiss (from ControlsMenu.vue lines 102–118):**
```typescript
// src/ui/components/ControlsMenu.vue lines 102-118
function handleOutsideClick(event: MouseEvent) {
  const target = event.target as Node;
  const root = menuRoot.value;
  const menu = menuRef.value;
  if (root && !root.contains(target) && (!menu || !menu.contains(target))) {
    close();
  }
}

onMounted(() => {
  document.addEventListener('mousedown', handleOutsideClick);
});
onUnmounted(() => {
  document.removeEventListener('mousedown', handleOutsideClick);
});

// Add Escape key dismiss alongside outside-click:
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close();
}
// Also register/unregister handleKeydown in onMounted/onUnmounted
```

**Template structure — Teleport to body (from HeatmapOverlay.vue lines 241–259):**
```html
<!-- HeatmapOverlay.vue lines 241-259 — the Teleport pattern -->
<Teleport to="body">
  <div
    v-if="hasContent"
    ref="overlayRoot"
    class="bsg-heatmap-overlay"
  >
    <!-- ... -->
  </div>
</Teleport>

<!-- ActionHelpPopover adapts this to a fixed-positioned tooltip: -->
<Teleport to="body">
  <div
    v-if="isOpen"
    :id="`${actionName}-help-tip`"
    role="tooltip"
    aria-live="polite"
    class="action-help-popover"
    :style="popoverStyle"
  >
    <span class="caret" :class="`caret--${caretSide}`" aria-hidden="true"></span>
    <p v-if="helpText" class="help-body">{{ helpText }}</p>
    <hr v-if="helpText && disabledReason" class="help-divider" aria-hidden="true" />
    <template v-if="disabledReason">
      <span class="disabled-label">Why disabled:</span>
      <p class="disabled-body">{{ disabledReason }}</p>
    </template>
  </div>
</Teleport>
```

**Trigger button template (inside ActionPanel, not in this component):**
```html
<button
  type="button"
  class="action-help-btn"
  :aria-label="`Help for ${triggerLabel}`"
  :aria-expanded="isOpen"
  :aria-controls="`${actionName}-help-tip`"
  :aria-describedby="isOpen ? `${actionName}-help-tip` : undefined"
  @click="toggle"
  @mouseenter="show"
  @mouseleave="hide"
>
  <!-- inline SVG: circled question mark — same approach as all existing UI components -->
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
       stroke="currentColor" stroke-width="1.5" aria-hidden="true">
    <circle cx="7" cy="7" r="6"/>
    <path d="M7 9V8.5c0-.5.3-.9.7-1.1C8.3 7 9 6.3 9 5.5a2 2 0 0 0-4 0"
          stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="7" cy="11" r="0.5" fill="currentColor" stroke="none"/>
  </svg>
</button>
```

**Caret CSS (from BoardMessage.vue lines 258–296) — use top/bottom variants only:**
```css
/* src/ui/components/helpers/BoardMessage.vue lines 258-296 */
.bsg-board-message__caret--top {
  top: -8px;
  left: 50%;
  transform: translateX(-50%);
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
  border-bottom: 8px solid var(--bsg-line-2);
}
.bsg-board-message__caret--top::after {
  content: '';
  position: absolute;
  top: 2px;
  left: -7px;
  border-left: 7px solid transparent;
  border-right: 7px solid transparent;
  border-bottom: 7px solid var(--bsg-surface-2);  /* change to var(--bsg-surface-3) for popover */
}
.bsg-board-message__caret--bottom {
  bottom: -8px;
  left: 50%;
  transform: translateX(-50%);
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
  border-top: 8px solid var(--bsg-line-2);
}
.bsg-board-message__caret--bottom::after {
  content: '';
  position: absolute;
  bottom: 2px;
  left: -7px;
  border-left: 7px solid transparent;
  border-right: 7px solid transparent;
  border-top: 7px solid var(--bsg-surface-2);  /* change to var(--bsg-surface-3) for popover */
}
```

Note: BoardMessage uses `--bsg-surface-2`; ActionHelpPopover uses `--bsg-surface-3` per UI-SPEC. Substitute the fill color in `::after`.

**Animation + reduced-motion (from BoardMessage.vue lines 338–354):**
```css
/* src/ui/components/helpers/BoardMessage.vue lines 338-354 */
.bsg-board-message-fade-enter-active,
.bsg-board-message-fade-leave-active {
  transition: opacity var(--bsg-dur-base) var(--bsg-ease);
}
.bsg-board-message-fade-enter-from,
.bsg-board-message-fade-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .bsg-board-message-fade-enter-active,
  .bsg-board-message-fade-leave-active {
    transition: none;
  }
}

/* ActionHelpPopover variant adds transform — same reduced-motion guard applies: */
.popover-enter-active,
.popover-leave-active {
  transition: opacity var(--bsg-dur-fast) var(--bsg-ease),
              transform var(--bsg-dur-fast) var(--bsg-ease);
}
.popover-enter-from,
.popover-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}
@media (prefers-reduced-motion: reduce) {
  .popover-enter-active,
  .popover-leave-active { transition: none; }
}
```

**Security note:** Text content MUST use Vue text interpolation (`{{ helpText }}`), never `v-html`. This matches TutorialOverlay T-105-05 rule.

---

### `src/ui/components/auto-ui/ActionPanel.vue` (component, request-response)

**Analog:** existing `ActionPanel.vue` (modify in-place)

**New props — add to `defineProps` (lines 46–67):**
```typescript
// src/ui/components/auto-ui/ActionPanel.vue lines 46-67
const props = defineProps<{
  availableActions: string[];
  actionMetadata?: Record<string, ActionMetadata>;
  playerSeat: number;
  isMyTurn: boolean;
  canUndo?: boolean;
  autoEndTurn?: boolean;
  messages?: Array<{ text: string }>;
  currentPlayerName?: string;
  currentPlayerColor?: string;
  awaitingPlayers?: Array<{ seat: number; name: string; color?: string }>;
  // ADD:
  /** Global action-help visibility — driven by localStorage toggle in GameShell */
  isActionHelpVisible?: boolean;
  /** Per-action disabled reasons from PlayerGameState.disabledActions */
  disabledActions?: Record<string, string>;
}>();
```

**Template change — `.action-btn-group` wrapper (replaces bare `<button>` loop at lines 790–810):**

Currently (lines 790–810):
```html
<!-- src/ui/components/auto-ui/ActionPanel.vue lines 790-810 -->
<div v-if="!currentAction" class="action-buttons" :key="availableActions.join(',')">
  <button
    v-for="action in visibleActions"
    :key="action.name"
    class="action-btn"
    :data-bs-action="action.name"
    @click="startAction(action.name)"
    :disabled="isExecuting"
  >
    {{ action.prompt || formatActionName(action.name) }}
  </button>
  <button v-if="canUndo" class="action-btn undo-btn" @click="emit('undo')" :disabled="isExecuting">
    Undo
  </button>
</div>
```

Replace the inner `<button v-for>` with a `.action-btn-group` wrapper:
```html
<div v-if="!currentAction" class="action-buttons" :key="availableActions.join(',')">
  <div
    v-for="action in visibleActions"
    :key="action.name"
    class="action-btn-group"
  >
    <button
      class="action-btn"
      :data-bs-action="action.name"
      @click="startAction(action.name)"
      :disabled="isExecuting"
    >
      {{ action.prompt || formatActionName(action.name) }}
    </button>
    <!-- "?" affordance: shown when toggle ON and content exists -->
    <ActionHelpPopover
      v-if="isActionHelpVisible && (action.help || disabledActions?.[action.name])"
      :action-name="action.name"
      :help-text="action.help"
      :disabled-reason="disabledActions?.[action.name]"
      :trigger-label="action.prompt || formatActionName(action.name)"
    />
  </div>
  <button v-if="canUndo" class="action-btn undo-btn" @click="emit('undo')" :disabled="isExecuting">
    Undo
  </button>
</div>
```

**New CSS for `.action-btn-group` — mirrors `.action-buttons { display: contents }` but wraps the group:**
```css
/* Add after the .action-buttons block at line 1140 */
/* Positioning context for "?" affordance; inline-flex becomes a dock flex item
   (because .action-buttons { display: contents } propagates the parent flex context). */
.action-btn-group {
  display: inline-flex;
  align-items: stretch;
  position: relative;
}

/* "?" affordance button */
.action-help-btn {
  position: absolute;
  top: 0;
  right: 0;
  /* 24x24px minimum tap target (WCAG 2.2 SC 2.5.8) */
  min-width: 24px;
  min-height: 24px;
  padding: 4px 5px;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--bsg-ink-3);
  line-height: 1;
}
.action-help-btn:hover {
  color: var(--bsg-ink-2);
}
.action-help-btn[aria-expanded="true"] {
  color: var(--bsg-accent);
}
```

**Import line to add at top of script section:**
```typescript
import ActionHelpPopover from '../helpers/ActionHelpPopover.vue';
```

---

### `src/ui/components/ControlsMenu.vue` (component, event-driven)

**Analog:** heatmap toggle block, lines 264–277; emits definition, line 47–58

**New prop — add to `defineProps` (lines 19–45):**
```typescript
// src/ui/components/ControlsMenu.vue lines 40-45
/** Whether the move quality heatmap overlay is currently visible (drives aria-checked). */
isHeatmapVisible?: boolean;
// ADD:
/** Whether action help affordances are currently visible (drives aria-checked). */
isActionHelpVisible?: boolean;
```

**Extend emit union (line 58) — add 'help-toggle' to the union:**
```typescript
// src/ui/components/ControlsMenu.vue line 47-58
const emit = defineEmits<{
  'update:autoEndTurn': [value: boolean];
  'update:zoom': [value: number];
  'undo': [];
  'menu-item-click': [id: string];
  'teaching-action': [action: 'hint' | 'demo-toggle' | 'heatmap-toggle' | 'help-toggle'];
  //                                                                         ^^ ADD
}>();
```

**New toggle in Play group — insert after "Auto end turn" row (after line 176), before "Undo" (line 178). Mirror heatmap toggle exactly:**
```html
<!-- src/ui/components/ControlsMenu.vue lines 264-277 (heatmap toggle — blueprint) -->
<button
  class="mi"
  type="button"
  role="menuitemcheckbox"
  :aria-checked="isHeatmapVisible"
  @click="emit('teaching-action', 'heatmap-toggle')"
>
  <svg viewBox="0 0 24 24" aria-hidden="true">...</svg>
  Show move quality
  <span class="r">
    <span class="toggle" :class="{ on: isHeatmapVisible }"></span>
  </span>
</button>

<!-- NEW: Show action help — identical structure, placed in Play group -->
<button
  class="mi"
  type="button"
  role="menuitemcheckbox"
  :aria-checked="isActionHelpVisible"
  @click="emit('teaching-action', 'help-toggle')"
>
  <!-- inline SVG: circled question mark, 24x24 viewBox -->
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9"/>
    <path d="M12 16v-.5c0-.8.5-1.5 1.2-1.8C14.4 13.2 15 12 15 10.5a3 3 0 0 0-6 0"
          stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="12" cy="18.5" r="0.75" fill="currentColor" stroke="none"/>
  </svg>
  Show action help
  <span class="r">
    <span class="toggle" :class="{ on: isActionHelpVisible }"></span>
  </span>
</button>
```

**IMPORTANT placement:** This toggle goes in the **Play group** (always visible), NOT inside `<template v-if="showHint !== undefined">` (the Teaching group). See RESEARCH.md Pitfall 6.

The `.toggle` / `.toggle.on` CSS (lines 400–427) is inherited unchanged — no new styles needed for the pill.

---

### `src/ui/components/GameShell.vue` (component, request-response)

**Analogs:**
- localStorage pattern: `getPlayerName()` / `setPlayerName()` at lines 88–96
- Computed from broadcast state: `isHeatmapVisibleProp` at line 674
- Teaching action handler: `handleTeachingAction` at lines 681–717
- ActionPanel prop wiring: lines 1916–1929
- Slot props threading: `#game-board` slot at lines 1828–1847

**1. localStorage helpers — add near existing player-name helpers (lines 88–96):**
```typescript
// src/ui/components/GameShell.vue lines 88-96 (existing pattern to mirror)
function getPlayerName(): string | null {
  const KEY = 'boardsmith_player_name';
  return localStorage.getItem(KEY);
}
function setPlayerName(name: string): void {
  const KEY = 'boardsmith_player_name';
  localStorage.setItem(KEY, name);
}

// ADD: same pattern, boolean value, default ON when absent
function getActionHelpEnabled(): boolean {
  try {
    const stored = localStorage.getItem('boardsmith_action_help');
    return stored === null ? true : stored === 'true';
  } catch {
    return true; // SSR / private-browsing fallback
  }
}
function setActionHelpEnabled(value: boolean): void {
  try {
    localStorage.setItem('boardsmith_action_help', String(value));
  } catch { /* ignore */ }
}
```

**2. Reactive ref — add near existing refs in the component setup:**
```typescript
// Mirrors pattern of other local refs; initialized from localStorage
const isActionHelpVisible = ref(getActionHelpEnabled());
```

**3. `disabledActions` computed — add near `actionMetadata` computed (line 324):**
```typescript
// src/ui/components/GameShell.vue lines 324-326 (actionMetadata computed — pattern to mirror)
const actionMetadata = computed(() => {
  return state.value?.state?.actionMetadata as Record<string, ActionMetadata> | undefined;
});

// ADD: same shape — cast from PlayerGameState.disabledActions
const disabledActions = computed(() => {
  return (state.value?.state as any)?.disabledActions as Record<string, string> | undefined;
});
```

**4. `handleTeachingAction` extension (lines 681–717) — extend union, add branch:**
```typescript
// src/ui/components/GameShell.vue lines 681-717 (existing function)
async function handleTeachingAction(
  teachAction: 'hint' | 'demo-toggle' | 'heatmap-toggle' | 'help-toggle'
  //                                                         ^^ ADD to union
) {
  if (teachAction === 'hint') { /* unchanged */ }
  else if (teachAction === 'demo-toggle') { /* unchanged */ }
  else if (teachAction === 'heatmap-toggle') { /* unchanged */ }
  else if (teachAction === 'help-toggle') {
    // Pure client toggle — no platformRequest (client display preference only)
    isActionHelpVisible.value = !isActionHelpVisible.value;
    setActionHelpEnabled(isActionHelpVisible.value);
  }
}
```

**5. ControlsMenu wiring — add new prop (lines 1871–1885):**
```html
<!-- src/ui/components/GameShell.vue lines 1871-1885 (existing ControlsMenu usage) -->
<ControlsMenu
  class="actionbar-controls"
  open-up
  align="left"
  v-model:auto-end-turn="autoEndTurn"
  v-model:zoom="zoomLevel"
  :can-undo="canUndo && !isViewingHistory"
  :show-hint="showHintProp"
  :hint-disabled="hintDisabledProp"
  :is-demo-running="isDemoRunning"
  :is-heatmap-visible="isHeatmapVisibleProp"
  :is-action-help-visible="isActionHelpVisible"
  @undo="handleUndo"
  @menu-item-click="handleMenuItemClick"
  @teaching-action="handleTeachingAction"
/>
```

**6. ActionPanel wiring — add two new props (lines 1916–1929):**
```html
<!-- src/ui/components/GameShell.vue lines 1916-1929 (existing ActionPanel usage) -->
<ActionPanel
  :available-actions="isViewingHistory ? [] : availableActions"
  :action-metadata="isViewingHistory ? {} : actionMetadata"
  :is-action-help-visible="isActionHelpVisible"
  :disabled-actions="isViewingHistory ? undefined : disabledActions"
  :players="players"
  :player-seat="playerSeat"
  :is-my-turn="isMyTurn && !isViewingHistory"
  :can-undo="canUndo && !isViewingHistory"
  :auto-end-turn="autoEndTurn"
  :messages="gameMessages"
  :current-player-name="currentPlayerName"
  :current-player-color="currentPlayerColor"
  :awaiting-players="awaitingPlayerNames"
  @undo="handleUndo"
/>
```

**7. `#game-board` slot props — add `isActionHelpVisible` (lines 1828–1847):**
```html
<!-- src/ui/components/GameShell.vue lines 1828-1847 -->
<slot
  name="game-board"
  :state="state"
  :game-view="gameView"
  :players="players"
  :my-player="myPlayer"
  :player-seat="playerSeat"
  :is-my-turn="isMyTurn"
  :available-actions="availableActions"
  :action-args="actionArgs"
  :set-board-prompt="setBoardPrompt"
  :can-undo="canUndo && !isViewingHistory"
  :undo="handleUndo"
  :action-controller="actionController"
  :is-action-help-visible="isActionHelpVisible"
>
  <!-- ... -->
</slot>
```

Also add `:is-action-help-visible="isActionHelpVisible"` to the `<component :is="selectedUiComponent">` block (lines 1810–1827) for dev UI-switcher parity.

---

## Shared Patterns

### Teleport to Body (fixed positioning)
**Source:** `src/ui/components/helpers/HeatmapOverlay.vue` lines 241–259 and `src/ui/components/ControlsMenu.vue` lines 159–280
**Apply to:** `ActionHelpPopover.vue`

All overlays and popover-style elements Teleport to `<body>` with `position: fixed` to escape `.boardregion` / `.actionbar` overflow clipping. Never use `position: absolute` inside the dock.

```html
<!-- Pattern: HeatmapOverlay.vue lines 241-247 -->
<Teleport to="body">
  <div
    v-if="hasContent"
    ref="overlayRoot"
    class="bsg-heatmap-overlay"
  >
```

### Reduced-Motion Guard
**Source:** `src/ui/components/helpers/BoardMessage.vue` lines 349–354; `src/ui/components/helpers/HeatmapOverlay.vue` lines 283–287
**Apply to:** `ActionHelpPopover.vue`

```css
/* BoardMessage.vue lines 349-354 */
@media (prefers-reduced-motion: reduce) {
  .bsg-board-message-fade-enter-active,
  .bsg-board-message-fade-leave-active {
    transition: none;
  }
}

/* HeatmapOverlay.vue lines 282-287 */
@media (prefers-reduced-motion: reduce) {
  .bsg-heatmap-overlay > * {
    animation: none !important;
  }
}
```

### `menuitemcheckbox` Toggle Pill
**Source:** `src/ui/components/ControlsMenu.vue` lines 163–176 (auto-end-turn) and 264–277 (heatmap)
**Apply to:** "Show action help" button in `ControlsMenu.vue`

```html
<!-- ControlsMenu.vue lines 163-176 — exact template to mirror -->
<button
  class="mi"
  type="button"
  role="menuitemcheckbox"
  :aria-checked="autoEndTurn"
  @click="emit('update:autoEndTurn', !autoEndTurn)"
>
  <!-- inline SVG -->
  Auto end turn
  <span class="r">
    <span class="toggle" :class="{ on: autoEndTurn }"></span>
  </span>
</button>
```

Toggle pill CSS (lines 400–427) is unchanged — `.toggle` / `.toggle.on` work as-is.

### `localStorage` Boolean Preference
**Source:** `src/ui/components/GameShell.vue` lines 88–96
**Apply to:** `isActionHelpVisible` persistence in `GameShell.vue`

```typescript
// GameShell.vue lines 88-96 — the pattern to mirror
function getPlayerName(): string | null {
  const KEY = 'boardsmith_player_name';
  return localStorage.getItem(KEY);
}
function setPlayerName(name: string): void {
  const KEY = 'boardsmith_player_name';
  localStorage.setItem(KEY, name);
}
```

Wrap in try/catch (unlike player-name) because the toggle has a meaningful default (ON) and must degrade gracefully in private browsing.

### Vue Text Interpolation — No `v-html`
**Source:** `src/ui/components/helpers/TutorialOverlay.vue` (T-105-05 rule), `src/ui/components/helpers/BoardMessage.vue` (narration variant)
**Apply to:** `ActionHelpPopover.vue` help text and disabled reason rendering

Always `{{ helpText }}`, never `v-html`. Help text is author-supplied string — treat same as annotation text (T-105-05).

### Conditional `aria-describedby`
**Source:** RESEARCH.md Pitfall 3
**Apply to:** trigger button in `ActionHelpPopover.vue`

```html
<!-- Only apply aria-describedby when the popover is mounted -->
:aria-describedby="isOpen ? `${actionName}-help-tip` : undefined"
```

---

## No Analog Found

All files have close analogs. No entries in this section.

---

## Metadata

**Analog search scope:** `src/engine/action/`, `src/session/`, `src/ui/components/`, `src/ui/components/helpers/`, `src/ui/components/auto-ui/`, `src/ui/composables/`
**Files read:** 10 source files (types.ts × 2, action-builder.ts, utils.ts, useActionControllerTypes.ts, ActionPanel.vue, ControlsMenu.vue, GameShell.vue, HeatmapOverlay.vue, BoardMessage.vue, TutorialOverlay.vue)
**Pattern extraction date:** 2026-06-26
