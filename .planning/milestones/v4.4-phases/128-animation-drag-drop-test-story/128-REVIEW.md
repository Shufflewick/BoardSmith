---
phase: 128-animation-drag-drop-test-story
reviewed: 2026-07-02T00:00:00Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - src/testing/index.ts
  - src/ui/composables/anchorAttrs.test.ts
  - src/ui/composables/useActionAnimations.test.ts
  - src/ui/composables/useActionAnimations.ts
  - src/ui/composables/useAnimationTestMode.test.ts
  - src/ui/composables/useAnimationTestMode.ts
  - src/ui/composables/useBoardInteraction.ts
  - src/ui/composables/useDragDrop.test.ts
  - src/ui/composables/useElementAnimation.test.ts
  - src/ui/composables/useElementAnimation.ts
  - src/ui/composables/useFLIP.test.ts
  - src/ui/composables/useFLIP.ts
  - src/ui/composables/useFlyingElements.test.ts
  - src/ui/composables/useFlyingElements.ts
  - src/ui/index.ts
findings:
  critical: 4
  warning: 3
  info: 0
  total: 7
status: fixed
fixed_at: 2026-07-02T00:00:00Z
resolutions:
  CR-01: "fixed (fa8525f)"
  CR-02: "fixed (2012b3d)"
  CR-03: "fixed (f5596c5)"
  CR-04: "fixed (e8593d5)"
  WR-01: "fixed (55f52e5)"
  WR-02: "fixed (fa8525f)"
  WR-03: "fixed (fa8525f)"
---

# Phase 128: Code Review Report

**Reviewed:** 2026-07-02
**Depth:** standard
**Files Reviewed:** 15
**Status:** fixed (all 7 findings resolved — see Resolutions below)

## Summary

Phase 128 adds an explicit, opt-in animation test-mode + trace recorder (`useAnimationTestMode.ts`, Vue-free by design) and threads it through four animation composables (`useFLIP`, `useFlyingElements`, `useElementAnimation`, `useActionAnimations`), plus a dev-only fail-loud path for missing anchor attributes/targets. The core recorder module and three of the four composables' primary code paths (fly/flip/element traces, dev-throw/prod-console.error gating) are sound and well-tested.

