---
phase: 128-animation-drag-drop-test-story
plan: 05
subsystem: ui
tags: [animation, vitest, jsdom, flying-elements, dev-warnings, fail-loud]

requires:
  - phase: 128-animation-drag-drop-test-story (plan 01)
    provides: isAnimationTestModeEnabled() / recordTrace() / AnimationTrace trace-recorder contract
provides:
  - useFlyingElements test-mode trace branch (instant, assertable {kind:'fly'} traces, no RAF chain)
  - useFlyingElements fail-loud first-resolution missing start/end target throw (dev) / console.error+skip (prod)
  - useFlyingElements's first direct unit tests (test-mode incl. the flagship autoWatch trace, mocked-RAF real path, throw path)
affects: [128-06]

tech-stack:
  added: []
  patterns:
    - "FlyConfig gained from/to/element optional fields so autoWatch can thread container names + the engine element id through to the trace, distinct from FlyConfig.id (an internal animation-bookkeeping key, generated for autoWatch as auto-fly-{id}-{timestamp} and therefore not assertable)"
    - "Dynamic (not static) import of the composable-under-test after vi.stubGlobal('matchMedia'/'ResizeObserver') — same ordering fix as 128-03's useFLIP.test.ts"
    - "vi.hoisted() mutable state object + vi.mock() partial-override factory for isDevMode() control (dev-throw vs prod-console.error), same as 128-03"

key-files:
  created:
    - src/ui/composables/useFlyingElements.test.ts
  modified:
    - src/ui/composables/useFlyingElements.ts

key-decisions:
  - "Test mode is checked BEFORE prefersReducedMotion everywhere in this composable (flyCardInternal, plus fly()/flyMultiple()'s own early-returns and the autoWatch watcher's blanket check were all removed) — test mode must never be silently suppressed by a user's a11y reduced-motion preference (mirrors useAnimationTestMode.ts's documented 'never merged' rule, which the pre-existing outer checks in this file were quietly violating)"
  - "First-resolution fail-loud now covers BOTH startRect and endRect uniformly inside flyCardInternal via a single getRect()+reportMissingFlyTarget() check, replacing normalizeRect's narrower, unconditional (non-isDevMode-gated) startRect-only throw — the old throw could never be observed as a distinct 'dev vs prod' behavior and only handled the function-returning-null case, not a null HTMLElement/DOMRect target"
  - "The per-frame endRect re-check inside animate() (a target disappearing DURING flight) is untouched and still a silent complete — RESEARCH Pitfall 3: a moving target legitimately vanishing mid-flight is not an authoring error, only the FIRST resolution (before the flying element is created) is"
  - "FlyConfig.element (trace identity) is distinct from FlyConfig.id (animation-bookkeeping key); autoWatch supplies the engine element id via .element, manual fly()/flyMultiple() default to .id when omitted"
  - "Manual fly()/flyMultiple() derive from/to from an HTMLElement start/end target's anchor attribute (data-bs-el-id/data-card-id/data-piece-id/data-element-id/id) only when no explicit from/to override is given; a raw DOMRect or moving-target function carries no derivable identity and stays undefined (RESEARCH A3 discretion)"

requirements-completed: [ANIM-01, ANIM-02, ANIM-03]

duration: 55min
completed: 2026-07-02
---

# Phase 128 Plan 05: useFlyingElements Test-Mode + Fail-Loud + Flagship Trace Summary

**useFlyingElements now records instant, assertable `{kind:'fly'}` traces in test mode — including the CONTEXT flagship `{from:'opponentHand', to:'myHand'}` autoWatch assertion keyed by the engine element id — and fails loud (dev-gated) on a first-resolution missing start/end target, with its first direct unit tests covering all paths.**

## Performance

