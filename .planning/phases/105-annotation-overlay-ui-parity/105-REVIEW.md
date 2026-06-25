---
phase: 105-annotation-overlay-ui-parity
reviewed: 2026-06-25T00:00:00Z
depth: deep
files_reviewed: 11
files_reviewed_list:
  - src/engine/tutorial/types.ts
  - src/ui/composables/useBoardInteraction.ts
  - src/ui/composables/useSelectable.ts
  - src/ui/components/auto-ui/renderers/GridBoardRenderer.vue
  - src/ui/components/auto-ui/renderers/HexBoardRenderer.vue
  - src/ui/components/auto-ui/renderers/HandRenderer.vue
  - src/ui/components/auto-ui/ActionPanel.vue
  - src/ui/components/helpers/BoardMessage.vue
  - src/ui/components/helpers/TutorialOverlay.vue
  - src/ui/components/GameShell.vue
  - src/ui/components/helpers/TutorialOverlay.parity.test.ts
findings:
  blocker: 1
  critical: 1
  warning: 3
  info: 2
  total: 7
status: resolved
resolved: 2026-06-25T00:00:00Z
resolved_by: Claude Sonnet 4.6
---

# Phase 105: Code Review Report — Tutorial Annotation Overlay (UI Parity)

**Reviewed:** 2026-06-25
**Depth:** deep
**Files Reviewed:** 11
**Status:** issues_found

## Summary

The shared-anchor architecture is sound and the headline parity concern is genuinely met: `anchorAttrs` is the single source of `data-bs-el-*` names (no literals leak into renderers — only into tests), `useSelectable`/`useSelectableGrid` route every AutoUI renderer through it, HandRenderer now carries the anchor on `.hand-container`, and custom UIs get the same anchor by calling `anchorAttrs` directly. MR-01 is a real production wire (`tutorialStep` computed → `useActionController`) and its guard test is behavioral (drives `state → computed → controller`, not a directly injected ref) and non-vacuous. Tokens are all `--bsg-*` (verified against `theme.ts`); no raw hex; `CSS.escape` blocks selector injection; the ring is `pointer-events:none`; text is interpolated (no XSS).

However, two of the three documented `AnnotationTarget` kinds — `'action'` and `'panel'` — **cannot resolve in production** because the overlay scopes target queries to `.boardregion` while `ActionPanel` (the only host of `data-bs-action` / `data-bs-panel`) renders in `.actionbar`, a sibling *outside* `.boardregion`. The parity test masks this by planting the action button inside `.boardregion`, so the suite passes while the feature is broken. Separately, the annotation bubble is nested under an `aria-hidden="true"` root and will not be announced despite the explicit a11y intent, and explicit `placement` values plus the untargeted-bubble case render at (0,0).

## Resolution Summary (2026-06-25)

All four actionable findings (BL-01, CR-01, WR-01, WR-02) resolved in commits
`d466ce0` (RED tests) and `72041ef` (fix). WR-03 resolved as a side-effect of BL-01.
IN-01 and IN-02 are informational — not addressed (within accepted scope). Full
suite green: 1371/1371. lint:css clean.

---

## Blocker Issues

### BL-01: `action` and `panel` annotation targets never resolve in production (overlay scoped to `.boardregion`; ActionPanel lives in `.actionbar` sibling) — RESOLVED

**Status:** Fixed in `72041ef`. Guarded by new test in `TutorialOverlay.test.ts`
("action target outside .boardregion (BL-01 guard — production topology)").

**Fix:** Added `<Teleport to="body">` wrapping the overlay div (position:fixed,
inset:0, overflow:visible). Changed `boardRegion.querySelector(selector)` →
`document.querySelector(selector)` in both `measure()` and `rebuildObservers()`.
Ring/bubble coordinates are now viewport-fixed (getBoundingClientRect() values
with no boardRect subtraction). WR-03 resolved as a side-effect (no overflow:hidden).

**File:** `src/ui/components/helpers/TutorialOverlay.vue:141-162` (+ `src/ui/components/GameShell.vue:1585-1817`)

**Issue:** `measure()` resolves every target via `boardRegion.querySelector(selector)`, where `boardRegion` is the `.boardregion` element the overlay is mounted inside. But `data-bs-action="<name>"` (ActionPanel.vue:795) and `data-bs-panel` (ActionPanel.vue:787) are only ever emitted by `ActionPanel`, which GameShell renders inside `.actionbar` — a **sibling of `.stage`**, entirely outside `.boardregion` (GameShell.vue: `.stage` contains `.boardregion` at line 1674; `.actionbar` opens at line 1773 after `.stage` closes at 1767). Therefore:
- `{ kind: 'action', actionName }` → `querySelector` returns `null` → no ring; falls into the null-target branch (line 203-210) and emits a stray bubble pinned to the top of the board pointing at nothing.
- `{ kind: 'panel' }` → same silent failure.

