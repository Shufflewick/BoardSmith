# Phase 108: Lightweight Action Help — Research

**Researched:** 2026-06-26
**Domain:** Vue 3 component authoring, action metadata propagation, popover/tooltip positioning, localStorage persistence
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- `help?: string` on `ActionDefinition` + `.help(text)` builder method, mirroring `.prompt()`. Display-only, never a predicate.
- Propagate help through `buildActionMetadata()` → `ActionMetadata.help?` (session/types.ts) → `useActionControllerTypes.ActionMetadata.help?` (UI composable). AutoUI reads `action.help`; custom UI reads `actionController.getActionMetadata(name)?.help`.
- Plain string content model. One help text per action. No per-selection help this phase.
- Custom help popover/tooltip (no native `:title`), one reveal path for pointer hover, touch tap, and global toggle.
- Touch reveal: explicit "?" affordance button on the action button. Long-press stays reserved for `useZoomPreview` card zoom.
- Popover with `role="tooltip"` + `aria-describedby`; dismiss on outside tap / Escape; keyboard via "?" button focus. WCAG 2.2 AA, v4.0 Slate tokens.
- Global toggle in ControlsMenu as "Show action help" pill, `menuitemcheckbox` pattern, Phase 107 heatmap toggle is the exact blueprint.
- Persist via localStorage key `boardsmith_action_help`. Default ON. Global (not per-game).
- Wire the currently-dead `disabledActions` field: render per-action disabled reason on disabled buttons via the same popover surface.
- Parity: help text + disabled reason tested in both AutoUI and custom-UI fixture, mirroring Phase 105/107.
- Scope: substrate + AutoUI rendering here. Checkers help text → Phase 109. Browser confirmation → Phase 110.
- Vitest: engine unit, `buildActionMetadata` integration, ActionPanel reveal + toggle + parity component tests.

### Claude's Discretion

- Exact "?" glyph/placement, `ActionHelpPopover` component file name and positioning approach (reuse overlay/anchor patterns from TutorialOverlay/HeatmapOverlay where sensible), and whether the popover is a new small component vs. extension of an existing helper — consistent with v4.0 Slate + existing patterns. Reveal must route through `actionMetadata` (parity), set in ONE shared place.

### Deferred Ideas (OUT OF SCOPE)

- Per-selection (choice/element) help text.
- Markdown/rich help content.
- Checkers-specific help text authoring (Phase 109).
- Browser end-to-end visual confirmation (Phase 110).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HELP-01 | A game author can attach help text to each action; a player can reveal it on hover (pointer) or tap (touch). | Engine field + builder method; propagation chain; ActionHelpPopover component; "?" affordance in ActionPanel template. |
| HELP-02 | A player can toggle action help text on or off globally. | ControlsMenu toggle prop/emit; GameShell localStorage read/write; `isActionHelpVisible` ref wired to ActionPanel. |
</phase_requirements>

---

## Summary

Phase 108 threads a single new string field (`help?: string`) through four layers — engine `ActionDefinition`, session `ActionMetadata`, UI `ActionMetadata`, and ActionPanel — then surfaces it via a new `ActionHelpPopover` component and a global toggle. Every layer already has a `prompt?: string` field to mirror, and every propagation hop has been read and confirmed. The only structural change of substance is wrapping ActionPanel action buttons in `.action-btn-group` to host the "?" affordance, which is safe because `.action-buttons { display: contents }` already flattens its children into the dock flex flow.

The second deliverable — wiring the dead `disabledActions` field — requires only passing it as a prop to ActionPanel (same pattern as `action-metadata`) and rendering it inside the same popover. The data already flows from server to `state.value.state.disabledActions` in GameShell; it just never reaches the template.

The `isActionHelpVisible` flag lives as a local `ref` in GameShell (initialized from localStorage), propagated as a prop to ControlsMenu and ActionPanel, toggled by the `help-toggle` branch in the existing `handleTeachingAction` function — no platform request needed because it is a pure client display preference.

