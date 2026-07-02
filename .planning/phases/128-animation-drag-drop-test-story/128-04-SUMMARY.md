---
phase: 128-animation-drag-drop-test-story
plan: 04
subsystem: ui
tags: [animation, vitest, jsdom, raf, dev-warnings, fail-loud]

requires:
  - phase: 128-animation-drag-drop-test-story (plan 01)
    provides: isAnimationTestModeEnabled() / recordTrace() / AnimationTrace trace-recorder contract
provides:
  - useElementAnimation test-mode trace branch (instant, assertable {kind:'element'} traces, no RAF loop)
  - useElementAnimation fail-loud first-resolution missing-anchor throw (dev) / console.error+skip (prod)
  - useElementAnimation's first direct unit tests (test-mode, mocked-RAF real path, throw path)
affects: [128-05, 128-06]

tech-stack:
  added: []
  patterns:
    - "Dynamic (not static) import of the composable-under-test after vi.stubGlobal('matchMedia') — same fix as 128-03's useFLIP.test.ts, required because useElementAnimation.ts itself is the module-load-time window.matchMedia() reader"
    - "Manually-ticked requestAnimationFrame queue (vi.stubGlobal('requestAnimationFrame', cb => queue.push(cb))) plus a stubbed performance.now() to drive the real RAF-based animation loop deterministically in jsdom, per RESEARCH's Don't-Hand-Roll guidance (fake timers do not auto-tick RAF)"

key-files:
  created:
    - src/ui/composables/useElementAnimation.test.ts
  modified:
    - src/ui/composables/useElementAnimation.ts

key-decisions:
  - "Container's own data-element-id (or undefined) is used for trace from/to, per the plan's discretion note — no new containerName param added to the public API, since this composable has no first-class named-container concept"
  - "reportMissingAnchor() mirrors useFLIP's shared-helper shape (single message, single isDevMode() gate) but is local to useElementAnimation.ts, keyed on the single data-element-id attribute this composable actually recognizes (unlike useFLIP's four-attribute search)"
  - "Only the FIRST-resolution `if (!id) return;` (line ~100, inside animateToCurrentPositions()'s per-element loop) was upgraded to fail loud; the `if (!startPos) return;` skip (element not previously captured — transient render state) stays silent, matching useFLIP's per-frame re-check precedent; capturePositions()'s own silent id-skip was left untouched (not in the plan's scope — only animate()'s first-resolution site was named)"

requirements-completed: [ANIM-01, ANIM-02, ANIM-03]

duration: 8min
completed: 2026-07-02
---

# Phase 128 Plan 04: useElementAnimation Test-Mode + Fail-Loud Anchor Throw Summary

