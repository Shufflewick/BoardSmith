---
phase: 91-security-leak-fix
fixed_at: 2026-06-20T23:41:00Z
review_path: .planning/phases/91-security-leak-fix/91-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 91: Code Review Fix Report

**Fixed at:** 2026-06-20T23:41:00Z
**Source review:** .planning/phases/91-security-leak-fix/91-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 4 (1 Critical + 3 Warning)
- Fixed: 4
- Skipped: 0

Info findings IN-01 and IN-02 were out of fix scope (`critical_warning`) and were not attempted.

## Fixed Issues

### CR-01: Owner-only hidden placeholders leak real element IDs

**Files modified:** `src/engine/element/game.ts`
**Commit:** f691d75
**Applied fix:** In the `zoneVisibility.mode === 'owner'` branch, replaced the real,
stable `id: childJson.id` with the anonymized `id: -(element._t.id * 1000 + i)`
form used by the sibling hidden/count-only branch, and switched the loop to an
index-based loop to derive `i`. This drops the stable real id that allowed a
non-owner to track a face-down card across zones and reveals. Verified: `tsc
--noEmit` reports no errors in game.ts.

### WR-01: Count-only branch leaks identity-bearing `name` and omits `__hidden`

**Files modified:** `src/engine/element/game.ts`
**Commit:** 0cca595
**Applied fix:** In the element-level `count-only` branch, dropped the
identity-bearing `name` field and seeded `__hidden: true` into the placeholder
attributes. Dropping `name` prevents a leaf element (e.g. a `Card` named `"AS"`)
from revealing its identity; seeding `__hidden` ensures the SEC-02
`collectAllHiddenAttrs` regression guard sweeps this surface. Verified: `tsc
--noEmit` reports no errors in game.ts; the full `image-leak.test.ts` suite
passes (7/7).

### WR-02: Owner check uses `element.player?.seat`, inconsistent with `isVisibleTo`

**Files modified:** `src/engine/element/game.ts`
**Commit:** e3ca62e
**Applied fix:** Changed the owner-zone predicate from `element.player?.seat` to
`element.getEffectiveOwner()?.seat` so ownership resolution matches the resolver
`isVisibleTo` uses. `getEffectiveOwner()` walks up the tree when `this.player` is
undefined, so a zone that inherits its owner from a parent (e.g. a `Hand` nested
in a player-owned container) no longer hides the owner's own cards from them.

**Status note (logic/semantic change — requires human verification):** This
changes ownership-resolution semantics. The full `image-leak.test.ts` suite
passes and `tsc --noEmit` is clean, but no test currently exercises the
inherited-ownership case described in the finding. Recommend a developer confirm
the inherited-owner path behaves as intended (ideally add a regression test for a
`Hand` that inherits ownership from a parent container).

### WR-03: `SAFE_LAYOUT_KEYS` is a hand-maintained duplicate of layout keys

**Files modified:** `src/engine/element/image-leak.test.ts`
**Commit:** 665be75
**Applied fix:** Per the in-scope constraint (avoid refactoring element classes),
added a drift-guard test (`describe('WR-03: ...')`). The test discovers every
`$`-prefixed key declared across the engine element class source files (class
field declarations and `this.$x =` assignments), parses the actual
`SAFE_LAYOUT_KEYS` Set literal out of `game.ts`, and asserts every declared
layout `$`-key is present in the allowlist (excluding the value-bearing keys
`$image`/`$images`, which `redactHiddenElementAttrs` handles separately). If a
future element adds a layout `$`-key but forgets to add it to `SAFE_LAYOUT_KEYS`,
this test fails loudly with the list of missing keys — closing the silent-drift
gap. The element source directory is resolved from `import.meta.url` so the test
is cwd-independent. Verified: `tsc --noEmit` clean for the test file; full
`image-leak.test.ts` suite passes 7/7, including the new guard.

## Skipped Issues

None.

---

_Fixed: 2026-06-20T23:41:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
