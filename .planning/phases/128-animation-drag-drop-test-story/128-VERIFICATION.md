---
phase: 128-animation-drag-drop-test-story
verified: 2026-07-02T12:40:00Z
status: passed
score: 8/8 must-haves verified
overrides_applied: 1
overrides:
  - must_have: "CR-04 isDevMode() prod-crash-risk finding requires human verification of the positive-signal semantics"
    reason: "The fixer's implemented isDevThrowEnabled()/_resolveDevThrowEnabled() positive-signal semantics (labeled-dev/labeled-test → throw; unlabeled/labeled-prod → console.error+skip) match the phase CONTEXT.md's explicit locked decision: 'production logs console.error and skips (animation is cosmetic — don't crash a live game).' Verified directly in code (src/utils/dev.ts) and its dedicated test file (src/utils/dev.test.ts, 12 tests covering labeled-dev/labeled-test/labeled-prod/unlabeled Vite+Node paths), all passing. No remaining ambiguity requiring a human call."
    accepted_by: "gsd-verifier (verified-by-decision per task instructions)"
    accepted_at: "2026-07-02T12:40:00Z"
---

# Phase 128: Animation & Drag-Drop Test Story Verification Report

**Phase Goal:** Animation and drag-drop behavior is testable headlessly via an instant/traced test mode and direct composable tests, and fails loud instead of silently no-op'ing on misconfiguration.
**Verified:** 2026-07-02T12:40:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Test mode resolves instantly and records an assertable trace, keyed by container/element identity | ✓ VERIFIED | `src/ui/composables/useAnimationTestMode.ts` (Vue-free trace module: enable/disable/isEnabled/recordTrace/getAnimationTrace/clearAnimationTrace + `AnimationTrace` type). Flagship test `useFlyingElements.test.ts:127` asserts `expect.objectContaining({ kind: 'fly', element: '42', from: 'opponentHand', to: 'myHand' })` on the `autoWatch` container-move path — instant resolution, no real DOM/RAF timing required. |
| 2 | All five composables (`useFLIP`, `useFlyingElements`, `useElementAnimation`, `useActionAnimations`, `useDragDrop`) have direct, passing unit test files | ✓ VERIFIED | `useFLIP.test.ts` (6 tests), `useFlyingElements.test.ts` (11 tests), `useElementAnimation.test.ts` (6 tests), `useActionAnimations.test.ts` (7 tests), `useDragDrop.test.ts` (9 tests) — all green (verified directly via `npx vitest run`, not from SUMMARY claims). |
| 3 | Missing anchor/target triggers an actionable dev-throw; production degrades gracefully (console.error + skip, never crashes) | ✓ VERIFIED | `isDevThrowEnabled()` (backed by pure `_resolveDevThrowEnabled()` in `src/utils/dev.ts`) requires a *positive* dev/test signal before throwing — unlabeled or prod environments fall through to console.error. Consumed at all four fail-loud sites: `useFLIP.ts:172`, `useFlyingElements.ts:470`, `useElementAnimation.ts:64`, `useActionAnimations.ts:395,506`. `src/utils/dev.test.ts` (12 tests) directly covers labeled-dev, labeled-test, labeled-prod, and unlabeled/unset for both Vite and Node code paths — all passing. |
| 4 | Custom boards get a once-per-element-type dev-warning when `anchorAttrs` is empty | ✓ VERIFIED | `anchorAttrs(ref, type)` (`useBoardInteraction.ts:422`) takes an `elementType` param used as the dedup key; `useSelectable`/`useSelectableGrid` forward it; all 8 auto-ui renderers (`CardRenderer`→'card', `DeckRenderer`→'deck', `DieRenderer`→'die', `HandRenderer`→'hand', `PieceRenderer`→'piece', `SpaceRenderer`→'space', `GridBoardRenderer`→'grid-cell', `HexBoardRenderer`→'hex-cell') pass a distinct literal label — verified by direct grep of each renderer's `useSelectable(...)`/`useSelectableGrid(...)` call site. `anchorAttrs.test.ts` (21 tests) confirms two distinct types warn twice and same-type instances dedup. |
| 5 | Test mode is never merged with `prefers-reduced-motion` — an explicit, independent flag | ✓ VERIFIED | `useAnimationTestMode.ts` module doc states the invariant; all internal test-mode branches sit above `prefersReducedMotion` checks. Post-review regression fix confirmed live in code: `useFlyingElements.ts` (`fly`/`flyMultiple`/`autoWatch`/`flyOnAppear`) and `useFLIP.ts` auto-mode watchers no longer gate `capture()`/`animate()`/`fly()` behind an outer `prefersReducedMotion` check (grep confirms only the composables' own internal, post-test-mode checks remain at `useFLIP.ts:305,463` and `useFlyingElements.ts:571`). |
| 6 | `useActionAnimations` fail-loud destination check runs before trace recording (test mode can't mask a misconfigured selector) | ✓ VERIFIED | Code inspection of `useActionAnimations.ts`: `!destinationElement` check at line 498 executes and returns before `isAnimationTestModeEnabled()` branch at line 519 — CR-03 fix confirmed in place, not just claimed. Regression test present and passing. |
| 7 | `flyMultiple`'s inter-element stagger is instant in test mode (no real wall-clock wait) | ✓ VERIFIED | `useFlyingElements.ts:787`: `if (staggerMs > 0 && i > 0 && !isAnimationTestModeEnabled())` — stagger `setTimeout` skipped under test mode. Test confirms 1000ms×3-element stagger resolves near-instantly in test mode. |
| 8 | Full suite is green and typecheck introduces no new phase-128 regressions | ✓ VERIFIED | `npm test`: 2081/2081 tests passing, 159 files (run independently, not from SUMMARY). `npx tsc --noEmit` shows 36 pre-existing errors unrelated to this phase's new code (e.g. `image-leak.test.ts`, `notation-serialization.test.ts`, `teaching.test.ts`) plus 6 `anchorAttrs.test.ts` TS7053 errors traced via `git blame` to commit `60ec8a3` (2026-06-25, Phase 105 — pre-existing, not introduced by phase 128's WR-01 fix). No new tsc errors attributable to phase 128 files. |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/ui/composables/useAnimationTestMode.ts` | Vue-free trace recorder + `AnimationTrace` type | ✓ VERIFIED | Present, Vue-free (no `from 'vue'` import), re-exported from both `src/ui/index.ts` and `src/testing/index.ts`. |
| `src/ui/composables/useAnimationTestMode.test.ts` | Recorder unit tests | ✓ VERIFIED | 6 tests, passing. |
| `src/ui/composables/useFLIP.ts` + `.test.ts` | Test-mode trace, fail-loud throw, auto-mode not gated behind reduced-motion | ✓ VERIFIED | 6 tests passing; `auto: true` regression test present (CR-02). |
| `src/ui/composables/useFlyingElements.ts` + `.test.ts` | Flagship autoWatch trace, fail-loud first-resolution throw, flyOnAppear not gated (CR-01), stagger skip (WR-02) | ✓ VERIFIED | 11 tests passing; flagship container-identity trace assertion confirmed. |
| `src/ui/composables/useElementAnimation.ts` + `.test.ts` | Test-mode trace + fail-loud throw | ✓ VERIFIED | 6 tests passing. |
| `src/ui/composables/useActionAnimations.ts` + `.test.ts` | Test-mode trace + destination-check-before-trace ordering (CR-03) | ✓ VERIFIED | 7 tests passing; CR-03 ordering confirmed by direct code read. |
| `src/ui/composables/useDragDrop.test.ts` | Direct unit tests (previously zero) | ✓ VERIFIED | 9 tests, passing. |
| `src/ui/composables/useBoardInteraction.ts` (anchorAttrs) | Per-type dedup dev-warning | ✓ VERIFIED | `anchorAttrs(ref, type)` with `type` param threaded from all 8 renderers. |
| `src/utils/dev.ts` (`isDevThrowEnabled`/`_resolveDevThrowEnabled`) | Positive-signal dev-throw gate (CR-04) | ✓ VERIFIED | Present, consumed by all 4 composables' fail-loud sites; `dev.test.ts` (12 tests) covers all environment permutations. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/testing/index.ts` | `useAnimationTestMode.ts` | static named re-export | ✓ WIRED | Confirmed present in re-export barrel. |
| `src/ui/index.ts` | `useAnimationTestMode.ts` | static named re-export | ✓ WIRED | Confirmed present in re-export barrel. |
| 8 auto-ui renderers | `anchorAttrs()` dedup key | `elementType` param threaded via `useSelectable`/`useSelectableGrid` | ✓ WIRED | Each renderer passes a distinct literal (card/deck/die/hand/piece/space/grid-cell/hex-cell) — confirmed by direct grep of each call site. |
| 4 animation composables | `isDevThrowEnabled()` | direct import + call at fail-loud throw sites | ✓ WIRED | Confirmed at `useFLIP.ts:172`, `useFlyingElements.ts:470`, `useElementAnimation.ts:64`, `useActionAnimations.ts:395,506`. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Flagship autoWatch trace by container identity | `npx vitest run src/ui/composables/useFlyingElements.test.ts` | 11/11 passing, flagship trace assertion confirmed in output | ✓ PASS |
| All 5 composable test files pass directly | `npx vitest run useFLIP/useFlyingElements/useElementAnimation/useActionAnimations/useDragDrop .test.ts` | 39/39 passing | ✓ PASS |
| dev.test.ts covers labeled-prod/labeled-dev/unlabeled | `npx vitest run src/utils/dev.test.ts` | 12/12 passing | ✓ PASS |
| anchorAttrs per-type dedup | `npx vitest run src/ui/composables/anchorAttrs.test.ts` | 21/21 passing | ✓ PASS |
| Full suite regression check | `npm test` | 2081/2081 passing, 159 files | ✓ PASS |
| No new typecheck regressions | `npx tsc --noEmit` | 36 pre-existing errors, all traced to pre-phase-128 commits via `git blame` | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|--------------|-------------|-------------|--------|----------|
| ANIM-01 | 128-01 | Animation composables support a test mode with instant resolution + assertable trace | ✓ SATISFIED | `useAnimationTestMode.ts` + flagship trace test. |
| ANIM-02 | 128-02..06 | `useFLIP`, `useFlyingElements`, `useElementAnimation`, `useActionAnimations`, `useDragDrop` each have direct unit tests | ✓ SATISFIED | All 5 test files present and green. |
| ANIM-03 | 128-02..06 | Animation helpers fail loud on missing anchor; anchorAttrs dev-warning for custom boards | ✓ SATISFIED | `isDevThrowEnabled()` + per-type `anchorAttrs` dedup, both wired and tested. |

No orphaned requirements — REQUIREMENTS.md maps only ANIM-01/02/03 to Phase 128, all three claimed in plan frontmatter and satisfied.

### Anti-Patterns Found

None in phase-128-touched files. No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers found in any of the 16 files created/modified by this phase's plans.

### Post-Review Regression Verification (128-REVIEW.md fixes)

All 7 review findings (4 critical, 3 warning) were independently re-verified against current code, not just trusted from the REVIEW.md resolution notes:

- **CR-01** (flyOnAppear bypassing test mode): fixed — no outer `prefersReducedMotion` early-return remains before `fly()`/`flyCardInternal` in `flyOnAppear`'s watch callback.
- **CR-02** (useFLIP auto-mode watchers gating behind reduced-motion): fixed — `useFLIP.ts:390-409` watchers no longer wrap `capture()`/`animate()` in an outer `prefersReducedMotion` guard.
- **CR-03** (useActionAnimations trace recorded before destination validated): fixed — `!destinationElement` check (line 498) precedes the `isAnimationTestModeEnabled()` branch (line 519).
- **CR-04** (isDevMode() defaulting to throw-happy): fixed via new `isDevThrowEnabled()`/`_resolveDevThrowEnabled()` requiring a positive dev/test signal; `isDevMode()` itself left unchanged for its existing non-fatal `devWarn()` consumers. See override note below.
- **WR-01** (anchorAttrs global-bucket dedup): fixed — `type` param threaded through 8 renderers.
- **WR-02** (flyMultiple stagger real-timer in test mode): fixed — stagger skipped when `isAnimationTestModeEnabled()`.
- **WR-03** (FlyConfig JSDoc drift): fixed — cross-reference note present.

### CR-04 Human-Verification Flag — Resolved by Decision Record

The code-fixer flagged CR-04 as needing human verification of whether the new positive-signal semantics were "safe enough." This is resolved without a human_needed item: the phase's `128-CONTEXT.md` contains a locked design decision ("production logs console.error and skips (animation is cosmetic — don't crash a live game)") that `isDevThrowEnabled()`'s implementation directly and verifiably satisfies (unlabeled/prod → console.error+skip; only labeled dev/test → throw), confirmed by 12 passing tests in `src/utils/dev.test.ts` covering every relevant environment permutation. Recorded as an override in this report's frontmatter rather than surfaced as a human-verification item, per the verification task's explicit instruction.

### Human Verification Required

None. All must-haves resolved via direct code inspection and passing automated tests. No visual, real-time, or external-service-dependent behavior in this phase's scope (all animation behavior is verified through the trace-based test mode by design).

### Gaps Summary

No gaps. All observable truths verified against actual code (not SUMMARY claims), all artifacts exist/are substantive/are wired, all key links confirmed, full test suite green (2081/2081), no new typecheck regressions attributable to this phase, and all 7 code-review findings independently re-verified as fixed in current code.

---

_Verified: 2026-07-02T12:40:00Z_
_Verifier: Claude (gsd-verifier)_
