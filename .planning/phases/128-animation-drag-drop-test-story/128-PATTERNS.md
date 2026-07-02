# Phase 128: Animation & Drag-Drop Test Story - Pattern Map

**Mapped:** 2026-07-02
**Files analyzed:** 12 (1 new module + 6 new test files + 5 modified composables, per RESEARCH's Wave 0 list)
**Analogs found:** 12 / 12 (all files have a same-repo analog; several are "modify in place" so the analog IS the file itself)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/ui/composables/useAnimationTestMode.ts` (NEW) | utility (pure-TS state module) | event-driven (record/consult) | `src/utils/dev.ts` (`devWarn`/dedup-set pattern) + `src/testing/dom-leak.ts` (Vue-free-module discipline) | role-match |
| `src/ui/composables/useAnimationTestMode.test.ts` (NEW) | test | transform | `src/ui/composables/useAnimationEvents.test.ts` (composable-unit-test shape) | role-match |
| `src/ui/composables/useFLIP.ts` (MODIFIED) | component/composable | transform (position→animation) | itself (`animate()` at lines 242-310; `capture()` at 221-236) | exact (self) |
| `src/ui/composables/useFLIP.test.ts` (NEW) | test | transform | `src/ui/composables/useAnimationEvents.test.ts` (fake-timer/nextTick pattern) + `HintOverlay.test.ts` (matchMedia stub) | role-match |
| `src/ui/composables/useFlyingElements.ts` (MODIFIED) | component/composable | streaming (RAF chain) | itself (`flyCardInternal` lines 445-629; `normalizeRect` 390-401) | exact (self) |
| `src/ui/composables/useFlyingElements.test.ts` (NEW) | test | streaming | `useAnimationEvents.test.ts` (RAF/fake-timer-adjacent pattern) | role-match |
| `src/ui/composables/useElementAnimation.ts` (MODIFIED) | component/composable | streaming (RAF chain) | itself (`animateToCurrentPositions` lines 84-178) | exact (self) |
| `src/ui/composables/useElementAnimation.test.ts` (NEW) | test | streaming | `useAnimationEvents.test.ts` | role-match |
| `src/ui/composables/useActionAnimations.ts` (MODIFIED) | component/composable | event-driven (watch-triggered) | itself (lines 370-499: selector-resolve → warn → animate) | exact (self) |
| `src/ui/composables/useActionAnimations.test.ts` (NEW) | test | event-driven | `useAnimationEvents.test.ts` | role-match |
| `src/ui/composables/useDragDrop.ts` (MODIFIED — test-only, no test-mode branch per RESEARCH Pitfall 4) | component/composable | request-response (sync event handlers) | itself (`dragProps`/`dropProps` lines 212-266) | exact (self) |
| `src/ui/composables/useDragDrop.test.ts` (NEW) | test | request-response | `drag-keyboard-parity.test.ts` (startDrag/triggerDrop API-level driving) | exact |
| `src/ui/composables/useBoardInteraction.ts` (MODIFIED — anchorAttrs registration warning) | component/composable | event-driven | itself (`triggerChoiceSelect` devWarn at 371-382; `anchorAttrs()` at 408-414) + `useDragDropTargets.ts` (`warnNoTargets` at 214-234) | role-match |
| `src/ui/composables/anchorAttrs.test.ts` (EXTEND, not new file — see note below) | test | event-driven | itself (existing `anchorAttrs` describe blocks) | exact (self) |

**Note on registration-warning test coverage (RESEARCH open question 3, resolved):** `anchorAttrs.test.ts` (read in full) tests ONLY the `anchorAttrs(ref)` pure mapping function and its consumers (`useSelectable`, `useSelectableGrid`) — it does NOT test any element-registration warning. There is no existing "registration path" function in `useBoardInteraction.ts` (grepped: no `register*` export exists today). The planner must design where the warning fires (most likely inside `useSelectable`'s setup, since that is what actually calls `anchorAttrs()` per rendered element today) and should EXTEND `anchorAttrs.test.ts` with a new `describe('anchorAttrs dev-warning ...')` block rather than create a duplicate file, since this file is already the established home for anchor-attribute-surface tests.

## Pattern Assignments

### `src/ui/composables/useAnimationTestMode.ts` (NEW module)

**Analogs:** `src/utils/dev.ts` (dedup/state-module shape) + `src/testing/dom-leak.ts` (Vue-free-module discipline, header comment style)

**Dedup-by-key state module pattern to copy** (`src/utils/dev.ts:40-63`):
```typescript
const shownWarnings = new Set<string>();

export function devWarn(key: string, message: string): void {
  if (!isDevMode()) return;
  if (shownWarnings.has(key)) return;
  shownWarnings.add(key);
  console.warn(`[BoardSmith] ${message}`);
}

/** Clear all shown warnings (useful for testing). @internal */
export function _clearShownWarnings(): void {
  shownWarnings.clear();
}
```
Apply the same shape to the trace recorder: module-level array/state + an exported `_clear*`-style reset for test isolation (`clearAnimationTrace()` — already named in RESEARCH's recommendation, matches this repo's `_clearShownWarnings` precedent for "add a reset export so tests don't leak state across files").

**Vue-free-module discipline to copy** (`src/testing/dom-leak.ts:25-29`, `1-23` doc-comment style):
```typescript
import { mount, type VueWrapper } from '@vue/test-utils';
import type { default as AutoUIComponent } from '../ui/components/auto-ui/AutoUI.vue';
import type { GameElement as UIGameElement } from '../ui/components/auto-ui/index.js';
```
`dom-leak.ts` only ever imports Vue-dependent types with `import type`, and defers the one place it needs the real component (`AutoUI.vue`) to a runtime `import()`. `useAnimationTestMode.ts` must have ZERO `vue` import (not even `import type`) so it is safe to statically re-export from both `boardsmith/ui` and `boardsmith/testing` (per `src/testing/index.ts`'s export list, which never imports Vue-dependent modules statically — see its full export block, lines 35-123, all `.js` value exports of plain TS modules).

**Where to re-export from** — `src/testing/index.ts:35-123` shows the exact re-export shape to imitate (named export block per module, grouped by feature with a one-line comment banner):
```typescript
// DOM-leak test utility for hidden info (VIS-03)
export {
  renderAsSeat,
  assertNoHiddenInfoLeak,
  type HiddenInfoGameView,
  type HiddenInfoLeakAllowPredicate,
  type AssertNoHiddenInfoLeakOptions,
} from './dom-leak.js';
```

---

### `src/ui/composables/useFLIP.ts` (MODIFIED — add test-mode branch)

**Analog:** itself — the existing `prefersReducedMotion` branch is the exact insertion point.

**Import pattern** (useFLIP.ts:56-60):
```typescript
import { ref, watch, computed, type Ref, onUnmounted, getCurrentInstance } from 'vue';
import { prefersReducedMotion } from './useElementAnimation.js';

export { prefersReducedMotion };
```
New test-mode import goes alongside this: `import { isAnimationTestModeEnabled, recordTrace } from './useAnimationTestMode.js';`

**Core pattern — insertion point** (useFLIP.ts:242-250, current code):
```typescript
async function animate(): Promise<void> {
  // Skip if reduced motion is preferred
  if (prefersReducedMotion.value) {
    for (const handler of handlers) {
      handler.positions.clear();
    }
    return;
  }
  // ... existing WAAPI animate() calls ...
}
```
New test-mode branch is inserted ABOVE the `prefersReducedMotion` check (per CONTEXT.md — never merge the two), following the exact same "clear positions and return early" shape already established by the reduced-motion branch.

**Silent-skip sites that become throw sites** (useFLIP.ts:264-269 — the two most surgical throw locations, per RESEARCH Pitfall 3):
```typescript
elements.forEach((el) => {
  const id = getElementId(el);
  if (!id) return;          // <- becomes: dev-throw naming which selector/attribute was searched

  const oldRect = handler.positions.get(id);
  if (!oldRect) return;     // <- becomes: dev-throw naming the element id that wasn't captured
});
```
`capture()` (useFLIP.ts:221-236) has the earlier silent-skip: `container.querySelectorAll(handler.selector)` simply returns empty with no signal — this is the FIRST-resolution-attempt site RESEARCH recommends for the throw (not the per-frame re-check).

**Element identity extraction to copy** (useFLIP.ts:146-154):
```typescript
function getElementId(el: Element): string | null {
  return (
    el.getAttribute('data-card-id') ||
    el.getAttribute('data-piece-id') ||
    el.getAttribute('data-element-id') ||
    el.getAttribute('id') ||
    null
  );
}
```

---

### `src/ui/composables/useFlyingElements.ts` (MODIFIED — add test-mode branch + upgrade throw)

**Analog:** itself — `normalizeRect` is the ALREADY fail-loud precedent to match wording style for the NEW throws.

**The one existing fail-loud precedent in the whole composable set** (useFlyingElements.ts:390-401 — match this exact wording style, per RESEARCH):
```typescript
function normalizeRect(
  input: DOMRect | HTMLElement | (() => DOMRect | HTMLElement | null)
): DOMRect | HTMLElement {
  if (typeof input === 'function') {
    const result = input();
    if (!result) {
      throw new Error('Flying element start position returned null');
    }
    return result;
  }
  return input;
}
```

**Core RAF-chain pattern** (useFlyingElements.ts:445-629, `flyCardInternal`) — test-mode branch goes at the top, mirroring the existing reduced-motion guard:
```typescript
async function flyCardInternal(flyOptions: InternalFlyOptions): Promise<void> {
  // Skip animation if reduced motion preferred
  if (prefersReducedMotion.value) {
    return;
  }
  // ... startRect = getRect(startTarget); if (!startRect) return;  <- FIRST-resolution throw site
  // ... nested RAF `animate()` (line 521) — per-frame `getRect(endTarget)` null-check at
  //     line 529-537 intentionally stays silent-complete (target legitimately disappeared
  //     mid-flight) — do NOT add a throw there, per RESEARCH Pitfall 3.
}
```

**Element identity source for autoWatch traces** (useFlyingElements.ts:234-239, `AutoWatchContainer.name` — already first-class, matches CONTEXT.md's `{from:'opponentHand', to:'myHand'}` assertion example directly):
```typescript
export interface AutoWatchContainer {
  ref: Ref<HTMLElement | null>;
  name: string;
}
```

**Import pattern** (useFlyingElements.ts:94-97):
```typescript
import { ref, computed, watch, onUnmounted, isRef, type Ref, type ComputedRef } from 'vue';
import { prefersReducedMotion } from './useElementAnimation.js';
import { easeOutCubic } from '../../utils/easing.js';
import { tryUseBoardInteraction } from './useBoardInteraction.js';
```

---

### `src/ui/composables/useElementAnimation.ts` (MODIFIED — add test-mode branch + upgrade throw)

**Analog:** itself — module-level `prefersReducedMotion` ref (the thing RESEARCH's Pitfall 1 warns about) lives here.

**Module-load-time matchMedia read — the exact site tests must stub around BEFORE importing** (useElementAnimation.ts:34-46):
```typescript
export const prefersReducedMotion = ref(
  typeof window !== 'undefined'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
);

if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-reduced-motion: reduce)')
    .addEventListener('change', (e) => {
      prefersReducedMotion.value = e.matches;
    });
}
```

**Core pattern + silent-skip sites to upgrade** (useElementAnimation.ts:84-120):
```typescript
function animateToCurrentPositions(container: HTMLElement | null, options: AnimationOptions = {}) {
  if (prefersReducedMotion.value) {   // <- test-mode branch goes ABOVE this
    positions.clear();
    return;
  }
  if (!container) { positions.clear(); return; }
  // ...
  elements.forEach((el) => {
    const id = el.getAttribute('data-element-id');
    if (!id) return;                  // <- becomes dev-throw (first-resolution)

    const startPos = positions.get(id);
    if (!startPos) return;            // <- becomes dev-throw (first-resolution)
    // ...
  });
}
```

---

### `src/ui/composables/useActionAnimations.ts` (MODIFIED — upgrade console.warn to dev-throw)

**Analog:** itself — ALREADY does the "right thing partially" (warn, not silent skip) at two sites; ANIM-03 upgrades warn-only to dev-throw + prod-console.error.

**Site 1 — source element not found** (useActionAnimations.ts:387-395):
```typescript
const sourceElement = document.querySelector(selector);
if (!sourceElement) {
  console.warn(
    `[useActionAnimations] Could not find element for selector "${selector}". ` +
      `Action: ${actionName}, Args: ${JSON.stringify(args)}`
  );
  return;
}
```

**Site 2 — destination element not found** (useActionAnimations.ts:483-493):
```typescript
if (!destinationElement) {
  const selectorDesc =
    typeof config.destinationSelector === 'function'
      ? '(custom function)'
      : config.destinationSelector;
  console.warn(
    `[useActionAnimations] Could not find destination element. ` +
      `Selector: ${selectorDesc}, Args: ${JSON.stringify(args)}`
  );
  return;
}
```
Both sites already carry the actionable diagnostic content (selector, action, args) that ANIM-03 requires — the change is `console.warn` → `if (isDevMode()) throw new Error(...)` else `console.error(...)`, reusing the exact same message strings. This is also where RESEARCH's Open Question 2 lands: trace `from`/`to` for this composable should be sourced from `selector`/destSelector (the already-interpolated strings available right here), not pushed down into `useFlyingElements`.

---

### `src/ui/composables/useDragDrop.ts` (test-only surface — NOT modified for test-mode/throw)

**Analog:** itself. `drag-keyboard-parity.test.ts` is the analog for the TEST file.

**Do-not-touch precedent** (useDragDrop.ts:93-107 doc comment + 101-107 `warnNoProvider`):
```typescript
const warnNoProvider = (): void =>
  devWarn(
    'useDragDrop-no-provider',
    'useDragDrop() drag-and-drop is inactive because there is no <GameShell> ' +
      'board-interaction provider. Render this component inside <GameShell> ' +
      '(or use tryUseBoardInteraction() directly if drag-and-drop is optional here).'
  );