**Primary recommendation:** Implement in strict bottom-up order — engine field, builder, session propagation, session type, UI type, then component — so each wave's tests lock in the contract before the next wave builds on it.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `help` authoring API | Engine (ActionDefinition + builder) | — | Action definitions live in the engine; display-only metadata belongs alongside `prompt` |
| `help` propagation | Session (buildActionMetadata) | — | Session is the bridge between engine state and broadcast; all per-action metadata is already assembled here |
| Global toggle persistence | UI/Client (localStorage in GameShell) | — | Client display preference; no server round-trip, no game-state involvement |
| Popover rendering | UI component (ActionHelpPopover) | — | Pure view layer; reads pre-propagated metadata from props |
| `disabledActions` surfacing | UI/Client (ActionPanel prop) | Session (already populates field) | Data already exists on broadcast; gap is UI-layer prop threading and rendering |
| A11y/WCAG compliance | UI component | — | `role="tooltip"`, `aria-describedby`, reduced-motion all live in the component |

---

## Standard Stack

### Core — No New Dependencies

This phase adds zero third-party packages. All capabilities are satisfied by existing project primitives.

| Primitive | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| Vue 3 `<Teleport>` | Bundled with Vue 3 | Escape `.actionbar` overflow; fixed positioning | Established pattern — TutorialOverlay, HintOverlay, HeatmapOverlay, ControlsMenu all use it |
| `getBoundingClientRect()` | Browser API | Compute viewport-fixed popover anchor position | Used by HeatmapOverlay and TutorialOverlay for the same purpose |
| `localStorage` | Browser API | Persist global toggle | Used for `boardsmith_player_name` and `boardsmith_player_id` already |
| `document.addEventListener('mousedown', …)` | Browser API | Outside-click dismiss | Established pattern in ControlsMenu |
| `v-if` / CSS `display:none` | Vue 3 / CSS | Conditional render for toggle-off state | Used throughout; `v-if` preferred for full removal, `display:none` for "?" affordance when toggle is off |

### Package Legitimacy Audit

No external packages are introduced. This section is not applicable.

---

## Architecture Patterns

### System Architecture Diagram

```
Game author                            Player (browser)
    |                                        |
    | Action.create('move').help('…')        | hover / tap "?"
    |                                        |
[Engine: ActionDefinition.help]        [ActionHelpPopover]
    |                                        | reads
[Session: buildActionMetadata()]       [ActionPanel props]
    | copies help                            |
[PlayerGameState.actionMetadata]  ------> [GameShell computed: actionMetadata]
[PlayerGameState.disabledActions] ------> [GameShell computed: disabledActions]
    |                                        |
    |                               [ActionPanel]
    |                                 | help  | disabledActions
    |                               [ActionHelpPopover] <--> [ControlsMenu toggle]
    |                                                               |
    |                                                     [localStorage: boardsmith_action_help]
    |
    | (custom UI path)
    +-> actionController.getActionMetadata(name)?.help
        + state.value.state.disabledActions[name]
        -> [ActionHelpPopover] (same shared component)
```

### Recommended Project Structure

```
src/
├── engine/action/
│   ├── types.ts                  # Add help?: string to ActionDefinition
│   └── action-builder.ts         # Add .help(text) method
├── session/
│   ├── types.ts                  # Add help?: string to ActionMetadata
│   └── utils.ts                  # buildActionMetadata + buildSingleActionMetadata copy help
├── ui/
│   ├── composables/
│   │   └── useActionControllerTypes.ts   # Add help?: string to ActionMetadata
│   └── components/
│       ├── helpers/
│       │   └── ActionHelpPopover.vue     # NEW — shared by both UI paths
│       ├── auto-ui/
│       │   └── ActionPanel.vue           # New prop + .action-btn-group wrapper + "?" affordance
│       ├── ControlsMenu.vue              # New prop + emit union extension
│       └── GameShell.vue                 # localStorage init, isActionHelpVisible ref, wiring
```

### Pattern 1: Propagation Hop (mirrors prompt)

