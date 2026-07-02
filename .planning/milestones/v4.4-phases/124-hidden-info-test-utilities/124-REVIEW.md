---
phase: 124-hidden-info-test-utilities
reviewed: 2026-07-02T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - src/testing/assertions.test.ts
  - src/testing/assertions.ts
  - src/testing/dom-leak.test.ts
  - src/testing/dom-leak.ts
  - src/testing/index.ts
  - src/testing/test-game.ts
  - src/testing/view-diff.test.ts
  - src/testing/view-diff.ts
  - src/testing/visibility.test.ts
  - src/testing/visibility.ts
findings:
  critical: 1
  warning: 3
  info: 1
  total: 5
status: fixed
fixed_at: 2026-07-02T00:00:00Z
---

# Phase 124: Code Review Report

**Reviewed:** 2026-07-02
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Reviewed the three VIS-01/02/03 utility modules (`visibility.ts`, `view-diff.ts`, `dom-leak.ts`) plus their tests and barrel exports. The final-tree-derivation design (deriving verdicts from `game.toJSONForPlayer(seat)` rather than re-implementing visibility rules) is sound and correctly honors `static playerView` post-transforms in both `isElementVisible`/`getVisibleElements` and `diffPlayerViews`. The `__hidden`-flag-only (never-id-based) positional walk in `view-diff.ts` correctly sidesteps the synthetic-id vs. stable-id asymmetry documented in the engine.

However, the DOM-leak matcher (`dom-leak.ts`, VIS-03) — the utility whose entire purpose is to catch the "opponent card identity rendered into the DOM" failure mode — has a real, provable false-negative gap: its scoped DOM scan does not inspect `aria-label`, `alt`, or `title` attributes, even though BoardSmith's own production `AutoUI` renderers actively write element-derived labels (including a card's serialized `name`/notation) into exactly those attributes. A hidden element's identity leaking through a custom `presentationEntry.label`, a mis-guarded `ariaLabel` computed property, or an `alt`/`title` binding would go completely undetected by `assertNoHiddenInfoLeak`, silently passing the exact bug class this phase was built to catch. This is the single Critical finding below.

Three further Warnings cover a related-but-more-defensible boolean-exclusion false-negative gap, a caller footgun around `diffPlayerViews`'s positional walk when comparing non-simultaneous snapshots, and a missing actionable error message when the async DOM-leak utility is used outside a jsdom test environment.

## Critical Issues

### CR-01: DOM-leak matcher's scoped scan omits `aria-label`/`alt`/`title` — real production leak surfaces are never checked

**File:** `src/testing/dom-leak.ts:319-343` (`collectScopedSurfaceStrings`)

**Issue:** `collectScopedSurfaceStrings` only scans three DOM surfaces: `data-*` attribute values, `img[src]`, and inline `style="background-image:..."`. It does NOT scan `aria-label`, `alt`, or `title` attributes.

This is not a theoretical gap — BoardSmith's own `AutoUI` renderers actively write element-derived identity into exactly these attributes in production:

- `src/ui/components/auto-ui/renderers/CardRenderer.vue:377` — `<img :alt="displayLabel" ...>` where `displayLabel = presentationEntry.value?.label ?? props.element.name ?? props.element.className` (`CardRenderer.vue:264-266`). A per-game `presentationEntry.label` override (or a future bug in the `name` fallback chain) can render identity text straight into `alt`.
- `src/ui/components/auto-ui/renderers/CardRenderer.vue:355` — `:aria-label="ariaLabel"`, where `ariaLabel` similarly falls back through `element.name`/notation (`CardRenderer.vue:169-176`).
- `src/ui/components/auto-ui/renderers/GridBoardRenderer.vue:297` — `:title="cell.name ?? undefined"`.
- `PieceRenderer.vue:149`, `DieRenderer.vue:107`, `SpaceRenderer.vue:165`, `DeckRenderer.vue:134`, `HexBoardRenderer.vue:335,353` — all bind `aria-label` from element-derived computed values.

The forbidden-marker derivation itself (`extractIdentityCandidates`, `dom-leak.ts:206-238`) explicitly treats `name` as an identity candidate (line 211-213) — so the tool *knows* `name` is identity-bearing and forbidden when hidden, but its own DOM scan never looks at the one production attribute family (`aria-label`/`alt`/`title`) most likely to carry that exact value if a custom presentation override or renderer bug reintroduces it for a hidden element. A hidden card's identity leaking via `alt="Ace of Spades"` (instead of `data-*`/`img[src]`/inline style) would pass `assertNoHiddenInfoLeak` silently.

