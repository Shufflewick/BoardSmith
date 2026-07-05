# Phase 140: Library Prerequisite — useAnnouncer() - Pattern Map

**Mapped:** 2026-07-04
**Files analyzed:** 5 (new/modified)
**Analogs found:** 5 / 5

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|-----------------|---------------|
| `src/ui/composables/useAnnouncer.ts` | provider/composable | event-driven (provide/inject controller object) | `src/ui/composables/useAnimationEvents.ts` | exact |
| `src/ui/composables/useAnnouncer.test.ts` | test (unit) | event-driven | `src/ui/composables/useAnimationEvents.test.ts` | exact |
| `src/ui/components/GameShell.announcer.test.ts` | test (component, jsdom, provide/inject parity) | event-driven | `src/ui/components/auto-ui/ActionPanel.test.ts` (mount + `global.provide`) | role-match (mounting pattern); `GameShell.live-region.test.ts` is the sibling-naming/doc-comment analog but tests pure functions only, not a mount |
| `src/ui/components/GameShell.vue` (edit: wire `createAnnouncer`/`provideAnnouncer`) | component (root, provider wiring) | event-driven | Same file's existing `createAnimationEvents`/`provideAnimationEvents` wiring (lines 351-355) and live-region refs/watchers (lines 340-349, 1742-1815) | exact (self-referential — extend existing conventions in the same file) |
| `src/ui/index.ts` (edit: add export) | config (barrel export) | — | `useBoardSize` export (line 154) / `useAnimationEvents` export block (lines ~141-151) | exact |

## Pattern Assignments

### `src/ui/composables/useAnnouncer.ts` (provider/composable, event-driven)

**Analog:** `src/ui/composables/useAnimationEvents.ts` (full file, 405 lines — small enough for one read)

**Imports pattern** (lines 35-36):
```typescript
import { ref, watch, type Ref, type InjectionKey, provide, inject } from 'vue';
import type { AnimationEvent } from '../../engine/index.js';
```
For `useAnnouncer.ts`, adapt to:
```typescript
import { ref, nextTick, type InjectionKey, provide, inject } from 'vue';
import { devWarn } from '../../utils/dev.js';
```

**InjectionKey + provide/inject pattern** (lines 100-121, exact mechanics to mirror):
```typescript
export const ANIMATION_EVENTS_KEY: InjectionKey<UseAnimationEventsReturn> = Symbol('animationEvents');

export function provideAnimationEvents(instance: UseAnimationEventsReturn): void {
  provide(ANIMATION_EVENTS_KEY, instance);
}

export function useAnimationEvents(): UseAnimationEventsReturn | undefined {
  // Pass undefined as default to suppress Vue's "injection not found" warning
  // Animation events are optional - components handle undefined gracefully
  return inject(ANIMATION_EVENTS_KEY, undefined);
}
```
**Deviation required by CONTEXT.md:** `useAnnouncer()` must return a *usable no-op object* (`{ announce }`), never `undefined` (callers do `const { announce } = useAnnouncer()` unconditionally, no null-check). So the `inject(KEY, undefined)` check must branch into a no-op fallback + `devWarn`, not just return the injected-or-undefined value directly:
```typescript
export function useAnnouncer(): UseAnnouncerReturn {
  const injected = inject(ANNOUNCER_KEY, undefined);
  if (!injected) {
    devWarn(
      'useAnnouncer-no-provider',
      'useAnnouncer() was called outside a GameShell-provided context — ' +
        'announcements will be no-ops. Only call useAnnouncer() from a component ' +
        'rendered inside GameShell (a custom UI or AutoUI component).',
    );
    return { announce: () => {} };
  }
  return injected;
}
```

**Factory function pattern** (lines 131-405, `createAnimationEvents`): a `createX(options)` factory that builds and returns the controller object, called once by GameShell before `provideX()`. Mirror the two-function shape (`createAnnouncer` + `provideAnnouncer`) rather than collapsing into one call — this keeps the controller logic unit-testable without mounting any component (see `useAnimationEvents.test.ts`, which tests `createAnimationEvents()` directly).

