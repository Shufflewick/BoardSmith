---
phase: 91-security-leak-fix
reviewed: 2026-06-21T04:36:01Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - src/engine/element/game.ts
  - src/engine/element/image-leak.test.ts
findings:
  critical: 1
  warning: 3
  info: 2
  total: 6
status: issues_found
---

# Phase 91: Code Review Report

**Reviewed:** 2026-06-21T04:36:01Z
**Depth:** standard
**Files Reviewed:** 2
**Status:** issues_found

## Summary

The phase 91 fix replaces the blanket `key.startsWith('$')` attribute copy in
`toJSONForPlayer` with `redactHiddenElementAttrs()` across all three hidden-view
surfaces (deck/hidden zone children, count-only zone children, owner-only zone
children). The image-redaction logic itself is sound: `$image` is dropped
unconditionally, `$images` is narrowed to `{ back }`, unknown `$`-keys and all
non-`$` keys are fail-safe dropped, and the `SAFE_LAYOUT_KEYS` allowlist matches
the layout `$`-keys actually emitted by the engine element classes (verified by
grep — no missing or stale entries). The test file proves all three surfaces.

However, the same per-player serialization path still leaks hidden-information
through channels the fix did **not** address, and the redaction is not applied
uniformly across every branch:

1. The owner-only branch broadcasts the **real, stable element `id`** of every
   face-down card to non-owners — re-enabling exactly the cross-state
   correlation/card-tracking attack the hidden branch's negative-id
   anonymization (with its own in-code comment) was written to prevent. This
   branch was edited by this phase (its `systemAttrs` copy was swapped for
   `redactHiddenElementAttrs`), so the real-id leak was looked at and left in.
2. The element-level count-only branch still emits the element's identity-bearing
   `name` (e.g. `"AS"`) and never sets `__hidden`, so the SEC-02 regression guard
   cannot catch a leak there.
3. The owner-detection predicate is inconsistent with `isVisibleTo`, so games
   that assign hand ownership by inheritance hide a player's own cards from them.

No `<structural_findings>` block was provided, so this report contains narrative
findings only.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Owner-only hidden placeholders leak real element IDs, enabling hidden-card tracking

**File:** `src/engine/element/game.ts:2316-2333`
**Issue:**
In the `zoneVisibility.mode === 'owner'` branch, each non-owner placeholder is
built with the card's **real, stable** element id:

```js
hiddenChildren.push({
  className: childJson.className,
  id: childJson.id,                                   // <-- real, stable id
  attributes: { __hidden: true, ...redactHiddenElementAttrs(childJson.attributes ?? {}) },
});
```

Compare the hidden/count-only branch directly above (lines 2302-2308), which
deliberately anonymizes ids with `id: -(element._t.id * 1000 + i)` and documents
why: *"Use negative index-based IDs to prevent correlation with real element IDs"*
and *"no real IDs or names that could be used to cheat."* The owner-only branch
violates that established project requirement.

Because the id is stable across serializations, a non-owner can track a specific
face-down card across the game: correlate the placeholder id in an opponent's
hand with the same id after the card moves to another hidden zone, or with the
id once the card is finally revealed. This breaks hidden-information integrity —
a security/correctness defect for a board-game engine, and the same leak class
this phase set out to close (it was simply a different channel than `$images`).
This branch was modified by the phase, so the leak was within the changed code.

**Fix:** Anonymize the id exactly as the sibling hidden branch does, and drop the
real id:

```js
if (json.children) {
  for (let i = 0; i < json.children.length; i++) {
    const childJson = json.children[i];
    hiddenChildren.push({
      className: childJson.className,
      id: -(element._t.id * 1000 + i),   // anonymized, matches hidden branch
      attributes: { __hidden: true, ...redactHiddenElementAttrs(childJson.attributes ?? {}) },
    });
  }
}
```

## Warnings

### WR-01: Element-level count-only branch still leaks identity-bearing `name` and omits `__hidden`

**File:** `src/engine/element/game.ts:2266-2273`
**Issue:**
When an element's own effective visibility resolves to `count-only` and it is not
visible to the viewer, the branch returns the element verbatim including its
`name`:

```js
if (visibility.mode === 'count-only' && !element.isVisibleTo(visibilityPosition)) {
  return {
    className: json.className,
    id: json.id,
    name: json.name,                                  // <-- identity-bearing for cards
    attributes: redactHiddenElementAttrs(json.attributes ?? {}),
    childCount: element._t.children.length,
  };
}
```