At each layer, `help` is optional and copies verbatim. The source of truth is `ActionDefinition.help`.

**Engine type** (`src/engine/action/types.ts`, after line 454 `undoable?: boolean`):
```typescript
// [VERIFIED: codebase read] ActionDefinition interface, line 429-455
/** Help text shown to players on hover/tap. Display-only; never a predicate. */
help?: string;
```

**Builder method** (`src/engine/action/action-builder.ts`, after `.prompt()` at line 95-98):
```typescript
// [VERIFIED: codebase read] mirrors prompt() at line 95
/**
 * Set the player-facing help text for this action.
 * Shown in the action help popover on hover/tap.
 */
help(text: string): this {
  this.definition.help = text;
  return this;
}
```

**Session `buildActionMetadata`** (`src/session/utils.ts`, lines 73-77):
```typescript
// [VERIFIED: codebase read] — add help to the object literal
metadata[actionName] = {
  name: actionName,
  prompt: actionDef.prompt,
  help: actionDef.help,       // ADD
  selections: pickMetas,
};
```

**Session `buildSingleActionMetadata`** (`src/session/utils.ts`, lines 111-115):
```typescript
// [VERIFIED: codebase read] — must also copy help (used for followUp actions)
return {
  name: actionName,
  prompt: actionDef.prompt,
  help: actionDef.help,       // ADD
  selections: pickMetas,
};
```

**Session `ActionMetadata`** (`src/session/types.ts`, lines 356-360):
```typescript
// [VERIFIED: codebase read]
export interface ActionMetadata {
  name: string;
  prompt?: string;
  help?: string;              // ADD
  selections: PickMetadata[];
}
```

**UI `ActionMetadata`** (`src/ui/composables/useActionControllerTypes.ts`, lines 102-106):
```typescript
// [VERIFIED: codebase read]
export interface ActionMetadata {
  name: string;
  prompt?: string;
  help?: string;              // ADD
  selections: PickMetadata[];
}
```

### Pattern 2: ActionPanel — `.action-btn-group` Wrapper

**Context:** `.action-buttons { display: contents }` (ActionPanel.vue line ~1143). This means `.action-buttons` itself generates no box; its children are direct flex items in the dock. A `.action-btn-group { display: inline-flex }` wrapper therefore becomes a dock flex item, which is correct behavior.

```html
<!-- [VERIFIED: codebase read] lines 790-810 — wrap each action in .action-btn-group -->
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
    <!-- "?" affordance: shown when toggle ON and (help text OR disabled reason) exists -->
    <ActionHelpPopover
      v-if="isActionHelpVisible && (action.help || disabledActions?.[action.name])"
      :action-name="action.name"
      :help-text="action.help"
      :disabled-reason="disabledActions?.[action.name]"
      :trigger-label="`Help for ${action.prompt || formatActionName(action.name)}`"
    />
  </div>
  <!-- Undo button — no help affordance -->
  <button v-if="canUndo" class="action-btn undo-btn" @click="emit('undo')" :disabled="isExecuting">
    Undo
  </button>
</div>
```

**New props for ActionPanel:**
```typescript
// [VERIFIED: codebase read] ActionPanel defineProps, line 46-67
const props = defineProps<{
  // … existing props …
  /** Global action-help visibility — driven by localStorage toggle */
  isActionHelpVisible?: boolean;
  /** Per-action disabled reasons from PlayerGameState.disabledActions */
  disabledActions?: Record<string, string>;
}>();
```

### Pattern 3: ActionHelpPopover Component

Key positioning logic (mirrors HeatmapOverlay/TutorialOverlay pattern):

