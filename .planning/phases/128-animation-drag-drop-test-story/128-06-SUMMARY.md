---
phase: 128-animation-drag-drop-test-story
plan: 06
subsystem: ui
tags: [animation, vitest, jsdom, action-animations, dev-warnings, fail-loud]

requires:
  - phase: 128-animation-drag-drop-test-story (plan 01)
    provides: isAnimationTestModeEnabled() / recordTrace() / AnimationTrace trace-recorder contract
provides:
  - useActionAnimations test-mode trace branch (instant, assertable {kind:'action'} traces from its OWN interpolated selector strings, no delegation to fly())
  - useActionAnimations fail-loud missing source/destination element (dev-throw / prod console.error, reusing exact existing message text)
  - useActionAnimations's first direct unit tests (test-mode, fake-timer real path, fail-loud dev/prod x source/destination)
affects: []

tech-stack:
  added: []
  patterns:
    - "Test-mode trace recorded at the composable's OWN level (its own interpolated elementSelector/destinationSelector strings), not delegated through useFlyingElements' fly() - resolves RESEARCH Open Question 2 and avoids double-recording since useFlyingElements has its own independent 'fly' trace branch"
    - "vi.useFakeTimers({ toFake: [...,'requestAnimationFrame','cancelAnimationFrame','performance','Date'] }) needed (not just the setTimeout default) because this composable's real path chains through useFlyingElements.fly(), which internally drives its animation loop via requestAnimationFrame + performance.now() timestamps - vitest's default toFake list only covers setTimeout family, so RAF/performance/Date must be added explicitly or the RAF chain never advances under fake timers"
    - "A throw inside an async Vue watch callback (no active component instance) is NOT swallowed by Vue's dev-build error logging - it still surfaces as a genuine unhandled promise rejection, captured in tests via a direct `process.on('unhandledRejection', ...)` listener rather than relying on a console.error spy"

key-files:
  created:
    - src/ui/composables/useActionAnimations.test.ts
  modified:
    - src/ui/composables/useActionAnimations.ts

key-decisions:
  - "Test-mode branch placed in the gameView watch handler (the destination side), positioned after both interpolated selector strings are available (source recomputed via interpolateSelector(config.elementSelector, args) from the stored args; destination already computed at that point) but before the destinationElement-not-found check and before delegating to fly() - satisfies 'checked BEFORE the existing reduced-motion/animation path' and 'no double-record'"
  - "Site 1 (source missing, in onBeforeAutoExecute) and Site 2 (destination missing, in the gameView watcher) both reuse their EXACT original console.warn message text verbatim, now gated: `if (isDevMode()) throw new Error(msg); else console.error(msg);` - no wording changes, per plan and CLAUDE.md's fail-loud/actionable-error requirements"
  - "Trace's `element` field derived from `args[config.elementSelection]` (the action's selection value), not `config.elementSelection` itself (the key name) - matches the 128-05 precedent of using stable, assertable identity values rather than internal bookkeeping keys"
  - "destSelectorStr (used for the trace's `to`) is left `undefined` for function-typed destinationSelector (no derivable string), matching useFlyingElements' discretion for non-string targets (128-05 decision)"

requirements-completed: [ANIM-01, ANIM-02, ANIM-03]

duration: 35min
completed: 2026-07-02
---

# Phase 128 Plan 06: useActionAnimations Test-Mode + Fail-Loud + Direct Tests Summary

**useActionAnimations now records an instant, assertable `{kind:'action'}` trace from its OWN interpolated elementSelector/destinationSelector strings (no delegation to useFlyingElements.fly(), avoiding double-recording), fails loud (dev-gated) at both former console.warn sites reusing the original message text, and has its first direct unit tests across test-mode, a fake-timer-driven real path, and the fail-loud throw path.**

## Performance

