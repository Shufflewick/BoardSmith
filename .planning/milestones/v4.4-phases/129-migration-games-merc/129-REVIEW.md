---
phase: 129-migration-games-merc
reviewed: 2026-07-02T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/testing/dom-leak.ts
  - src/testing/index.ts
  - ~/BoardSmithGames/go-fish/tests/no-hidden-info-dom-leak.test.ts
  - ~/BoardSmithGames/go-fish/tests/visibility.test.ts
  - ~/BoardSmithGames/cribbage/tests/visibility.test.ts
  - ~/BoardSmithGames/demo-animation/tests/animation-trace.test.ts
findings:
  critical: 0
  warning: 2
  info: 1
  total: 3
status: fixed
fixed_at: 2026-07-02T00:00:00Z
resolutions:
  WR-01: fixed (go-fish commit bbfef61 — elementId-scoped allow predicate + rank-only positive control; suite 84/84 green)
  WR-02: fixed (BoardSmith commit 1b722b1 — elementId-scoped worked example added to HiddenInfoLeakAllowPredicate doc)
  IN-01: skipped (single adopter; no action required per original review)
---

# Phase 129: Code Review Report

**Reviewed:** 2026-07-02
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Reviewed the BoardSmith-side lazy-import fix for `@vue/test-utils` in
`src/testing/dom-leak.ts` (commit `fb09f4b`) and the cross-repo flagship test
adoptions from Plan 129-02 (go-fish DOM-leak + visibility, cribbage
visibility, demo-animation trace).

**dom-leak.ts lazy-import fix:** correct. The only runtime reference to
`@vue/test-utils` is a cached dynamic `import()` (`loadMount`), mirroring the
existing `loadAutoUI()` pattern; the top-level `import type { VueWrapper }`
is a type-only import, and the project's `isolatedModules` +
`verbatimModuleSyntax` tsconfig settings guarantee it is erased at
compile/transpile time (confirmed no runtime resolution occurs). Traced the
full static import graph of `src/testing/index.ts` and every file it
re-exports from (`test-game.ts`, `simulate-action.ts`, `random-simulation.ts`,
`assertions.ts`, `visibility.ts`, `view-diff.ts`, `dom-leak.ts`, `debug.ts`,
`simulate-tutorial.ts`, `tutorial-assertions.ts`, `action-builder.ts`,
`useAnimationTestMode.ts`) — `dom-leak.ts` is the only file in the barrel
that references `@vue/test-utils` at all, so no other path eagerly pulls it
in. The two `if (!promise) { ...; promise = import(...) }` cache guards in
`loadAutoUI`/`loadMount` are synchronous before any `await`, so concurrent
callers (e.g. the `Promise.all([loadAutoUI(), loadMount()])` call in
`renderAsSeat`) cannot race into creating two separate import promises — this
is correct. Ran `dom-leak.test.ts` directly (13/13 passed) to confirm no
regression.

**Cross-repo test adoption:** all three flagship tests contain meaningful,
non-vacuous assertions. go-fish's DOM-leak suite includes a genuine positive
control that splices a real hidden card identity into a `gameViewOverride`
and asserts the matcher throws — verified this is a real injected leak (not
a fabricated string) and that the assertion targets `/Hidden-info leak/`.
cribbage's visibility test exercises both hand-privacy and crib-secrecy
correctly. demo-animation's trace test asserts a specific `fly` trace entry
and asserts the `flip` entry is absent — not just "array is non-empty."

One real gap: the go-fish `allow` predicate that excludes `rank`/`suit` as
identity candidates is broader than necessary and, as designed, would mask a
genuine rank-only (or suit-only) DOM leak that doesn't also surface the full
compound `name`. See WR-01 below.

## Warnings

### WR-01: go-fish's rank/suit allow-predicate is unscoped and would mask a real rank-only (or suit-only) leak

