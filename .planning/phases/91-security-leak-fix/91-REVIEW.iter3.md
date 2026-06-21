---
phase: 91-security-leak-fix
reviewed: 2026-06-20T23:45:00Z
depth: standard
iteration: 2
files_reviewed: 2
files_reviewed_list:
  - src/engine/element/game.ts
  - src/engine/element/image-leak.test.ts
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
status: issues_found
---

# Phase 91: Code Review Report (Iteration 2)

**Reviewed:** 2026-06-20T23:45:00Z
**Depth:** standard
**Files Reviewed:** 2
**Status:** issues_found

## Summary

This is a re-review of the four findings raised in iteration 1. All four are
correctly fixed:

- **CR-01 (real-id leak in owner-only branch)** — FIXED. `game.ts:2332` now emits
  the anonymized `id: -(element._t.id * 1000 + i)`, matching the hidden/count-only
  sibling branch, and no longer includes `name`. The stable real-id correlation
  channel is closed for owner-only zones.
- **WR-01 (count-only element-level branch leaked `name`, no `__hidden`)** — FIXED.
  `game.ts:2266-2275` now drops `name` and seeds `__hidden: true`, so the SEC-02
  regression guard (`collectAllHiddenAttrs`) sweeps this surface.
- **WR-02 (owner predicate vs `isVisibleTo` mismatch)** — FIXED. `game.ts:2318`
  now uses `element.getEffectiveOwner()?.seat`, the exact resolver `isVisibleTo`
  uses (`game-element.ts:652`). Inherited ownership now agrees with the visibility
  gate; owners no longer get `__hidden` placeholders for their own cards.
- **WR-03 (`SAFE_LAYOUT_KEYS` drift)** — FIXED. A drift-guard test was added
  (`image-leak.test.ts:340-392`) that discovers every layout `$`-key declared in
  the engine element classes and fails loudly if one is missing from the
  allowlist. Verified independently: all declared layout `$`-keys
  (`$align`, `$colCoord`, `$columnLabels`, `$coordSystem`, `$direction`, `$fan`,
  `$fanAngle`, `$gap`, `$hexOrientation`, `$hexSize`, `$layout`, `$overlap`,
  `$qCoord`, `$rCoord`, `$rowCoord`, `$rowLabels`, `$sCoord`, `$type`) are present;
  `$image`/`$images` are correctly excluded as value-bearing.

Test status: `image-leak.test.ts` 7/7 green; full `src/engine/element` suite
149/149 green (the `name`-drop in the count-only branch caused no regression).

Two residual concerns remain. Both concern the **id channel**, which the redaction
fix and its regression guard do not cover (the guard inspects `attributes` only,
never placeholder ids). Neither blocks the redaction objective of this phase, but
they leave the CR-01 fix unguarded and an adjacent same-class leak open.

No `<structural_findings>` block was provided, so this report contains narrative
findings only.

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: CR-01's id-anonymization fix has no regression test — the critical leak is unguarded

**File:** `src/engine/element/image-leak.test.ts` (whole file) / `src/engine/element/game.ts:2332`
**Issue:**
The iteration-1 CRITICAL was the owner-only branch leaking a real, stable element
id. The fix anonymizes the id (`-(element._t.id * 1000 + i)`), but the test suite
never asserts anything about placeholder **ids**. Every assertion checks
`attributes` (`__hidden`, `$images`, `$image`, `$type`, `$secretValue`) and the
`collectAllHiddenAttrs` guard only walks `attributes`. There is no test asserting
that an owner-only placeholder's `id` is negative / not equal to the card's real
id. A future edit that restores `id: childJson.id` in the owner branch (the exact
iteration-1 regression) would leave all 149 tests green. Per the project rule
"Treat identified test gaps as blockers," the just-fixed CRITICAL leak should have
a guard.

**Fix:** Extend the owner-only and hidden-zone test cases (and ideally the
`collectAllHiddenAttrs` regression sweep) to assert id anonymization, e.g.:

```ts
// In the owner-only non-owner test, after locating hiddenCard:
expect(hiddenCard.id, 'hidden placeholder id must be anonymized (negative)').toBeLessThan(0);

// And a cross-surface guard: collect every __hidden node and assert no real id leaks.
function collectHiddenIds(json: ElementJSON): number[] {
  const ids: number[] = [];
  if (json.attributes?.__hidden && typeof json.id === 'number') ids.push(json.id);
  for (const c of json.children ?? []) ids.push(...collectHiddenIds(c));
  return ids;
}
// every collected id from an anonymized-children branch must be < 0
```

### WR-02: Standalone hidden-element placeholder still emits the real `id` (same correlation class as CR-01)

**File:** `src/engine/element/game.ts:2279-2285`
**Issue:**
The element-level hidden placeholder returns the card's real, stable id:

```js
if (!element.isVisibleTo(visibilityPosition)) {
  return {
    className: json.className,
    id: json.id,                 // <-- real, stable id on a __hidden element
    attributes: { __hidden: true },
  };
}
```

This is the identical id-correlation channel CR-01 closed for owner-only zones,
but for an individually-hidden element sitting in an otherwise-visible parent
(e.g. a single face-down card on the table via explicit `hide()`). A non-owner can
track that specific card across moves/reveals by its stable id. This branch was
not modified by the phase, and unlike fungible zone children it may be an
intentional tradeoff (the client needs a stable handle to animate a standalone
element). Flagging it because (a) it is the same leak class the phase just fixed,
(b) the new regression guard cannot see it (ids aren't inspected), and (c) it
deserves an explicit accept/fix decision rather than silent divergence between
the two hidden-placeholder shapes.

**Fix:** Decide explicitly. If standalone hidden elements must stay individually
addressable for animation, document that requirement in a comment here so the
asymmetry with the anonymized zone branches is intentional and reviewable. If not,
anonymize the id consistently with the zone branches.

## Info

### IN-01: Anonymized placeholder id can collide for zones with >1000 children (now in two branches)

**File:** `src/engine/element/game.ts:2307` and `:2332`
**Issue:**
`id: -(element._t.id * 1000 + i)` reserves a 1000-slot range per element. A zone
with >1000 children spills index `i` into the id range of `element._t.id + 1`,
producing duplicate placeholder ids across zones. The CR-01 fix duplicated this
magic-number formula into the owner branch, so the latent capacity limit now
exists in two places. Unlikely for typical games but undocumented.
**Fix:** Extract a named `MAX_CHILDREN` constant (with an assertion) or use a
single running placeholder counter shared by both branches.

### IN-02: Owner-only branch omits `childCount` (shape inconsistency across the three hidden branches)

**File:** `src/engine/element/game.ts:2338-2341`
**Issue:**
The hidden/count-only zone branch returns `childCount` (`:2316`) and the
element-level count-only branch returns `childCount` (`:2274`), but the owner-only
branch returns `{ ...json, children }` with no `childCount`. `...json` does not
supply it (a zone's `toJSON()` carries `children`, not `childCount`). Count is
still derivable from `children.length`, so this is cosmetic, but the three hidden
branches now emit three slightly different placeholder shapes.
**Fix:** Add `childCount: element._t.children.length` to the owner-only return for
parity.

---

_Reviewed: 2026-06-20T23:45:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
