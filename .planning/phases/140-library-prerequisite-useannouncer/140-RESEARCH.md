# Phase 140: Library Prerequisite — useAnnouncer() - Research

**Researched:** 2026-07-04
**Domain:** Vue 3 composables (provide/inject), screen-reader live regions
**Confidence:** HIGH

## Summary

This phase adds one small, well-precedented composable to an existing, mature pattern set. GameShell.vue already owns two live-region refs (`politeMessage`/`assertiveMessage`), a `postMessage` relay (`emitAnnounce`), and four watcher call sites that write to them. `useAnnouncer()` needs to expose that same write path to arbitrary descendant components via provide/inject, following the exact shape of `useAnimationEvents.ts` (the codebase's canonical provide/inject composable). No new packages, no new DOM nodes, no new architecture — this is 100% code-reuse of existing conventions.

The two technical risks called out in the phase description are both resolved by direct code inspection, not speculation: (1) AutoUI parity is structurally guaranteed because `AutoUI.vue`/the custom-UI slot are rendered via `<component :is="selectedUiComponent">` directly inside `GameShell.vue`'s own template — they are genuine Vue-tree descendants of the component that will call `provide()`, so `inject()` works identically for both without any bridging; and (2) the codebase already has a shared "warn once in dev mode" utility (`devWarn` in `src/utils/dev.ts`, re-exported from `boardsmith/utils`) that exactly matches the CONTEXT.md requirement for a one-time dev-mode `console.warn` on missing-provider use — no need to hand-roll a warned-once flag.

**Primary recommendation:** Create `src/ui/composables/useAnnouncer.ts` mirroring `useAnimationEvents.ts`'s `InjectionKey` + `provideX`/`useX` shape; have `GameShell.vue` call `provideAnnouncer()` wired to its existing `politeMessage`/`assertiveMessage` refs and `emitAnnounce()` function (do not duplicate that logic); use `devWarn()` from `src/utils/dev.ts` for the no-provider case; and prove AutoUI/custom-UI parity with a `@vue/test-utils` `mount()` test using `global: { provide: { [ANNOUNCER_KEY]: mockAnnouncer } }`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `useAnnouncer()` composable (public API) | Browser / Client (Vue UI layer) | — | Pure client-side Vue composable; no server/session involvement |
| Live-region DOM writes (`politeMessage`/`assertiveMessage`) | Browser / Client (GameShell.vue) | — | GameShell already owns these refs and the rendered `<p role="status">`/`<p role="alert">` nodes; useAnnouncer must write through GameShell's existing refs, not create new ones |
| Cross-frame relay (`boardsmith-a11y` postMessage) | Browser / Client (GameShell.vue → parent frame) | — | Existing `emitAnnounce()` function in GameShell; useAnnouncer triggers it, does not reimplement it |
| Dev-mode no-provider warning | Browser / Client (shared utility) | — | `devWarn()` in `src/utils/dev.ts`, consumed by the UI composable |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vue | 3.x (already a project dependency) | provide/inject, `ref`, `nextTick` | Existing framework; no version change needed [VERIFIED: package.json] |

No new packages are required for this phase. `useAnnouncer()` is built entirely from Vue core APIs and existing in-repo utilities.

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@vue/test-utils` | ^2.4.11 (already a devDependency) | Mounting components with `global.provide` to test inject parity | Writing the AutoUI-vs-custom-UI parity test [VERIFIED: package.json:94] |
| vitest | already configured | Unit + component tests | All new tests |

### Alternatives Considered

None — this phase is additive to an existing, singular pattern (provide/inject via `useAnimationEvents.ts`). There is no competing approach worth evaluating; deviating from the established composable shape would itself be the anti-pattern.

**Installation:** No installation needed — zero new dependencies.

## Package Legitimacy Audit

Not applicable — this phase installs no external packages. Skipping the Package Legitimacy Gate per its own scope condition ("whenever this phase installs external packages").

## Architecture Patterns

### System Architecture Diagram

```
GameShell.vue (root, owns state)
│
│  setup():
│   const politeMessage = ref('')
│   const assertiveMessage = ref('')
│   function emitAnnounce(level, text) { postMessage(...) }
│   const announcer = createAnnouncer({ politeMessage, assertiveMessage, emitAnnounce })
│   provideAnnouncer(announcer)   ──────────────┐
│                                                │ (Vue provide/inject —
│  <template>                                   │  same component tree,
│   <slot name="game-board" />  ◄── custom UI ──┤  no postMessage/bridge
│   <component :is="selectedUiComponent" />      │  needed)
│     (AutoUI.vue OR a game's uis[] component) ◄─┘
│   <p role="status" aria-live="polite">{{ politeMessage }}</p>
│   <p role="alert" aria-live="assertive">{{ assertiveMessage }}</p>
│  </template>
│
▼
Any descendant component (custom UI component OR AutoUI/ActionPanel/renderer)
  const { announce } = useAnnouncer()
  announce('Card drawn')
       │
       ▼
  writes politeMessage.value (clear → nextTick → set)
       │
       ▼
  screen reader reads the live region text (no new DOM node created)
       │
       └──► emitAnnounce('polite', text) → window.postMessage('boardsmith-a11y')
                                             → platform-mode host page (optional relay)
```

Both the `#game-board` slot content (custom UI) and `<component :is="selectedUiComponent">` (AutoUI or an extra `uis[]` UI) are rendered as direct template children of `GameShell.vue` — i.e., genuine descendants in the same Vue component tree that calls `provide()`. There is no iframe boundary or separate Vue app instance between them: the iframe/platform-mode boundary in the CLI dev host is at the *browser-tab* level (GameShell.vue running inside an iframe as a whole), not between GameShell and the UI it renders internally. This structurally guarantees inject() parity — no bridging code is needed, and the "prove it" test is a straightforward two-case mount test, not a technical challenge. [VERIFIED: GameShell.vue:2191 `<component :is="selectedUiComponent">`, GameShell.vue:187-203 `selectedUiComponent`/`DevAutoUI` wiring]

### Recommended Project Structure
```
src/ui/composables/
├── useAnnouncer.ts          # new: InjectionKey, provideAnnouncer, useAnnouncer, createAnnouncer
├── useAnnouncer.test.ts     # new: unit tests (createAnnouncer logic, no-provider warning)
├── useAnimationEvents.ts    # existing: pattern to mirror exactly
└── liveRegionAnnouncer.ts   # existing: pure mapping fns GameShell already uses — do not touch

src/ui/components/
├── GameShell.vue                        # add: createAnnouncer() + provideAnnouncer() call
├── GameShell.announcer.test.ts           # new: parity test (custom-UI vs AutoUI inject) — sibling to GameShell.live-region.test.ts
└── GameShell.live-region.test.ts         # existing: style/format to mirror for behavioral tests

src/ui/index.ts   # add: useAnnouncer export, alongside useBoardSize (line 154)
```

### Pattern 1: InjectionKey + provide/inject composable pair (mirror `useAnimationEvents.ts`)
**What:** A `Symbol`-based `InjectionKey<T>`, a `provideX(instance)` function called once from `GameShell.vue`'s `setup()`, and a `useX()` function that injects with an explicit `undefined` default (suppresses Vue's "injection not found" console warning) so consumers get `undefined` gracefully outside GameShell instead of a Vue framework warning.
**When to use:** Any composable whose data must flow from GameShell to arbitrary descendant components without prop drilling.
**Example:**
```typescript
// Source: src/ui/composables/useAnimationEvents.ts (existing, in-repo pattern)
export const ANNOUNCER_KEY: InjectionKey<UseAnnouncerReturn> = Symbol('announcer');

export function provideAnnouncer(instance: UseAnnouncerReturn): void {
  provide(ANNOUNCER_KEY, instance);
}

export function useAnnouncer(): UseAnnouncerReturn {
  const injected = inject(ANNOUNCER_KEY, undefined);
  if (!injected) {
    devWarn('useAnnouncer-no-provider',
      'useAnnouncer() called outside a GameShell — announcements are no-ops. ' +
      'This composable only works inside a component tree rendered by GameShell.');
    return { announce: () => {} };
  }
  return injected;
}
```
Note the CONTEXT.md decision that `useAnnouncer()` should return a *usable no-op object* (`{ announce }` that does nothing), not `undefined` — this differs slightly from `useAnimationEvents()`'s `| undefined` return type, because CONTEXT.md's locked API surface is `const { announce } = useAnnouncer()` unconditionally (callers should never need to null-check). Follow CONTEXT.md's shape, not `useAnimationEvents`'s optional-return shape, for the return type — but follow `useAnimationEvents`'s InjectionKey/provide/inject *mechanics* exactly.

### Pattern 2: Clear-then-set for duplicate-message re-announcement
**What:** To force screen readers to re-announce an identical string (ARIA live regions only announce on *change*), reset the ref to `''` first, wait a tick, then set the real value.
**When to use:** Every `announce()` call, since callers may legitimately want to repeat an announcement (CONTEXT.md decision).
**Example:**
```typescript
// Vue's nextTick — src/ui/components/GameShell.vue already imports nextTick (line 2, used at line 1834)
async function announce(message: string, options?: { assertive?: boolean }): Promise<void> {
  const target = options?.assertive ? assertiveMessage : politeMessage;
  target.value = '';
  await nextTick();
  target.value = message;
  emitAnnounce(options?.assertive ? 'assertive' : 'polite', message);
}
```
Note: GameShell's *existing* four watcher call sites (turn/connection/game-over/opponent-turn) do NOT do clear-then-set today — they just assign directly (GameShell.vue:1744-1815). Do not change that existing behavior; `useAnnouncer()`'s own write path is additive and may reasonably want the more robust clear-then-set technique since its messages are arbitrary and repeats are more likely. Confirm with the planner whether `announce()` should be sync or return a Promise — a Promise-returning `announce()` makes tests trivially awaitable but slightly changes the "just call it" ergonomics CONTEXT.md implies with `const { announce } = useAnnouncer(); announce(...)`. Sync-fire-and-forget-internally (not awaited by caller) is likely closer to the locked API shape; internally `await nextTick()` inside an async IIFE or non-awaited async function is fine either way.

### Pattern 3: One-time dev-mode warning via shared `devWarn()` utility
**What:** `devWarn(key, message)` in `src/utils/dev.ts` (exported from `boardsmith/utils`) logs `console.warn` exactly once per unique `key`, gated on `isDevMode()`.
**When to use:** The CONTEXT.md-mandated "no-op + one-time dev-mode console.warn" behavior when `useAnnouncer()` is called with no ancestor `provideAnnouncer()`.
**Example:**
```typescript
// Source: src/utils/dev.ts:124 (existing, already used by anchorAttrs() in useBoardInteraction.ts:428)
import { devWarn } from '../../utils/dev.js';
devWarn('useAnnouncer-no-provider', '...');
```
This is a directly reusable existing utility — do not hand-roll a `let warned = false` module-level flag; `devWarn` already solves exactly this problem and is unit-tested (`src/utils/dev.test.ts`, has a `_clearShownWarnings()` test-only reset hook).

### Anti-Patterns to Avoid
- **Creating a second pair of live-region DOM nodes:** Success criterion 2 explicitly requires writing to GameShell's *existing* `politeMessage`/`assertiveMessage` refs — do not add a third `<p role="status">`/`alert` element "for the composable's own messages."
- **Re-deriving the postMessage relay:** `emitAnnounce()` already exists in GameShell.vue (line 347) — `useAnnouncer()`'s `announce()` must call through to it (or GameShell must call it for every `announce()`-driven write), not reimplement the `boardsmith-a11y` postMessage shape independently.
- **Hand-rolled dev-warning dedup:** use `devWarn()`, not a new `Set`/boolean flag (see Pattern 3).
- **Bridging AutoUI via postMessage/props:** unnecessary — AutoUI is a genuine Vue-tree descendant of GameShell (see Architecture Diagram); provide/inject already reaches it with zero extra plumbing.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| One-time dev warning when used outside a provider | A new `warned` flag / `Set<string>` | `devWarn(key, message)` from `src/utils/dev.ts` | Already exists, already tested, already the established convention (`anchorAttrs()` uses it identically) |
| provide/inject wiring shape | A bespoke pattern | Mirror `useAnimationEvents.ts`'s `InjectionKey` + `provideX`/`useX` + factory function (`createAnnouncer`) shape | Established, reviewed, precedent for exactly this "GameShell owns state, descendants inject a controller object" shape |
| Live-region text writing | New refs/DOM nodes | GameShell's existing `politeMessage`/`assertiveMessage` refs | Success criterion 2 explicitly forbids new DOM nodes |
| Cross-frame relay | New postMessage type | Existing `emitAnnounce()` / `boardsmith-a11y` message shape | CONTEXT.md decision explicitly requires firing the *existing* relay |

**Key insight:** This phase has zero net-new architecture. Every piece it needs — the live-region refs, the postMessage relay, the provide/inject pattern, the dev-warning utility — already exists in the codebase. The work is exposing an existing internal capability through a new public composable seam, not inventing new mechanics.

## Common Pitfalls

### Pitfall 1: Silent first announcement (immediate:true trap)
**What goes wrong:** If any watcher or the composable's own reactive wiring runs with `immediate: true`, GameShell will announce something the instant a component mounts (e.g., before the player has even seen the game), and the very first "real" announcement gets swallowed by the ARIA live-region change-detection (nothing appears to change because the region already had the same recent value, or the SR hasn't attached yet).
**Why it happens:** GameShell's four existing live-region watchers are deliberately `{ immediate: false }` (GameShell.vue:1742 comment: "Live-region watchers (immediate: false — never write to regions at mount)"). `useAnnouncer()` itself is imperative (`announce()` is called explicitly by the developer, not driven by a watcher), so this specific pitfall mostly does not apply to `useAnnouncer()`'s own code — but it's a relevant constraint if the plan adds any watcher-driven wiring inside `createAnnouncer()` itself.
**How to avoid:** Keep `announce()` purely imperative — no watchers inside `useAnnouncer.ts` that fire on mount. If a "reset on unmount" or similar reactive touch is added, gate it `immediate: false`.
**Warning signs:** A test that mounts a component and expects the live region to still be empty until `announce()` is explicitly called; if it isn't, a watcher fired eagerly.