**Fix:** Add `aria-label`, `alt`, and `title` to the scanned attribute set in `collectScopedSurfaceStrings`:
```typescript
function collectScopedSurfaceStrings(wrapper: VueWrapper<unknown>): string[] {
  const root = wrapper.element as HTMLElement;
  const surfaces: string[] = [];

  const visit = (el: Element) => {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('data-')) {
        surfaces.push(attr.value);
      }
    }
    // Identity is a documented candidate (name/notation) and BoardSmith's own
    // renderers write it into these attributes (CardRenderer.vue ariaLabel/
    // displayLabel, GridBoardRenderer.vue title, etc.) — scan them too.
    for (const attrName of ['aria-label', 'alt', 'title']) {
      const value = el.getAttribute(attrName);
      if (value) surfaces.push(value);
    }
    if (el.tagName === 'IMG') {
      const src = el.getAttribute('src');
      if (src) surfaces.push(src);
    }
    const style = el.getAttribute('style');
    if (style && style.includes('background-image')) {
      surfaces.push(style);
    }
  };

  visit(root);
  root.querySelectorAll('*').forEach(visit);

  return surfaces;
}
```
Add a regression test asserting a leak via `alt`/`aria-label`/`title` (not `data-*`) is caught, mirroring the existing positive-control test in `dom-leak.test.ts`.

**Resolution:** status: fixed (commit `cbbdc34`). `collectScopedSurfaceStrings` now also scans `aria-label`, `alt`, `title`, `aria-description`, and `aria-roledescription`. Added a regression fixture (`AriaLeakGame`/`HiddenCard`, an individually-hidden card with a stable id) proving a `name` leaked back onto a correctly-redacted hidden placeholder is caught via aria-label/alt/title alone (data-*/img-src/style stay clean). 2 new tests; 10/10 `dom-leak.test.ts` tests pass.

## Warnings

### WR-01: Boolean-valued identity attributes are a documented — but real — false-negative class beyond `faceUp`

**File:** `src/testing/dom-leak.ts:171-175` (`stringifyScalar`)

**Issue:** `stringifyScalar` excludes booleans entirely to avoid `Card.faceUp` (`"true"`/`"false"`) colliding with ubiquitous DOM substrings like `data-animatable="true"`. This is documented as a deliberate tradeoff in the SUMMARY and code comments, and is defensible for `faceUp` specifically. But the exclusion is blanket: ANY hidden custom boolean attribute that IS the secret (e.g. a hidden "isSpy" role flag, a secret coin-flip result, a hidden "isJoker" bit) will never become a forbidden marker, so a leak of that exact bit into the DOM (e.g. via a class binding or `data-is-spy="true"`) will silently pass `assertNoHiddenInfoLeak` even though it is precisely the kind of hidden-info leak this utility exists to catch.

**Fix:** At minimum, document this limitation prominently in the exported JSDoc for `assertNoHiddenInfoLeak` (not just an internal code comment) so callers with boolean-typed secret state know to supplement with `assertHidden`/`isElementVisible` checks. Consider a narrower exclusion: only skip booleans when comparing against known-noisy DOM value pairs (`"true"`/`"false"`), or restrict boolean markers to non-generic attribute names (skip only when the attribute is a known layout/animation flag), rather than excluding all booleans unconditionally.

**Resolution:** status: fixed (commit `5dece8c`). Narrowing was assessed and rejected: since every boolean stringifies to exactly `"true"`/`"false"`, there is no narrower exclusion that isn't either a brittle attribute-name allowlist (defeats the "no hardcoded field list" design principle) or a no-op. Documented the tradeoff prominently in `assertNoHiddenInfoLeak`'s exported JSDoc, directing callers with boolean-typed secrets to `assertHidden`/`isElementVisible`. No behavior change, no new test required.

### WR-02: `diffPlayerViews`'s positional walk can misattribute non-visibility structural differences when compared views are not the same instant

**File:** `src/testing/view-diff.ts:74-144` (`walk`), `164-199` (`diffPlayerViews`)

