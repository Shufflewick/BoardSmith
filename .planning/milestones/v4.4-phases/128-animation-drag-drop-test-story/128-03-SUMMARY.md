---
phase: 128-animation-drag-drop-test-story
plan: 03
subsystem: ui
tags: [animation, vitest, jsdom, flip, dev-warnings, fail-loud]

requires:
  - phase: 128-animation-drag-drop-test-story (plan 01)
    provides: isAnimationTestModeEnabled() / recordTrace() / AnimationTrace trace-recorder contract
provides:
  - useFLIP test-mode trace branch (instant, assertable {kind:'flip'} traces, no WAAPI)
  - useFLIP fail-loud first-resolution missing-anchor throw (dev) / console.error+skip (prod)
  - useFLIP's first direct unit tests (test-mode, mocked-WAAPI real path, throw path)
affects: [128-04, 128-05, 128-06]

tech-stack:
  added: []
  patterns:
    - "Dynamic (not static) import of the composable-under-test after vi.stubGlobal('matchMedia'/'ResizeObserver') — required whenever the module transitively reads window.matchMedia() at load time, since a static import is hoisted by the ESM/Vite transform ahead of runtime vi.stubGlobal() calls regardless of source order"
    - "vi.hoisted() mutable state object + vi.mock() partial-override factory to make isDevMode() controllable per-test (dev-throw vs prod-console.error) without touching the real utils/dev.ts module for other exports"

key-files:
  created:
    - src/ui/composables/useFLIP.test.ts
  modified:
    - src/ui/composables/useFLIP.ts

key-decisions:
  - "reportMissingAnchor() is a single shared helper (capture() + animate()'s first-resolution per-element loop both call it) rather than duplicated throw logic — one message, one isDevMode() gate, two call sites"
  - "Test-mode trace's from/to use the container's own getElementId() result if present, else the handler's CSS selector string as a stable fallback label — containers rarely carry their own anchor attribute, so the selector fallback keeps the trace assertable even then"
  - "Test-mode branch only emits a trace for elements that were BOTH found in the DOM by selector AND present in the previously-captured positions map (mirrors the real animate() path's shape) — an element found but never captured is not a 'moved' element, consistent with the real WAAPI path's semantics"

requirements-completed: [ANIM-01, ANIM-02, ANIM-03]

duration: 18min
completed: 2026-07-02
---

# Phase 128 Plan 03: useFLIP Test-Mode + Fail-Loud Anchor Throw Summary

**useFLIP now records instant, assertable `{kind:'flip'}` traces in test mode (never merged with prefers-reduced-motion) and fails loud on first-resolution missing anchor attributes (dev throw / prod console.error), with its first direct unit tests covering all three paths.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-07-02T11:44:00Z
- **Completed:** 2026-07-02T12:02:00Z
- **Tasks:** 2/2 completed
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- `animate()` now checks `isAnimationTestModeEnabled()` in a branch positioned textually ABOVE the `prefersReducedMotion` check, recording one `AnimationTrace{kind:'flip', element, from, to, meta:{deltaX,deltaY}}` per previously-captured, currently-found element and returning without ever calling `el.animate()`
- `capture()` and `animate()`'s first-resolution per-element loop both fail loud via a new shared `reportMissingAnchor()` helper when an element the caller registered lacks all four recognized anchor attributes (`data-card-id`/`data-piece-id`/`data-element-id`/`id`) — throws in dev (`isDevMode()`), `console.error`s + skips in prod
- The per-frame re-check (`if (!oldRect) return;` — a captured id not re-found on a later pass) deliberately remains a silent skip, per RESEARCH Pitfall 3 (transient render state, not an anchor error)
- `useFLIP.test.ts` created with 5 passing tests: 2 test-mode (trace-by-identity, no `el.animate()` call), 1 mocked-WAAPI real path (stubbed `getBoundingClientRect` + `animate()` proves the real chain fires), 2 fail-loud (dev throws, prod console.errors+skips)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add test-mode trace branch + fail-loud anchor throw to useFLIP** - `6254025` (feat)
2. **Task 2: Direct unit tests for useFLIP (test-mode + mocked-WAAPI real path + throw)** - `173793a` (test)

**Plan metadata:** (this commit)

## Files Created/Modified
- `src/ui/composables/useFLIP.ts` - imports `isAnimationTestModeEnabled`/`recordTrace` from `./useAnimationTestMode.js` and `isDevMode` from `../../utils/dev.js`; new `reportMissingAnchor()` helper; test-mode branch in `animate()` above the reduced-motion check; `capture()` and `animate()`'s first-resolution loop now call `reportMissingAnchor()` on a missing id instead of silently skipping
- `src/ui/composables/useFLIP.test.ts` - new direct unit test file: test-mode trace-by-identity + no-WAAPI-call, mocked-WAAPI real path with stubbed rects, dev-throw / prod-console.error fail-loud paths