Even resolving against `document` would not fix it: ring coordinates are computed relative to `boardRect` and the root is `overflow:hidden` (line 375), so a target below the board region is clipped/offscreen. This is the exact "UI path that can silently lack annotations" the phase was meant to prevent — 2 of 3 model variants are dead in production. The discriminated union (`types.ts:56-59`) advertises all three.

**Fix:** Either (a) mount a second overlay layer (or move the overlay) so it spans both `.boardregion` and `.actionbar` and resolve targets against a shared ancestor (e.g. `.game-shell`), computing rects relative to that ancestor; or (b) if action/panel highlighting is out of scope for 105, remove the `'action'` and `'panel'` variants from `AnnotationTarget` and the `buildSelector` branches so the type cannot represent an unsupported target (Pit of Success — don't ship a model that silently no-ops). Do not leave the union advertising capabilities the overlay cannot deliver.

## Critical Issues

### CR-01: Annotation bubble is inside an `aria-hidden="true"` subtree — `role=status`/`aria-live` is never announced — RESOLVED

**Status:** Fixed in `72041ef`. Guarded by new test "role=status bubble has no
aria-hidden='true' ancestor" in `TutorialOverlay.test.ts`.

**Fix:** Removed `aria-hidden="true"` from the overlay root div. Only the
decorative ring elements retain `aria-hidden="true"`. The bubble (BoardMessage /
role=status / aria-live=polite) has no aria-hidden ancestor and is now announced.
Also removed the contradictory `aria-hidden="false"` that was on BoardMessage.

**File:** `src/ui/components/helpers/TutorialOverlay.vue:315-356`

**Issue:** The overlay root is `<div v-if="hasContent" aria-hidden="true">` (line 320). The bubble is rendered inside it with `aria-hidden="false"` on the `BoardMessage` (line 355). Per WAI-ARIA, a descendant `aria-hidden="false"` does **not** re-expose a subtree whose ancestor is `aria-hidden="true"`; browsers prune the entire `aria-hidden="true"` subtree from the accessibility tree, suppressing the `role="status"` / `aria-live="polite"` live announcement. The inline comment (lines 343-348) states the intent ("must be announced") but the implementation contradicts it — defeating a11y criterion #5. Screen-reader users get no tutorial prose.

**Fix:** Do not place the announced bubble under an `aria-hidden="true"` root. Restructure so the decorative ring/chip are individually `aria-hidden="true"` while the bubble is a sibling that is NOT inside any aria-hidden ancestor. For example, drop `aria-hidden` from the overlay root and instead mark only the ring `<div>` and chip `aria-hidden="true"` (the ring already is, line 332/338), leaving the BoardMessage exposed:
```vue
<div v-if="hasContent" ref="overlayRoot" class="bsg-tutorial-overlay">
  <template v-for="(resolved, i) in resolvedAnnotations" :key="i">
    <div v-if="resolved.ring" class="bsg-tutorial-ring" :style="ringStyle(resolved.ring)" aria-hidden="true"> … </div>
    <BoardMessage v-if="resolved.text" variant="annotation" … />  <!-- no aria-hidden ancestor -->
  </template>
</div>
```

## Warnings

### WR-01: Explicit `placement` ('top'/'bottom'/'center') and untargeted bubbles render at (0,0) — RESOLVED

**Status:** Fixed in `72041ef`. Guarded by 3 new tests in `TutorialOverlay.test.ts`:
untargeted bubble, placement='top', placement='bottom'.

**Fix:** Added `bubbleFallbackStyle(placement, boardRect)` helper. Untargeted
annotations (no target field) and annotations with explicit placement use
board-region-relative viewport coords (top/bottom/center of the board rect).
The null-target branch (target specified but not found) also uses this helper.
Previously all these cases set `anchorStyle = {}` → no style → bubble at (0,0).

**File:** `src/ui/components/helpers/TutorialOverlay.vue:176-214`

**Issue:** `anchorStyle` is only computed when `!ann.placement || ann.placement === 'auto'` (line 177). For a targeted annotation with `placement: 'top' | 'bottom' | 'center'`, `anchorStyle` stays `{}`, so the bubble is positioned with no `left/top` and lands in the board's top-left corner while the ring draws correctly elsewhere. The untargeted case (line 211-214, `anchorStyle = {}`) has the same outcome — yet `types.ts:84` documents "Without `target`: renders as a floating text bubble" as a primary use case, and `BoardMessage`'s `position` prop is ignored in the `annotation` variant (BoardMessage.vue:97). So three of four `AnnotationPlacement` values and the entire untargeted-bubble path are broken/dead.

**Fix:** Honor explicit placements (compute board-relative `top`/`bottom`/`center` anchorStyle for non-auto values and for the untargeted case), or narrow `AnnotationPlacement` to the values actually implemented. At minimum, make the untargeted floating bubble center/top of the board region rather than (0,0).

### WR-02: Parity test plants the action anchor inside `.boardregion`, giving false confidence for BL-01 — RESOLVED

**Status:** Fixed in `d466ce0` (test commit). Both fixture builders now put the
action button as a sibling of `.boardregion` (inside a `shell-wrapper`), mirroring
the production ActionPanel-in-.actionbar relationship. `stubs: { Teleport: true }`
added to all VTU `mount()` calls so `wrapper.find()` works after the BL-01 Teleport fix.
The action-target assertions now fail against the pre-fix code and pass after.

**File:** `src/ui/components/helpers/TutorialOverlay.parity.test.ts:145,184` (+ assertions 237-248, 272-283, 338-371)

**Issue:** The fixtures render `<button data-bs-action="move">` as a direct child of the `.boardregion` div (lines 145, 184). Production GameShell renders that button in `.actionbar`, outside `.boardregion` (see BL-01). The "action target: ring rendered" assertions therefore pass against a DOM that does not reflect production, masking the real defect. This is a can't-fail test for the broken path.

**Fix:** Make the action/panel fixtures mirror production topology (action button as a sibling of `.boardregion`, both under a common shell ancestor) so the test exercises the same resolution scope the overlay uses in GameShell. The test should fail until BL-01 is fixed.

### WR-03: Annotation bubble can be clipped by the overlay's `overflow:hidden` — RESOLVED (subsumed by BL-01)

**Status:** Resolved as a side-effect of the BL-01 Teleport fix. The overlay
now uses `position:fixed; overflow:visible` — there is no clip context. Bubbles
and rings are visible at their full viewport coordinates regardless of position
relative to the board edge.

**File:** `src/ui/components/helpers/TutorialOverlay.vue:375` (+ placement clamping 186-201)

**Issue:** The root sets `overflow:hidden` (intended to clip rings at the board edge), but the bubble is a child of the same root. The auto-placement only clamps the left edge with `Math.max(0, …)` and uses a fixed `BUBBLE_HEIGHT_ESTIMATE = 80` with no right-edge or below-board clamp, so a bubble for a target near the right/bottom edge can be silently clipped. Annotation prose getting cut off is a correctness/usability defect, not just cosmetics.

**Fix:** Render the bubble outside the `overflow:hidden` clip context (separate sibling layer) or clamp the bubble's `left`/`top` against the board rect and bubble width so it stays fully visible.

## Info

### IN-01: Scroll listener re-attached on every `rebuildObservers` without symmetric removal

**File:** `src/ui/components/helpers/TutorialOverlay.vue:262` (+ unmount 291-296)

**Issue:** `rebuildObservers()` calls `boardRegion.addEventListener('scroll', onScroll, …)` each time annotations change. It is idempotent for the same element+fn (no duplicate), but if `boardRegion` ever resolves to a different element across rebuilds, the prior element keeps its listener until GC. Unmount cleanup resolves `boardRegion` again via `closest`, which can be `null` if the root is already detached. Low impact (element-scoped, GC-collected), but the lifecycle is asymmetric.

**Fix:** Track the bound `boardRegion` element in a module-level ref and remove the scroll listener from that exact element before re-binding and on unmount.

### IN-02: `BUBBLE_HEIGHT_ESTIMATE` / `GAP` / `OFFSET` magic numbers duplicate token intent

**File:** `src/ui/components/helpers/TutorialOverlay.vue:166,178-179`

**Issue:** `OFFSET = 3`, `GAP = 8 // var(--bsg-s2)`, `BUBBLE_HEIGHT_ESTIMATE = 80` are hardcoded in JS with comments tying them to tokens. The 80px estimate in particular drives the auto-flip decision and is fragile (a 3-line bubble exceeds it). These are pixel constants the comments themselves acknowledge should track `--bsg-*`.

**Fix:** Where a value mirrors a token (GAP↔`--bsg-s2`), read it from computed style or document the coupling in one constant block. Prefer measuring the actual bubble height (after render) over a fixed estimate for the flip decision.

---

_Reviewed: 2026-06-25_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