### Pitfall 2: ARIA live regions do not re-announce identical text without a change
**What goes wrong:** Calling `announce('Card drawn')` twice in a row (or announce() firing the same text GameShell's own watchers already set) results in the screen reader announcing it only once, because assistive tech detects DOM *mutation*, and setting a ref to the same string may not even trigger a DOM patch (Vue's reactivity often skips re-render when the new value === old value, and browsers also frequently no-op unchanged text mutations for AT purposes).
**Why it happens:** `aria-live` regions are observed via mutation, not polled; identical-value re-renders can be optimized away at the Vue level, the DOM level, or the AT level.
**How to avoid:** Clear-then-set with `nextTick()` (Pattern 2) — CONTEXT.md already locks this decision explicitly ("Repeated identical messages use clear-then-set... so screen readers re-announce duplicates").
**Warning signs:** A test asserting two consecutive `announce('same text')` calls both result in a DOM mutation event (or, more practically, that the ref passes through `''` between the two sets — this is testable without a real screen reader).

### Pitfall 3: `inject()` without an explicit default logs a Vue framework warning
**What goes wrong:** `inject(KEY)` with no second argument throws a console warning ("injection not found") in dev mode whenever a component using `useAnnouncer()` is *not* a descendant of a component that called `provideAnnouncer()` — e.g. in most existing unit tests for other components that don't bother providing an announcer.
**Why it happens:** Vue's `inject()` API defaults to warning when a key isn't found and no default value is supplied.
**How to avoid:** `useAnimationEvents()` avoids this by calling `inject(KEY, undefined)` — an explicit default suppresses the warning (see `useAnimationEvents.ts` comment: "Pass undefined as default to suppress Vue's 'injection not found' warning"). Do the same in `useAnnouncer()`.
**Warning signs:** Unrelated component test suites start emitting new Vue console warnings after this phase ships, if `useAnnouncer()` is called from a component under test that isn't wrapped with the provider.

