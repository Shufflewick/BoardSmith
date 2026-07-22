---
phase: 162-test-tooling-ergonomics
reviewed: 2026-07-21T00:00:00Z
fixed: 2026-07-21T00:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - src/cli/lib/asset-scan.ts
  - src/testing/index.ts
  - src/ui/composables/useElementAnimation.ts
  - src/testing/dom-leak.ts
findings:
  critical: 2
  warning: 2
  info: 1
  total: 5
status: resolved (2 criticals fixed)
---

# Phase 162: Code Review Report

**Reviewed:** 2026-07-21T00:00:00Z
**Fixed:** 2026-07-21T00:00:00Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** resolved — all 2 CRITICALs and 2 WARNINGs fixed, RED-first (PROC-01). See "Resolution" section below.

## Summary

Reviewed the D20 hidden-info DOM-leak matcher, the D17 asset-reachability comment stripper, the D19 lazy `prefersReducedMotion` customRef, and the additive `testing/index.ts` re-exports. The `useElementAnimation.ts` lazy-init fix is sound (write-before-read is preserved, listener attaches exactly once, no double-listener leak). `testing/index.ts`'s new export is additive and does not create an import cycle. However, both of the two security/gate-critical files have a real, reproducible false-negative: the `dom-leak.ts` per-owner scoping structurally cannot catch a hidden element's identity leaking through an **ancestor's** aggregated markup (proven live in `HexBoardRenderer.vue`), and `asset-scan.ts`'s comment stripper is not string-literal-aware, so a live `//` inside an attribute value (e.g. a protocol-relative URL) blanks the remainder of the line — including a real bare `<img>` tag later on that same line — which I reproduced against the actual scanner.

## Critical Issues

### CR-01: dom-leak.ts's per-owner surface scoping misses leaks that surface on an ANCESTOR element, not the hidden element itself

**File:** `src/testing/dom-leak.ts:543`
**Issue:**

```ts
if (surface.ownerId !== undefined && surface.ownerId !== marker.elementId) continue;
```

This assumes a DOM surface whose nearest `data-element-id` ancestor differs from the marker's own `elementId` can only be a same-valued sibling's own legitimate identity (per the comment at dom-leak.ts:537-542). That assumption is false: several `AutoUI` renderers deliberately aggregate a CHILD element's identity into a PARENT container's `aria-label`/`<title>`, and the parent, not the child, is what carries `data-element-id`.

Concrete, currently-shipping example — `src/ui/components/auto-ui/renderers/HexBoardRenderer.vue`:
- `hexCellAriaLabel(cell)` (lines 297-309) builds `aria-label="${coord}, ${pieces.map(p => p.name).join(', ')}, ${state}"` — the occupant PIECES' `name`s are folded into the CELL's `aria-label`.
- That `aria-label` is stamped on the cell `<g>` (line 354), which is the element carrying `v-bind="cellAttrs(cell)"` → `data-element-id="{cell.id}"` (line 350-354). The piece `<g>` itself (lines 375-388) carries no `data-element-id` at all — it's `aria-hidden="true"` because, per the code's own comment, "the cell's own aria-label includes occupant names."
- The `<title>{{ piece.name }}</title>` (line 400) — a literal per-piece identity marker — is nested inside that same cell subtree with no closer `data-element-id` ancestor than the cell.

If a piece occupying that cell is hidden to the viewing seat, `deriveForbiddenMarkers` correctly produces a marker with `elementId = piece.id`. But `collectScopedSurfaceStrings` attributes the cell's `aria-label` and the piece's own `<title>` text to `ownerId = cell.id` (the nearest ancestor with `data-element-id`). Since `cell.id !== piece.id`, line 543's `continue` silently drops this surface from the check for that marker — a real hidden-piece-name leak into `aria-label`/`<title>` would NOT be caught by `assertNoHiddenInfoLeak`, exactly the leak class this fix's own docstring (IDENTITY_BEARING_ATTRS comment, lines 373-384) says it exists to catch.

This is the precise failure mode flagged in the review brief ("no path where a real leak's surface gets attributed to a DIFFERENT (permitted) element's id and thereby slips through") — confirmed against real renderer code, not a hypothetical.