**useElementAnimation now records instant, assertable `{kind:'element'}` traces in test mode (never merged with prefers-reduced-motion) and fails loud on first-resolution missing `data-element-id` (dev throw / prod console.error), with its first direct unit tests covering test-mode, a mocked-RAF real path, and the throw path.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-02T16:51:00Z
- **Completed:** 2026-07-02T16:54:06Z
- **Tasks:** 2/2 completed
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- `animateToCurrentPositions()` now checks `isAnimationTestModeEnabled()` in a branch positioned textually ABOVE the `prefersReducedMotion` check, recording one `AnimationTrace{kind:'element', element, from, to, meta:{deltaX,deltaY}}` per previously-captured, currently-found element and returning without ever calling `requestAnimationFrame`
- First-resolution missing `data-element-id` (the per-element loop's `if (!id) ...` site) now fails loud via a new local `reportMissingAnchor()` helper — throws in dev (`isDevMode()`), `console.error`s + skips in prod
- The transient `if (!startPos) return;` skip (element found but never captured) deliberately remains silent, per the useFLIP precedent
- `useElementAnimation.test.ts` created with 6 passing tests: 2 test-mode (trace-by-identity, no transform applied), 2 real-path (manually-ticked RAF queue + stubbed `getBoundingClientRect`/`performance.now()` proving the actual animation loop drives a mid-flight transform then clears it on completion), 2 fail-loud (dev throws, prod console.errors+skips)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add test-mode trace branch + fail-loud anchor throw to useElementAnimation** - `a35287c` (feat)
2. **Task 2: Direct unit tests for useElementAnimation (test-mode + mocked-RAF real path + throw)** - `34bf380` (test)

**Plan metadata:** (this commit)

## Files Created/Modified
- `src/ui/composables/useElementAnimation.ts` - imports `isAnimationTestModeEnabled`/`recordTrace` from `./useAnimationTestMode.js` and `isDevMode` from `../../utils/dev.js`; new `reportMissingAnchor()` helper; test-mode branch in `animateToCurrentPositions()` above the reduced-motion check; the per-element loop's first-resolution missing-id site now calls `reportMissingAnchor()` instead of silently skipping
- `src/ui/composables/useElementAnimation.test.ts` - new direct unit test file: test-mode trace-by-identity + no-transform-applied, mocked-RAF real path with a manually-ticked queue + stubbed rects/`performance.now()`, dev-throw / prod-console.error fail-loud paths

## Decisions Made
- Kept the container-identity discretion note as written: `from`/`to` use the container's own `data-element-id` (or `undefined`), not a new `containerName` param — no public API expansion.
- Chose a manually-ticked RAF queue (`vi.stubGlobal('requestAnimationFrame', cb => queue.push(cb))`) plus a stubbed `performance.now()` for the real-path tests, per RESEARCH's guidance that fake timers do not auto-tick `requestAnimationFrame`. Split the real-path assertions into two tests: one driving `now` straight to `duration` (asserts the transform clears on completion) and one driving `now` to the halfway point (asserts a mid-flight `translate(...)` transform is applied) — this proves the animation loop's progress math without relying on pixel-perfect values.
- Reused 128-03's dynamic-import fix verbatim: `useElementAnimation.js` is itself the module that reads `window.matchMedia()` at load time (it's the module useFLIP.test.ts had to route around), so this test file dynamic-imports it after `vi.stubGlobal('matchMedia', ...)` rather than risking the same hoisting failure.

## Deviations from Plan

None - plan executed exactly as written. The RAF real-path test was split into two assertions (mid-flight + completion) instead of one, purely to make the state-transition assertions unambiguous; this stays within the plan's "assert isAnimating toggled true then settled" intent even though `useElementAnimation` (unlike `useFLIP`) has no exposed `isAnimating` ref — the equivalent observable signal here is the `style.transform` value, which the plan's own `<read_first>` context (lines 84-120) confirms is the only externally visible state this composable exposes per animation frame.

## Known Stubs

None — no hardcoded empty values, placeholder text, or unwired data introduced by this plan.

## Threat Flags

None — changes stay within the threat model's registered dispositions (T-128-01 test-mode branch gated solely by `isAnimationTestModeEnabled()`; T-128-02 trace payload carries only identity strings + deltaX/deltaY in `meta`, no hidden-info values; T-128-03 dev-throw is `isDevMode()`-gated with a `console.error`+skip production fallback). No new network endpoints, auth paths, or schema changes were introduced.

## Verification

- `npx vitest run src/ui/composables/useElementAnimation.test.ts` — 6/6 tests green
- `npx vitest run` (full suite) — 156 files, 2048/2048 tests green
- `npx tsc --noEmit -p .` — no new type errors introduced by this plan (grep for `useElementAnimation` on the tsc output returns nothing)
- Code read: test-mode branch in `animateToCurrentPositions()` textually precedes the `prefersReducedMotion` branch
- Code read: fail-loud site uses `isDevMode()`; the `if (!startPos) return;` transient skip remains silent
- Code read: no new exported types/params added to `useElementAnimation`'s public surface (`AnimationOptions`, return shape unchanged)

## TDD Gate Compliance

Not a plan-level `type: tdd` plan (frontmatter `type: execute`); Task 1 and Task 2 each carry `tdd="true"` at the task level, but the plan itself sequences implementation (Task 1) before its direct tests (Task 2) rather than a RED→GREEN cycle within a single task — this ordering was authored explicitly by the plan (Task 1 = implementation, Task 2 = "give it its first direct unit tests"), consistent with 128-01/128-03's precedent of test-after-implementation for foundational composable work. No RED-phase (failing-test) commit exists for this plan; both task commits (`a35287c` feat, `34bf380` test) reflect the plan's own task boundaries.

## Self-Check: PASSED

- FOUND: src/ui/composables/useElementAnimation.ts
- FOUND: src/ui/composables/useElementAnimation.test.ts
- FOUND commit: a35287c
- FOUND commit: 34bf380

---
*Phase: 128-animation-drag-drop-test-story*
*Completed: 2026-07-02*