```typescript
// [VERIFIED: codebase read] HeatmapOverlay uses same getBoundingClientRect + Teleport pattern
function computePosition(triggerEl: HTMLElement) {
  const rect = triggerEl.getBoundingClientRect();
  let top = rect.bottom + 4; // 4px gap below trigger
  let left = rect.left;

  // Flip above if too close to viewport bottom
  const FLIP_THRESHOLD = 8; // var(--bsg-s1) * 2
  const POPOVER_ESTIMATED_HEIGHT = 80;
  if (top + POPOVER_ESTIMATED_HEIGHT > window.innerHeight - FLIP_THRESHOLD) {
    top = rect.top - POPOVER_ESTIMATED_HEIGHT - 4;
    // flip caret direction
  }

  // Right-edge constraint
  const POPOVER_MAX_WIDTH = 240;
  if (left + POPOVER_MAX_WIDTH > window.innerWidth - 8) {
    left = window.innerWidth - POPOVER_MAX_WIDTH - 8;
  }

  return { top, left };
}
```

**Outside-click dismiss** (mirrors ControlsMenu.vue:102-118):
```typescript
// [VERIFIED: codebase read] ControlsMenu uses mousedown on document
onMounted(() => {
  document.addEventListener('mousedown', handleOutsideClick);
  document.addEventListener('keydown', handleKeydown);
});
onUnmounted(() => {
  document.removeEventListener('mousedown', handleOutsideClick);
  document.removeEventListener('keydown', handleKeydown);
});

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close();
}
```

**Accessibility:**
```html
<!-- trigger button on .action-help-btn -->
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
  <!-- inline SVG -->
</button>

<!-- popover (Teleported to body) -->
<Teleport to="body">
  <div
    v-if="isOpen"
    :id="`${actionName}-help-tip`"
    role="tooltip"
    aria-live="polite"
    class="action-help-popover"
    :style="popoverStyle"
  >
    <!-- content -->
  </div>
</Teleport>
```

### Pattern 4: GameShell localStorage + ControlsMenu Wiring

**`isActionHelpVisible` in GameShell** (mirrors `isHeatmapVisibleProp` at line 674, but client-side rather than from broadcast):

```typescript
// [VERIFIED: codebase read] localStorage pattern from GameShell.vue:88-96
function getActionHelpEnabled(): boolean {
  try {
    const stored = localStorage.getItem('boardsmith_action_help');
    return stored === null ? true : stored === 'true';
  } catch {
    return true; // SSR / private browsing fallback
  }
}

function setActionHelpEnabled(value: boolean): void {
  try {
    localStorage.setItem('boardsmith_action_help', String(value));
  } catch { /* ignore */ }
}

// Reactive ref — initialized once, then toggled by handleTeachingAction
const isActionHelpVisible = ref(getActionHelpEnabled());
```

**`handleTeachingAction` extension** (GameShell.vue line 681-717):
```typescript
// [VERIFIED: codebase read] current signature — extend union and add branch
async function handleTeachingAction(
  teachAction: 'hint' | 'demo-toggle' | 'heatmap-toggle' | 'help-toggle'  // extend
) {
  // … existing branches …
  if (teachAction === 'help-toggle') {
    // Pure client toggle — no platformRequest
    isActionHelpVisible.value = !isActionHelpVisible.value;
    setActionHelpEnabled(isActionHelpVisible.value);
  }
}
```

**ControlsMenu prop + emit** (`ControlsMenu.vue`):
```typescript
// [VERIFIED: codebase read] lines 19-59
// Add to props:
isActionHelpVisible?: boolean;

// Extend emit union (line 58):
'teaching-action': [action: 'hint' | 'demo-toggle' | 'heatmap-toggle' | 'help-toggle'];
```

**ActionPanel wiring in GameShell template** (line 1916-1929):
```html
<!-- Add two new props -->
<ActionPanel
  :available-actions="isViewingHistory ? [] : availableActions"
  :action-metadata="isViewingHistory ? {} : actionMetadata"
  :is-action-help-visible="isActionHelpVisible"
  :disabled-actions="isViewingHistory ? undefined : (state?.state as any)?.disabledActions"
  <!-- … rest unchanged … -->
/>
```

### Anti-Patterns to Avoid

