---
phase: 105-annotation-overlay-ui-parity
plan: 03
subsystem: ui
tags: [vue3, tutorial, overlay, animation, accessibility, css-tokens, tdd]

# Dependency graph
requires:
  - phase: 105-01
    provides: Annotation[] content model on TutorialStep/TutorialStepView; engine types
  - phase: 105-02
    provides: anchorAttrs() placing data-bs-el-id/notation/name, data-bs-action, data-bs-panel on every interactive element

provides:
  - TutorialOverlay.vue: single annotation layer resolving data-bs-* anchors to ring+bubble
  - BoardMessage annotation variant: prose card (--bsg-r-md, caret, left-aligned) for tutorial bubbles
  - CSS.escape polyfill for selector-safe anchor attribute queries

affects:
  - 105-04 (GameShell wiring — mounts TutorialOverlay in .boardregion)
  - 105-05 (parity tests — TutorialOverlay is the subject)
  - 106 (predicate auto-advance — reads same tutorial.content path)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single overlay pattern: TutorialOverlay reads shared data-bs-* anchors so any custom UI gets annotation parity for free"
    - "BoardMessage variant prop: additive annotation variant leaves default pill unchanged"
    - "CSS border-trick caret: two-layer outer-border + ::after fill for --bsg-surface-2/line-2 edge matching bubble border"
    - "CSS.escape polyfill: production uses native CSS.escape; jsdom fallback escapes quotes/backslashes"
    - "ResizeObserver + scroll listener for live re-measurement; cleanup on unmount"

key-files:
  created:
    - src/ui/components/helpers/TutorialOverlay.vue
    - src/ui/components/helpers/TutorialOverlay.test.ts
  modified:
    - src/ui/components/helpers/BoardMessage.vue

key-decisions:
  - "CSS.escape polyfill added inline (not a new dependency) for jsdom test environment compatibility"
  - "aria-hidden on overlay root + aria-hidden=false override on BoardMessage bubble (bubble must be announced)"
  - "Bubble-only fallback uses position absolute 50% top when target querySelector returns null (never throws)"
  - "caret is a child <span> in BoardMessage not a pseudo-element — allows v-if conditional without scoped style complications"
  - "overlayRoot.closest('.boardregion') preferred over document.querySelector for multi-instance safety"

patterns-established:
  - "Single annotation overlay over shared anchor layer — no per-renderer method additions needed"
  - "BoardMessage variant prop pattern: additive, default unchanged, annotation adds anchor-style + caretSide"

requirements-completed: [TUT-01]

# Metrics
duration: 10min
completed: 2026-06-25
---

# Phase 105 Plan 03: TutorialOverlay + BoardMessage Annotation Variant Summary

**Single TutorialOverlay resolves annotation targets via data-bs-* anchors only, rendering a 3px accent ring + glow + marker chip over the target and a BoardMessage prose card bubble with connector caret, with full CSS.escape XSS guard, aria-hidden ring, role=status bubble, z-index 20, and prefers-reduced-motion support**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-06-25T21:58:03Z
- **Completed:** 2026-06-25T22:03:16Z
- **Tasks:** 3 (Task 1: BoardMessage, Task 2 TDD RED+GREEN: TutorialOverlay, Task 3: expanded tests)
- **Files modified:** 3

## Accomplishments
- Extended BoardMessage.vue with `variant="annotation"` (additive, zero regression to default pill/turn-prompt path)
- Implemented TutorialOverlay.vue: injects gameState, resolves element/action/panel targets via CSS.escape-built attribute selectors in .boardregion, renders ring + BoardMessage bubble with auto placement (prefer-below, flip-above, clamp)
- 14 component tests covering element resolution, getBoundingClientRect call proof, null-target bubble-only, no-content zero-markup, action+panel targets, and XSS safety
- Full suite 1357 tests pass; lint:css clean

## Task Commits

1. **Task 1: Extend BoardMessage with annotation variant** - `38362b7` (feat)
2. **Task 2 RED: Failing TutorialOverlay tests** - `043f9f6` (test)
3. **Task 2 GREEN: Implement TutorialOverlay.vue** - `469a53d` (feat)
4. **Task 3: Expanded test suite with anchor-resolution proof** - `f915602` (test)

## Files Created/Modified
- `src/ui/components/helpers/BoardMessage.vue` — added `variant`, `anchorStyle`, `caretSide` props; annotation content class; caret span with CSS border-trick in 4 directions; base pill unchanged
- `src/ui/components/helpers/TutorialOverlay.vue` — new; injects gameState; data-bs-* anchor resolver; ring (absolute + border + glow + marker chip); BoardMessage bubble with caretSide; ResizeObserver + scroll listener; reduced-motion animation guards; z-index 20
- `src/ui/components/helpers/TutorialOverlay.test.ts` — new; 14 tests; jsdom ResizeObserver stub; getBoundingClientRect spy proves anchor resolution; all 4 target kinds covered

## Decisions Made
- CSS.escape polyfill added inline (no new dependency) — jsdom doesn't expose CSS.escape; fallback escapes only `"` and `\` which is sufficient for attribute selector safety
- `aria-hidden="true"` on overlay root + `aria-hidden="false"` explicit override on BoardMessage — the bubble carries real accessible content and must not be silenced by the parent's aria-hidden
- Caret rendered as a `<span>` child element (not a pseudo-element) so it can be conditionally v-if'd per `caretSide` without scoped-style selector gymnastics
- `overlayRoot.closest('.boardregion')` preferred over bare `document.querySelector` — safer in multi-instance scenarios and in tests where the fixture is a real DOM element

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] CSS.escape unavailable in jsdom test environment**
- **Found during:** Task 2 GREEN (first test run)
- **Issue:** `CSS.escape` is not defined in jsdom; `buildSelector` threw `TypeError: Cannot read properties of undefined`
- **Fix:** Added inline `cssEscape()` helper that delegates to `CSS.escape` when available (production browsers) and falls back to a minimal `"` and `\` escape for jsdom
- **Files modified:** `src/ui/components/helpers/TutorialOverlay.vue`
- **Verification:** All 13 tests pass after fix; `CSS.escape` still used in production via the delegate
- **Committed in:** `469a53d` (Task 2 GREEN commit, same task)

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking)
**Impact on plan:** Minimal. CSS.escape polyfill is a correctness fix, not scope creep. Production code still uses the native API.

## Issues Encountered
- Acceptance criterion grep for renderer-specific selectors matched a comment in the docstring that mentioned `.grid-cell` and `.board-grid` as examples of what NOT to use. Reworded the comment to avoid the literal strings.
- Same issue with `v-html` appearing in a security docstring comment — reworded.

## Threat Surface Scan
No new network endpoints, auth paths, file access patterns, or schema changes introduced. TutorialOverlay reads only `gameState` (already injected in GameShell stacking context). No new trust boundaries beyond those modeled in the plan's threat register (T-105-05, T-105-06, T-105-07 — all mitigated: text interpolation only, CSS.escape on selectors, pointer-events:none on ring).

## Next Phase Readiness
- TutorialOverlay and BoardMessage annotation variant are ready for Plan 04 (GameShell wiring — mounting the overlay in .boardregion and threading tutorialStep into useActionController)
- Plan 05 parity tests can assert the same annotation data-bs-* anchor resolves identically in AutoUI and custom UI paths

---
*Phase: 105-annotation-overlay-ui-parity*
*Completed: 2026-06-25*