The image fix correctly redacts attributes here, but for a leaf element (e.g. a
`Card` named `"AS"`) the `name` itself reveals identity. Every other redaction
branch (lines 2279-2283, 2302-2308, 2323-2327) drops `name`. This branch fires
whenever a non-container element is given explicit `count-only` visibility and is
then walked via normal recursion. Additionally it never sets `__hidden: true`, so
the SEC-02 `collectAllHiddenAttrs` regression guard (image-leak.test.ts:44-53,
270-321) sweeps right past it — a leak introduced here would not be caught by the
new test suite.

**Fix:** Drop `name` for non-container elements (or only retain it when the
count-only element is a zone/container), and seed `__hidden: true` so the
regression guard covers this surface:

```js
return {
  className: json.className,
  id: json.id,
  attributes: { __hidden: true, ...redactHiddenElementAttrs(json.attributes ?? {}) },
  childCount: element._t.children.length,
};
```

### WR-02: Owner check uses `element.player?.seat`, inconsistent with `isVisibleTo`/`getEffectiveOwner`

**File:** `src/engine/element/game.ts:2316`
**Issue:**
The owner-zone predicate reads ownership directly off the zone element:

```js
} else if (zoneVisibility.mode === 'owner' && element.player?.seat !== visibilityPosition) {
```

but `isVisibleTo` (game-element.ts:647-654) resolves ownership through
`getEffectiveOwner()` (game-element.ts:660-663), which walks **up the tree** when
`this.player` is undefined. These two ownership notions disagree for any zone that
inherits its owner from a parent (a common pattern — e.g. a `Hand` nested inside a
player-owned container without its own `.player` set). In that case
`element.player?.seat` is `undefined`, so `undefined !== visibilityPosition` is
true even for the real owner, and the owner is served `__hidden` placeholders for
their own cards. Two sources of truth for "who owns this" is the kind of
divergence the project's single-source-of-truth rule exists to prevent.

**Fix:** Use the same resolver the visibility gate uses:

```js
} else if (zoneVisibility.mode === 'owner'
           && element.getEffectiveOwner()?.seat !== visibilityPosition) {
```

### WR-03: `SAFE_LAYOUT_KEYS` is a hand-maintained duplicate of layout keys declared elsewhere

**File:** `src/engine/element/game.ts:239-245`
**Issue:**
The allowlist is a manually curated copy of the `$`-prefixed layout keys defined
across the element classes (the comment even dates a manual verification:
"Verified against src/engine/element/ on 2026-06-20"). It is correct *today*
(confirmed by grep — every emitted layout key is present), but it is a second
source of truth. When a future element adds a new layout `$`-key, the fail-safe
drop will silently strip it from every hidden/owner/count-only placeholder,
degrading rendering of face-down elements with no error and no test failure. This
is the opposite of pit-of-success: the easy path (add a layout key on the element)
silently breaks the hidden-view renderer.

**Fix:** Derive the allowlist from a single shared constant that the element
classes also consume when declaring layout attributes, or add a test that asserts
every layout `$`-key emitted by the engine is present in `SAFE_LAYOUT_KEYS` so
drift fails loudly.

## Info

### IN-01: Anonymized placeholder id can collide for zones with >1000 children

**File:** `src/engine/element/game.ts:2305`
**Issue:**
`id: -(element._t.id * 1000 + i)` reserves a 1000-slot range per element. A zone
with more than 1000 children would have its index `i` spill into the id range of
`element._t.id + 1`, producing duplicate placeholder ids across zones. Latent and
unlikely for typical games, but it is an undocumented magic-number capacity limit.
**Fix:** Use a collision-free composition (e.g. a separate running counter for
placeholders, or `-(element._t.id * MAX_CHILDREN + i)` with `MAX_CHILDREN` a named
constant and an assertion).

### IN-02: Owner-only branch omits `childCount` (shape inconsistency)

**File:** `src/engine/element/game.ts:2330-2333`
**Issue:**
The hidden/count-only branch returns `childCount` (line 2314) but the owner-only
branch does not. The count is still derivable from the `children` array length, so
this is cosmetic, but the differing placeholder shapes across the three branches
are an avoidable inconsistency for consumers that read `childCount`.
**Fix:** Include `childCount: element._t.children.length` in the owner-only return
for shape parity.

---

_Reviewed: 2026-06-21T04:36:01Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
