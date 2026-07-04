# Phase 134: UI & Session Interaction Guardrails - Pattern Map

**Mapped:** 2026-07-03
**Files analyzed:** 7 (5 source edits + 1 doc + N test insertions in existing test files)
**Analogs found:** 7 / 7 (every fix mirrors an existing sibling pattern in the SAME file — no external analog needed; this phase is entirely "wire up existing machinery," not "invent new abstractions," per RESEARCH.md's "Don't Hand-Roll" section)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `src/ui/composables/useActionController.ts` (`start()` return type + devWarn) | composable / controller | request-response | same file: `execute()`'s existing `ActionResult`-returning shape + `toggleMultiSelect`'s devWarn-on-invalid-selection pattern (lines 1719-1725) | exact (in-file sibling) |
| `src/ui/composables/useActionController.ts` (`fill()` multiSelect guard) | composable / controller | CRUD (client-side validation) | same file: `toggleMultiSelect`'s reverse guard (lines 1727-1735) | exact (in-file sibling, mirror-image guard) |
| `src/ui/composables/useActionController.ts` (`setBeforeAutoExecute` accumulation) | composable / controller | event-driven (hook registry) | same file: the single-slot `beforeAutoExecuteHook` ref (lines 179-183) + its consumer in the auto-execute watcher (853-858) — replace ref-of-fn with ref-of-array | exact (in-file, replacing the exact pattern being fixed) |
| `src/ui/components/GameShell.vue` (`lastError` → toast watch) | component / chrome owner | event-driven (reactive watch → side effect) | same file: `handleUndo()`'s existing toast-on-failure pattern (lines 651-676) + the Game-Over `assertiveMessage` watch (1763-1786) | exact (in-file sibling) |
| `src/ui/components/GameShell.vue` (0×0 dev-check) | component / diagnostic | event-driven (watch + settle timer) | same file: `useAutoZoom`'s startup settle-timer state machine (`onBoardResize`/`endStartup`, `useAutoZoom.ts:89-115`) — reuse `SETTLE_MS` constant; trigger from GameShell's own `gameView`/`state` watch per research's placement recommendation | role-match (cross-file precedent, same "settle" idiom) |
| `src/ui/composables/useDragDrop.ts` (`dragProps()` `when` gating) | composable / DOM-prop factory | transform | same file: `drag()`'s existing `evalCondition()`-gated inert-props pattern (lines 324-327) and `dragClasses()` (307-310) | exact (in-file sibling — `dragProps` is the ONLY one of the four helpers not yet wired to `evalCondition`) |
| `src/session/game-session.ts` (`get runner()` facade) | service / session accessor | request-response (read accessor) | same file: no prior read-only facade exists — closest analog is the existing `get runner()` getter itself (858-860) being narrowed, plus the `#runner` reassignment sites (341, 379, 484 — two more at 1462, 1482 found in this pass) that must all build the new `#runnerFacade` | novel-but-mechanical (no existing facade pattern in repo; RESEARCH.md's concrete code example is the template) |
| `docs/custom-ui-guide.md` (result-checking + board-sizing sections) | doc | n/a | same file: existing fire-and-forget `start()` example (~line 120) and unchecked `fill()` example (~line 141) — rewrite in place; add new "Board Sizing" section near line 242/316 | exact (in-file sections to revise/add) |
| `src/ui/composables/useActionController.test.ts` (flip RED test) | test | n/a | same file, line 521 `'setBeforeAutoExecute replaces the previous hook (single-slot)'` — invert assertion | exact |

## Pattern Assignments

### `src/ui/composables/useActionController.ts` — UIX-01: `start()` return type + devWarn

**Analog:** same file, `start()` itself (current, lines 1245-1309) + `toggleMultiSelect`'s devWarn-on-no-selection guard (lines 1716-1725)

**Current signature and failure returns (lines 1245-1262):**
```typescript
async function start(
  actionName: string,
  startOptions?: { args?: Record<string, unknown>; prefill?: Record<string, unknown> }
): Promise<void> {
  ...
  if (!availableActions.value?.includes(actionName)) {
    lastError.value = `Action "${actionName}" is not available`;
    return;
  }
  const meta = getActionMetadata(actionName);
  if (!meta) {
    lastError.value = `No metadata for action "${actionName}"`;
    return;
  }
  ...
}
```

**devWarn template to copy (lines 1716-1725, `toggleMultiSelect`'s no-selection guard):**
```typescript
const selection = currentActionMeta.value?.selections.find(s => s.name === selectionName);
if (!selection) {
  devWarn(
    `multiselect-no-selection:${selectionName}`,
    `toggleMultiSelect('${selectionName}', ...) was ignored: no active action exposes a selection named '${selectionName}'. ` +
      `Start the action (and reach this selection) before toggling its values.`
  );
  return;
}
```
Apply the same `devWarn(key, message)` call shape at the `!availableActions.value?.includes(actionName)` branch, using the UI-SPEC's exact copy: `` `start('{actionName}') was ignored: '{actionName}' is not in the current player's available actions. Check availableActions before calling start(), or wait for the action to become available.` ``

**Result type to reuse (do not invent a new shape) — `useActionControllerTypes.ts:122-134`:**
```typescript
export interface ActionResult {
  success: boolean;
  error?: string;
  data?: Record<string, unknown>;
  message?: string;
  followUp?: FollowUpAction;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}
```
Per RESEARCH.md Pitfall 1, `start()`'s new `Promise<ActionResult>` may ONLY faithfully represent its own two synchronous checks (`not available`, `no metadata`) plus a `{ success: true }` acknowledgment — never the eventual server outcome (that still arrives via `lastError`/toast or `execute()`).

**Caller migration note (safe, confirmed no in-repo consumer breaks):** `useDragDropTargets.ts` Case B (lines 277-306) currently discards `start()`'s return value — widening `Promise<void>` → `Promise<ActionResult>` is additive there.

---

### `src/ui/composables/useActionController.ts` — UIX-02: `fill()` multiSelect scalar guard

**Analog:** `toggleMultiSelect`'s reverse guard, same file lines 1727-1735:
```typescript
const cfg = resolveMultiSelectConfig(selection);
if (!cfg) {
  devWarn(
    `multiselect-not-multi:${selectionName}`,
    `toggleMultiSelect('${selectionName}', ...) was ignored: '${selectionName}' is not a multiSelect selection. ` +
      `Use fill('${selectionName}', value) for single-value selections.`
  );
  return;
}
```

**`resolveMultiSelectConfig()` helper to reuse as-is (lines 1695-1706):**
```typescript
function resolveMultiSelectConfig(
  selection: PickMetadata
): { min?: number; max?: number } | undefined {
  if (selection.dependsOn && selection.multiSelectByDependentValue) {
    const depValue = currentArgs.value[selection.dependsOn];
    if (depValue !== undefined) {
      return selection.multiSelectByDependentValue[String(depValue)];
    }
    return undefined;
  }
  return selection.multiSelect;
}
```

**Exact insertion point in `fill()` (current lines 1311-1345):** the choice-object auto-unwrap block (1321-1332) runs FIRST — insert the new guard immediately AFTER it (so unwrapped choice objects still hit the multiSelect check) and BEFORE the `selection.repeat` (1335) / `hasOnSelect`/`pendingOnServer` (1340) branches, which bypass `validateSelection` entirely:
```typescript
// existing unwrap block ends at line 1332 (value now holds the unwrapped scalar/array)

// NEW — UIX-02 guard (after unwrap, before repeat/onSelect routing):
const multiCfg = resolveMultiSelectConfig(selection);
if (multiCfg && !Array.isArray(value)) {
  const error = `fill('${selectionName}', ...) rejected: '${selectionName}' is a multiSelect selection ` +
    `(min ${multiCfg.min ?? 0}, max ${multiCfg.max ?? '∞'}) and requires an array. ` +
    `Use toggleMultiSelect()/confirmMultiSelect(), or pass an array directly to fill().`;
  lastError.value = error;
  return { valid: false, error };
}

// existing: if (selection.repeat) { return await handleRepeatingFill(...); }  (line 1335)
```
Copy text matches UI-SPEC's Copywriting Contract verbatim (row "UIX-02").

---

### `src/ui/composables/useActionController.ts` — UIX-05: hook accumulation

**Analog/target to replace (same file, lines 179-183, single-slot ref):**
```typescript
// Single before-auto-execute hook (REPLACED, not accumulated, via setBeforeAutoExecute)
const beforeAutoExecuteHook = ref<((actionName: string, args: Record<string, unknown>) => void | Promise<void>) | undefined>(
  initialBeforeAutoExecute
);
```

**Consumer to update (auto-execute watcher, lines 853-858):**
```typescript
watch(isReady, async (ready) => {
  if (ready && getAutoExecute() && currentAction.value && !isExecuting.value && !pendingOnServer.value) {
    if (beforeAutoExecuteHook.value) {
      await beforeAutoExecuteHook.value(currentAction.value, buildServerArgs());
    }
    executeCurrentAction();
  }
});
```

**New shape (per RESEARCH.md Pattern 2 — sequential await, registration order, unregister fn):**
```typescript
const beforeAutoExecuteHooks = ref<Hook[]>(initialBeforeAutoExecute ? [initialBeforeAutoExecute] : []);
function setBeforeAutoExecute(hook: Hook): () => void {
  beforeAutoExecuteHooks.value.push(hook);
  return () => {
    const idx = beforeAutoExecuteHooks.value.indexOf(hook);
    if (idx !== -1) beforeAutoExecuteHooks.value.splice(idx, 1);
  };
}
// watcher body:
for (const hook of beforeAutoExecuteHooks.value) {
  await hook(currentAction.value, buildServerArgs());
}
```

**JSDoc to update (lines 919-937):** remove "Note: this REPLACES any previously set hook (single-slot, not accumulated)." — replace with the UI-SPEC copy: "registers an additional hook; hooks run in registration order; call the returned function to unregister this hook."

**Test to flip (RED→GREEN), `src/ui/composables/useActionController.test.ts:521-541`:**
```typescript
it('setBeforeAutoExecute replaces the previous hook (single-slot)', async () => {
  ...
  controller.setBeforeAutoExecute(() => { calls.push('first'); });
  controller.setBeforeAutoExecute(() => { calls.push('second'); });
  await controller.start('forcedPlay');
  await nextTick();
  await nextTick();
  // Only the most recently set hook fires
  expect(calls).toEqual(['second']);
});
```
Rename to something like `'setBeforeAutoExecute accumulates hooks and runs them in registration order'` and change the final assertion to `expect(calls).toEqual(['first', 'second'])`. This IS the PROC-02 regression test for UIX-05 (no new file needed).

---

### `src/ui/components/GameShell.vue` — UIX-01 part 1: central `lastError` → toast watch

**Analog:** `handleUndo()`'s existing toast-on-failure pattern (lines 651-676):
```typescript
async function handleUndo(): Promise<void> {
  ...
  toast.error(result.error || 'Undo failed.');
  ...
  toast.error(error instanceof Error ? error.message : 'Undo failed.');
}
```

**Live-region refs already present (lines 339-340), rendered at 1849-1850:**
```typescript
const politeMessage = ref('');
const assertiveMessage = ref('');
```
```html
<p class="vh" role="status" aria-live="polite">{{ politeMessage }}</p>
<p class="vh" role="alert" aria-live="assertive">{{ assertiveMessage }}</p>
```

**Existing sibling `watch(...)` → `assertiveMessage.value = text` pattern to mirror (Game-Over watch, lines 1763-1786):**
```typescript
watch(
  () => (state.value?.flowState as any)?.complete,
  (newComplete, oldComplete) => {
    if (newComplete && !oldComplete) {
      ...
      const text = announceGameOver(winnerNames);
      assertiveMessage.value = text;
      emitAnnounce('assertive', text);
      ...
    }
  },
  { immediate: false },
);
```

**New pattern to add** (co-locate near line 651-676, after `toast`/`actionController` are defined; `actionController` is `provide()`d at line 966, so it must already be constructed earlier in `<script setup>`):
```typescript
watch(actionController.lastError, (err) => {
  if (!err) return;
  toast.error(err);
  assertiveMessage.value = err;
});
```
No `flush: 'sync'` needed — Vue batches synchronous `lastError` mutations within a tick (confirmed by RESEARCH.md's trace of the 11 set-sites in useActionController.ts).

---

### `src/ui/components/GameShell.vue` — UIX-03: 0×0 dev-check

**Analog:** `useAutoZoom.ts`'s existing settle-timer state machine (`onBoardResize`/`endStartup`, lines 89-115) and its `SETTLE_MS` constant (line 28, value `300`):
```typescript
export const SETTLE_MS = 300;
...
function onBoardResize() {
  if (startupDone) return;
  if (!measureAndFit()) return;
  if (settleTimer !== null) clearTimeout(settleTimer);
  settleTimer = setTimeout(endStartup, SETTLE_MS);
}
```

**Wiring point in GameShell (lines 289-291, current `useAutoZoom` call):**
```typescript
const { zoomLevel, setZoom, fitZoom } = useAutoZoom({
  boardEl: zoomContainerEl, regionEl: /* ... */, dockHeight: /* ... */,
});
```

**Zoom-container CSS being diagnosed (~line 2817-2839, `.game-shell__zoom-container { width: max-content }`)** and the `#game-board` slot mount point (lines 2110-2168, `<div class="game-shell__zoom-container" ref="zoomContainerEl" ...>`).

**Recommended new pattern (per RESEARCH.md's Pitfall 2 recommendation — keep the check in GameShell, do not widen `useAutoZoom`'s public options):**
```typescript
// import SETTLE_MS from '../composables/useAutoZoom' for consistency
watch(gameView, async (view) => {
  if (!view) return;
  await nextTick();
  setTimeout(() => {
    const el = zoomContainerEl.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) {
      console.error(
        `Custom board failed to render: the #game-board slot measured 0×0 after game state arrived. ` +
        `This usually means a percentage-width or container-type board is collapsing inside GameShell's ` +
        `zoom container ('.game-shell__zoom-container { width: max-content }'). Give your board's root ` +
        `element a definite width (not 100%) or see the "Board Sizing" section of docs/custom-ui-guide.md.`
      );
    }
  }, SETTLE_MS);
}, { immediate: false });
```
Must gate on `#game-board` slot having children too (per CONTEXT.md's exact condition) — verify `el.children.length > 0` alongside the 0×0 rect check to avoid false positives before any custom UI mounts.