- **Hand-rolling position: absolute inside the dock:** The dock (`.actionbar`) clips anything that overflows. Always Teleport the popover to `<body>` and use `position: fixed`. This is already proven by ControlsMenu, TutorialOverlay, HeatmapOverlay.
- **Using `:title` for touch:** Native tooltips are invisible on touch devices. The UI-SPEC decision is explicit: the "?" affordance is the touch mechanism.
- **Long-press for "?" reveal:** `useZoomPreview` owns 400ms touchstart long-press on card/element surfaces. The "?" is a separate `<button>` and uses explicit `@click`, so there is no conflict — but do not add touchstart long-press to `.action-help-btn`.
- **Storing toggle in broadcast/session state:** The heatmap toggle goes to the server because the server must supply heatmap data. Action help is pure display — no server round-trip. Only write to localStorage.
- **Setting `aria-describedby` when popover is not mounted:** If the popover ID doesn't exist in the DOM, the `aria-describedby` reference is dangling. Conditionally apply it only when `isOpen === true`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Overflow-clipped popover | DOM-relative position inside dock | `<Teleport to="body">` + `position:fixed` | The dock clips absolutely-positioned children. All existing overlays use Teleport for this reason. |
| Focus trap in tooltip | Custom focus management | None — `role="tooltip"` does not take focus | Tooltips are not dialogs. `aria-describedby` is the a11y contract; the trigger keeps focus. |
| Outside-click detection | Complex event delegation | `document.addEventListener('mousedown', ...)` in onMounted/onUnmounted | ControlsMenu already proves this pattern at line 102-118. |
| Keyboard dismiss | Custom key listener per-component | Same `document.addEventListener('keydown', ...)` checking `e.key === 'Escape'` | One shared handler per component instance, cleaned up in onUnmounted. |
| localStorage reactivity | Vuex/Pinia | Plain `ref` + `localStorage.getItem/setItem` | The existing pattern for `boardsmith_player_name` and `boardsmith_player_id` — consistent, zero dependencies. |

---

## Common Pitfalls

### Pitfall 1: `buildSingleActionMetadata` Missing `help`

**What goes wrong:** FollowUp actions use `buildSingleActionMetadata` (not `buildActionMetadata`). If `help` is only copied in `buildActionMetadata`, help text silently disappears for followUp actions.

**Why it happens:** `buildSingleActionMetadata` (utils.ts:90-116) is a separate code path that returns `{ name, prompt, selections }` — it mirrors `buildActionMetadata` but is easy to miss.

**How to avoid:** Update both functions in the same commit. The unit test for propagation should cover both paths.

**Warning signs:** Help text works for initial actions but disappears after a followUp action starts.

### Pitfall 2: localStorage Access in jsdom Tests

**What goes wrong:** `localStorage.getItem(...)` works in jsdom but the store persists between tests within a vitest `describe` block. A test that sets `boardsmith_action_help = 'false'` can poison subsequent tests that expect the default (ON) behavior.

**Why it happens:** jsdom provides a shared `localStorage` object across the test file. Unlike a real browser session, it is not cleared between tests automatically.

**How to avoid:** Add `beforeEach(() => localStorage.clear())` to any test file that exercises the localStorage toggle. Alternatively, spy on `localStorage.getItem` with `vi.spyOn`.

**Warning signs:** Test order dependency — tests pass in isolation but fail when run together.

### Pitfall 3: `aria-describedby` Points to Non-Existent ID

**What goes wrong:** The trigger button sets `aria-describedby="{name}-help-tip"` unconditionally. When the popover is hidden (`v-if="false"`), the referenced ID doesn't exist in the DOM, which is invalid ARIA.

**Why it happens:** Developers often copy `aria-describedby` from the open-state template without making it conditional.

**How to avoid:** Bind `aria-describedby` conditionally:
```html
:aria-describedby="isOpen ? `${actionName}-help-tip` : undefined"
```

**Warning signs:** AXE accessibility audit reports "aria-describedby attribute does not point to an element in the document."

### Pitfall 4: Popover Position Stale After Scroll or Resize