**Fix:** Don't gate on strict `ownerId === marker.elementId` equality alone. At minimum, also check the surface's owner against every ANCESTOR of the marker's element (so a parent aggregating a child's identity is still attributed correctly), e.g. walk `marker.elementId`'s ancestor chain via `game.all(GameElement)`/`element.container` and treat `surface.ownerId` as attributable if it equals the marker's own id OR any ancestor id up to (and including) the nearest common container that the game's own tree would render together. A simpler, safer fix given the false-positive this scoping was introduced to prevent (same-named siblings) is to widen the check to "attributed IFF ownerId's subtree contains marker.elementId as a descendant in the finalTree", not "ownerId === elementId" — that still lets an aggregating ancestor's surface be checked against its descendants' markers, while continuing to exclude a same-valued but structurally unrelated sibling.

### CR-02: asset-scan.ts's comment stripper is not string-literal-aware — a live `//` inside an attribute value blanks a real `<img>` tag later on the same line

**File:** `src/cli/lib/asset-scan.ts:104-117`
**Issue:** `stripComments`'s line-comment detector only special-cases `//` immediately preceded by `:` (the `https://` guard, line 111). Any OTHER live `//` — e.g. inside a protocol-relative URL attribute (`href="//example.com"`), a live string literal, or an HTML comment span — is treated as a real line-comment opener and blanks everything to the end of that line, including a genuine bare `<img>` tag that follows it on the same line. I reproduced this against the live scanner:

```vue
<template>
  <a href="//example.com"><img src="x.png"></a>
</template>
```

```
$ node -e "scanAssetReachability(...)"  →  []   // NO violation reported
```

vs. the same `<img>` on its own line correctly flags. This is a build-blocking security/quality gate (ASSET-02) whose entire job is to catch exactly this pattern — a single line combining a protocol-relative URL (extremely common in real markup: CDN links, external hrefs) with a bare `<img>` silently defeats the gate. The same root cause (no quote/string-awareness) also means any live string containing an un-guarded `//` or `/*` anywhere in a `.vue`/`.ts`/`.tsx` file will blank the rest of that physical line.

**Fix:** Track string-literal state (single/double/backtick-quote open, JS) alongside `openKind` so a `//`/`/*` encountered while inside a live string/attribute value is not treated as a comment opener. At minimum, since Vue templates don't have JS string ambiguity issues but DO have quoted attribute values, track whether scan position is inside a `"..."`/`'...'` HTML attribute value and skip comment-opener detection there.

## Warnings

### WR-01: Unterminated block comment silently swallows the rest of the file

**File:** `src/cli/lib/asset-scan.ts:76-86`
**Issue:** If a file contains an unbalanced `/*` with no matching `*/` (e.g. a stray comment-opener typo), `openKind` stays `'block'` for every remaining line, blanking all of them — including any real `<img>` tags further down the file. The docstring acknowledges this tradeoff but it's worth flagging explicitly: a single malformed comment anywhere in a large `.vue`/`.ts` file silently disables the gate for everything after it, with no warning/error surfaced to the caller.
**Fix:** At minimum, have `scanAssetReachability` detect "block comment never closed" per file and emit a warning/violation of its own (distinct from the img-tag violation) so an unbalanced comment doesn't silently produce a false PASS.

### WR-02: `testing/index.ts` couples the test-tooling barrel to `cli/lib` internals

**File:** `src/testing/index.ts:125-127`
**Issue:** `scanAssetReachability`/`AssetViolation` are re-exported from `../cli/lib/asset-scan.js`, a path outside `src/testing/`. This is not circular today (verified: `src/cli/commands/simulate.ts` imports `testing/random-simulation.js` directly, not through this barrel), but it means the `boardsmith/testing` public surface now silently tracks whatever `cli/lib/asset-scan.ts` happens to export, and any future refactor of `cli/lib`'s internal layout (e.g. renaming/moving `asset-scan.ts`, or `cli/lib` picking up a Node-only transitive dependency) breaks `testing`'s export surface without any signal from within `testing/` itself.
**Fix:** Consider re-exporting via a stable, testing-owned path (or documenting the cross-module contract with a comment on the `cli/lib` side pointing back at this re-export) so a `cli`-side refactor doesn't silently break `testing` consumers.

## Info

### IN-01: `elementHidden` fallback in `deriveForbiddenMarkers` treats "no such node id in final tree" the same as "explicitly redacted"