---

### `src/ui/composables/useDragDrop.ts` — UIX-04: `dragProps()` `when` gating

**Analog:** `drag()`'s existing inert-props pattern (lines 324-327):
```typescript
const drag = (ref: ElementRef, options?: DragOptions): DragResult => ({
  props: evalCondition(options) ? dragProps(ref, options) : {},
  classes: dragClasses(ref, options),
});
```

**`evalCondition()` helper to reuse as-is (lines 299-302):**
```typescript
const evalCondition = (options?: DragOptions): boolean => {
  if (options?.when === undefined) return true;
  return typeof options.when === 'function' ? options.when() : options.when;
};
```

**Current `dragProps()` to modify (lines 212-235) — always returns `draggable: true`, never reads `options.when`:**
```typescript
const dragProps = (ref: ElementRef, options?: DragOptions): DragProps => ({
  draggable: true,
  onDragstart: (e: DragEvent) => { /* ... */ },
  onDragend: () => { /* ... */ },
});
```

**New pattern (widen return type, gate on `evalCondition`):**
```typescript
const dragProps = (ref: ElementRef, options?: DragOptions): DragProps | { draggable: false } => {
  if (!evalCondition(options)) {
    return { draggable: false };
  }
  return {
    draggable: true,
    onDragstart: (e: DragEvent) => { /* unchanged body */ },
    onDragend: () => { /* unchanged body */ },
  };
};
```