```
This is the composable's own documented "degrade gracefully, don't throw" design (see doc comment at lines 1-88, especially "Drop targets are wired automatically"). Per RESEARCH Pitfall 4, ANIM-03 must NOT touch this pattern.

**API-level test-driving pattern to copy verbatim** (`drag-keyboard-parity.test.ts:108-134`):
```typescript
it('drag path: startDrag + setDropTargets + triggerDrop fires onDrop callback (progressive enhancement)', () => {
  const onDropSpy = vi.fn();
  const dropTarget = { id: 42, ref: { id: 42 } };

  bi.startDrag({ id: 1 });
  expect(bi.isDragging).toBe(true);
  expect(bi.isDraggedElement({ id: 1 })).toBe(true);

  bi.setDropTargets([dropTarget], onDropSpy);
  expect(bi.isDropTarget({ id: 42 })).toBe(true);
  expect(bi.isDropTarget({ id: 999 })).toBe(false);

  bi.triggerDrop({ id: 42 });

  expect(onDropSpy).toHaveBeenCalledTimes(1);
  expect(onDropSpy).toHaveBeenCalledWith(42);
  expect(bi.isDragging).toBe(false);
  expect(bi.dropTargets).toEqual([]);
});
```
`useDragDrop.test.ts` should drive BOTH this API-level path (import `dragProps`/`dropProps` and call the returned handlers directly, per CONTEXT.md) AND a minimal hand-built `DragEvent`-shaped plain object (per RESEARCH's Don't-Hand-Roll table) passed straight to `dragProps(ref).onDragstart(fakeEvent)` etc. — NOT `element.dispatchEvent(new DragEvent(...))`, since jsdom lacks the `DragEvent` constructor entirely (confirmed via probe).

**`dragProps`/`dropProps` implementation to reference directly** (useDragDrop.ts:212-266) — the exact handler shapes the fake-event tests must satisfy (`e.dataTransfer?.setData`, `e.dataTransfer!.effectAllowed`, `e.preventDefault()`, `e.dataTransfer!.dropEffect`, `e.relatedTarget`, `e.currentTarget`).

---

### `src/ui/composables/useBoardInteraction.ts` (MODIFIED — anchorAttrs registration dev-warning)

**Analog:** itself (`triggerChoiceSelect`'s devWarn, static key) — the CORRECT pattern to copy; `useDragDropTargets.ts`'s `warnNoTargets` — the WRONG pattern to imitate (per-instance key), included here as a negative example.

**Correct pattern: static/type-level dedup key** (useBoardInteraction.ts:371-382):
```typescript
triggerChoiceSelect(selectionName, value) {
  if (!state.onChoiceSelect) {
    devWarn(
      'board-interaction-no-choice-callback',
      `triggerChoiceSelect('${selectionName}', ...) was ignored because no action is active to receive it. ` +
        `Choice selection only works while an action exposing a '${selectionName}' selection is in progress. ` +
        `Start the action first (via the ActionPanel or by selecting the relevant board element) before triggering a choice.`,
    );
    return;
  }
  state.onChoiceSelect(selectionName, value);
},
```

**Anti-pattern (per-instance key — do NOT copy this shape for the new warning)** (`useDragDropTargets.ts:214-234`):
```typescript
function warnNoTargets(dragged: ElementRef, matchedAction: string | null): void {
  devWarn(
    `drag-no-targets-${JSON.stringify(dragged)}`,   // <- per-DRAGGED-ELEMENT key, correct for THIS warning
    `Drag started for element ${JSON.stringify(dragged)} but no drop targets could be derived.\n\n` + /* ... */
  );
}
```
This composable's key is deliberately per-instance because it legitimately should fire per distinct dragged shape. The new anchorAttrs warning must instead key by `className`/`name` (type-level), e.g. `` `anchorattrs-missing-${element.className ?? element.name ?? 'unknown'}` ``, per RESEARCH Pitfall 5 — NOT by `id`.

**The single source of truth the warning protects** (useBoardInteraction.ts:396-414):
```typescript
export function anchorAttrs(ref: ElementRef): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (ref.id !== undefined) attrs['data-bs-el-id'] = String(ref.id);
  if (ref.notation !== undefined) attrs['data-bs-el-notation'] = String(ref.notation);
  if (ref.name !== undefined) attrs['data-bs-el-name'] = String(ref.name);
  return attrs;
}
```
The warning fires when a selectable/renderable element's ref produces an EMPTY `anchorAttrs()` result (no id/notation/name present) — this is the concrete, checkable condition.

---

### Test files — shared infra patterns

**matchMedia stub (copy verbatim, place BEFORE static imports of any of the 5 composables — RESEARCH Pitfall 1)** (`src/ui/components/helpers/HintOverlay.test.ts:28-36`):
```typescript
// jsdom lacks matchMedia; modules that read it at import time would throw.
vi.stubGlobal(
  'matchMedia',
  vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
);
```

**ResizeObserver stub (same file, immediately following, same technique)** (`HintOverlay.test.ts:39-45`):
```typescript
vi.stubGlobal(
  'ResizeObserver',
  vi.fn(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })),
);
```

**Composable-unit-test file shape to copy** (`src/ui/composables/useAnimationEvents.test.ts:1-40`):
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, nextTick } from 'vue';
import { createAnimationEvents, /* ... */ } from './useAnimationEvents.js';

async function waitForIdle(instance, timeout = 1000): Promise<void> {
  const start = Date.now();
  while (instance.isAnimating.value && Date.now() - start < timeout) {
    await new Promise((r) => setTimeout(r, 10));
  }
  if (instance.isAnimating.value) {
    throw new Error('Animation did not complete within timeout');
  }
}

describe('useAnimationEvents', () => {
  describe('handler registration', () => {
    it('registers handler for event type', async () => {
      // arrange ref-based state, act via composable call, await nextTick + waitForIdle, assert
    });
  });
});
```
This `waitForIdle` polling-helper pattern (real-time poll on a reactive `isAnimating` ref, not fake timers) is the model for `useFlyingElements.test.ts`/`useElementAnimation.test.ts`'s REAL-path (mocked-RAF) tests, where `vi.useFakeTimers` doesn't auto-tick RAF (per RESEARCH's Don't-Hand-Roll table) — prefer `vi.stubGlobal('requestAnimationFrame', ...)` with a manually-ticked queue over trying to coerce fake timers into driving RAF.