**What goes wrong:** `getBoundingClientRect()` is called once on open. If the dock scrolls (touch devices can scroll the action bar) or the viewport resizes, the popover floats off its trigger.

**Why it happens:** Fixed positioning is computed once; it doesn't track the trigger element.

**How to avoid:** Since the UI-SPEC specifies dismiss-on-mouseleave (pointer) and toggle-on-tap (touch), the popover lifetime is short and scroll-stale positions are acceptable. Do NOT add a ResizeObserver or scroll listener — the HeatmapOverlay pattern also accepts this trade-off.

**Warning signs:** Popover appears at wrong location on device rotation. Acceptable for this phase.

### Pitfall 5: `.action-btn-group` Breaks Dock Layout

**What goes wrong:** If `.action-btn-group` uses `display: block` or `display: flex` without proper width constraints, it can break the dock's wrapping behavior or cause action buttons to change size.

**Why it happens:** `.action-buttons { display: contents }` flattens children into the dock flow. The new `.action-btn-group { display: inline-flex }` becomes a flex item, and its flex layout must preserve the existing action button dimensions.

**How to avoid:** Use `display: inline-flex; align-items: stretch` with no `width` or `flex-grow`. The `.action-btn` inside should retain its existing sizing rules (min-width, padding). Add the "?" button as a positioned element (`position: absolute; top: 0; right: 0`) within the `position: relative` group wrapper so it does not affect the group's intrinsic width.

**Warning signs:** Action buttons change size or the dock layout wraps differently after the change. Verify in the go-fish dev host (multiple actions visible simultaneously) and the checkers dev host.

### Pitfall 6: Teaching Group Gating Hides Help Toggle

**What goes wrong:** The ControlsMenu "Teaching" group (`<template v-if="showHint !== undefined">`) currently gates all teaching controls. The "Show action help" toggle must be visible even when no AI player is present (`showHint === undefined`).

**Why it happens:** The heatmap toggle (Phase 107) lives inside the Teaching group. If the help toggle is placed inside the same `<template>`, it will be hidden for non-AI games.

**How to avoid:** Place the "Show action help" toggle in the **Play group** (alongside "Auto end turn" and "Undo last action") — always visible, not gated by `showHint`. The UI-SPEC confirms this placement.

**Warning signs:** Help toggle is not visible in go-fish or hex (non-AI games).

---

## Code Examples

### Reading `disabledActions` in GameShell

```typescript
// [VERIFIED: codebase read] GameShell.vue line 324-326 — same pattern for disabledActions
const disabledActions = computed(() => {
  return (state.value?.state as any)?.disabledActions as Record<string, string> | undefined;
});
```

### Caret CSS (mirrors BoardMessage.vue)

The BoardMessage component (helpers/BoardMessage.vue lines 259-337) has a complete, tested CSS border-trick caret implementation for all four sides. The `ActionHelpPopover` needs only the top/bottom variants. Use the exact same two-layer technique (outer span = border color, `::after` = fill color):

```css
/* [VERIFIED: codebase read] BoardMessage.vue lines 259-276 */
.caret--top {
  top: -8px;
  left: 50%;
  transform: translateX(-50%);
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
  border-bottom: 8px solid var(--bsg-line-2);
}
.caret--top::after {
  content: '';
  position: absolute;
  top: 2px;
  left: -7px;
  border-left: 7px solid transparent;
  border-right: 7px solid transparent;
  border-bottom: 7px solid var(--bsg-surface-3);  /* surface-3 for popover */
}
```

Note: BoardMessage uses `var(--bsg-surface-2)` for its bubble; ActionHelpPopover uses `var(--bsg-surface-3)` per the UI-SPEC. Update the fill color accordingly.

### Reduced-Motion Guard