**Type surface to update:** `UseDragDropReturn['dragProps']` signature at line 178 (`dragProps: (ref: ElementRef, options?: DragOptions) => DragProps;`) must widen to `DragProps | { draggable: false }`. No copy/UI change (UI-SPEC: behavioral only, silent).

---

### `src/session/game-session.ts` — SESS-01: read-only runner facade

**Analog:** no prior facade pattern exists in this file; the exact template is RESEARCH.md's `buildRunnerFacade()` code example, which this file must adopt directly.

**Current getter to replace (lines 858-860):**
```typescript
/**
 * Get the current game runner (for advanced use cases)
 */
get runner(): GameRunner<G> {
  return this.#runner;
}
```

**All `#runner` assignment sites requiring a paired `#runnerFacade` rebuild (verified via grep this pass — 5 sites, not 3 as research's summary implied; research's own Code Examples section correctly lists "every #runner assignment site"):**
```
game-session.ts:341   this.#runner = runner;        (constructor)
game-session.ts:379   this.#runner = newRunner;
game-session.ts:484   session.#runner = newRunner;
game-session.ts:1462  this.#runner = newRunner;
game-session.ts:1482  this.#runner = newRunner;
```

**New pattern to add (private field near `#runner`, line 236):**
```typescript
export interface ReadOnlyRunnerFacade<G extends Game = Game> {
  readonly game: G;
  readonly actionHistory: readonly SerializedAction[];
  getSnapshot(): GameStateSnapshot;
  getPlayerView(playerPosition: number): PlayerStateView;
  getAllPlayerViews(): PlayerStateView[];
  getFlowState(): FlowState | undefined;
  getFlowDebugInfo(): FlowDebugInfo;
  getPendingAction(playerPosition: number): PendingActionState | undefined;
  isComplete(): boolean;
  getWinners(): Player[];
}

function buildRunnerFacade<G extends Game>(runner: GameRunner<G>): ReadOnlyRunnerFacade<G> {
  return {
    get game() { return runner.game; },
    get actionHistory() { return runner.actionHistory; },
    getSnapshot: () => runner.getSnapshot(),
    getPlayerView: (p) => runner.getPlayerView(p),
    getAllPlayerViews: () => runner.getAllPlayerViews(),
    getFlowState: () => runner.getFlowState(),
    getFlowDebugInfo: () => runner.getFlowDebugInfo(),
    getPendingAction: (p) => runner.getPendingAction(p),
    isComplete: () => runner.isComplete(),
    getWinners: () => runner.getWinners(),
  };
}

// class field:
#runnerFacade: ReadOnlyRunnerFacade<G>;

// at EVERY #runner assignment site (all 5 listed above), add immediately after:
this.#runnerFacade = buildRunnerFacade(this.#runner);

// replace the public getter:
get runner(): ReadOnlyRunnerFacade<G> {
  return this.#runnerFacade;
}
```