**File:** `~/BoardSmithGames/go-fish/tests/no-hidden-info-dom-leak.test.ts:59-62`
**Issue:** `IGNORE_REDUNDANT_RANK_SUIT_FIELDS` excludes every marker whose
`attribute` is `'rank'` or `'suit'`, globally — not scoped to a specific
`elementId`. The stated justification (redundant with the compound `name`
field, and a standard 52-card deck guarantees `name` is unique) is sound for
the *current* `AutoUI` `CardRenderer.vue`, which only ever emits the
compound `name` (via `aria-label`/`alt`, confirmed by grep — `CardRenderer.vue`
never emits a bare `data-rank`/`data-suit`). However, `assertNoHiddenInfoLeak`
checks the DOM surface via substring match (`surface.includes(marker.value)`).
If go-fish ever adds a custom board component (or a future `AutoUI` renderer
change) that surfaces a hidden card's bare rank or suit independently — e.g.
`data-rank="7"` for CSS sorting/grouping, without the full `"7C"` compound
also appearing in that same surface string — this predicate would silently
exempt exactly that leak, and the compound `name` marker would NOT catch it
either (since `"7C"` is not a substring of a surface containing only `"7"`).
This is the precise "rank-only leak masked" scenario the review was asked to
assess, and it is real: the predicate's blanket `attribute === 'rank' ||
attribute === 'suit'` scoping provides no defense-in-depth if the compound
identity ever stops being the only leak vector.
**Fix:** Narrow the predicate to be defensive against future renderer
changes — e.g. only allow rank/suit markers whose *value* also already
appears as a substring of some `name` marker for the same `elementId` (proving
true redundancy at assertion time rather than assuming it structurally), or
add a code comment + a dedicated regression test asserting that a
rank-only leak (independent of `name`) is still caught if introduced later.
Minimal version:
```ts
const IGNORE_REDUNDANT_RANK_SUIT_FIELDS = {
  allow: (marker: string, ctx: { attribute?: string; elementId: number }) => {
    if (ctx.attribute !== 'rank' && ctx.attribute !== 'suit') return false;
    // Only allow if this exact value is a substring of the compound `name`
    // for the SAME element — proves redundancy instead of assuming it.
    return false; // placeholder: requires access to the element's name marker at allow-time
  },
};
```
At minimum, add an explicit regression test (mirroring the existing positive
control) that injects a rank-only leak via `gameViewOverride` bypassing the
`allow` predicate (i.e. calling `assertNoHiddenInfoLeak` with no `allow`
option) to document that this is a known, accepted gap rather than an
oversight — the current suite proves the *compound* leak is caught, but does
not prove (or even attempt) a rank-only leak is caught, despite that being
exactly the scenario the `allow` predicate creates a blind spot for.

### WR-02: dom-leak.ts's `AssertNoHiddenInfoLeakOptions.allow` predicate has no per-`elementId` scoping example, encouraging attribute-only allowlists

**File:** `src/testing/dom-leak.ts:161-164`
**Issue:** The `HiddenInfoLeakAllowPredicate` type signature exposes
`elementId` in its context specifically so allowlist predicates can be
scoped narrowly (per the doc comment at line 156-160: "A narrow predicate
... cannot silently mask a real leak"), but neither of the two consuming
callers reviewed (`go-fish`'s `IGNORE_REDUNDANT_RANK_SUIT_FIELDS`) actually
uses `elementId` to scope the exemption — both allow entire attribute
classes globally. This is a documentation/example gap: the library's own
doc comment promises narrow scoping is possible and safe, but the only
real-world adopter of the API (go-fish, the flagship) demonstrates the
opposite (attribute-wide, not element-scoped) pattern, which other game
authors are likely to copy.
**Fix:** Add a worked example in the `HiddenInfoLeakAllowPredicate` doc
comment (or a dedicated section of testing docs) showing an `elementId`-scoped
allow predicate, so future adopters copy the safer pattern rather than the
go-fish attribute-wide one.

## Info

### IN-01: demo-animation's `waitFor` polling helper duplicates a pattern that could be a shared testing utility

**File:** `~/BoardSmithGames/demo-animation/tests/animation-trace.test.ts:59-65`
**Issue:** The locally-defined `waitFor(predicate, timeout)` polling loop
(200ms via `nextTick()` + `setTimeout(5)` iterations) is a generic
async-condition-wait pattern with no game-specific logic. Not a bug, but
worth noting as an opportunity to promote to `boardsmith/testing` if other
games adopt the animation-trace pattern later (currently only this one game
uses it, so no action needed now).
**Fix:** No action required this phase; consider extracting to
`boardsmith/testing` if a second game adopts an animation-trace test with
the same polling need.

---

## Resolutions (2026-07-02)

- **WR-01 — fixed.** go-fish's `IGNORE_REDUNDANT_RANK_SUIT_FIELDS` was
  replaced with `makeIgnoreRedundantRankSuitFields(testGame)`, which scopes
  the rank/suit exemption to `ctx.elementId` and only allows a marker if it's
  a substring of that SAME element's real compound `name` (proving
  redundancy per-element rather than assuming it for every rank/suit field
  globally). A new dedicated positive control was added
  (`no-hidden-info-dom-leak.test.ts`) that injects a bare rank-only leak (no
  compound name) of an opponent's hidden card via `gameViewOverride` with NO
  `allow` predicate, and asserts the matcher still throws — proving the
  underlying detection capability for a rank-only leak exists independent of
  the convenience predicate's structural redundancy assumption. go-fish
  commit `bbfef61`; suite 84/84 green (was 83, +1 test).
- **WR-02 — fixed.** `HiddenInfoLeakAllowPredicate`'s doc comment in
  `src/testing/dom-leak.ts` now includes a worked `elementId`-scoped example
  (built from the fix above) instead of leaving narrow scoping only implied.
  BoardSmith commit `1b722b1`; `dom-leak.test.ts` 13/13 green.
- **IN-01 — skipped, no action taken.** Single adopter (demo-animation); the
  original review already recommended no action this phase.

_Reviewed: 2026-07-02_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Fixed: 2026-07-02_
_Fixer: Claude (gsd-code-fixer)_
