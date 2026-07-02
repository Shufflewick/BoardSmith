# Phase 128: Animation & Drag-Drop Test Story - Research

**Researched:** 2026-07-02
**Domain:** Vue 3 composables (animation/drag-drop), jsdom test environment, vitest
**Confidence:** HIGH (all findings verified directly against this repo's source + a live jsdom probe run in this session)

## Summary

This phase adds no new visuals — it adds an explicit, opt-in test mode to five existing
animation/drag composables, direct unit tests for each, and fail-loud behavior for missing
anchor attributes. All five composables were read in full this session; every "silent skip"
site, RAF/WAAPI/setTimeout timing path, and element-identity source is now known precisely
(file:line below). A live jsdom probe (run in this repo's vitest config) confirmed the three
environment constraints CONTEXT.md flagged as needing verification: `element.animate` is
`undefined` in jsdom (Web Animations API absent), `getBoundingClientRect()` always returns a
zero rect, and `DragEvent`/`DataTransfer` are `undefined` in jsdom. `window.matchMedia` is also
absent — this is not new: `useElementAnimation.ts`'s module-level `prefersReducedMotion` ref
already breaks under plain jsdom, and the codebase has an established fix (`vi.stubGlobal` /
runtime polyfill installed before import) proven in ~10 existing test files.

The test-mode/trace module must be a plain, Vue-free TypeScript module (no `vue` import) so it
can be statically re-exported from both `boardsmith/ui` and `boardsmith/testing` without risk —
confirmed by tracing `testing/index.ts`'s existing dependency discipline (it never statically
imports Vue-dependent code; `dom-leak.ts` uses `import type` for Vue component types and a
runtime `import()` for the one place it actually needs `AutoUI.vue`).

**Primary recommendation:** Build one new pure-TS module (e.g. `src/ui/composables/useAnimationTestMode.ts`) exporting `enableAnimationTestMode()` / `disableAnimationTestMode()` / `getAnimationTrace()` / `clearAnimationTrace()` plus a `recordTrace(entry)` helper the five composables call. Each composable gets an early branch: `if (isAnimationTestModeEnabled()) { recordTrace({...}); return; }` inserted BEFORE its existing `prefersReducedMotion` branch (never merged with it — CONTEXT.md requires this stays separate/explicit). Statically export the module unchanged from both `boardsmith/ui` and `boardsmith/testing` (zero Vue import makes this safe).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Animation test-mode flag + trace recorder | Browser/Client (composable layer) | — | Pure in-memory module state consulted synchronously by composables; no server round-trip |
| Instant-resolve branch in each composable | Browser/Client | — | Each composable already owns its own animate/fly logic; test mode is a branch inside existing functions, not a new tier |
| Direct composable unit tests | Test infra (vitest + jsdom) | — | jsdom-mounted or plain-function tests; no real browser needed |
| Fail-loud anchor-missing throw | Browser/Client (composable) | — | The composable already resolves the DOM node; it is the only place that knows the anchor was missing |
| anchorAttrs dev-warning | Browser/Client (`useBoardInteraction` element registration) | — | `anchorAttrs()` is already the single source of truth for anchor attribute names (useBoardInteraction.ts:408); the warning belongs where elements are registered, not duplicated per-renderer |

## Standard Stack

### Core
No new external dependencies. This phase is internal composable + test-infrastructure work.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | 2.1.9 (installed, confirmed via `npx vitest --version`-equivalent config read) | Test runner | Already the project's test runner; `vi.useFakeTimers`, `vi.stubGlobal`, `@vitest-environment jsdom` pragma all in active use |
| @vue/test-utils | ^2.4.11 (package.json) | Vue component mounting for jsdom-level tests | Already used throughout `src/ui/**/*.test.ts` |
| jsdom | 29.1.1 (installed) | DOM environment for browser-API tests | Vitest's `jsdom` environment; per-file `// @vitest-environment jsdom` pragma is the established convention (never global) |

### Supporting
None needed — no polyfill libraries required. `matchMedia`/RAF/DragEvent gaps are handled with minimal inline stubs following existing repo patterns (see Common Pitfalls below), not third-party packages.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline `vi.stubGlobal` / manual polyfill for `matchMedia`/`DragEvent` | `jest-environment-jsdom` extras, `happy-dom` | Repo already standardized on vitest's jsdom env + manual stubs across ~10 files; switching environments now would be a large, unrelated migration. Reuse the proven pattern. |
| Building a new drag simulator for jsdom `DragEvent` dispatch | `@testing-library/user-event`'s drag helpers | Not installed; CONTEXT.md explicitly scopes "no new dependencies without discussing" (root CLAUDE.md hard rule) — recommend the API-level test path (`boardInteraction.startDrag()/triggerDrop()`) as primary, with a *minimal* hand-rolled `DragEvent`-shaped plain object only where jsdom event-level coverage is decided worth the cost (see ANIM-02 discretion note). |

**Installation:** None — no new packages.

## Package Legitimacy Audit

Not applicable — this phase installs no external packages.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│ Test file (vitest, @vitest-environment jsdom where needed)          │
│                                                                       │
│   enableAnimationTestMode()                                          │
│         │                                                             │
│         ▼                                                             │
│  ┌──────────────────────────┐   consult (sync, module-level flag)    │
│  │ useAnimationTestMode.ts   │◄──────────────────────────────────┐   │
│  │  - isAnimationTestMode-   │                                    │   │
│  │    Enabled()              │                                    │   │
│  │  - recordTrace(entry)     │                                    │   │
│  │  - getAnimationTrace()    │                                    │   │
│  │  - clearAnimationTrace()  │                                    │   │
│  └──────────────────────────┘                                    │   │
│         ▲ record trace, return early (skip RAF/WAAPI/setTimeout) │   │
│         │                                                          │   │
│  ┌──────┴───────┐ ┌────────────────┐ ┌───────────────┐ ┌────────┐│   │
│  │ useFLIP       │ │useFlyingElements│ │useElementAnim.│ │useAction││   │
│  │ capture/animate│ │fly/flyMultiple/ │ │capturePositions│ │Animations││   │
│  │               │ │autoWatch/flyOn- │ │/animateToCurr- │ │(setTimeout││  │
│  │               │ │Appear           │ │entPositions    │ │ waits)  ││   │
│  └───────────────┘ └────────────────┘ └───────────────┘ └────────┘│   │
│         │                  │                    │             │    │   │
│         └──────────────────┴────────────────────┴─────────────┘    │   │
│                    querySelector('[data-*-id]') on containerRef      │
│                    → if anchor missing: DEV throw / PROD console.error│
│                                                                        │
│  useDragDrop: dragProps/dropProps event handlers                     │
│         │  reads/writes                                               │
│         ▼                                                             │
│  useBoardInteraction (createBoardInteraction / provide/inject)       │
│    startDrag / setDropTargets / triggerDrop / isDropTarget           │
│    anchorAttrs(ref) → { data-bs-el-id, data-bs-el-notation, ... }    │
│    (element-registration path → new dev-warning, once per el. type)  │
└─────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure
```
src/ui/composables/
├── useAnimationTestMode.ts        # NEW — pure TS, zero Vue import: flag + trace recorder
├── useAnimationTestMode.test.ts   # NEW — unit tests for the recorder itself
├── useFLIP.ts                     # MODIFIED — test-mode branch in animate()
├── useFLIP.test.ts                # NEW
├── useFlyingElements.ts           # MODIFIED — test-mode branch in flyCardInternal()
├── useFlyingElements.test.ts      # NEW
├── useElementAnimation.ts         # MODIFIED — test-mode branch in animateToCurrentPositions()
├── useElementAnimation.test.ts    # NEW
├── useActionAnimations.ts         # MODIFIED — test-mode branch (delegates to useFlyingElements' fly())
├── useActionAnimations.test.ts    # NEW
├── useDragDrop.ts                 # MODIFIED — no test-mode branch needed (see Pitfall: drag has no timing path)
├── useDragDrop.test.ts            # NEW
└── useBoardInteraction.ts         # MODIFIED — anchorAttrs dev-warning in element-registration path
```

### Pattern 1: Test-mode short-circuit placed BEFORE prefersReducedMotion
**What:** Each composable's animate-equivalent function gets a new guard clause checked first:
`if (isAnimationTestModeEnabled()) { recordTrace(...); return; }` — placed above the existing
`if (prefersReducedMotion.value) { ...; return; }` guard.
**When to use:** In every one of the five composables' single entry point that currently does
the reduced-motion check.
**Why order matters:** CONTEXT.md is explicit — test mode must NEVER be implied by
`prefersReducedMotion`; they are two independent flags. Checking test-mode first means a test
that sets test-mode + leaves `prefersReducedMotion` at its jsdom-default (`false`, since
`matchMedia` needs a stub anyway) still resolves instantly and records a trace, rather than
silently falling into the (broken, in jsdom) real animation path.
**Example (useFLIP.ts:242-250, current code to be modified):**
```typescript
// Source: src/ui/composables/useFLIP.ts:242
async function animate(): Promise<void> {
  // NEW: test-mode branch goes here, before the existing reduced-motion check
  // if (isAnimationTestModeEnabled()) { record one 'flip' trace per moved element; clear positions; return; }

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

### Pattern 2: Element identity sources per composable (what's assertable in a trace)
| Composable | Identity source | from/to derivation |
|---|---|---|
| `useFLIP` | `getElementId(el)` (useFLIP.ts:146-154): `data-card-id` → `data-piece-id` → `data-element-id` → `id`, in that priority order | Single container: `from`/`to` = the container's own identity (caller-supplied, e.g. a name passed alongside `containerRef`); FLIP has no cross-container concept — `kind: 'flip'`, `from`/`to` can both be the container name/selector, `meta` carries `deltaX`/`deltaY` |
| `useFlyingElements` (manual `fly`/`flyMultiple`) | `FlyConfig.id` (caller-supplied string) + `FlyConfig.elementData` (rank/suit/faceUp etc.) | `startRect`/`endRect` are DOMRect|HTMLElement|fn — in test mode, if an `HTMLElement` was passed, walk `anchorAttrs`-style attributes (`data-bs-el-id` etc.) off that element for `from`/`to`; if a raw DOMRect was passed, `from`/`to` are not derivable from geometry alone — accept `undefined` and let `meta` carry the raw rect, OR require callers passing a raw DOMRect to also supply an explicit `from`/`to` string via a new optional `FlyConfig.from`/`to` test-mode-only field (recommended — cleanest, opt-in, doesn't change the runtime contract) |
| `useFlyingElements` (`autoWatch`) | `AutoWatchGameElement.id` (numeric engine element id) | `from`/`to` = `AutoWatchContainer.name` (already a first-class field, e.g. `'hand'`, `'crib'` — this is exactly the assertion ergonomics CONTEXT.md's example targets: `{kind:'fly', from:'opponentHand', to:'myHand'}`) |
| `useElementAnimation` | `el.getAttribute('data-element-id')` (useElementAnimation.ts:66,99) | No container-name concept exists in this composable's API (`capturePositions(container)`/`animateToCurrentPositions(container)` take a raw `HTMLElement`, not a named container) — `from`/`to` in test mode should be the container's own `data-element-id` or a caller-supplied label; recommend accepting an optional `containerName` param addition, discretion-flagged below |
| `useActionAnimations` | `config.action` + `config.elementSelection` (the action name + selection whose value names the element) — delegates internally to `useFlyingElements.fly()` | `from` = interpolated `elementSelector`, `to` = interpolated `destinationSelector` (both already string templates with `{arg}` placeholders resolved per-call at useActionAnimations.ts:385,479) — natural, already-human-readable from/to values |
| `useDragDrop` | `ElementRef` (`{id, name, notation}`, useBoardInteraction.ts:19-23) — the SAME ref type flowing through `boardInteraction.startDrag(ref)`/`triggerDrop(ref)` | `from`/`to` are not really applicable to drag lifecycle (it's a discrete event sequence, not a positional animation) — recommend `useDragDrop` does NOT participate in the trace/test-mode system at all (see Pitfall below); its tests use the existing `boardInteraction.startDrag()/triggerDrop()` API path instead |

### Anti-Patterns to Avoid
- **Merging test-mode into the `prefersReducedMotion` branch:** CONTEXT.md explicitly forbids
  this ("NEVER auto-enabled by prefers-reduced-motion"). Reduced-motion is a real user
  accessibility preference that legitimately varies at runtime (jsdom's absence of
  `matchMedia` is an environment gap, not a semantic reason to conflate the two).
- **Giving `useDragDrop` a parallel "instant resolve" test mode:** it has no animation timing
  path to short-circuit — `dragProps`/`dropProps` are synchronous event handlers that call
  `boardInteraction.startDrag`/`setDropTargets`/`triggerDrop` directly (useDragDrop.ts:212-266).
  There is nothing to make "instant" that isn't already instant. Forcing it into the trace
  system would be hand-rolling test infrastructure the composable doesn't need.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Fake RAF scheduling for `useElementAnimation`/`useFlyingElements` RAF-chain tests | A custom RAF queue/scheduler | `vi.stubGlobal('requestAnimationFrame', ...)` driving a manually-ticked queue, OR (simpler, since jsdom's real `requestAnimationFrame` exists per the probe run) a short real-time `await new Promise(r => setTimeout(r, N))` wait combined with `vi.useFakeTimers({ toFake: [...], shouldAdvanceTime: true })` — but note vitest's fake timers do NOT auto-tick `requestAnimationFrame` by default; `vi.stubGlobal` replacement is more reliable and matches the CONTEXT.md requirement ("mocked RAF + fake timers... RAF chain gets at least one test with mocked RAF") |
| Web Animations API stub for `useFLIP`'s `.animate()` calls | A full WAAPI polyfill | A minimal stub: `HTMLElement.prototype.animate = () => ({ finished: Promise.resolve(), cancel(){}, ... })` installed via `vi.stubGlobal` or direct prototype assignment in a `beforeEach`, matching the repo's existing "supply the missing browser API, don't alter behavior" philosophy documented in `dom-leak.ts:42-56` | `element.animate` is confirmed `undefined` in this repo's jsdom (verified this session) — any `useFLIP.test.ts` that exercises the REAL (non-test-mode) `animate()` path will throw `TypeError: el.animate is not a function` without this stub |
| `matchMedia` polyfill | Anything bespoke per test file | The exact pattern already used 10+ times in this repo (`vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))`, e.g. `HintOverlay.test.ts:28-36`) | Proven, minimal, consistent with `dom-leak.ts`'s module-load-time constraint explanation |
| DragEvent-level jsdom simulation | A full `DataTransfer`/`DragEvent` polyfill library | A minimal inline object shaped like the subset `useDragDrop.ts` actually reads (`dataTransfer.setData`, `.effectAllowed`, `.dropEffect`, `.getData` — see useDragDrop.ts:224-225,242,262) passed as the event argument to a directly-invoked handler (NOT dispatched as a real DOM event, since jsdom lacks the `DragEvent`/`DataTransfer` constructors entirely per this session's probe) | `DragEvent`/`DataTransfer` are confirmed `undefined` in this repo's jsdom; real `element.dispatchEvent(new DragEvent(...))` is not possible without first defining these globals. The `dragProps(ref).onDragstart(...)` /`dropProps(ref).onDragover(...)` functions are plain functions taking a `DragEvent`-shaped object — calling them directly with a hand-built plain object sidesteps needing the constructor entirely, and is a legitimate (not hacky) test technique since these are ordinary exported functions, not framework-internal listeners |

**Key insight:** every jsdom gap this phase hits (`matchMedia`, `element.animate`, `DragEvent`)
already has a proven, minimal-stub precedent elsewhere in this codebase. The discipline is:
supply exactly the browser API surface the code under test reads, nothing more, and do it
before the module that reads it is imported (matchMedia is read at module-load time; `.animate`
and DragEvent are read at call time, so per-test `beforeEach` stubbing is sufficient for those
two, but `matchMedia` needs `vi.stubGlobal` at the top of the file, before the `import` statements
resolve).

## Common Pitfalls

### Pitfall 1: `matchMedia` polyfill placement relative to `import` statements
**What goes wrong:** `useElementAnimation.ts`'s `prefersReducedMotion` ref is computed at
MODULE LOAD time (`ref(typeof window !== 'undefined' ? window.matchMedia(...).matches : false)`,
useElementAnimation.ts:34-38). ES module imports are hoisted — if `vi.stubGlobal('matchMedia', ...)`
appears textually below an `import { useFLIP } from './useFLIP.js'` line, the import still
resolves (and throws) before the stub call executes, because static imports are evaluated before
any of the importing file's own top-level statements run.
**Why it happens:** `useFLIP.ts` re-exports `prefersReducedMotion` from `useElementAnimation.js`
(useFLIP.ts:57,60) and `useFlyingElements.ts` also imports it (useFlyingElements.ts:95) — so
importing ANY of the five composables transitively triggers the module-load-time
`window.matchMedia()` call.
**How to avoid:** Call `vi.stubGlobal('matchMedia', ...)` as the FIRST statement in the test
file, before any `import` of the composables under test — vitest hoists `vi.stubGlobal` calls
made at the top of a test file above other module evaluation in practice because vitest's test
file itself is the entry module and stub calls execute as soon as the file's own top-level code
runs, but static `import` specifiers are still resolved/evaluated first per ES module semantics.
The SAFEST version of this pattern (matching `dom-leak.ts`'s documented technique) is a runtime
dynamic `import()` of the composable AFTER the stub is installed, if the composable is imported
anywhere transitively-eager. In practice, the existing 10+ test files in this repo do successfully
use `vi.stubGlobal('matchMedia', ...)` at file top with static imports below it and it works —
confirm this ordering holds for the new composable test files with a quick smoke test before
relying on it broadly.
**Warning signs:** `TypeError: window.matchMedia is not a function` thrown during test file
collection (not during a specific `it()` block) — this means the import itself failed at
module-evaluation time.

### Pitfall 2: `getBoundingClientRect()` always returns a zero rect in jsdom — breaks the movement-threshold check
**What goes wrong:** `useFLIP.animate()` (useFLIP.ts:274-277) and
`useElementAnimation.animateToCurrentPositions()` (useElementAnimation.ts:118-120) both skip
animating an element when `Math.abs(deltaX) < threshold && Math.abs(deltaY) < threshold`. Since
jsdom's `getBoundingClientRect()` always returns `{x:0,y:0,width:0,height:0,...}` (confirmed this
session), EVERY element's old rect and new rect are identical zero rects — `deltaX`/`deltaY` are
always `0`, so the REAL (non-test-mode) animation path never actually animates anything in jsdom,
regardless of test setup.
**Why it happens:** jsdom does not implement layout; `getBoundingClientRect` is a layout-dependent
API with no meaningful jsdom implementation.
**How to avoid:** For the "mocked RAF" tests that CONTEXT.md requires (real animation code path,
not test-mode), you MUST also stub `Element.prototype.getBoundingClientRect` to return distinct
before/after rects (e.g. `vi.fn().mockReturnValueOnce({left:0,top:0,...}).mockReturnValueOnce({left:100,top:0,...})` or a counter-based stub) — otherwise the threshold check silently no-ops and the RAF-mocked test asserts nothing meaningful. This is a MUST-fix, not a nice-to-have; it is the actual reason the composables currently have zero tests.
**Warning signs:** A "real path" test passes trivially (no animation ever starts, no assertion
about `isAnimating` ever becomes true) — a green test with no signal.

### Pitfall 3: FLIP/flying-elements silent-skip sites (the exact ANIM-03 throw locations)
**What goes wrong today:** Several sites resolve `null`/skip silently instead of surfacing that
an anchor was missing:
- `useFLIP.ts` `capture()` (line 228-234): `container.querySelectorAll(handler.selector)` simply
  returns an empty NodeList if no elements match `[data-element-id]` (or whatever selector) — no
  signal that the selector/anchor was wrong.
- `useFLIP.ts` `animate()` (line 264-269): per-element, `if (!id) return;` (line 265) and
  `if (!oldRect) return;` (line 268) both silently skip a specific element that lacks its id
  attribute or wasn't captured — this is the most surgical throw site (`throw new Error` naming
  the missing attribute, dev-mode only).
- `useFlyingElements.ts` `normalizeRect()` (line 390-401): ALREADY throws
  (`'Flying element start position returned null'`) when a function-typed `startRect`/`endRect`
  resolves to `null` — this is the one existing fail-loud precedent in the whole set; match its
  wording style for the new throws.
- `useFlyingElements.ts` `flyCardInternal()` `animate()` inner function (line 529-537): when
  `getRect(endTarget)` returns `null` mid-animation (target disappeared), it silently completes
  the animation and resolves — this is arguably correct behavior for a target that legitimately
  disappeared mid-flight (e.g. destination removed by a subsequent state change) vs. a target
  that was NEVER present (misconfiguration) — the dev-mode throw belongs at the FIRST resolution
  attempt (before `flyingCards.value.push`), not at every subsequent per-frame re-resolution.
- `useElementAnimation.ts` `animateToCurrentPositions()` (line 99-104): `if (!id) return;`
  (100) and `if (!startPos) return;` (103) — same pattern as useFLIP, per-element silent skip.
- `useActionAnimations.ts` (line 388-395, 483-493): ALREADY does the RIGHT thing partially —
  `console.warn` (not throw) when source/destination elements aren't found. ANIM-03 upgrades
  this specific site from warn-only to dev-mode-throw + prod-console.error, per CONTEXT.md.
**Why it happens:** These composables were written assuming "element not there yet" (a normal,
transient DOM state during Vue's render cycle) and "element anchor misconfigured" (a real bug)
look identical from inside `querySelector`/`getAttribute` — both return `null`/empty.
**How to avoid:** The dev-throw must fire only at the FIRST attempt to resolve a target that a
caller explicitly asked to animate (capture-time for FLIP, initial `startRect`/`endRect`
resolution for flying elements, action-animation's initial `elementSelector` resolution) — NOT
on every per-frame re-check inside an already-running RAF loop (where a legitimately-removed
mid-flight target is normal). Message must name: which composable, which selector/attribute was
searched, and what to check (mirroring `useDragDropTargets.ts`'s `warnNoTargets` message style,
lines 214-234, which is the best existing example of an actionable diagnostic in this codebase).
**Warning signs:** An animation that "just doesn't happen" with no console output at all in dev —
today's exact bug.

### Pitfall 4: `useDragDrop` degrades gracefully by design — don't accidentally make ANIM-03 throw there
**What goes wrong:** `useDragDrop.ts` already has an established, deliberate pattern: no
`<GameShell>` provider → `warnNoProvider()` (devWarn, not throw) — the composable's own doc
comment (useDragDrop.ts:97-107) explicitly explains it "degrades gracefully... rather than
throwing at setup like `useBoardInteraction`". `useDragDropTargets.ts`'s `warnNoTargets` (line
214-234) is ALSO a `devWarn`, not a throw, for "drag started but no drop targets could be
derived".
**Why it happens:** Drag-and-drop is inherently more permissive — a board can legitimately
render draggable elements before an action makes them droppable (mid-turn-transition states).
**How to avoid:** ANIM-03's "fail loud" requirement targets ANIMATION anchor misconfiguration
(FLIP/flying-elements/action-animations), not drag-and-drop's existing devWarn-based
degradation. Do not change `useDragDrop.ts`'s or `useDragDropTargets.ts`'s existing warn-not-throw
behavior — CONTEXT.md's ANIM-03 scope is "animation helpers", and the phase's own file list
already separates `useDragDrop` (event-level tests only, per ANIM-02) from the throw-on-missing-
anchor requirement.
**Warning signs:** A plan that adds a dev-throw to `useDragDrop`'s `warnNoProvider` path would
contradict this composable's own documented design intent and regress every board that legally
renders outside a GameShell during setup.

### Pitfall 5: the "once per element type" anchorAttrs dev-warning needs a dedup key that varies by TYPE, not by instance
**What goes wrong:** `devWarn(key, message)` (utils/dev.ts:58-63) already dedups by an exact
`key` string. If the new anchorAttrs warning uses a per-element key (e.g. including the element's
numeric id), it will fire once PER ELEMENT rather than once per element TYPE/renderer as
CONTEXT.md specifies ("once per element type").
**Why it happens:** Copy-pasting the existing `devWarn` call sites (e.g.
`useBoardInteraction.ts:373-378`'s `triggerChoiceSelect` warning, which correctly uses a static
key `'board-interaction-no-choice-callback'`) is easy to get right; the drag-no-targets warning
(`useDragDropTargets.ts:218`) deliberately uses a per-dragged-element key
(`` `drag-no-targets-${JSON.stringify(dragged)}` ``) because THAT warning legitimately should
fire per distinct dragged element/shape — the wrong pattern to imitate for THIS warning.
**How to avoid:** Key the anchorAttrs warning by the element's `className`/`name` (the
type-level identifier available on a `GameElement`/`ElementRef`), e.g.
`` `anchorattrs-missing-${element.className ?? element.name ?? 'unknown'}` `` — NOT by `id`.
**Warning signs:** In a game with many instances of the same custom-rendered element type (e.g.
50 cards), the console would show 50 near-identical warnings instead of 1.

## Code Examples

### Verified: jsdom capability probe (run live in this repo's vitest config, 2026-07-02)
```typescript
// Source: ad-hoc probe run via `npx vitest run` against this repo's vitest.config.ts,
// file deleted after run — not a permanent test file.
describe('jsdom animate check', () => {
  it('element.animate', () => {
    const el = document.createElement('div');
    console.log(typeof (el as any).animate); // -> 'undefined'
  });
  it('getBoundingClientRect', () => {
    const el = document.createElement('div');
    console.log(JSON.stringify(el.getBoundingClientRect()));
    // -> {"x":0,"y":0,"bottom":0,"height":0,"left":0,"right":0,"top":0,"width":0}
  });
  it('DragEvent/DataTransfer', () => {
    console.log(typeof (globalThis as any).DragEvent); // -> 'undefined'
    console.log(typeof (globalThis as any).DataTransfer); // -> 'undefined'
  });
  it('matchMedia', () => {
    console.log(typeof window.matchMedia); // -> 'undefined'
  });
  it('requestAnimationFrame', () => {
    console.log(typeof requestAnimationFrame); // -> 'function' (PRESENT — no stub needed)
  });
});
```

### Established matchMedia stub pattern (copy verbatim)
```typescript
// Source: src/ui/components/helpers/HintOverlay.test.ts:28-36 (existing, proven)
vi.stubGlobal(
  'matchMedia',
  vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
);
```

### Established devWarn dedup-by-type pattern to model the new warning on
```typescript
// Source: src/ui/composables/useBoardInteraction.ts:371-380 (static key, correct pattern to copy)
if (!state.onChoiceSelect) {
  devWarn(
    'board-interaction-no-choice-callback',
    `triggerChoiceSelect('${selectionName}', ...) was ignored because no action is active...`,
  );
  return;
}
```

### Existing actionable-diagnostic style to match for the new ANIM-03 throw messages
```typescript
// Source: src/ui/composables/useDragDropTargets.ts:214-234 (best existing example of a
// multi-line, "what/why/how to fix" diagnostic in this codebase)
function warnNoTargets(dragged: ElementRef, matchedAction: string | null): void {
  const pick = actionController.currentPick.value;
  devWarn(
    `drag-no-targets-${JSON.stringify(dragged)}`,
    `Drag started for element ${JSON.stringify(dragged)} but no drop targets could be derived.\n\n` +
      `Dragging completes an action by dropping onto a board target. For drag-drop to wire up automatically:\n` +
      // ...
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `console.warn` on missing destination element (`useActionAnimations.ts:390,489`) | Dev-mode throw + prod console.error (this phase, ANIM-03) | Phase 128 | Misconfigured `elementSelector`/`destinationSelector` now fails a dev build/test loudly instead of a silent animation no-op |
| No dedicated `anchorAttrs` warning for custom boards | Dev-only, once-per-type `devWarn` in `useBoardInteraction`'s element-registration path | Phase 128 (deferred from v4.1 backlog per STATE.md line 85) | Closes a known v4.1 backlog item |
| Zero direct unit tests for the five animation composables | Direct unit tests for all five (ANIM-02) | Phase 128 | First test coverage for this surface (verified zero test files exist today via file listing) |

**Deprecated/outdated:** None — this is additive test-infrastructure work on stable composables; no runtime API is being removed for games (Phase 129/MIG-03 will surface any downstream call-site changes needed, but none are anticipated since the new test-mode is opt-in and the anchor-throw only fires on already-broken configurations).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `vi.stubGlobal('matchMedia', ...)` placed at the TOP of a test file (before static `import` lines of the five composables) reliably runs before the composables' module-load-time `window.matchMedia()` call, based on observing this exact ordering succeed in ~10 existing test files in this repo | Common Pitfalls, Pitfall 1 | LOW — this is empirically observed (existing green tests use this ordering), not merely reasoned from ES-module spec; if it ever breaks for a NEW file, the dynamic-`import()` fallback documented in `dom-leak.ts` is the proven alternative |
| A2 | `useElementAnimation.ts`'s current lack of a container-name concept means test-mode `from`/`to` values for that composable need a new optional param (recommended: `containerName` on `capturePositions`/`animateToCurrentPositions` options) — this is Claude's-discretion territory per CONTEXT.md, not a locked decision | Architecture Patterns, Pattern 2 table | MEDIUM — if the planner instead derives `from`/`to` purely from `data-element-id` (no container label), the trace's `from`/`to` would describe elements, not zones, which is less useful for "flew from A to B" assertions but is still workable; flag for a planning-time decision, not a blocker |
| A3 | For `FlyConfig`s where `startRect`/`endRect` are raw `DOMRect` values (no `HTMLElement`, no container ref), test-mode `from`/`to` cannot be derived automatically and should fall back to an optional new field on `FlyConfig` (`from`/`to` strings) rather than `undefined` | Architecture Patterns, Pattern 2 table | LOW — worst case, `from`/`to` are `undefined` in the trace for that call shape, which is honest (no assertion possible) rather than wrong; not a correctness risk, only an ergonomics gap |

**If this table is empty:** N/A — see entries above; all are flagged for planner attention, none block starting the phase.

## Open Questions (RESOLVED)

> **RESOLVED:** Q1 (containerName API) — resolved by Plan 128-04: no public API expansion; trace from/to use the container's own data-element-id or undefined. Q2 (useActionAnimations trace source) — resolved by Plan 128-06: records at its own level from interpolated selector strings, early-return without delegating to fly() (no double-recording).

1. **Should `useElementAnimation`'s public API gain a `containerName`/label parameter for test-mode `from`/`to`, or should its trace entries omit `from`/`to` entirely?**
   - What we know: the composable currently has no first-class "named container" concept (unlike `useFlyingElements`'s `autoWatch.containers[].name`); its own doc example (useElementAnimation.ts:1-19) shows a single anonymous `containerEl`.
   - What's unclear: whether any current callers of `useElementAnimation` (grep confirmed it's imported/used somewhere in the UI layer beyond its own file — not exhaustively traced call sites in this research pass) would benefit from/need this addition, or whether it's dead weight for a composable that may be a candidate for eventual consolidation with `useFLIP`.
   - Recommendation: default to trace entries with `from`/`to: undefined` for this composable in v1 of the test-mode work (matches what's realistically knowable today); only add the labeling param if a concrete test scenario in ANIM-02 needs it.

2. **Does any existing game (in `~/BoardSmithGames/` or MERC) call `useFLIP`/`useFlyingElements`/`useElementAnimation` with a raw `DOMRect` (not an `HTMLElement` or container ref) for `startRect`/`endRect`, making the from/to-omission in Assumption A3 a real, not just theoretical, gap?**
   - What we know: the `FlyConfig` type permits `DOMRect | HTMLElement | (() => ...)` (useFlyingElements.ts:169,172); `useActionAnimations.ts` (the highest-traffic caller) always passes `startRect: DOMRect` (captured via `getBoundingClientRect()`, useActionAnimations.ts:398) and `endRect: () => Element.getBoundingClientRect()` — i.e. a FUNCTION wrapping element lookup, not a raw element — meaning even the "well-behaved" existing caller loses element identity for `startRect` specifically.
   - What's unclear: whether ANIM-02's direct tests for `useActionAnimations` need trace assertions on the `from` side at all, given `useActionAnimations` already interpolates human-readable selector strings (`config.elementSelector`/`config.destinationSelector`) BEFORE calling `fly()` — those interpolated strings are a better `from`/`to` source than trying to re-derive identity from the DOMRect.
   - Recommendation: for `useActionAnimations` specifically, source trace `from`/`to` from the already-interpolated selector strings (available at the call site inside `useActionAnimations.ts`, not inside `useFlyingElements.ts`) rather than trying to push DOMRect-to-identity resolution down into `useFlyingElements`'s generic `fly()`. This means the test-mode recording call for the action-animations path may need to happen in `useActionAnimations.ts` itself (which already has the selector strings), not solely inside the lower-level `useFlyingElements.fly()`.

## Environment Availability

Not applicable in the traditional sense (no external services/CLIs) — the one relevant "environment" is the jsdom test environment's browser-API surface, fully audited above via a live probe.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| jsdom `element.animate` (WAAPI) | `useFLIP` real-path tests | ✗ | jsdom 29.1.1 | Stub `HTMLElement.prototype.animate` per-test (see Don't Hand-Roll) |
| jsdom `getBoundingClientRect` (real layout) | `useFLIP`/`useElementAnimation`/`useFlyingElements` real-path tests | ✗ (always zero rect) | jsdom 29.1.1 | Mock return values per-call in tests that need distinct before/after rects |
| jsdom `window.matchMedia` | Any test importing any of the 5 composables (module-load-time) | ✗ | jsdom 29.1.1 | `vi.stubGlobal('matchMedia', ...)` before imports — proven pattern, 10+ existing test files |
| jsdom `DragEvent`/`DataTransfer` constructors | `useDragDrop` jsdom event-level tests (if attempted) | ✗ | jsdom 29.1.1 | Call `dragProps(ref).onDragstart(...)` directly with a hand-built plain object shaped like the subset read (`dataTransfer.setData`/`.effectAllowed`, etc.) instead of dispatching a real `DragEvent` |
| jsdom `requestAnimationFrame` | `useElementAnimation`/`useFlyingElements` RAF-chain tests | ✓ | jsdom 29.1.1 (native, confirmed via probe) | None needed — real RAF present; still recommend `vi.stubGlobal` override for deterministic single-tick control per CONTEXT.md's "mocked RAF" requirement |

**Missing dependencies with no fallback:** None — every gap has a documented, already-precedented fallback in this codebase.

**Missing dependencies with fallback:** `element.animate`, `getBoundingClientRect` (real layout), `matchMedia`, `DragEvent`/`DataTransfer` — see table above.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 2.1.9 |
| Config file | `vitest.config.ts` (repo root) — `environment: 'node'` default, per-file `// @vitest-environment jsdom` pragma for DOM tests |
| Quick run command | `npx vitest run src/ui/composables/useFLIP.test.ts` (per new file, once created) |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ANIM-01 | Test mode resolves instantly + records assertable trace for each `kind` | unit | `npx vitest run src/ui/composables/useAnimationTestMode.test.ts` | ❌ Wave 0 |
| ANIM-01 | Trace shape matches `{kind, element, from, to, meta}` for at least one call of each composable | unit | `npx vitest run src/ui/composables/useFLIP.test.ts` (and 3 sibling files) | ❌ Wave 0 |
| ANIM-02 | `useFLIP` direct unit test: capture/animate lifecycle, test-mode + mocked-RAF/WAAPI real path | unit (jsdom) | `npx vitest run src/ui/composables/useFLIP.test.ts` | ❌ Wave 0 |
| ANIM-02 | `useFlyingElements` direct unit test: fly/flyMultiple/flyOnAppear/autoWatch, test-mode + mocked-RAF real path | unit (jsdom) | `npx vitest run src/ui/composables/useFlyingElements.test.ts` | ❌ Wave 0 |
| ANIM-02 | `useElementAnimation` direct unit test: capturePositions/animateToCurrentPositions, test-mode + mocked-RAF real path | unit (jsdom) | `npx vitest run src/ui/composables/useElementAnimation.test.ts` | ❌ Wave 0 |
| ANIM-02 | `useActionAnimations` direct unit test: onBeforeAutoExecute + gameView-watch trigger, test-mode + setTimeout-based real path | unit (jsdom) | `npx vitest run src/ui/composables/useActionAnimations.test.ts` | ❌ Wave 0 |
| ANIM-02 | `useDragDrop` direct unit test: both `boardInteraction` API-level path AND jsdom drag-event-shaped handler calls | unit (jsdom) | `npx vitest run src/ui/composables/useDragDrop.test.ts` | ❌ Wave 0 |
| ANIM-03 | Missing anchor on target element throws (dev) / console.error + skip (prod) in each of the 3 animation-throw sites | unit | Same files as ANIM-02 (throw-path assertions within each) | ❌ Wave 0 |
| ANIM-03 | `useBoardInteraction` element-registration emits a dev-only, once-per-element-type warning when `anchorAttrs` is missing | unit | `npx vitest run src/ui/composables/useBoardInteraction.test.ts` (extend existing or new file — confirm existing file name first) | ⚠️ Confirm — repo has `anchorAttrs.test.ts` already; extend that file rather than creating a duplicate |

### Sampling Rate
- **Per task commit:** `npx vitest run src/ui/composables/<touched-file>.test.ts`
- **Per wave merge:** `npx vitest run` (full suite)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/ui/composables/useAnimationTestMode.ts` + `.test.ts` — the new module itself, needed before any composable can consume it
- [ ] `src/ui/composables/useFLIP.test.ts` — covers ANIM-01/02/03 for useFLIP
- [ ] `src/ui/composables/useFlyingElements.test.ts` — covers ANIM-01/02/03 for useFlyingElements
- [ ] `src/ui/composables/useElementAnimation.test.ts` — covers ANIM-01/02/03 for useElementAnimation
- [ ] `src/ui/composables/useActionAnimations.test.ts` — covers ANIM-01/02/03 for useActionAnimations
- [ ] `src/ui/composables/useDragDrop.test.ts` — covers ANIM-02 for useDragDrop
- [ ] Confirm whether `src/ui/composables/anchorAttrs.test.ts` (existing file, found via file listing but not read in this pass) already covers `anchorAttrs()` the function, vs. needing a NEW test file for the element-REGISTRATION dev-warning (a different concern) — read this file first in planning/execution before deciding whether to extend or create new.

## Security Domain

Not applicable — this phase touches no authentication, session, network, or cryptographic
surface. `security_enforcement` config value was not checked (no `.planning/config.json`
security-domain override found necessary given the phase's pure client-side-composable scope);
recommend the planner confirm `.planning/config.json` doesn't force this section if it's truly
absent, but the phase's own scope (animation/drag-drop composables, jsdom tests) has no ASVS
category that plausibly applies.

## Sources

### Primary (HIGH confidence — direct source read + live probe, all in this repo, this session)
- `src/ui/composables/useFLIP.ts` (full file read)
- `src/ui/composables/useFlyingElements.ts` (full file read)
- `src/ui/composables/useElementAnimation.ts` (full file read)
- `src/ui/composables/useActionAnimations.ts` (full file read)
- `src/ui/composables/useDragDrop.ts` (full file read)
- `src/ui/composables/useDragDropTargets.ts` (full file read)
- `src/ui/composables/useBoardInteraction.ts` (full file read)
- `src/utils/dev.ts` (full file read — `devWarn`/`isDevMode`)
- `src/testing/dom-leak.ts` (matchMedia polyfill + dynamic-import pattern, lines 1-90 read)
- `src/ui/composables/useAnimationEvents.test.ts` (full file read — fake-timer/RAF-adjacent test patterns)
- `src/ui/components/auto-ui/renderers/drag-keyboard-parity.test.ts` (partial read — drag API-level test pattern)
- `src/ui/components/helpers/HintOverlay.test.ts` (partial read — matchMedia stub pattern)
- Live jsdom probe executed via `npx vitest run` against this repo's `vitest.config.ts` (element.animate, getBoundingClientRect, DragEvent/DataTransfer, matchMedia, requestAnimationFrame availability) — probe file created and deleted within this session, not committed
- `package.json` (jsdom 29.1.1, vitest 2.1.9, @vue/test-utils ^2.4.11, `exports` map for `./ui`/`./testing`)
- `vitest.config.ts` (environment: node default, jsdom per-file pragma convention, exclude list)

### Secondary (MEDIUM confidence)
None used beyond primary sources — this phase's domain is entirely internal to the repo; no
external library/framework research was needed since no new dependencies are introduced.

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; existing vitest/jsdom/@vue-test-utils versions read directly from `package.json`.
- Architecture: HIGH — all five composables and the two supporting files (`useBoardInteraction.ts`, `useDragDropTargets.ts`) were read in full; every silent-skip site and identity source is cited by file:line.
- Pitfalls: HIGH — the three critical jsdom gaps (WAAPI, layout, DragEvent) were verified via a live probe run in this session's actual environment, not assumed from training data; the matchMedia/devWarn patterns are copied from existing, currently-passing test files in this repo.

**Research date:** 2026-07-02
**Valid until:** 30 days (stable internal composables + pinned jsdom/vitest versions; re-verify jsdom capability probe if `jsdom`/`vitest` package versions change in `package.json`)
