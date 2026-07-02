# Phase 128: Animation & Drag-Drop Test Story - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Animation and drag-drop behavior is testable headlessly via an instant/traced test mode and direct composable tests, and fails loud instead of silently no-op'ing on misconfiguration. Covers ANIM-01 (test mode + assertable trace), ANIM-02 (direct unit tests for useFLIP/useFlyingElements/useElementAnimation/useActionAnimations/useDragDrop), ANIM-03 (fail-loud on missing anchor attributes + the deferred v4.1 anchorAttrs dev-warning).

Scope: `src/ui/composables/` (the five animation/drag composables + a new test-mode/trace module + useBoardInteraction registration warning). No new visuals — test infrastructure phase.

</domain>

<decisions>
## Implementation Decisions

### Animation Test Mode + Trace (ANIM-01)
- An explicit, exported animation-test-mode switch + trace recorder module in `src/ui`; the animation composables consult it and resolve instantly while recording; NEVER auto-enabled by prefers-reduced-motion (explicit beats implicit in tests)
- Trace shape: `{kind, element (data-bs-el-id / element id when available), from, to, meta}` — from/to as container/anchor identities (assertable), rects in meta
- Exported from `boardsmith/ui`; re-exported via `boardsmith/testing` if the dependency direction allows (testing must not pull Vue into node-only consumers — check; if unsafe, ui-only export)

### Direct Composable Tests (ANIM-02)
- Both timing paths covered: mocked RAF + fake timers for the real animation paths (the RAF chain gets at least one test with mocked RAF), and the instant test mode for trace-based tests
- useDragDrop: both levels — the `boardInteraction.startDrag()`/`triggerDrop()` API path (the proven parity surface) AND jsdom drag-event simulation where practical
- All five composables get direct unit tests: useFLIP, useFlyingElements, useElementAnimation, useActionAnimations, useDragDrop

### Fail-Loud Anchors (ANIM-03)
- Missing-anchor behavior in animation helpers: dev-mode (`import.meta.env.DEV`) THROW with an actionable message (which element, which attribute, how to fix); production logs console.error and skips (animation is cosmetic — don't crash a live game)
- anchorAttrs dev-warning (deferred v4.1 backlog item): in `useBoardInteraction`'s element-registration path — dev-only warning (once per element type) when a custom board renders selectable elements without `anchorAttrs`

### Claude's Discretion
- Recorder API names; how test mode is toggled (module function vs provide/inject); exact trace meta contents; which drag-event simulations are practical in jsdom

</decisions>

<code_context>
## Existing Code Insights

(From the verified audit + later phases.)

### The five untested composables (verified zero test files at audit time)
- src/ui/composables/useFLIP.ts — Web Animations API (`.animate().finished` — awaitable)
- src/ui/composables/useFlyingElements.ts — nested RAF chains (lines ~521-628), promise-based fly()
- src/ui/composables/useElementAnimation.ts — RAF loop (~140-174)
- src/ui/composables/useActionAnimations.ts — setTimeout waits for CSS transitions
- src/ui/composables/useDragDrop.ts — HTML5 drag events; tested only indirectly via useDragDropTargets

### Reusable Assets
- `prefersReducedMotion` refs already exist in useElementAnimation/useFLIP (composables already know how to short-circuit — the test mode can reuse those branch points, but must be a distinct explicit flag)
- drag-keyboard-parity.test.ts drives drags via boardInteraction.startDrag()/triggerDrop() (the API-level pattern)
- anchorAttrs (useBoardInteraction) emits data-bs-el-id/notation/name — the identity source for traces and the ANIM-03 warning
- useAnimationEvents.test.ts + useAutoRendererAnimations.test.ts — existing animation-adjacent test patterns (fake timers, nextTick)
- Phase 124's dom-leak jsdom mount patterns; CardRenderer.a11y.test.ts jsdom pragma convention
- Phase 126 structured-warning taxonomy (if animation warnings should ride any structured channel — likely console-only in prod, keep simple)

### Established Patterns
- vitest node default env; jsdom per-file pragma
- FLIP consumers query `[data-bs-el-id]` / games use data-element-id alias (v4.3: AutoUI emits data-bs-el-id; data-element-id kept as FLIP alias)

### Integration Points
- src/ui/index.ts exports (new test-mode/trace module)
- The five composables' animation entry points (fly, animate, capture/play, action animations, drag lifecycle)
- useBoardInteraction element registration (ANIM-03 warning)

</code_context>

<specifics>
## Specifics

- Target assertion ergonomics (the phase's reason to exist): `expect(getAnimationTrace()).toContainEqual({kind:'fly', element:'card-7H', from:'opponentHand', to:'myHand', ...})` — an agent can prove "card X flew from A to B" headlessly
- Silent no-op today: FLIP querySelector misses when an element lacks its anchor attribute — that exact path must throw (dev) with the element/attribute named
- Games adopt in Phase 129; docs in 130

</specifics>

<deferred>
## Deferred Ideas

- Pixel/visual regression testing — out of scope (trace-based assertions cover correctness)
- Game-repo animation tests — Phase 129

</deferred>