**File:** `src/testing/dom-leak.ts:348`
**Issue:** `const elementHidden = !node || node.attributes?.__hidden === true;` — a missing node (`!node`) could also indicate a genuinely non-existent/pruned element unrelated to visibility (e.g. an element removed from the tree by unrelated game logic between snapshot and query), not necessarily a hidden-info redaction. This is a minor semantic conflation, not a leak-detection gap (treating it as forbidden is conservative, not permissive), so it can't produce a false negative — noting for precision only.
**Fix:** No action required; documenting for completeness since the matcher's correctness depends on this branch's conservatism holding.

---

## Resolution

All findings fixed RED-first (PROC-01: a failing test proving the defect, then the minimal fix, then GREEN).

### CR-01 — dom-leak.ts (FIXED)

The elementId-scoped exemption was too broad: it treated ANY `surface.ownerId !== marker.elementId`
as "not this marker's leak," which is false for aggregation (an ancestor/owner surface folding in a
DIFFERENT, hidden element's identity — e.g. `HexBoardRenderer.vue`'s cell `aria-label`/`<title>`
aggregating occupant piece names). Fixed by narrowing the exemption: `deriveForbiddenMarkers` was
replaced with `deriveLeakDetectionData`, which additionally returns `ownValuesById` — each VISIBLE
element's own surviving (legitimate) identity values. A surface is now only exempted from a
different-owner marker check when the owner's OWN legitimate values already contain the marker's
value (the symmetric-deck case); otherwise the surface is always checked. RED: a new
`HexAggregationGame` fixture (`Space > HexGrid > HexCell > hidden Piece`, real `HexBoardRenderer`
render via `AutoUI`) proved `assertNoHiddenInfoLeak` resolved (did not throw) when a hidden piece's
name leaked only through the aggregating cell's aria-label/title — a real false negative. Post-fix,
this throws, and all existing cases (symmetric-deck non-false-positive, adversarial same-id and
un-attributed-surface cases) remain green.

### CR-02 — asset-scan.ts (FIXED)

`stripComments`'s line-comment detector only guarded `https://`-style `:`-prefixed URLs; any other
live `//` (e.g. `href="//example.com"`, a JS string containing `//`) was treated as a comment opener
and blanked the rest of the line — including a real bare `<img>` later on that line, defeating the
ASSET-02 build gate. Fixed by making comment-opener detection quote-aware: a char-by-char scan now
tracks live single/double/backtick quote state and never treats `//`, `/*`, or `<!--` found inside an
open quote as a comment opener. RED: `<a href="//example.com"><img src="x.png"></a>` on one line
produced zero violations pre-fix (gate defeated); post-fix it correctly flags the live `<img>`. A
second RED case (`const x = "a // b"; <img src="x.png"> // real comment`) proved a live `//` inside a
JS string no longer swallows a subsequent live `<img>`, while a REAL trailing comment on the same
line still blanks correctly.

### WR-01 — asset-scan.ts (FIXED)

An unterminated `/*`/`<!--` silently blanked the rest of the file with no signal. `stripComments` now
returns `unterminated: { line, kind }` when a comment opener is never closed by EOF, and
`scanAssetReachability` surfaces this as its own actionable `AssetViolation` naming the line the
comment opened on, instead of a silent false PASS. The existing "unterminated block comment" test was
updated to assert the new loud-violation behavior (previously asserted the old silent-pass behavior,
which was itself the bug WR-01 flags).

### WR-02 — testing/index.ts (DOCUMENTED, not relocated)

Relocating `scanAssetReachability` out of `cli/lib` was judged risky: it has a second importer
outside this package's type-checked source graph (`bs-build-chunk` skill's `build/test.md`, a
hardcoded relative-path reference) that a move would silently break with no compiler signal. Per the
D20/162-CONTEXT.md discretion guidance, kept the export and added an explicit cross-module contract
comment on both sides (`src/testing/index.ts` and `src/cli/lib/asset-scan.ts`) documenting the
coupling and listing both importers that must be updated together if this file ever moves.

### Verification

`npm test` (vitest run): 209 files / 2941 tests passed (was 209/2937 — net +4 new tests: 2 CR-01
aggregation-leak cases, 2 CR-02 quote-aware cases; 1 pre-existing WR-01 test updated in place, not
counted as new).

---

_Reviewed: 2026-07-21T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Fixed: 2026-07-21T00:00:00Z_