## Decisions Made
- Kept a single `reportMissingAnchor(el)` helper shared by both call sites (rather than inlining the dev/prod branch twice) so the message and gate can never drift between `capture()` and `animate()`.
- Test-mode trace `from`/`to` use the container's own `getElementId()` if present, else fall back to the handler's selector string — per the plan's suggested fallback, since containers themselves rarely carry an anchor attribute.
- In `useFLIP.test.ts`, switched from a static `import { useFLIP } from './useFLIP.js'` to a dynamic `await import('./useFLIP.js')` placed after the `vi.stubGlobal('matchMedia', ...)` calls — a static import is hoisted by Vitest's ESM transform ahead of runtime `vi.stubGlobal()` regardless of source-line order, which caused `window.matchMedia is not a function` at collection time (proved via an isolated probe test before fixing). This differs from `useDragDrop.test.ts`'s existing pattern, which coincidentally "works" with a static import only because neither `useDragDrop.ts` nor `useBoardInteraction.ts` actually read `matchMedia` at module load — confirmed by grep before relying on it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Static import of useFLIP.js loaded before matchMedia stub was installed**
- **Found during:** Task 2
- **Issue:** Following `HintOverlay.test.ts`/`useDragDrop.test.ts`'s documented pattern (`vi.stubGlobal('matchMedia', ...)` then a static `import`), the test file failed at collection with `TypeError: window.matchMedia is not a function` thrown from `useElementAnimation.ts:36` (module-load-time `window.matchMedia(...)` read, transitively imported by `useFLIP.ts`). An isolated probe file proved the failure persisted even with `vi.mock()` removed entirely, and that `useDragDrop.test.ts`'s existing use of this pattern only "works" because neither of its transitive imports (`useDragDrop.ts`, `useBoardInteraction.ts`) actually call `matchMedia` — the stub in that file is unexercised, precautionary boilerplate, not proof the ordering pattern is sound.
- **Fix:** Replaced the static `import { useFLIP } from './useFLIP.js'` (and the `useAnimationTestMode.js` import) with dynamic `await import(...)` calls placed after the `vi.stubGlobal` calls, guaranteeing the stubs are installed before `useFLIP.js`'s module graph (including `useElementAnimation.js`) is evaluated.
- **Files modified:** `src/ui/composables/useFLIP.test.ts`
- **Verification:** `npx vitest run src/ui/composables/useFLIP.test.ts` — 5/5 tests pass; confirmed via an isolated `__probe.test.ts` scratch file (deleted after diagnosis) that static import failed identically with and without the `vi.mock()` call present, isolating the root cause to import-hoisting vs. runtime stub-application ordering, not to `vi.mock`'s own hoisting.
- **Committed in:** `173793a` (Task 2 commit)

**2. [Rule 1 - Bug] Default selector `[data-element-id]` cannot match an element missing that exact attribute, defeating the fail-loud test setup**
- **Found during:** Task 2 (writing the fail-loud tests)
- **Issue:** The first draft of the fail-loud tests appended a plain `<div>` (no attributes at all) to the container and called `capture()` using the composable's DEFAULT selector `[data-element-id]`. Since `querySelectorAll('[data-element-id]')` never returns an element lacking that attribute in the first place, `reportMissingAnchor()` was never reached — the tests failed with "expected function to throw" / "expected console.error to be called".
- **Fix:** Gave the test element a `.flip-target` class and passed a custom `selector: '.flip-target'` to `useFLIP()`, so the element is found by the selector but still carries none of the four recognized identity attributes — correctly exercising the first-resolution missing-anchor path.
- **Files modified:** `src/ui/composables/useFLIP.test.ts`
- **Verification:** `npx vitest run src/ui/composables/useFLIP.test.ts` — both fail-loud tests pass.
- **Committed in:** `173793a` (Task 2 commit; fixed before the final commit, not as a follow-up)

## Known Stubs

None — no hardcoded empty values, placeholder text, or unwired data introduced by this plan.

## Threat Flags

None — changes stay within the threat model's registered dispositions (T-128-01 test-mode branch gated solely by `isAnimationTestModeEnabled()`; T-128-02 trace payload carries only identity strings + deltaX/deltaY in `meta`, no hidden-info values; T-128-03 dev-throw is `isDevMode()`-gated with a `console.error`+skip production fallback). No new network endpoints, auth paths, or schema changes were introduced.

## Verification

- `npx vitest run src/ui/composables/useFLIP.test.ts` — 5/5 tests green
- `npx vitest run` (full suite) — 155 files, 2042/2042 tests green
- `npx tsc --noEmit -p .` — no new type errors introduced by this plan (`grep -i useFLIP` on the tsc output returns nothing); all listed errors are pre-existing, documented "tsc test-file looseness" backlog items in unrelated files
- Code read: test-mode branch in `animate()` textually precedes the `prefersReducedMotion` branch
- Code read: fail-loud sites use `isDevMode()` (not a fresh `import.meta.env` check); the per-frame `if (!oldRect) return;` re-check remains a silent skip

## TDD Gate Compliance

Not a plan-level `type: tdd` plan (frontmatter `type: execute`); Task 1 and Task 2 each carry `tdd="true"` at the task level, but the plan itself sequences implementation (Task 1) before its direct tests (Task 2) rather than a RED→GREEN cycle within a single task — this ordering was authored explicitly by the plan (Task 1 = implementation, Task 2 = "give it its first direct unit tests"), consistent with 128-01/128-02's precedent of test-after-implementation for foundational composable work. No RED-phase (failing-test) commit exists for this plan; both task commits (`6254025` feat, `173793a` test) reflect the plan's own task boundaries.

## Self-Check: PASSED

- FOUND: src/ui/composables/useFLIP.ts
- FOUND: src/ui/composables/useFLIP.test.ts
- FOUND commit: 6254025
- FOUND commit: 173793a