### Pitfall 4: Confusing the CLI dev-host iframe boundary with a component-tree boundary
**What goes wrong:** Assuming AutoUI needs a postMessage bridge to receive announcements because `boardsmith dev` runs each seat's GameShell inside an iframe.
**Why it happens:** The iframe boundary is real (CLAUDE.md: "each browser is a real player connecting over WS, rendering its seat via a GameShell iframe in platform mode"), but that boundary is *outside* GameShell, between the dev-host chrome page and the GameShell Vue app. AutoUI is rendered *inside* the same GameShell Vue app/iframe via `<component :is="selectedUiComponent">` — same Vue instance, same provide/inject scope.
**How to avoid:** Verify via `GameShell.vue:2191` (`<component :is="selectedUiComponent">`) and the `selectedUiComponent` computed (lines 197-203) — both AutoUI and any game's extra `uis[]` component resolve to the same slot position in GameShell's own template.
**Warning signs:** Time spent designing a message-passing bridge between GameShell and AutoUI for this feature — that's a sign the iframe/component-tree distinction has been conflated.

## Code Examples

### Injection key + provide/inject skeleton (mirrors useAnimationEvents.ts)
```typescript
// Source: pattern from src/ui/composables/useAnimationEvents.ts (existing in-repo)
import { ref, nextTick, type InjectionKey, provide, inject } from 'vue';
import { devWarn } from '../../utils/dev.js';

export interface UseAnnouncerReturn {
  announce: (message: string, options?: { assertive?: boolean }) => void;
}

export const ANNOUNCER_KEY: InjectionKey<UseAnnouncerReturn> = Symbol('announcer');

export function provideAnnouncer(instance: UseAnnouncerReturn): void {
  provide(ANNOUNCER_KEY, instance);
}

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

### GameShell wiring (writes through existing refs, fires existing relay)
```typescript
// Source: src/ui/components/GameShell.vue:340-349 (existing refs/relay, do not duplicate)
const politeMessage = ref('');
const assertiveMessage = ref('');
function emitAnnounce(level: 'polite' | 'assertive', text: string): void {
  window.postMessage({ source: 'boardsmith-a11y', type: 'announce', level, text }, '*');
}

