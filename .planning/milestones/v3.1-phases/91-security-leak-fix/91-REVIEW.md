---
phase: 91-security-leak-fix
reviewed: 2026-06-21T04:54:23Z
depth: standard
iteration: 3
files_reviewed: 2
files_reviewed_list:
  - src/engine/element/game.ts
  - src/engine/element/image-leak.test.ts
findings:
  critical: 0
  warning: 1
  info: 2
  total: 3
status: issues_found
---

# Phase 91: Code Review Report

**Reviewed:** 2026-06-21T04:54:23Z
**Depth:** standard
**Files Reviewed:** 2
**Status:** issues_found

## Summary

Iteration-3 (final) re-review of the image/identity leak fix in `toJSONForPlayer`. All prior
fixes were verified to hold:

- **CR-01 (owner-only real-id leak)** — HELD. The owner-zone branch (`game.ts:2343-2362`) now
  anonymizes child ids via `id: -(element._t.id * 1000 + i)` (line 2357), matching the
  hidden/count-only branch. No real id reaches a non-owner.
- **WR-01 (count-only name leak)** — HELD. The count-only container branch (2266-2276) and both
  anonymized-child loops drop `name`; only `__hidden`, anonymized id, `childCount`, and
  allowlisted layout `$`-keys survive.
- **WR-02 / iter-1 (owner-resolution mismatch)** — HELD. Branch 2343 resolves the owner with
  `element.getEffectiveOwner()?.seat !== visibilityPosition`, the same authority used by
  `isVisibleTo` (`game-element.ts:652`), so the placeholder decision can no longer disagree with
  the visibility check.
- **WR-03 (SAFE_LAYOUT_KEYS drift)** — HELD. Allowlist present (2239-2245) with a drift-guard test
  (`image-leak.test.ts:395-447`) that discovers declared `$`-keys and fails loudly on omission.
- **iter-2 WR-01 (id-anonymization regression tests)** — HELD. The `collectHiddenIds` sweep
  (459-512) asserts every anonymized-zone placeholder id is negative.
- **iter-2 WR-02 (standalone hidden id ACCEPT)** — HELD and correctly locked in. The documenting
  comment (2280-2305) and lock-in test (526-565) are present. I traced the FLIP rationale and
  found no concrete evidence the accept decision is wrong, so it is NOT re-raised.

The `redactHiddenElementAttrs` helper (260-280) is fail-safe and correct: `$image` dropped
unconditionally, `$images` narrowed to `{ back }` only, unknown `$`-keys and all non-`$` keys
dropped, allowlisted layout keys passed through. Null/undefined inputs are guarded (`?? {}`,
`images?.back`). Spread order `{ __hidden: true, ...redact(...) }` is safe because the helper
never emits `__hidden`. The container spreads (`...json` then `children:` override at 2339 and
2364) correctly replace the full child list with anonymized placeholders.

I also resolved the one structural concern in the count-only OWN-visibility branch (2266, which
keeps the real `json.id`): `getEffectiveVisibility()` inherits zone visibility
(`game-element.ts:623`), but count-only *zones* are intercepted at branch 2317 (which anonymizes
direct children and never recurses to grandchildren). So branch 2266 only ever fires for a
container that *inherits* count-only visibility — it keeps the id of a structural container, not
a fungible leaf, and emits no children. No leak.

No new Critical issues. One pre-existing WARNING adjacent to the changed code is surfaced below
for an explicit ship/defer decision.

## Warnings

### WR-01: Standalone hidden-element branch drops `$type` and `$images.back`, breaking face-down rendering

**File:** `src/engine/element/game.ts:2306-2310`
**Issue:** The standalone individually-hidden branch returns `attributes: { __hidden: true }` with
no other keys. Unlike the three zone branches — which all spread
`...redactHiddenElementAttrs(...)` to preserve `$type` (AutoUI renderer dispatch) and
`$images.back` (face-down card-back graphic) — this branch strips everything. An element hidden
via `hideFromAll()` / `showOnlyTo()` while sitting in a *visible* parent (the exact scenario the
WR-02 accept rationale is about) therefore arrives at the UI with no element type and no back
image, so it cannot render its face-down graphic on first paint (before any FLIP clone exists).

This is **pre-existing** behavior that the phase's own redaction design (preserving `back`/`$type`
on every other hidden surface) now makes inconsistent. It is a rendering/robustness defect, not a
security leak (the branch drops *more*, not less). It does **not** contradict the WR-02 id-accept
decision — that decision concerns the `id`, not the attributes — but the same FLIP requirement
that justified keeping the id implies the back graphic should also survive so there is something
to animate. The lock-in test (`image-leak.test.ts:559-563`) only asserts `$images.face` is
absent; it does not assert `$images.back` survives, so this gap is currently unguarded.

**Fix:** Make the standalone branch consistent with the zone branches by preserving safe
layout/back attributes:
```typescript
return {
  className: json.className,
  id: json.id, // intentional: stable id for FLIP (see comment above)
  attributes: { __hidden: true, ...redactHiddenElementAttrs(json.attributes ?? {}) },
};
```
Then extend the WR-02 lock-in test to assert `$images.back === '/cards/back.svg'` and
`$type === 'card'` survive on the standalone placeholder. If the product decision is that
standalone hidden elements should render as a generic blank (no back graphic), document that
explicitly in the comment block alongside the id rationale so the asymmetry is deliberate rather
than incidental.

## Info

### IN-01: Magic-number id-collision window above 1000 children per zone

**File:** `src/engine/element/game.ts:2332, 2357`
**Issue:** Anonymized ids are computed as `-(element._t.id * 1000 + i)`. With `i` unbounded, a
zone with `parentId = N` and a zone with `parentId = N+1` collide once a zone exceeds 1000
children (`-(N*1000 + 1000) === -((N+1)*1000 + 0)`), and anonymized ids stop being unique across
sibling zones in that regime. Intentionally left out of the critical/warning fix scope this phase
(tracked, accepted). Noted here for continuity only.
**Fix:** If addressed later, replace the `*1000` packing with a per-view monotonic counter or a
`(parentId, index)` tuple encoding that cannot overflow into a neighbor's range.

### IN-02: Owner-zone placeholder branch omits `childCount`

**File:** `src/engine/element/game.ts:2363-2366`
**Issue:** The owner-zone branch returns `{ ...json, children: hiddenChildren }` but does not set
`childCount`, whereas the hidden/count-only zone branch (2341) does. Consumers relying on
`childCount` for owner-hidden zones get `undefined` (they can still infer count from
`children.length`). Intentionally left out of the critical/warning fix scope this phase
(tracked, accepted). Noted for continuity.
**Fix:** Add `childCount: element._t.children.length` to the owner branch return for parity.

---

_Reviewed: 2026-06-21T04:54:23Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
