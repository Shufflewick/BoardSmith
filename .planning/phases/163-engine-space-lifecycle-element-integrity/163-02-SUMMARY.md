---
requirements-completed: [SPACE-03, PROC-01]
---

# Plan 163-02 Summary — Hidden Space Child-Count Leak (SPACE-03/D24, PROC-01)

**Plan:** 163-02 (execute — Information-Disclosure fix: `toJSONForPlayer`'s `'hidden'` zone branch no
longer leaks its exact child count)
**Completed:** 2026-07-21
**Result:** PASS — `'hidden'` mode is now true concealment (no `childCount`, no `children` key at all);
`'count-only'` is byte-for-byte unchanged; Phase 159 redaction intact; PROC-01's RED-before-GREEN
satisfied.

## What was done

This closes T-163-24 (Information Disclosure): `toJSONForPlayer`'s zone branch treated `'hidden'` and
`'count-only'` identically, both emitting `childCount` and a full array of anonymized per-child
placeholders. A `'hidden'` deck/hand — which is supposed to mean "you learn nothing" — told every
opponent exactly how many cards it held. Games have been faking real concealment by hiding each child
individually (the `concealFromEverySeat` smell) precisely because the engine's `'hidden'` mode didn't
actually conceal the count.

1. **Task 1 (RED):** Added/updated regression coverage in `deck-hand-visibility.test.ts` (new describe
   block `SPACE-03/D24: hidden-mode child-count no longer leaks`, plus corrected the pre-existing "hides
   a fresh Deck contents" test, which had been asserting the leaky behavior as *expected*) and
   `zone-visibility-restore.test.ts` (corrected the "reports __hidden contents" test and the
   re-hide-after-reveal round-trip test). All new/updated assertions check `'childCount' in node` and
   `'children' in node` are both `false` for a `'hidden'` zone's non-owner view — not `childCount === 0`,
   since that would still distinguish empty from full. Ran and captured the real failure (current code
   still emits both keys) before any production change.
2. **Task 2 (GREEN):** Split `game.ts:2867`'s combined `if (mode === 'hidden' || mode === 'count-only')`
   into two branches. `'hidden'` now returns `{ ...ownJson }` with `children` explicitly destructured
   out (setting `children: undefined` was insufficient — `'children' in obj` still finds an
   explicitly-undefined key) and never builds synthetic placeholder ids or populates `idRemap`.
   `'count-only'` keeps its existing logic verbatim: negative synthetic ids, `idRemap` relink,
   anonymized placeholders, `childCount`.

## PROC-01 verbatim RED output (Task 1, before any fix)

```
❯ deck-hand-visibility.test.ts (6 tests | 2 failed)
  × hides a fresh Deck contents from non-owner in per-player snapshot (SPACE-03/D24: true concealment)
    → expected true to be false // Object.is equality ('childCount' in deckJson)
  × SPACE-03/D24 ... > a hidden Space exposes neither childCount nor children to a non-owner
    → expected true to be false // Object.is equality ('childCount' in zoneJson)
❯ zone-visibility-restore.test.ts (7 tests | 2 failed)
  × a hidden Space reports neither childCount nor children to the opponent before any restore (SPACE-03/D24)
    → expected true to be false // Object.is equality ('childCount' in zoneJson)
  × a zone re-hidden after being shown mid-game also survives GameRunner.fromSnapshot
    → expected true to be false // Object.is equality ('childCount' in beforeZone)

Test Files  2 failed (2)
     Tests  4 failed | 9 passed (13)
```
The 9 passing tests were `'count-only'`, `'owner'`, and default/`'all'`-mode controls, proving the
suppression fixture was scoped correctly and not everything was failing.

## PROC-01 verbatim GREEN output (Task 2, after the fix)

```
✓ src/engine/element/deck-hand-visibility.test.ts (6 tests)
✓ src/engine/element/image-leak.test.ts (11 tests)
✓ src/engine/element/zone-visibility-restore.test.ts (7 tests)

Test Files  3 passed (3)
     Tests  24 passed (24)
```

## Verification

- `npx vitest run src/engine/element/deck-hand-visibility.test.ts src/engine/element/zone-visibility-restore.test.ts src/engine/element/image-leak.test.ts` — 3 files, 24 tests, all pass.
- `npm test` — **209 files / 2950 tests pass**, at/above the pre-phase baseline (209/2947 after 163-01);
  the +3 delta is this plan's net-new hidden-vs-count-only/owner coverage.
- Grep gate: `grep -n "zoneVisibility.mode === 'hidden'" src/engine/element/game.ts` → one match at
  `game.ts:2867`, confirming the distinct `mode === 'hidden'` handler exists.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug/pre-existing-behavior-encoded-as-test] Pre-existing tests asserted the leaky pre-fix