**Core write pattern (clear-then-set, from RESEARCH.md Pattern 2, adapted from GameShell's own ref-writing style at GameShell.vue:1747-1748):**
```typescript
async function announce(message: string, options?: { assertive?: boolean }): Promise<void> {
  const target = options?.assertive ? assertiveMessage : politeMessage;
  target.value = '';
  await nextTick();
  target.value = message;
  emitAnnounce(options?.assertive ? 'assertive' : 'polite', message);
}
```

**Dev-warning pattern** — do not hand-roll a `let warned = false` flag. Use the existing shared utility exactly as `anchorAttrs()` does in `src/ui/composables/useBoardInteraction.ts:422-437`:
```typescript
// src/ui/composables/useBoardInteraction.ts:428-434
devWarn(
  `anchorattrs-missing-${type}`,
  `anchorAttrs() produced no data-bs-el-* attributes for a selectable/renderable element (type: '${type}'). ` +
    `Custom boards must spread anchorAttrs(ref) (or v-bind="attrs" from useSelectable) onto each element's root ` +
    `so FLIP/flying-element animations and drag-drop can find it. Without an anchor, animations silently no-op ` +
    `and traces cannot identify the element. Pass at least one of { id, notation, name } on the ElementRef.`,
);
```
`devWarn(key, message)` source (`src/utils/dev.ts:124-129`):
```typescript
export function devWarn(key: string, message: string): void {
  if (!isDevMode()) return;
  if (shownWarnings.has(key)) return;
  shownWarnings.add(key);
  console.warn(`[BoardSmith] ${message}`);
}
```
Test-only reset hook: `_clearShownWarnings()` (`src/utils/dev.ts:135-137`) — use in `beforeEach` of `useAnnouncer.test.ts` to isolate the "warns once" assertion between test cases (mirrors how `useAnimationEvents.test.ts` uses `vi.spyOn(console, 'warn')` + `mockRestore()` per test).

---

### `src/ui/composables/useAnnouncer.test.ts` (unit test)

**Analog:** `src/ui/composables/useAnimationEvents.test.ts` (full file read; no `@vitest-environment jsdom` override — default `node` env, no component mount, tests `createX()` directly)

**Structure to mirror** (imports + describe blocks, lines 1-13, 1176-1186):
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, nextTick } from 'vue';
import {
  createAnimationEvents,
  provideAnimationEvents,
  useAnimationEvents,
  ANIMATION_EVENTS_KEY,
  type UseAnimationEventsReturn,
} from './useAnimationEvents.js';
...
describe('provide/inject', () => {
  it('ANIMATION_EVENTS_KEY is a Symbol', () => {
    expect(typeof ANIMATION_EVENTS_KEY).toBe('symbol');
  });

  it('provideAnimationEvents and useAnimationEvents are functions', () => {
    expect(typeof provideAnimationEvents).toBe('function');
    expect(typeof useAnimationEvents).toBe('function');
  });
});
```
Apply the same "provide/inject shape" describe block to `ANNOUNCER_KEY`/`provideAnnouncer`/`useAnnouncer`.

**Console-warning assertion style** (lines 762-786, timeout-and-warn test — adapt for the no-provider warning instead of a timeout):
```typescript
it('timeout expires and event is skipped with console warning', async () => {
  vi.useFakeTimers();
  const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  ...
  expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('unknownType'));
  consoleWarn.mockRestore();
});
```
For `useAnnouncer`, the direct analog test is simpler (no fake timers needed): mock `console.warn`, call `useAnnouncer()` with no ancestor `provide()` (Vue's `inject()` outside a component's `setup()` requires either an explicit `getCurrentInstance` mock or calling within a minimal `mount()`/`effectScope` — check how `useAnimationEvents()`'s own inject-based functions are tested; if `useAnimationEvents.test.ts` never calls `useAnimationEvents()` itself directly outside setup(), `useAnnouncer.test.ts` will need a lightweight `mount()`-based or `withSetup()` helper to invoke `useAnnouncer()` in a valid reactive context. Note: `useAnimationEvents.test.ts` never tests `useAnimationEvents()` the injector function directly — only `createAnimationEvents()` in isolation and the Symbol/function-existence checks. Planner should therefore add a minimal `withSetup`-style helper or use `@vue/test-utils`' `mount()` with a trivial component for the no-provider-warns-once assertion, since this is genuinely new test surface not covered by the animation-events analog.

**Duplicate-message re-announce test** (no direct analog exists for clear-then-set testing in this codebase; write from CONTEXT.md's testable proxy — assert the ref passes through `''` between two identical `announce()` calls, per RESEARCH.md Pitfall 2's "Warning signs" note).

---

### `src/ui/components/GameShell.announcer.test.ts` (component test, jsdom)

**Analog (mount + global.provide mechanics):** `src/ui/components/auto-ui/ActionPanel.test.ts` (lines 240-267 read)

**Mount + provide pattern:**
```typescript
const wrapper = mount(ActionPanel, {
  global: { provide: { actionController: controller } },
  props: { availableActions: [], playerSeat: 1, isMyTurn: true },
});
```
For the announcer parity test, per RESEARCH.md's Code Examples section (already vetted against in-repo conventions):
```typescript
import { mount } from '@vue/test-utils';
import { ANNOUNCER_KEY } from '../composables/useAnnouncer.js';

it('AutoUI component receives the same announcer instance as a custom UI component', () => {
  const announceSpy = vi.fn();
  const wrapper = mount(SomeAutoUIDescendantComponent, {
    global: { provide: { [ANNOUNCER_KEY]: { announce: announceSpy } } },
  });
  expect(announceSpy).toHaveBeenCalled();
});
```
Note: `@vue/test-utils`'s `global.provide` accepts Symbol keys identically to string keys (confirmed working pattern in this codebase via `ActionPanel.test.ts`'s string-key `provide`).