---

## Shared Patterns

### Dev-mode detection + one-time-warning dedup
**Source:** `src/utils/dev.ts` (full file, 71 lines)
**Apply to:** `useFLIP.ts`, `useElementAnimation.ts`, `useActionAnimations.ts` (dev-throw gate uses `isDevMode()`), `useBoardInteraction.ts` (new anchorAttrs warning uses `devWarn`)
```typescript
export function isDevMode(): boolean {
  if (typeof import.meta !== 'undefined' && (import.meta as any).env) {
    const env = (import.meta as any).env;
    return env.DEV === true || env.MODE !== 'production';
  }
  return typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
}

export function devWarn(key: string, message: string): void {
  if (!isDevMode()) return;
  if (shownWarnings.has(key)) return;
  shownWarnings.add(key);
  console.warn(`[BoardSmith] ${message}`);
}
```
CONTEXT.md's dev-mode gate ("`import.meta.env.DEV` THROW... production logs console.error and skips") should use this SAME `isDevMode()` helper for consistency, not a fresh `import.meta.env.DEV` check duplicated per composable.

### matchMedia / ResizeObserver jsdom stubs
**Source:** `src/ui/components/helpers/HintOverlay.test.ts:28-45`
**Apply to:** every new `.test.ts` file for the five composables (all transitively import `useElementAnimation.js`'s module-load-time `matchMedia` read).

### Vue-free module + dynamic-import discipline for cross-package re-export
**Source:** `src/testing/dom-leak.ts:1-60`, `src/testing/index.ts:35-123`
**Apply to:** `useAnimationTestMode.ts` (must have zero `vue` import to be safely re-exported from both `boardsmith/ui` and `boardsmith/testing`, per CONTEXT.md's "check if the dependency direction allows" requirement — confirmed safe by this precedent).

### devWarn dedup key: static/type-level vs per-instance
**Source:** `src/ui/composables/useBoardInteraction.ts:371-382` (correct, static key) vs `src/ui/composables/useDragDropTargets.ts:214-234` (correct for ITS use case, per-instance key — do not imitate for the anchorAttrs warning)
**Apply to:** the new anchorAttrs registration warning — must use a `className`/`name`-derived key, never `id`.

## No Analog Found

None — every file in scope has at least a role-match analog, and five of the composable files are modified-in-place (the analog is the file's own existing branch structure). The one genuine gap is structural, not a missing analog:

| File | Role | Data Flow | Reason |
|---|---|---|---|
| anchorAttrs registration-warning call site | (new code inside `useBoardInteraction.ts` or `useSelectable.ts`) | event-driven | No existing "element registration" function exists today (grep confirmed no `register*` export in `useBoardInteraction.ts`); planner must decide whether the warning lives in `useBoardInteraction.ts` or in `useSelectable.ts` (which is what actually calls `anchorAttrs()` per rendered element — see `anchorAttrs.test.ts`'s `useSelectable.attrs` describe block, lines 76-124, for where that call currently happens) |

## Metadata

**Analog search scope:** `src/ui/composables/` (all 5 target composables + `useBoardInteraction.ts` + `useDragDropTargets.ts` + `useSelectable.ts` reference + `anchorAttrs.test.ts` + `useAnimationEvents.test.ts`), `src/ui/components/helpers/HintOverlay.test.ts`, `src/ui/components/auto-ui/renderers/drag-keyboard-parity.test.ts`, `src/utils/dev.ts`, `src/testing/index.ts`, `src/testing/dom-leak.ts`
**Files scanned:** 13 read in full or targeted-section, 0 files > 2000 lines requiring grep-first strategy
**Pattern extraction date:** 2026-07-02