```css
/* [ASSUMED] standard pattern in this codebase; verified in BoardMessage.vue lines 349-353 */
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
  .popover-leave-active {
    transition: none;
  }
}
```

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (version from package.json) |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HELP-01 | `ActionDefinition.help` field exists; `.help()` builder sets it | unit | `npx vitest run src/engine/action/action.test.ts` | ✅ (extend) |
| HELP-01 | `buildActionMetadata` copies `help` into `ActionMetadata` | integration | `npx vitest run src/session/utils.test.ts` | check |
| HELP-01 | `buildSingleActionMetadata` also copies `help` (followUp path) | integration | same file | check |
| HELP-01 | ActionPanel renders "?" affordance when toggle ON + help exists | component | `npx vitest run src/ui/components/auto-ui/ActionPanel.test.ts` | ✅ (extend) |
| HELP-01 | ActionPanel hides "?" when toggle OFF | component | same | ✅ (extend) |
| HELP-01 | ActionHelpPopover shows help text on open | component | new test file | ❌ Wave 0 |
| HELP-01 | disabledActions rendered in popover for disabled action | component | new test file | ❌ Wave 0 |
| HELP-01 | Parity: same popover content in custom-UI fixture vs ActionPanel fixture | component | new parity test | ❌ Wave 0 |
| HELP-02 | ControlsMenu emits `help-toggle` when toggle pressed | component | new or extend ControlsMenu tests | check |
| HELP-02 | localStorage persists toggle state across init | unit | new or extend GameShell tests | check |
| HELP-02 | Default ON when localStorage key absent | unit | same | check |

### Sampling Rate

- **Per task commit:** `npx vitest run --reporter=verbose` (full suite, fast — ~30s)
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/ui/components/helpers/ActionHelpPopover.test.ts` — covers HELP-01 popover content, show/hide, outside-click dismiss, Escape dismiss, reduced-motion (no transition class)
- [ ] Parity fixture test in ActionHelpPopover.test.ts — same data → same rendered content in custom-UI-like div vs AutoUI-grid-like fixture (mirroring HeatmapOverlay.test.ts pattern)
- [ ] Verify `src/session/utils.test.ts` exists and extend with `help` propagation assertions
- [ ] Verify ControlsMenu test coverage for `help-toggle` emit

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes — help text is author-supplied | Vue text interpolation only (no `v-html`); help text is a plain string set at authoring time, not runtime user input |
| V6 Cryptography | no | — |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via help text | Tampering | Render via Vue text interpolation (`{{ helpText }}`), never `v-html`. The codebase's T-105-05 rule (annotation text, no raw HTML) applies equally here. |
| localStorage poisoning | Tampering | Read with `try/catch`; treat any value other than `'true'`/`'false'` as default (ON). Never `eval` the stored value. |

**Key constraint:** The TutorialOverlay precedent (T-105-05, T-105-06, T-105-07) is the security model for all display overlays in this codebase. ActionHelpPopover must follow it: text via interpolation, no innerHTML, no raw HTML from game authors.

---

## Environment Availability

Step 2.6: SKIPPED — phase is purely code/config changes. No external tools, runtimes, databases, or CLI utilities are required beyond the existing npm/vitest/Vue toolchain already in use.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Native `:title` tooltip | Custom popover component | Phase 108 | Touch-visible, toggle-able, a11y-correct |
| `disabledActions` populated but never rendered | Rendered in same popover | Phase 108 | Closes v2.8 "why disabled" friction loop |

**Deprecated/outdated:**
- Native `:title` for action help: not touch-visible, not toggle-able, not WCAG 2.2 AA. Not the mechanism for this phase (though `:title` may remain on per-choice disabled reasons in the `element-btn` at line 865 — this phase does not touch that).

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `boardsmith_action_help` localStorage key does not conflict with any existing key | Standard Stack / GameShell Wiring | Low — no other `boardsmith_action_help` key found in codebase grep |
| A2 | Reduced-motion CSS transition pattern matches what exists in the codebase | Code Examples | Low — verified in BoardMessage.vue; ActionHelpPopover follows same pattern |
| A3 | `src/session/utils.test.ts` exists and can be extended with help propagation assertions | Validation Architecture | Medium — not directly verified; check before Wave 1 |
| A4 | ControlsMenu has existing tests that can be extended | Validation Architecture | Medium — not directly verified; check before adding help-toggle test |

---

## Open Questions (RESOLVED)

1. **`disabledActions` as a prop vs injected from `gameState`**
   - What we know: `gameState` is already injected in GameShell-adjacent components (HeatmapOverlay, TutorialOverlay); ActionPanel currently does NOT inject `gameState` — it only uses the injected `actionController`.
   - What's unclear: Should ActionPanel inject `gameState` directly (reduces prop count) or receive `disabledActions` as a prop (more explicit, more testable)?
   - **RESOLVED:** Pass as a prop (`:disabled-actions`) to match the established `action-metadata` prop pattern. This keeps ActionPanel's dependencies explicit and makes the test fixture simpler (no `provide('gameState', ...)` needed, just pass the prop). Implemented in Plan 02 (ActionPanel prop) + Plan 03 (GameShell computed + binding).

2. **`isActionHelpVisible` prop threading to custom UI slot**
   - What we know: Custom UIs use the `#game-board` slot and wire `ActionHelpPopover` themselves by importing it and calling `actionController.getActionMetadata(name)?.help`.
   - What's unclear: Does `isActionHelpVisible` need to be surfaced in the `#game-board` slot props so custom UI authors can implement the visibility rule?
   - **RESOLVED:** Yes — add `is-action-help-visible` to the `#game-board` slot props alongside `action-controller` (line 1838). Implemented in Plan 03; the parity fixture test confirms it is threaded correctly.

