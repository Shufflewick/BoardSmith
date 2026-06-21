---
phase: 91-security-leak-fix
fixed_at: 2026-06-20T23:52:00Z
review_path: .planning/phases/91-security-leak-fix/91-REVIEW.md
iteration: 2
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 91: Code Review Fix Report (Iteration 2)

**Fixed at:** 2026-06-20T23:52:00Z
**Source review:** .planning/phases/91-security-leak-fix/91-REVIEW.md
**Iteration:** 2

**Summary:**
- Findings in scope: 2 (WR-01, WR-02)
- Fixed: 2
- Skipped: 0

Info findings IN-01 and IN-02 were out of scope (`fix_scope: critical_warning`) and were not addressed.

## Fixed Issues

### WR-01: CR-01's id-anonymization fix has no regression test

**Files modified:** `src/engine/element/image-leak.test.ts`
**Commit:** d427ae5
**Applied fix:**
Added placeholder-**id** assertions to close the gap the reviewer flagged — the
suite previously only walked `attributes`, never `id`, so a future edit
restoring `id: childJson.id` in the owner branch (the exact iteration-1 CR-01
regression) would have left all tests green.

- Added a `collectHiddenIds()` recursive helper alongside the existing
  `collectAllHiddenAttrs()`.
- Added `id` assertions to all three anonymized-zone surface tests (hidden deck,
  owner-only hand, count-only zone): each placeholder `id` must be negative
  (anonymized) AND not equal to the real card's `id` (captured from the created
  element via the `id` getter).
- Added a cross-surface guard test (`WR-01: anonymized zone placeholders must
  never expose a real element id`) that builds a deck + hand + count-zone
  fixture and asserts every `__hidden` node's `id` collected from the full
  player-2 view is negative. The containers themselves are not `__hidden`, so
  every collected node is a fungible anonymized child — making "all negative"
  the correct, scoped invariant.

Verification: `image-leak.test.ts` 9/9 green; full `src/engine/element` suite
151/151 green (was 149, +2 new tests).

### WR-02: Standalone hidden-element placeholder emits the real `id`

**Files modified:** `src/engine/element/game.ts`, `src/engine/element/image-leak.test.ts`
**Commit:** 6cb7c5c (comment), d427ae5 (lock-in test)
**Decision: ACCEPT (keep the stable id), with evidence.**

The reviewer asked for an explicit accept-or-fix decision and instructed:
prefer anonymizing UNLESS a documented requirement (e.g. UI animation needing a
stable handle) is broken. Investigation found exactly such a requirement.

**Evidence — the standalone id is relied upon for animation.** Grepping
`src/ui`, `src/runtime`, `src/client` for `__hidden`/placeholder-id usage:
- `src/ui/composables/useFlyingElements.ts:816-821` — `collectElements()` keys
  both `elementLocations` and its result map by `root.id`, including for nodes
  where `__hidden === true`.
- `src/ui/composables/useFlyingElements.ts:873-877` — `defaultShouldFlip()`
  correlates the hidden↔visible transition via `elementDataCache.get(element.id)`
  comparing `wasHidden !== isHidden`.

The standalone branch (`game.ts:2279`) fires for a SINGLE element individually
hidden (via `hideFromAll()` / `showOnlyTo()`) while sitting in an otherwise
VISIBLE parent — i.e. a face-down card on the table. The FLIP animation needs a
stable handle to correlate that element across the hidden→revealed transition
and animate the flip/move. Anonymizing its id would make the hidden and revealed
views appear to be two different elements, degrading the flip into a
disappear/reappear.

**Why the asymmetry is safe (vs. the anonymized zone branches).** Zone children
(count-only / hidden / owner-only) are fungible and rendered as an
undifferentiated stack — never individually animated — and position-based
anonymization is precisely what defeats shuffle/reveal correlation inside a
hidden collection. A deliberately-placed standalone face-down element already
sits in a visible parent, so its position is observable by design; the only
residual signal is reveal-correlation of a card the viewer watched go
face-down, which is inherent to the game (true of physical play too) and not a
hidden-collection leak. The standalone branch also emits only
`{ __hidden: true }` attributes — no `$images`/identity data leaks.

**Applied change:**
- `game.ts` — added a detailed explanatory comment at the standalone branch
  documenting the intentional asymmetry, the animation requirement (with the
  `useFlyingElements.ts` references), and the accept rationale, so the
  divergence from the anonymized zone branches is reviewable rather than silent.
- `image-leak.test.ts` — added a lock-in test (`WR-02: standalone hidden element
  retains a stable id for animation`) asserting a `hideFromAll()` card in a
  visible parent keeps its real (positive) id when viewed by a non-viewer, and
  still leaks no `$images.face`. This forces any future change that anonymizes
  the branch to make a deliberate re-decision.

Verification: full `src/engine/element` suite 151/151 green; `tsc --noEmit`
reports no errors in `game.ts`.

---

_Fixed: 2026-06-20T23:52:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