- **Duration:** 35 min
- **Started:** 2026-07-02T17:12:00Z
- **Completed:** 2026-07-02T17:47:00Z
- **Tasks:** 2/2 completed
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- Imported `isAnimationTestModeEnabled`/`recordTrace` from `./useAnimationTestMode.js` and `isDevMode` from `../../utils/dev.js` into `useActionAnimations.ts`
- Added a test-mode branch in the `gameView` watch handler: when enabled, records one `{kind:'action', element, from, to, meta:{action, args}}` trace using the composable's own interpolated `elementSelector`/`destinationSelector` strings and returns immediately, WITHOUT ever calling `fly()` — resolving RESEARCH Open Question 2 by recording at this composable's own level rather than delegating to `useFlyingElements`' independent 'fly' trace branch (which would double-record the same action)
- Upgraded both former `console.warn` sites (source element not found in `onBeforeAutoExecute`; destination element not found in the `gameView` watcher) to `isDevMode()`-gated `throw new Error(msg)` in dev / `console.error(msg)` in prod, reusing the EXACT original message text verbatim (both already carried selector/action/args, satisfying ANIM-03's actionable-error requirement)
- Created `useActionAnimations.test.ts` with 6 passing tests: the test-mode trace assertion (from/to equal to the composable's own interpolated strings, element equals the interpolated action-arg value), a fake-timer-driven real path that drives both the RAF chain (inside `useFlyingElements.fly()`) and the `setTimeout`-based cleanup wait to completion, and 4 fail-loud tests (dev-throw + prod-console.error for both missing source and missing destination)

## Task Commits

Each task was committed atomically:

1. **Task 1: Test-mode trace (own selectors) + upgrade both warn sites to dev-throw** - `319194c` (feat)
2. **Task 2: Direct unit tests for useActionAnimations (test-mode + setTimeout real path + throw)** - `041cd6c` (test)

**Plan metadata:** (this commit)

## Files Created/Modified

- `src/ui/composables/useActionAnimations.ts` - new imports (`isAnimationTestModeEnabled`/`recordTrace`/`isDevMode`); Site 1 (`onBeforeAutoExecute`'s source-not-found check) upgraded to dev-throw/prod-console.error; the `gameView` watch handler now computes `destSelectorStr` inline, inserts the test-mode trace-and-return branch immediately after destination resolution but before the destination-not-found check, and that check is likewise upgraded to dev-throw/prod-console.error
- `src/ui/composables/useActionAnimations.test.ts` - new direct unit test file: test-mode trace, fake-timer real path, 4 fail-loud dev/prod x source/destination tests

## Decisions Made

- Recomputed the interpolated `elementSelector` string inline in the watch handler (via `interpolateSelector(config.elementSelector, args)`) rather than threading a new field through `CapturedAnimationState`, since `config` and `args` are already available there and the interpolation is a pure, cheap, deterministic function of data already in scope — avoids widening an internal interface for a value trivially recomputable.
- Kept `destSelectorStr` as a `let` declared alongside `destinationElement` (rather than a separate constant later) so both the real resolution path and the test-mode trace share the exact same interpolated string, guaranteeing they can never drift.
- For the fake-timer real path, added `'requestAnimationFrame'`, `'cancelAnimationFrame'`, `'performance'`, and `'Date'` to `vi.useFakeTimers()`'s `toFake` list (vitest's default only covers the `setTimeout` family) — discovered via a real full-suite-only flake: the composable's `setTimeout`-based cleanup wait is faked correctly on its own, but the animation itself resolves through `useFlyingElements.fly()`'s internal `requestAnimationFrame` + `performance.now()` timing, which needs to be faked in lockstep or `elapsed = currentTime - startTime` never converges to the animation's `duration`.
- For the dev-mode "destination element missing" fail-loud test, used a direct `process.on('unhandledRejection', ...)` listener instead of a `console.error` spy — proved via a real full-suite run that Vue's dev-build error handling for an async `watch()` callback with no active component instance does NOT swallow the thrown error into a caught `console.error` call; it still surfaces as a genuine unhandled promise rejection, so that is the only reliable way to observe the throw actually fired.

## Deviations from Plan

None — plan executed exactly as written. Two implementation details required investigation beyond the plan's own read_first pointers (documented above as "Decisions Made" rather than "Auto-fixed Issues" since they concern test-authoring technique, not a bug in the composable itself):

- The fake-timer `toFake` list needed 4 additional entries beyond the default to drive the composable's real path to completion (a Rule 3 blocking-issue fix, scoped entirely to the new test file — not the composable itself).
- The dev-mode destination-throw test needed a `process.on('unhandledRejection', ...)` capture technique instead of the originally-planned console.error-spy approach (also a Rule 3 test-authoring fix, scoped to the new test file).

## Known Stubs

None — no hardcoded empty values, placeholder text, or unwired data introduced by this plan.

## Threat Flags

None — changes stay within the threat model's registered dispositions (T-128-01 test-mode branch gated solely by `isAnimationTestModeEnabled()`; T-128-02 trace payload carries only selector-string identities + action name + args in `meta`, no element attribute/hidden-info values copied in; T-128-03 dev-throw is `isDevMode()`-gated with a `console.error` production fallback reusing the original message, and the composable's other behavior — flip-in-place detection, MutationObserver hiding, crossfade — is untouched). No new network endpoints, auth paths, or schema changes were introduced.

## Verification

- `npx vitest run src/ui/composables/useActionAnimations.test.ts` — 6/6 tests green
- `npx vitest run` (full suite) — 158 files, 2062/2062 tests green (confirmed the fake-timer fix eliminated a full-suite-only flake observed during development)
- `grep -c "console.warn" src/ui/composables/useActionAnimations.ts` — 0 (both former warn sites now dev-gated throw/console.error)
- `npx tsc --noEmit -p .` — no new type errors attributable to this plan's files
- `npx eslint src/ui/composables/useActionAnimations.ts` — clean, no errors
- Code read: test-mode branch in the `gameView` watch handler textually precedes both the destination-not-found check and the `fly()` delegation

## TDD Gate Compliance

Not a plan-level `type: tdd` plan (frontmatter `type: execute`); Task 1 and Task 2 each carry `tdd="true"` at the task level, but the plan itself sequences implementation (Task 1) before its direct tests (Task 2) rather than a RED→GREEN cycle within a single task — consistent with 128-01/128-03/128-05's precedent of test-after-implementation for these animation composables. No RED-phase (failing-test) commit exists for this plan; both task commits (`319194c` feat, `041cd6c` test) reflect the plan's own task boundaries.

## Self-Check: PASSED

- FOUND: src/ui/composables/useActionAnimations.ts
- FOUND: src/ui/composables/useActionAnimations.test.ts
- FOUND commit: 319194c
- FOUND commit: 041cd6c

---
*Phase: 128-animation-drag-drop-test-story*
*Completed: 2026-07-02*