// New: wire useAnnouncer to the same refs/relay
const announcer = createAnnouncer({ politeMessage, assertiveMessage, emitAnnounce });
provideAnnouncer(announcer);
```

### Parity test skeleton (custom-UI vs AutoUI inject)
```typescript
// Source: pattern from src/ui/components/auto-ui/ActionPanel.test.ts:254
// (global.provide with a Symbol key works identically to a string key in @vue/test-utils)
import { mount } from '@vue/test-utils';
import { ANNOUNCER_KEY } from '../composables/useAnnouncer.js';

it('AutoUI component receives the same announcer instance as a custom UI component', () => {
  const announceSpy = vi.fn();
  const wrapper = mount(SomeAutoUIDescendantComponent, {
    global: { provide: { [ANNOUNCER_KEY]: { announce: announceSpy } } },
  });
  // trigger whatever calls useAnnouncer().announce(...) inside the component
  expect(announceSpy).toHaveBeenCalled();
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| GameShell hardcodes 4 specific announcements (turn/connection/game-over/opponent-turn) via `liveRegionAnnouncer.ts` pure functions | GameShell keeps those 4 built-ins AND exposes a generic `useAnnouncer()` for arbitrary game-specific messages | This phase (140) | Games can now announce their own state changes (e.g., "3 cards remain in deck") without modifying GameShell |

No deprecations — this is purely additive.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `announce()` should be synchronous from the caller's perspective (internally awaits `nextTick()` without forcing callers to `await`) rather than returning a Promise | Pattern 2 | If the planner instead makes `announce()` return a `Promise<void>`, tests must account for that; low risk either way, but affects the exact function signature the planner locks in |
| A2 | The clear-then-set duplicate-message technique should apply to ALL `announce()` calls uniformly, not just literal-duplicate detection | Pattern 2 | If clear-then-set is only meant to trigger conditionally (e.g., only when the new message equals the current ref value), the simpler always-clear approach could cause an unnecessary extra render tick on every single call. CONTEXT.md's wording ("repeated identical messages use clear-then-set") is slightly ambiguous between "always clear-then-set" and "clear-then-set only for detected repeats" — recommend defaulting to always-clear-then-set for implementation simplicity (matches CONTEXT's "no queue, simple" philosophy elsewhere), but flag for planner confirmation |

## Open Questions (RESOLVED)

1. **RESOLVED (planner): single static key `'useAnnouncer-no-provider'`.** Should `useAnnouncer()`'s no-provider no-op warn using the exact `devWarn` key `'useAnnouncer-no-provider'`, or should the planner pick a different key?
   - What we know: `devWarn(key, message)` dedups per unique key across the whole app lifetime (module-level `Set`), and tests use `_clearShownWarnings()` to reset between test cases.
   - What's unclear: Whether a single global key is fine, or whether it should be dynamic per call site (unlikely needed here, since the message is generic and not per-instance like `anchorAttrs`'s per-`type` keys).
   - Recommendation: A single static key is sufficient and simpler — `useAnnouncer()`'s no-provider case is a single homogeneous warning, unlike `anchorAttrs()`'s per-element-type warnings.