---

## Sources

### Primary (HIGH confidence)

- Codebase reads (verified with Read tool):
  - `src/engine/action/types.ts:429-455` — ActionDefinition interface
  - `src/engine/action/action-builder.ts:73-140` — Action builder class, `.prompt()` method
  - `src/session/utils.ts:35-116` — `buildActionMetadata` and `buildSingleActionMetadata`
  - `src/session/types.ts:356-464` — `ActionMetadata`, `PlayerGameState.disabledActions`
  - `src/ui/composables/useActionControllerTypes.ts:95-120` — UI `ActionMetadata`
  - `src/ui/components/auto-ui/ActionPanel.vue:1-1597` — ActionPanel full structure, props, template, CSS
  - `src/ui/components/ControlsMenu.vue:1-428` — props, emits, teaching group, toggle CSS
  - `src/ui/components/GameShell.vue:56-97, 320-344, 670-717, 1871-1936` — localStorage, actionMetadata computed, handleTeachingAction, ActionPanel wiring
  - `src/ui/components/helpers/BoardMessage.vue` — caret CSS pattern, Teleport, animation
  - `src/ui/components/helpers/HeatmapOverlay.vue:1-270` — Teleport + getBoundingClientRect pattern
  - `src/ui/components/helpers/TutorialOverlay.vue:1-80` — overlay architecture principles
  - `src/ui/components/helpers/HeatmapOverlay.test.ts` — parity test fixture pattern

### Secondary (MEDIUM confidence)

- `108-CONTEXT.md` and `108-UI-SPEC.md` — user decisions and visual contract (approved, treated as locked)

---

## Metadata

**Confidence breakdown:**
- Propagation chain: HIGH — every hop read and confirmed in source
- ActionPanel anatomy: HIGH — read full template and CSS; `.action-buttons { display: contents }` confirmed
- Popover positioning: HIGH — same pattern as HeatmapOverlay/TutorialOverlay, read source
- localStorage pattern: HIGH — read GameShell.vue lines 88-96 directly
- ControlsMenu wiring: HIGH — read template and emits; heatmap toggle is confirmed blueprint
- Test approach: MEDIUM — parity test approach derived from HeatmapOverlay.test.ts pattern; specific test file existence for session/utils and ControlsMenu not confirmed (marked as gaps)

**Research date:** 2026-06-26
**Valid until:** 2026-07-26 (stable internal codebase, no external dependencies)