- **Duration:** 55 min
- **Started:** 2026-07-02T16:12:00Z
- **Completed:** 2026-07-02T17:07:00Z
- **Tasks:** 2/2 completed
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- `flyCardInternal()` now checks `isAnimationTestModeEnabled()` in a branch positioned textually ABOVE `prefersReducedMotion`, recording one `AnimationTrace{kind:'fly', element, from, to, meta:{startRect,endRect}}` and returning without ever pushing onto `flyingCards` or starting the RAF chain
- `autoWatch` threads its container names (and, for the disappear/appear count-based routes, the route's `from`/`to`) plus the engine element id through new `FlyConfig.from`/`to`/`element` fields, so its traces carry the CONTEXT-flagship `{from:'opponentHand', to:'myHand'}`-style identities instead of the internal `auto-fly-{id}-{timestamp}` bookkeeping key
- A single `reportMissingFlyTarget()` helper, gated by `isDevMode()`, fires on the FIRST resolution of either `startRect` or `endRect` (before the flying element is created), replacing `normalizeRect`'s narrower, unconditional (non-gated) startRect-only throw; the per-frame `getRect(endTarget)` re-check inside `animate()` (a target disappearing DURING flight) is untouched and stays a silent complete
- Removed three separate `prefersReducedMotion` early-returns (in `fly()`, `flyMultiple()`, and the `autoWatch` watcher) that were unconditionally bypassing test-mode recording whenever the user's OS preferred reduced motion — a real "never merged" violation the plan's read-through surfaced; test mode is now independently reachable regardless of that preference, while flyCardInternal's own reduced-motion check still governs the REAL animation path
- `useFlyingElements.test.ts` created with 8 passing tests: the flagship autoWatch trace assertion, 2 manual fly() test-mode traces (with/without HTMLElement anchor identity), a mocked-RAF real-path test that drives the RAF chain to completion and resolves the fly promise, and 3 fail-loud tests (dev-throw on missing start, dev-throw on missing end, prod-console.error+skip)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add test-mode trace branch + first-resolution throw to useFlyingElements** - `550f3f1` (feat)
2. **Task 2: Direct unit tests for useFlyingElements (test-mode + mocked-RAF real path + throw)** - `6f5e4d8` (test)

**Plan metadata:** (this commit)

## Files Created/Modified

- `src/ui/composables/useFlyingElements.ts` - imports `isAnimationTestModeEnabled`/`recordTrace` from `./useAnimationTestMode.js` and `isDevMode` from `../../utils/dev.js`; new `FLY_ANCHOR_ATTRS`/`getAnchorId`/`deriveAnchorId`/`reportMissingFlyTarget` helpers; `flyCardInternal()` now resolves+validates start/end targets first (fail-loud), then checks test mode, then reduced motion; `FlyConfig` gained optional `from`/`to`/`element`; `normalizeRect()` removed (superseded); `autoWatch`'s three `flyConfigs.push()` sites and the watcher's blanket reduced-motion check updated
- `src/ui/composables/useFlyingElements.test.ts` - new direct unit test file: flagship autoWatch trace, manual fly() test-mode traces, mocked-RAF real path, fail-loud dev/prod paths

## Decisions Made

- Kept a single `reportMissingFlyTarget(which, id)` helper (mirrors 128-03's `reportMissingAnchor()` precedent) shared by both the start and end first-resolution checks, so the message/gate can never drift between the two.
- Chose to delete `normalizeRect()` outright rather than layer the new gated check alongside its old unconditional one — CLAUDE.md's "no backward-compat, no deprecation cycles" rule; the old throw was a narrower, un-gated special case of the same validation the new uniform check now performs for both targets.
- `FlyConfig.element` added as a distinct field from `FlyConfig.id`, discovered necessary while writing Task 2's flagship-assertion test: `autoWatch`'s internally-generated `FlyConfig.id` (e.g. `auto-fly-42-1719936000000`) is not something a test can assert on stably (it embeds `Date.now()`), so the trace's `element` field needed its own explicit source — the engine element id.
- In the test file, switched to a dynamic `await import('./useFlyingElements.js')` (not static) after `vi.stubGlobal('matchMedia'/'ResizeObserver')`, following 128-03's `useFLIP.test.ts` precedent exactly (this composable transitively imports `useElementAnimation.js`, which reads `window.matchMedia()` at module load time).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Three prefersReducedMotion early-returns silently defeated test mode**
- **Found during:** Task 1 (writing the test-mode branch)
- **Issue:** `fly()`, `flyMultiple()`, and the `autoWatch` watcher each had their own `if (prefersReducedMotion.value) return;` guard BEFORE ever calling into `flyCardInternal()`. Since the new test-mode branch lives inside `flyCardInternal()`, these outer guards meant a user/CI environment with reduced motion preferred would never reach the test-mode branch at all — directly violating `useAnimationTestMode.ts`'s documented "test mode is never merged with prefers-reduced-motion" design principle (128-01 decision), which this file's pre-existing code had never been updated to honor.
- **Fix:** Removed the three outer early-returns; `flyCardInternal()` alone now gates on `prefersReducedMotion.value`, AFTER the test-mode check. `flyMultiple()` keeps its unrelated `configs.length === 0` shortcut.
- **Files modified:** `src/ui/composables/useFlyingElements.ts`
- **Verification:** `npx vitest run src/ui/composables/useFlyingElements.test.ts` — the flagship autoWatch trace test only passes with this fix (jsdom's stubbed `matchMedia` reports `matches: false`, so this wasn't directly exercised by a "reduced motion on" test case, but the design-principle violation was real and would have silently broken test mode for any consumer whose OS/browser prefers reduced motion).
- **Committed in:** `550f3f1` (Task 1 commit)

**2. [Rule 1 - Bug] Trace `element` field used the wrong identity for autoWatch**
- **Found during:** Task 2 (writing the flagship assertion test)
- **Issue:** The initial Task 1 implementation recorded `element: id` where `id` is `FlyConfig.id` — for `autoWatch`, an internally-generated string like `auto-fly-42-1719936000000` (embeds `Date.now()`), not the plan's required "engine element id" (a stable, assertable value). The plan's own behavior spec ("autoWatch trace: element = engine element id") could not be satisfied by the initial design.
- **Fix:** Added `FlyConfig.element` (optional, distinct from `.id`) and threaded it through `InternalFlyOptions`/`flyCardInternal`; `autoWatch`'s three `flyConfigs.push()` sites now set `element: String(id)` using the numeric engine element id already in scope. Manual `fly()`/`flyMultiple()` calls default to `.id` when `.element` is omitted (unchanged behavior for existing callers).
- **Files modified:** `src/ui/composables/useFlyingElements.ts`
- **Verification:** `npx vitest run src/ui/composables/useFlyingElements.test.ts` — flagship test asserts `element: '42'` (the engine element id), not the generated FlyConfig id.
- **Committed in:** `6f5e4d8` (Task 2 commit)

**3. [Rule 1 - Bug] normalizeRect's unconditional startRect-only throw could never be tested as dev/prod-gated per the plan's acceptance criteria**
- **Found during:** Task 2 (writing the fail-loud throw-path tests)
- **Issue:** The only way to make a `startRect` resolve to `null` through the public `fly()` API is to pass a function that returns `null` — but that case was already handled by the PRE-EXISTING `normalizeRect()`, which throws unconditionally (never gated by `isDevMode()`, no `console.error`+skip fallback). Writing the plan's required "throws in dev / console.errors in prod" test pair for the start-target case was impossible without touching `normalizeRect`'s call site, since its old behavior always throws regardless of environment.
- **Fix:** Removed `normalizeRect()` and its call site in `fly()`; `startRect` now flows through to `flyCardInternal` in its full (possibly-function) form, resolved once via the same `getRect()` + `reportMissingFlyTarget()` path already built for `endRect`'s first resolution. This makes start and end target validation symmetric and uniformly `isDevMode()`-gated.
- **Files modified:** `src/ui/composables/useFlyingElements.ts`
- **Verification:** `npx vitest run src/ui/composables/useFlyingElements.test.ts` — both the dev-throw and prod-console.error tests for a null start target pass; full suite (`npx vitest run`) 157 files / 2056 tests green; `npx tsc --noEmit -p .` shows no new errors attributable to this file.
- **Committed in:** `6f5e4d8` (Task 2 commit)

## Known Stubs

None — no hardcoded empty values, placeholder text, or unwired data introduced by this plan.

## Threat Flags

None — changes stay within the threat model's registered dispositions (T-128-01 test-mode branch gated solely by `isAnimationTestModeEnabled()`, independent of `prefersReducedMotion`; T-128-02 trace payload carries only element/container identity strings + rects in `meta`, no `elementData` rank/suit/hidden-info values copied in; T-128-03 dev-throw is `isDevMode()`-gated with a `console.error`+skip production fallback, and the per-frame mid-flight path remains a non-throwing silent complete). No new network endpoints, auth paths, or schema changes were introduced.

## Verification

- `npx vitest run src/ui/composables/useFlyingElements.test.ts` — 8/8 tests green
- `npx vitest run` (full suite) — 157 files, 2056/2056 tests green
- `npx tsc --noEmit -p .` — no new type errors attributable to this plan's files (remaining errors are pre-existing, documented "tsc test-file looseness" backlog items in unrelated files)
- `npx eslint src/ui/composables/useFlyingElements.ts` — 2 `@typescript-eslint/no-shadow` errors present both before and after this plan's changes (confirmed via `git stash`/re-lint diff) — this file is one of PROJECT.md's 3 documented pre-existing no-shadow backlog items, out of scope per the plan's scope boundary
- Code read: test-mode branch in `flyCardInternal()` textually precedes the `prefersReducedMotion` branch
- Code read: fail-loud sites use `isDevMode()` (not a fresh `import.meta.env` check); the per-frame `if (!endRect) {...}` re-check inside `animate()` remains a silent complete

## TDD Gate Compliance

Not a plan-level `type: tdd` plan (frontmatter `type: execute`); Task 1 and Task 2 each carry `tdd="true"` at the task level, but the plan itself sequences implementation (Task 1) before its direct tests (Task 2) rather than a RED→GREEN cycle within a single task — this ordering was authored explicitly by the plan (Task 1 = implementation, Task 2 = "give it its first direct unit tests"), consistent with 128-01/128-03's precedent of test-after-implementation for foundational composable work. No RED-phase (failing-test) commit exists for this plan; both task commits (`550f3f1` feat, `6f5e4d8` test) reflect the plan's own task boundaries.

## Self-Check: PASSED

- FOUND: src/ui/composables/useFlyingElements.ts
- FOUND: src/ui/composables/useFlyingElements.test.ts
- FOUND commit: 550f3f1
- FOUND commit: 6f5e4d8

---
*Phase: 128-animation-drag-drop-test-story*
*Completed: 2026-07-02*