shape and had to be corrected, not just extended**
- **Found during:** Task 1 (RED) and again while running the full suite after Task 2 (GREEN).
- **Issue:** Several tests outside the plan's `files_modified` list construct a `'hidden'`-mode Space
  and assert on the OLD leaking shape (`childCount`, a `children` array of anonymized placeholders).
  Since D24 changes that shape by design, these tests would otherwise regress on GREEN even though
  nothing else about them is wrong.
- **Fix:**
  - `src/engine/element/visible-attributes.test.ts` — the `contentsHidden()` container test asserted
    `boardJson.childCount).toBe(1)` and inspected `children?.[0]`; updated to assert `'childCount' in
    boardJson` and `'children' in boardJson` are both `false`.
  - `src/engine/element/image-leak.test.ts` — the "hidden deck child" SEC-01 case inspected
    `deckJson.children[0]` for `$images` redaction; since a `'hidden'` deck now emits no children at
    all, redaction of a placeholder is moot — rewrote to assert full concealment (no `childCount`/
    `children`) as a strictly stronger guarantee. The SEC-02 "mixed-deck" `$image`/`$secretValue`
    fail-safe-drop case used `contentsHidden()`; moved it to `contentsCountOnly()` so the
    `redactHiddenElementAttrs` sanitization it's actually testing still has a placeholder to run
    against. The two cross-surface regression sweeps (SEC-02's `collectAllHiddenAttrs`, WR-01's
    `collectHiddenIds`) expected `>= 3` hidden nodes across a hidden+owner+count-only fixture; a
    `'hidden'` zone now contributes zero by design, so both were adjusted to `>= 2` with a comment
    explaining why.
  - `src/ai/mcts-redaction.test.ts` — the Phase 159 CR-02 flow-variable-relinking regression fixture
    used `contentsHidden()` on the zone whose child a `forEach`-bound flow variable points at, then
    asserted the restored clone relinks it to a live `GameElement` placeholder. Per the plan's own D24
    decision ("the `'hidden'` path does not populate `idRemap`... confirm no restore relies on
    hidden-mode remap entries"), that placeholder no longer exists for `'hidden'` mode — there is
    nothing to relink to. Moved the fixture to `contentsCountOnly()`, which still anonymizes children
    and populates `idRemap` exactly as before, preserving the original CR-02 regression coverage on a
    mode where it remains valid.
- **Files modified:** `src/engine/element/visible-attributes.test.ts`,
  `src/engine/element/image-leak.test.ts`, `src/ai/mcts-redaction.test.ts` (all outside the plan's
  declared `files_modified`, but each failure was a direct, mechanical consequence of the D24 change in
  `game.ts` — Rule 1 scope: "Only auto-fix issues DIRECTLY caused by the current task's changes").
- **Commit:** `8e74abda` (bundled with the GREEN production change, since `npm test` must be green
  before the task is considered done).

### Auth gates
None encountered.

## Known Stubs
None — no stub patterns introduced.

## Threat Flags
None — this plan implements the mitigation specified in its own threat model (T-163-24, T-163-25); no
new, unlisted security-relevant surface was introduced. T-163-25 (regressing Phase 159 redaction) was
explicitly verified: `deck-hand-visibility.test.ts`, `zone-visibility-restore.test.ts`, and
`image-leak.test.ts` are all green, and the `'count-only'`/`'owner'` branches are untouched.

## Self-Check: PASSED

- `src/engine/element/game.ts` (`mode === 'hidden'` split at `game.ts:2867`) — FOUND
- `src/engine/element/deck-hand-visibility.test.ts` — FOUND
- `src/engine/element/zone-visibility-restore.test.ts` — FOUND
- `src/engine/element/image-leak.test.ts` — FOUND
- `src/engine/element/visible-attributes.test.ts` — FOUND
- `src/ai/mcts-redaction.test.ts` — FOUND
- Commit `f31c8b44` (RED) — FOUND in `git log`
- Commit `8e74abda` (GREEN) — FOUND in `git log`