**Naming/doc-comment style analog:** `src/ui/components/GameShell.live-region.test.ts` (full file read, 99 lines) — file-level doc comment explains *why* the test avoids mounting full `GameShell.vue`:
```typescript
// @vitest-environment node
/**
 * Behavioral tests for GameShell live-region announcement mapping.
 *
 * Instead of mounting the full GameShell component (which requires
 * extensive mocking of the game client and composables), we test the
 * pure announce-mapping helper extracted from GameShell. ...
 */
```
`GameShell.announcer.test.ts` needs the opposite tradeoff (RESEARCH.md flags this explicitly): it MUST actually `mount()` something to prove provide/inject parity, since that's a Vue-tree-structural claim, not a pure-function claim. RESEARCH.md's Wave-0-gap note recommends mounting a **minimal test host component** that calls `provideAnnouncer()`/renders a descendant that calls `useAnnouncer()` — not the full `GameShell.vue` (which needs extensive client/session mocking per the comment above). Do not attempt to mount real `GameShell.vue` for this test; build a tiny local test-host SFC or `defineComponent` inline, matching the "extensive mocking" avoidance rationale from the live-region test file.

**postMessage relay assertion** — spy on `window.postMessage` (no direct in-repo analog test found for this specific assertion; build from GameShell's own `emitAnnounce` implementation, GameShell.vue:347-349):
```typescript
function emitAnnounce(level: 'polite' | 'assertive', text: string): void {
  window.postMessage({ source: 'boardsmith-a11y', type: 'announce', level, text }, '*');
}
```
Test should spy `vi.spyOn(window, 'postMessage')` and assert the exact shape `{ source: 'boardsmith-a11y', type: 'announce', level, text }` is called after `announce()`.

---

### `src/ui/components/GameShell.vue` (edit — wire `createAnnouncer`/`provideAnnouncer`)

**Analog:** the same file's existing `createAnimationEvents`/`provideAnimationEvents` wiring

**Existing wiring pattern to mirror** (GameShell.vue:351-355):
```typescript
// Animation events - wire createAnimationEvents to server state
const animationEvents = createAnimationEvents({
  events: () => state.value?.state?.animationEvents,
});
provideAnimationEvents(animationEvents);
```

**Existing refs + relay function to REUSE, not duplicate** (GameShell.vue:340-349):
```typescript
// Screen-reader live-region message refs.
// Written only from watchers with immediate:false — never at mount (Pitfall 2).
const politeMessage = ref('');
const assertiveMessage = ref('');

// Emit an announce postMessage alongside each live-region write so a future
// host page can relay the announcement to its own AT-accessible DOM node.
function emitAnnounce(level: 'polite' | 'assertive', text: string): void {
  window.postMessage({ source: 'boardsmith-a11y', type: 'announce', level, text }, '*');
}
```

**New wiring to add near the animation-events wiring (after line 355), per RESEARCH.md:**
```typescript
const announcer = createAnnouncer({ politeMessage, assertiveMessage, emitAnnounce });
provideAnnouncer(announcer);
```

**Existing `provide()` call-site block to add alongside** (GameShell.vue:962-974) — not required (the announcer is provided via its own `provideAnnouncer()` call, not the raw `provide('key', ...)` calls here), but this is the established location cluster for GameShell's descendant-facing provides; keep the new `provideAnnouncer()` call near this cluster or immediately after the `createAnimationEvents`/`provideAnimationEvents` pair (line 355) per CONTEXT.md's "near its other provide() calls" note.

**Existing watchers this must NOT duplicate or conflict with** (GameShell.vue:1742-1815, four `watch(..., { immediate: false })` blocks writing directly to `politeMessage.value`/`assertiveMessage.value` without clear-then-set). `useAnnouncer()`'s `announce()` writes to the SAME refs but uses clear-then-set internally — CONTEXT.md confirms last-write-wins with no queue, so no coordination logic is needed beyond both paths writing to the same refs.

**Live-region DOM nodes (already exist, do not duplicate)** (GameShell.vue:1913-1914):
```html
<p class="vh" role="status" aria-live="polite">{{ politeMessage }}</p>
<p class="vh" role="alert" aria-live="assertive">{{ assertiveMessage }}</p>
```

---

### `src/ui/index.ts` (edit — add export)

**Analog:** `useBoardSize` export (line 154) and the `useAnimationEvents` export block (lines ~141-151)

**Existing exports to mirror:**
```typescript
// src/ui/index.ts:153-154
// Board sizing for content-flow custom boards (see docs/custom-ui-guide.md "Board Sizing")
export { useBoardSize } from './composables/useBoardSize.js';

// src/ui/index.ts:141-151 (multi-export block style, for the type exports)
export {
  ...
  type UseAnimationEventsReturn,
} from './composables/useAnimationEvents.js';
```
Add (per CONTEXT.md: "alongside `useBoardSize`"):
```typescript
export {
  useAnnouncer,
  provideAnnouncer,
  type UseAnnouncerReturn,
} from './composables/useAnnouncer.js';
```

## Shared Patterns

### provide/inject with graceful missing-provider handling
**Source:** `src/ui/composables/useAnimationEvents.ts:100-121` (mechanics) + CONTEXT.md decision (return shape override)
**Apply to:** `useAnnouncer.ts` only in this phase, but this is the canonical composable shape for the whole `src/ui/composables/` directory
```typescript
export const ANNOUNCER_KEY: InjectionKey<UseAnnouncerReturn> = Symbol('announcer');
export function provideAnnouncer(instance: UseAnnouncerReturn): void {
  provide(ANNOUNCER_KEY, instance);
}
export function useAnnouncer(): UseAnnouncerReturn {
  const injected = inject(ANNOUNCER_KEY, undefined); // explicit default suppresses Vue's warning
  if (!injected) {
    devWarn('useAnnouncer-no-provider', '...');
    return { announce: () => {} };
  }
  return injected;
}
```

### One-time dev-mode warning
**Source:** `src/utils/dev.ts:124-129` (`devWarn`), used identically by `src/ui/composables/useBoardInteraction.ts:428-434` (`anchorAttrs`)
**Apply to:** `useAnnouncer.ts`'s no-provider case
```typescript
export function devWarn(key: string, message: string): void {
  if (!isDevMode()) return;
  if (shownWarnings.has(key)) return;
  shownWarnings.add(key);
  console.warn(`[BoardSmith] ${message}`);
}
```
Test helper: `_clearShownWarnings()` (`src/utils/dev.ts:135-137`) — reset between test cases in `useAnnouncer.test.ts`.

### Live-region write + postMessage relay (existing GameShell mechanism, reused not duplicated)
**Source:** `src/ui/components/GameShell.vue:340-349, 1742-1815, 1913-1914`
**Apply to:** `useAnnouncer.ts`'s `announce()` implementation (via refs/function passed in from GameShell, not re-implemented)
```typescript
const politeMessage = ref('');
const assertiveMessage = ref('');
function emitAnnounce(level: 'polite' | 'assertive', text: string): void {
  window.postMessage({ source: 'boardsmith-a11y', type: 'announce', level, text }, '*');
}
```

### `mount()` + `global.provide` for component-level parity tests
**Source:** `src/ui/components/auto-ui/ActionPanel.test.ts:240-267`
**Apply to:** `GameShell.announcer.test.ts`
```typescript
const wrapper = mount(SomeComponent, {
  global: { provide: { [ANNOUNCER_KEY]: mockAnnouncer } },
  props: { ... },
});
```

## No Analog Found

None — all 5 files have a strong or exact analog in the codebase (this phase is explicitly additive to an existing, singular pattern set per RESEARCH.md; every mechanic it needs already exists in-repo).

One partial gap worth flagging to the planner (not a missing analog, but a missing *test technique*): no existing test in this codebase directly calls an injector function like `useAnimationEvents()`/`useAnnouncer()` outside a component's `setup()` context to assert the no-provider warning path — `useAnimationEvents.test.ts` only checks `typeof useAnimationEvents === 'function'`, never invokes it standalone. The planner should specify a `withSetup()` helper or a minimal `mount()`-based host component in `useAnnouncer.test.ts` for that specific assertion (see `GameShell.announcer.test.ts` section above for the same technique applied at the component level).

## Metadata

**Analog search scope:** `src/ui/composables/`, `src/ui/components/`, `src/ui/index.ts`, `src/utils/dev.ts`
**Files scanned:** `useAnimationEvents.ts`, `useAnimationEvents.test.ts`, `GameShell.vue` (targeted line ranges), `GameShell.live-region.test.ts`, `auto-ui/ActionPanel.test.ts` (targeted range), `useBoardInteraction.ts` (targeted range, `anchorAttrs`), `src/utils/dev.ts`, `src/ui/index.ts` (targeted range)
**Pattern extraction date:** 2026-07-04