**No internal migration needed:** confirmed (this pass) `game-session.ts` itself never calls `this.runner` internally — all internal access is via `this.#runner` directly, so the facade change is purely additive at the public-API boundary. External migration is limited to 10 test files (all read-only consumers per RESEARCH.md's grep — `getSnapshot()`, `.game`, `.actionHistory`), none of which call `.performAction()` through `session.runner`, so no test logic changes, only type-checking should continue to pass.

**Runtime-throw fallback (UI-SPEC copywriting contract, if implementing the untyped/JS-caller guard):**
```
`session.runner is a read-only facade (state/view/history only). Call session.performAction(...) instead — it handles persistence, broadcast, and checkpoints that calling the engine runner directly would silently skip.`
```
This is satisfied for free by the object-literal facade shape above (no `performAction` key on the returned object → `undefined` at runtime for JS callers, which throws a native `TypeError: ... is not a function` on call — RESEARCH.md's Pitfall 3 confirms a genuinely narrower object, not a type-cast, is required here).

---

### `docs/custom-ui-guide.md` — DOCX-04 updates

**Sections to revise (per RESEARCH.md's traced offsets — verify exact current line numbers during implementation, file may have shifted):**
- ~line 120: fire-and-forget `start()` example → rewrite to show checking the returned `ActionResult` (or noting it only covers the two synchronous pre-checks per Pitfall 1 — do not imply it reflects eventual server success).
- ~line 141: unchecked `fill()` example → add a multiSelect example showing the new rejection error and the corrective `toggleMultiSelect()`/array-argument pattern.
- ~line 242/316: new "Board Sizing" section — cover `width: max-content` on `.game-shell__zoom-container`, why percentage widths/`container-type` collapse to 0, and the corrective pattern (definite width on the board root, or `boardregion` measurement), matching the UIX-03 dev-console-error copy verbatim so the pointed-to doc section actually exists.

## Shared Patterns

### devWarn convention (Phases 131-133)
**Source:** `src/ui/composables/useActionController.ts:1719-1725` (toggleMultiSelect), `src/ui/composables/useDragDrop.ts:101-107` (`warnNoProvider`)
**Apply to:** UIX-01's `start()`-on-unavailable-action devWarn.
```typescript
devWarn(
  'unique-key',
  'Actionable message naming the fix, in the same voice as existing devWarn calls.'
);
```

### Toast/live-region ownership — single chokepoint
**Source:** `src/ui/components/GameShell.vue` (all `toast.error(...)` call sites, e.g. lines 651-676, 1269, 1340-1622; `politeMessage`/`assertiveMessage` refs at 339-340, rendered 1849-1850)
**Apply to:** UIX-01 exclusively. Do NOT add a parallel toast/error path inside ActionPanel.vue or any custom UI — parity holds because ActionPanel and custom UIs share the same `actionController` instance via `provide('actionController', actionController)` (GameShell.vue:966).

### `evalCondition()` — boolean-or-function condition evaluation
**Source:** `src/ui/composables/useDragDrop.ts:299-302`
**Apply to:** UIX-04 (`dragProps`) — the ONLY one of the four drag/drop helpers not yet wired to it; do not write a second implementation.

### `resolveMultiSelectConfig()` — multiSelect config resolution (including `dependsOn`-scoped)
**Source:** `src/ui/composables/useActionController.ts:1695-1706`
**Apply to:** UIX-02 (`fill()`'s new guard) — reuse verbatim, do not re-derive `dependsOn`/`multiSelectByDependentValue` lookup logic.

## No Analog Found

None. Every file in this phase's scope has an in-file or same-tier sibling pattern to mirror (per RESEARCH.md's "Don't Hand-Roll" section) — this phase is entirely "wire missing calls to existing machinery," not new abstractions.

## Metadata

**Analog search scope:** `src/ui/composables/`, `src/ui/components/GameShell.vue`, `src/session/game-session.ts`, `docs/custom-ui-guide.md`, plus corresponding `*.test.ts` files — all scoped directly by CONTEXT.md/RESEARCH.md file lists, no broader repo search needed since every fix's analog lives in the SAME file being modified.
**Files scanned:** 7 source/doc files + 1 test file, all read via targeted offset/limit reads (largest file, GameShell.vue at 2922 lines, read only at the 6 relevant non-overlapping ranges: 95-330 imports/toast n/a, 225-260 class fields n/a — see individual sections above for exact line ranges read).
**Pattern extraction date:** 2026-07-03