However, the single most important invariant this phase establishes — "test mode is never merged with `prefersReducedMotion`" (explicitly called out in `useAnimationTestMode.ts`'s module doc and fixed for three call sites inside `useFlyingElements.ts` by plan 128-05) — was **not applied consistently**. Two other call sites in the same files still gate on `prefersReducedMotion` *before* ever reaching the composable's internal test-mode branch, silently defeating test mode exactly the way 128-05's own fix was written to prevent. Separately, `useActionAnimations`' test-mode branch skips the ANIM-03 fail-loud destination check entirely, meaning a typo'd `destinationSelector` — the canonical authoring bug ANIM-03 exists to catch — passes silently as a "successful" trace when test mode is enabled. Both classes of defect are unguarded by any existing test (none of the new test files exercise `flyOnAppear`, `useFLIP({auto: true})`, or a test-mode-enabled missing-destination scenario), so they will not be caught by `npm test` as currently written.

A dev/prod-detection utility that all four composables' new fail-loud throws depend on (`isDevMode()`) treats any environment where `NODE_ENV`/`MODE` isn't literally `'production'` as "dev" — a common real-world misconfiguration (unset `NODE_ENV`) that would turn the phase's intentionally-cosmetic "console.error and skip" production fallback into an uncaught throw in a live game, contradicting the explicit CONTEXT.md requirement that production never crashes on a missing anchor.

## Critical Issues

### CR-01: `flyOnAppear`'s own `prefersReducedMotion` early-return bypasses test mode entirely

**File:** `src/ui/composables/useFlyingElements.ts:803`
**Issue:** Plan 128-05 explicitly removed three `prefersReducedMotion` early-returns (in `fly()`, `flyMultiple()`, and the `autoWatch` watcher) specifically because they ran *before* `flyCardInternal()`'s test-mode check, silently defeating test mode whenever the environment prefers reduced motion (documented as a real bug in 128-05-SUMMARY.md). `flyOnAppear`'s own watch callback has the identical pattern and was not touched:
```ts
watch(
  () => element.value,
  async (newElement, oldElement) => {
    if (!newElement || oldElement) return;
    // Skip if reduced motion preferred
    if (prefersReducedMotion.value) return;   // <-- returns BEFORE fly()/flyCardInternal is ever called
    ...
    await fly({ ... });
```
When `prefersReducedMotion.value` is true, `fly()` (and therefore `flyCardInternal`'s test-mode branch) is never reached, so `enableAnimationTestMode()` cannot record a trace for any `flyOnAppear`-driven animation in that environment — the exact "never merged" violation 128-05 fixed for the other three call sites in this same file, reintroduced (or rather, left unfixed) at a fourth site. No test in `useFlyingElements.test.ts` exercises `flyOnAppear` at all, so this regression is invisible to the suite.
**Fix:** Move the `prefersReducedMotion` check inside `flyCardInternal` (already the case) and delete this outer early-return, mirroring the fix already applied to `fly()`/`flyMultiple()`/`autoWatch`:
```ts
if (!newElement || oldElement) return;
const sourceRect = sourceRef.value?.getBoundingClientRect();
const targetRect = targetRef.value?.getBoundingClientRect();
if (!sourceRect || !targetRect) return;
// no prefersReducedMotion check here — flyCardInternal handles it after the test-mode check
```
Add a direct unit test for `flyOnAppear` covering both the test-mode trace and the reduced-motion-skip real path.

### CR-02: `useFLIP`'s auto-mode watchers gate `animate()` behind `prefersReducedMotion`, making its own test-mode branch unreachable

**File:** `src/ui/composables/useFLIP.ts:390-409`
**Issue:** `animate()`'s test-mode branch (line 270) is documented as sitting "ABOVE `prefersReducedMotion`... never merged with it." That's true only when `animate()` is actually invoked. In auto mode, the sync/post watchers wrap every call to `capture()`/`animate()` in their own outer `prefersReducedMotion` check:
```ts
watch(gameView, () => {
  if (!prefersReducedMotion.value) {
    capture();
  }
}, { deep: true, flush: 'sync' });

watch(gameView, async () => {
  if (!prefersReducedMotion.value) {
    await animate();
  }
}, { deep: true, flush: 'post' });
```
When `prefersReducedMotion.value` is true, `animate()` is never called, so its internal test-mode branch is unreachable — `useFLIP({ auto: true, ... })` cannot ever record a trace in that environment, regardless of `enableAnimationTestMode()`. `useFLIP.test.ts` has no test for `auto: true` at all, so this gap ships untested.
**Fix:** Remove the outer `prefersReducedMotion` guards from both watchers; let `capture()`/`animate()` run unconditionally and rely on `animate()`'s own internal test-mode-then-reduced-motion ordering (same fix pattern as CR-01/128-05):
```ts
watch(gameView, () => { capture(); }, { deep: true, flush: 'sync' });
watch(gameView, async () => { await animate(); }, { deep: true, flush: 'post' });
```
(`capture()` itself has no reduced-motion dependency; it only populates the positions map used later.)

### CR-03: `useActionAnimations`' test-mode branch records a trace without validating the destination element exists, defeating ANIM-03 for the exact bug it targets

**File:** `src/ui/composables/useActionAnimations.ts:479-506`
**Issue:** In the `gameView` watch handler, `destinationElement` is resolved, then the test-mode branch fires and returns *before* the `!destinationElement` fail-loud check below it:
```ts
if (typeof config.destinationSelector === 'function') {
  destinationElement = config.destinationSelector(args);
} else {
  destSelectorStr = interpolateSelector(config.destinationSelector, args);
  destinationElement = document.querySelector(destSelectorStr);
}

if (isAnimationTestModeEnabled()) {
  ...
  recordTrace({ kind: 'action', ..., to: destSelectorStr, ... });
  return;                       // <-- returns here, `!destinationElement` never checked
}

if (!destinationElement) {
  // fail-loud dev-throw / prod-console.error
}
```
Compare with `useFlyingElements.ts`'s `flyCardInternal`, which resolves+validates both `startRect`/`endRect` (throwing on a null resolution) *before* checking test mode (128-05's own precedent, correctly ordered). Here the order is reversed: a typo'd/misconfigured `destinationSelector` (the canonical authoring bug ANIM-03 exists to catch — "the exact path must throw," per CONTEXT.md) produces a "successful" `{kind:'action', to: '[data-zone="totally-wrong"]'}` trace when test mode is enabled, with no indication anything is wrong. A game's animation test suite (which is precisely where `enableAnimationTestMode()` is meant to be used) would never catch this class of bug — the opposite of the phase's stated purpose ("fails loud instead of silently no-op'ing on misconfiguration"). No test in `useActionAnimations.test.ts` exercises "test mode + missing destination" together (the missing-destination tests all run with test mode disabled).
**Fix:** Move the `!destinationElement` fail-loud check above the test-mode branch, so a missing destination throws/console.errors regardless of mode:
```ts
if (!destinationElement) {
  const msg = ...;
  if (isDevMode()) throw new Error(msg); else console.error(msg);
  return;
}

if (isAnimationTestModeEnabled()) {
  ...
  return;
}
```

### CR-04: `isDevMode()`'s fallback treats any non-`'production'`-labeled build as dev, turning new fail-loud throws into a live-game crash risk

**File:** `src/utils/dev.ts:30-38` (consumed by all four composables' new fail-loud gates: `useFLIP.ts:172`, `useFlyingElements.ts:456`, `useElementAnimation.ts:64`, `useActionAnimations.ts:395,516`)
**Issue:**
```ts
export function isDevMode(): boolean {
  if (typeof import.meta !== 'undefined' && (import.meta as any).env) {
    const env = (import.meta as any).env;
    return env.DEV === true || env.MODE !== 'production';
  }
  return typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
}
```
CONTEXT.md's explicit requirement for ANIM-03 is: "production logs console.error and skips (animation is cosmetic — don't crash a live game)." That guarantee depends entirely on the environment being correctly identified as "production." Both branches here default to **dev** unless the environment is *positively and exactly* labeled `'production'`:
- Vite: any custom mode name (`'staging'`, `'preview'`, an unset `MODE`) is treated as dev.
- Node: `NODE_ENV` unset (extremely common in real deployments — many Node processes never set it) is treated as dev.
This phase is the first to give `isDevMode()` real teeth — previously it only gated non-fatal `console.warn`/`devWarn` calls; now it gates genuine `throw new Error(...)` calls across all four animation composables. A live game deployed without `NODE_ENV=production` set (or built with a Vite mode other than the literal string `'production'`) will now **crash on a missing anchor attribute** instead of degrading gracefully — the exact live-game-crash scenario ANIM-03 was designed to prevent.
**Fix:** Invert the default to fail toward safety — require an explicit, positive signal to enable dev-mode throws, rather than requiring an explicit signal to suppress them:
```ts
export function isDevMode(): boolean {
  if (typeof import.meta !== 'undefined' && (import.meta as any).env) {
    return (import.meta as any).env.DEV === true;
  }
  return typeof process !== 'undefined' && process.env?.NODE_ENV === 'development';
}
```
This is out of this phase's file list but is now load-bearing for this phase's core safety guarantee and should be fixed alongside it (or flagged as a blocking dependency before ANIM-03 ships).

## Warnings

### WR-01: `anchorAttrs`'s "once per element type" warning collapses to a single global bucket, silently swallowing distinct missing-anchor bugs

**File:** `src/ui/composables/useBoardInteraction.ts:408-424`
**Issue:** CONTEXT.md's decision reads: "dev-only warning (once per element type) when a custom board renders selectable elements without `anchorAttrs`." The implementation:
```ts
if (Object.keys(attrs).length === 0) {
  const typeKey = ref.name ?? 'unknown';
  devWarn(`anchorattrs-missing-${typeKey}`, ...);
}
```
This branch only runs when `attrs` is empty, which requires `ref.id`, `ref.notation`, AND `ref.name` to all be `undefined` — but `ref.name` is the *only* field `typeKey` can derive "type" from. Since `ref.name` is guaranteed undefined whenever this code executes, `typeKey` always evaluates to the literal string `'unknown'`, and the dedup key is always `'anchorattrs-missing-unknown'`. This is confirmed intentional by `anchorAttrs.test.ts:101-109` ("dedup key is derived from ref.name, not per-id... resolves to a fixed 'unknown' bucket"), but it means a board with two genuinely distinct bugs — e.g. `CardRenderer` forgetting `anchorAttrs` AND, separately, `PieceRenderer` forgetting it — only ever surfaces ONE warning for the life of the module state (`shownWarnings` is never cleared outside tests), permanently hiding the second, unrelated bug.
**Fix:** Either accept a `type` parameter into `anchorAttrs()` (e.g., a component-local literal like `'card'`/`'piece'`) to give the dedup key real per-type granularity, or update CONTEXT.md/the JSDoc to accurately describe the actual behavior ("once globally, not once per type") so downstream consumers don't rely on a guarantee the code doesn't provide.

### WR-02: `flyMultiple()`'s inter-element stagger uses a real `setTimeout` even in animation test mode

**File:** `src/ui/composables/useFlyingElements.ts:767-770`
**Issue:**
```ts
for (let i = 0; i < configs.length; i++) {
  if (staggerMs > 0 && i > 0) {
    await new Promise((r) => setTimeout(r, staggerMs));   // real wall-clock wait, unconditional
  }
  promises.push(fly(configs[i]));
}
```
`fly()` itself resolves instantly in test mode, but the stagger delay between successive elements in the same `flyMultiple()`/`autoWatch` batch is a real timer regardless of test mode. `useAnimationTestMode.ts`'s stated goal is deterministic, instant tracing ("an agent/test can enable an instant/traced mode... without a real DOM or requestAnimationFrame timing"); an `autoWatch` update that moves N elements simultaneously (a common real scenario — e.g. dealing a hand) will take `(N-1) * staggerMs` real milliseconds in test mode even though no animation actually runs, needlessly slowing test suites that exercise multi-element moves.
**Fix:** Skip the stagger delay entirely when `isAnimationTestModeEnabled()`:
```ts
if (staggerMs > 0 && i > 0 && !isAnimationTestModeEnabled()) {
  await new Promise((r) => setTimeout(r, staggerMs));
}
```

### WR-03: `normalizeRect`'s removed throw was replaced with a strictly wider check, but the deviation isn't reflected in `FlyConfig`'s public docs

**File:** `src/ui/composables/useFlyingElements.ts:530-539` (vs. `FlyConfig.startRect`/`endRect` JSDoc at lines 170-174)
**Issue:** This is a minor doc-drift item, not a behavior bug (confirmed via `grep` that no other module referenced the removed `normalizeRect`). The public `FlyConfig.startRect`/`endRect` JSDoc doesn't mention that a null-resolving target now throws in dev / logs+skips in prod — a consumer reading only the public type doc would not know that passing a function returning `null` is a fail-loud condition rather than a silent no-op.
**Fix:** Add a one-line JSDoc note on `FlyConfig.startRect`/`endRect` cross-referencing the fail-loud behavior (mirrors the existing cross-references already present for `from`/`to`/`element`).

---

## Resolutions

All 7 findings fixed. `npx tsc --noEmit` clean on touched files; full `npm test` green (2081/2081, 159 files).

### CR-01 — fixed (`fa8525f`)
Removed `flyOnAppear`'s outer `prefersReducedMotion` early-return; `flyCardInternal` already checks reduced motion internally, after its test-mode branch. Added direct unit tests covering the test-mode trace (reduced motion preferred) and the real reduced-motion-skip path, in `useFlyingElements.test.ts`.

### CR-02 — fixed (`2012b3d`)
Removed the outer `prefersReducedMotion` guards from `useFLIP`'s auto-mode sync/post watchers; `capture()`/`animate()` now run unconditionally, relying on `animate()`'s own internal test-mode-then-reduced-motion ordering. Added an `auto: true` test in `useFLIP.test.ts` proving a flip trace is recorded even when reduced motion is preferred.

### CR-03 — fixed (`f5596c5`)
Moved the `!destinationElement` fail-loud check above the `isAnimationTestModeEnabled()` branch in `useActionAnimations`' `gameView` watch handler, so a missing/typo'd destination throws (dev) / console.errors (prod) regardless of test mode. Added a regression test in `useActionAnimations.test.ts` (typo'd selector + test mode enabled → throws in dev, no trace recorded).

### CR-04 — fixed (`e8593d5`)
Added `isDevThrowEnabled()` (backed by a pure, directly-testable `_resolveDevThrowEnabled()` helper in `src/utils/dev.ts`) requiring a *positive* dev/test signal before enabling a throw; unlabeled/misconfigured environments now fall through to `console.error` instead of crashing. `isDevMode()`'s existing semantics are unchanged (still used by `devWarn()` and other non-fatal consumers). All four animation composables' fail-loud throw sites (`useFLIP.ts`, `useFlyingElements.ts`, `useElementAnimation.ts`, `useActionAnimations.ts`) now use the new predicate. New `src/utils/dev.test.ts` covers labeled-prod, labeled-dev, labeled-test, and unlabeled/unset environments for both the Vite and Node code paths.

### WR-01 — fixed (`55f52e5`)
`anchorAttrs()` now accepts an optional `type` parameter (default `'unknown'`) used as the missing-anchor dev-warning's dedup key. `useSelectable()`/`useSelectableGrid()` forward an optional `elementType` param; all 8 auto-ui renderer call sites now pass a literal element-kind label (`'card'`, `'piece'`, `'die'`, `'deck'`, `'hand'`, `'space'`, `'grid-cell'`, `'hex-cell'`) so distinct renderers each warn once instead of collapsing into a shared `'unknown'` bucket. `anchorAttrs.test.ts` updated to prove two distinct types warn twice, same-type instances still dedup, and the omitted-type fallback still collapses to `'unknown'`.

### WR-02 — fixed (`fa8525f`)
`flyMultiple()`'s inter-element stagger `setTimeout` is now skipped when `isAnimationTestModeEnabled()`. Added a test proving a large stagger (1000ms × 3 elements) resolves near-instantly in test mode.

### WR-03 — fixed (`fa8525f`)
Added JSDoc notes on `FlyConfig.startRect`/`endRect` cross-referencing the fail-loud (throw-in-dev / log-and-skip-in-prod) behavior on null first resolution.

---

_Reviewed: 2026-07-02_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Fixed: 2026-07-02_
_Fixer: Claude (gsd-code-fixer)_