2. **RESOLVED (planner): mirror the two-function `createAnnouncer` + `provideAnnouncer` shape.** Does `createAnnouncer()` need to be a separately exported factory function (like `createAnimationEvents`), or can `provideAnnouncer()` build the instance internally from refs passed in?
   - What we know: `useAnimationEvents.ts` exports `createAnimationEvents(options)` as a standalone factory, called by GameShell, then passed to `provideAnimationEvents(instance)` — two separate calls.
   - What's unclear: Whether `useAnnouncer.ts` should follow that exact two-function shape or could collapse to one `provideAnnouncer({ politeMessage, assertiveMessage, emitAnnounce })` call.
   - Recommendation: Mirror the two-function shape (`createAnnouncer` + `provideAnnouncer`) for consistency with `useAnimationEvents.ts` and because it keeps the "build a controller object" logic unit-testable in isolation from Vue's provide/inject machinery (as `useAnimationEvents.test.ts` does — it tests `createAnimationEvents()` directly without mounting any component).

## Environment Availability

Skipped — this phase has no external tool/service/runtime dependencies. It is a pure Vue/TypeScript code change within the existing project (no new packages, no new CLI tools, no new services).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (already configured) [VERIFIED: vitest.config.ts] |
| Config file | `/Users/jtsmith/BoardSmith/vitest.config.ts` (default `environment: 'node'`; individual files override with `// @vitest-environment jsdom` comment, e.g. `HeatmapOverlay.test.ts`) |
| Quick run command | `npx vitest run src/ui/composables/useAnnouncer.test.ts` |
| Full suite command | `npm test` (per package.json script; confirm exact script name before writing plan tasks) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LIB-01 | `useAnnouncer()` is importable from `boardsmith/ui` and returns `{ announce }` | unit | `npx vitest run src/ui/composables/useAnnouncer.test.ts` | ❌ Wave 0 |
| LIB-01 | `announce()` writes to GameShell's existing `politeMessage`/`assertiveMessage` refs, no new DOM node created | component (jsdom) | `npx vitest run src/ui/components/GameShell.announcer.test.ts` | ❌ Wave 0 |
| LIB-01 | Identical repeated messages clear-then-set (re-announce) | unit | `npx vitest run src/ui/composables/useAnnouncer.test.ts` | ❌ Wave 0 |
| LIB-01 | No-provider usage no-ops + warns once (dev mode) | unit | `npx vitest run src/ui/composables/useAnnouncer.test.ts` | ❌ Wave 0 |
| LIB-01 | AutoUI and custom-UI components both receive the same injected announcer (parity) | component (jsdom, `@vue/test-utils` `mount` + `global.provide`) | `npx vitest run src/ui/components/GameShell.announcer.test.ts` | ❌ Wave 0 |
| LIB-01 | Each `announce()` fires the existing `boardsmith-a11y` postMessage relay | component/unit (spy on `window.postMessage`) | `npx vitest run src/ui/components/GameShell.announcer.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/ui/composables/useAnnouncer.test.ts src/ui/components/GameShell.announcer.test.ts`
- **Per wave merge:** `npm test` (full suite) to confirm no regressions to `GameShell.live-region.test.ts` or other GameShell tests
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/ui/composables/useAnnouncer.ts` — the composable itself (does not exist yet)
- [ ] `src/ui/composables/useAnnouncer.test.ts` — unit tests for `createAnnouncer()`/no-provider warning, mirroring `useAnimationEvents.test.ts`'s node-environment, no-mount style
- [ ] `src/ui/components/GameShell.announcer.test.ts` — jsdom component test proving custom-UI/AutoUI parity and postMessage relay firing, mirroring `GameShell.live-region.test.ts`'s doc-comment style (note: that existing file tests only the pure mapping functions, NOT a mounted GameShell — the new parity test will need to actually `mount()` something, likely a minimal test host component that calls `provideAnnouncer()`/`useAnnouncer()`, rather than the full `GameShell.vue` which requires extensive client/session mocking per the existing file's own comment)
- [ ] No framework install needed — vitest and `@vue/test-utils` are already project dependencies

## Security Domain

Not applicable / low relevance — check `.planning/config.json` for `security_enforcement` setting before omitting.

<!-- If security_enforcement is not explicitly false, note: this phase has no auth/session/network/crypto surface. useAnnouncer() only writes to a local Vue ref and fires a same-origin window.postMessage — no new attack surface (V2/V3/V4/V6 not applicable). V5 Input Validation: the `message` string parameter should be treated as plain text rendered via Vue's `{{ }}` interpolation (already used for the existing politeMessage/assertiveMessage refs at GameShell.vue:1913-1914), which is auto-escaped by Vue — no XSS risk from caller-supplied announce() text as long as the plan does not introduce a v-html binding for these regions. -->

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes (minor) | Rely on Vue's default text-interpolation escaping (`{{ message }}`) for the live-region `<p>` elements — do not switch to `v-html` |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Caller passes attacker-controlled string as the announce message (e.g., a hostile game's UI, or malformed server state text) | Tampering / Information Disclosure (low severity, cosmetic) | Vue's default `{{ }}` text interpolation escapes HTML; keep it that way — never render `politeMessage`/`assertiveMessage` via `v-html` |

## Sources

### Primary (HIGH confidence)
- `src/ui/components/GameShell.vue` (lines 2, 48, 187-203, 317, 340-349, 355, 685, 962-974, 1742-1815, 2191) — direct code read, confirms live-region refs, emitAnnounce, AutoUI-in-tree rendering, existing provide() calls, watcher immediate:false convention
- `src/ui/composables/useAnimationEvents.ts` — direct code read, the canonical provide/inject composable pattern to mirror
- `src/ui/composables/liveRegionAnnouncer.ts` — direct code read, pure-function announcement mapping style
- `src/ui/components/GameShell.live-region.test.ts` — direct code read, confirms node-environment pure-function test style
- `src/utils/dev.ts` — direct code read, confirms `devWarn`/`isDevMode` shared one-time-warning utility already exists and is exported from `boardsmith/utils`
- `src/ui/composables/useBoardInteraction.ts` (lines 400-437, `anchorAttrs`) — direct code read, confirms `devWarn` is already used for exactly this "dev-mode warn once" pattern elsewhere in the codebase
- `src/ui/components/auto-ui/ActionPanel.test.ts` (line 254) — direct code read, confirms `@vue/test-utils` `mount(..., { global: { provide: {...} } })` pattern already used in-repo
- `package.json` (lines 50-52, 94) — direct read, confirms `boardsmith/utils` export path and `@vue/test-utils` devDependency version
- `vitest.config.ts` — direct read, confirms default `environment: 'node'` with per-file jsdom override convention

### Secondary (MEDIUM confidence)
None used — all findings were verified by direct in-repo code inspection (HIGH confidence).

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies, all mechanics already exist in-repo and were read directly
- Architecture: HIGH — AutoUI/custom-UI parity claim verified by reading the exact template line (`GameShell.vue:2191`) rather than assumed
- Pitfalls: HIGH — all four pitfalls are drawn from existing in-repo comments/conventions (immediate:false rule, inject-default-undefined rule, devWarn precedent), not speculation

**Research date:** 2026-07-04
**Valid until:** 30 days (stable internal codebase pattern, no external API drift risk)