**Issue:** The positional (index-aligned) walk is correct and leak-safe for its intended use — two `getPlayerView(seat)` calls against the SAME immutable game state, where every real zone's child count is structurally identical across seats (only anonymization/redaction differs, not count — see `game.ts` hidden/count-only branches, which preserve array length). However, nothing in the API prevents (or warns against) calling `diffPlayerViews` with views captured at different points in game state (e.g. before/after a card draw). In that scenario, positional misalignment after the divergence point will produce a cascade of `onlyInA`/`onlyInB` entries for every subsequent sibling, mislabeling ordinary state progression as a "hidden information" difference — a false positive that could mask the intended signal or generate confusing failure output.

**Fix:** Add an explicit doc-comment caveat (and consider a lightweight runtime check, e.g. comparing `viewA.state.id`/root className/childCount at the top level) warning that `diffPlayerViews` is only meaningful for two views of the SAME game state snapshot, and that comparing views taken at different times will misreport ordinary progression as spurious diffs.

**Resolution:** status: fixed (commit `bf724e2`). Added a pit-of-success `diffPlayerViews(testGame, seatA, seatB)` overload that captures both views back-to-back with no gap for intervening mutation, eliminating the misuse pattern entirely for callers who adopt it. Added a doc-comment caveat on the existing two-view form recommending the atomic overload. New test proves the atomic overload matches the two-view form's output; 6/6 `view-diff.test.ts` tests pass.

### WR-03: `renderAsSeat`/`assertNoHiddenInfoLeak` throw an unhelpful low-level error when used outside a jsdom test environment

**File:** `src/testing/dom-leak.ts:98-116`, `362-401`

**Issue:** `dom-leak.ts` itself is annotated `// @vitest-environment jsdom` (line 1), but that pragma only affects tests IN THIS FILE — it has no effect on a caller's own test file that imports `renderAsSeat`/`assertNoHiddenInfoLeak`. If a game's test suite calls these functions from a file running under Node's default (non-jsdom) vitest environment, `mount()` (or `ensureMatchMediaPolyfill`'s `window` check) will fail with a generic low-level error (e.g. `window is not defined` / `document is not defined`), not an actionable message pointing at the missing `@vitest-environment jsdom` pragma. Per this project's stated requirement ("Error messages should be actionable"), this is a Pit-of-Success gap: the easy/obvious path (importing and calling the function) leads to a confusing failure instead of a clear fix instruction.

**Fix:** Add an explicit guard at the top of `renderAsSeat`/`assertNoHiddenInfoLeak`:
```typescript
if (typeof document === 'undefined') {
  throw new Error(
    'renderAsSeat/assertNoHiddenInfoLeak require a DOM environment. ' +
    'Add `// @vitest-environment jsdom` as the first line of this test file.'
  );
}
```
and document the requirement prominently in the exported JSDoc for both functions.

**Resolution:** status: fixed (commit `9e2275a`). Added the guard exactly as suggested to `renderAsSeat`; `assertNoHiddenInfoLeak` inherits it transitively (calls `renderAsSeat` internally). Documented via `@throws` on both exported functions. 2 new tests (temporarily deleting `globalThis.document` to simulate a non-jsdom caller) prove both functions throw the actionable message instead of a raw "document is not defined"; 12/12 `dom-leak.test.ts` tests pass.

## Info

### IN-01: `HiddenInfoLeakAllowPredicate` allowlist has no protection against overly-broad predicates masking unrelated leaks

**File:** `src/testing/dom-leak.ts:118-131`

**Issue:** The allowlist predicate receives only `(marker, { attribute, elementId, elementLabel })` and its return value is trusted unconditionally per-marker (`assertNoHiddenInfoLeak`, lines 369-378). A caller writing a loose predicate (e.g. `(marker) => marker.length < 3`) could inadvertently suppress genuine leaks of short values across unrelated elements, not just the intended narrow collision. The existing test suite proves the allowlist doesn't mask a specific *other* leak scenario (unfiltered override), but doesn't prove the general case of a caller-authored overly-broad predicate.

**Fix:** No code change strictly required — this is inherent to any allowlist API. Consider strengthening the JSDoc guidance to explicitly recommend scoping predicates to the exact `elementId`/`attribute` pair being allowlisted (as the existing test does), rather than the raw string value alone, to reduce accidental over-masking.

**Resolution:** status: fixed (commit `e3d1e5c`). Went beyond the "no code change strictly required" suggestion: added a cheap guardrail that fails loud when a predicate suppresses ALL forbidden markers for a seat (an over-broad predicate can't silently pass with zero real coverage). 1 new test proves an `allow: () => true` predicate now throws an actionable error naming the marker count; 13/13 `dom-leak.test.ts` tests pass.

---

_Reviewed: 2026-07-02_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
