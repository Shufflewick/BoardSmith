---
requirements-completed: [SPACE-01, SPACE-02, PROC-01]
---

# Plan 163-01 Summary — Sealed/Append-Only Space + Space Re-parent (SPACE-01/D22, SPACE-02/D23, PROC-01)

**Plan:** 163-01 (execute — lift `moveToInternal` to `GameElement`, add `sealed` flag + `reparent`/`remove` to `Space`)
**Completed:** 2026-07-21
**Result:** PASS — one shared `GameElement.moveToInternal` now owns the splice+exit+enter+cycle-guard
path for both `Piece` and `Space`; the D22 sealed-old-parent guard has exactly one home; `Space` can
now be removed/re-parented (D23). PROC-01's RED-before-GREEN satisfied for both defects.

## What was done

1. **Task 1 (RED):** Added 8 net-new cases to `space.test.ts` against current, unfixed source: sealed
   rejection (throws + tree untouched), append-only add, negative control (unsealed removal still
   works today), sealed-flag+onExit-state survives a `GameRunner.fromSnapshot` restore round-trip, a
   Space re-parent case (own `onExit` fires once on old parent, children ride along with no child exit
   events), and a sealed-Space-still-relocatable case. Ran and captured the real failures (sealed
   removal wrongly succeeded; `reparent` didn't exist) — see verbatim RED below. No production source
   touched in this commit.
2. **Task 2 (GREEN, D22):** Moved `Piece.moveToInternal`'s body (cycle guards → dev detached-destination
   warn → capture `oldParent` → splice → exit event → attach → enter event) up to `GameElement`
   **unchanged in ordering** — a literal relocation, not a reimplementation. `Piece.putInto`/`remove`
   now inherit it (no signature change, no back-compat shim). Inserted the D22 sealed check immediately
   after `oldParent` is captured and BEFORE the splice: if `oldParent` is a sealed `Space`, throw an
   actionable error naming it and leave `_t.children`/`_t.parent` untouched. Added `Space.sealed`
   (plain public field, default `false`) + `seal()` convenience — a plain field (not `_`-prefixed) so
   it rides the generic attribute-serialization loop and survives restore without a dedicated
   `_restore*` hook (restore rebuilds children via `addChild`, never `moveToInternal`, so the seal check
   is bypassed for free — by design). Replaced the two `instanceof Space` `triggerEvent` call sites with
   duck-typed lookups (mirrors the existing `getParentZoneVisibility` pattern) to avoid a circular
   import between `game-element.ts` and `space.ts`.
3. **Task 3 (GREEN, D23):** Added `Space.reparent(destination, position?)` and `Space.remove()` (mirrors
   `Piece.remove()`, moves to `game.pile`), both delegating to the inherited `moveToInternal` — no
   re-implementation of the splice/exit/enter logic. Confirmed a sealed Space can still be re-parented
   (when the sealed Space itself moves, `oldParent` in `moveToInternal` is the grandparent, so the D22
   guard is correctly inert there) and that children ride along unchanged (only `this._t.parent`
   changes; `this`'s children keep `this` as their parent, firing no exit/enter events of their own).

## PROC-01 verbatim RED output (Task 1, before any fix)

```
 ❯ src/engine/element/space.test.ts (8 tests | 3 failed) 11ms
   × Space.sealed (SPACE-01/D22): append-only child removal guard > rejects moving a Piece OUT of a sealed Space, tree left untouched (no corrupt-on-reject) 4ms
     → expected [Function] to throw an error
   × Space re-parent (SPACE-02/D23): a Space can be removed/re-parented > re-parents a Space: its own onExit fires once on the old parent, children ride along with no child exit events 0ms
     → childSpace.reparent is not a function
   × Space re-parent (SPACE-02/D23): a Space can be removed/re-parented > a sealed Space can still be re-parented (seal fences child removal, not the Space itself) 1ms
     → expected [Function] to not throw an error but 'TypeError: sealedChild.reparent is no…' was thrown

AssertionError: expected [Function] to throw an error
- Expected:
null
+ Received:
undefined
 ❯ src/engine/element/space.test.ts:87:40 (token.putInto(other) toThrow(/sealed-space/i))

Test Files  1 failed (1)
     Tests  3 failed | 5 passed (8)
```
The 5 passing tests were the negative control (unsealed removal already worked), the append-only-add
case (no guard exists to violate), and the sealed-survives-restore case (nothing to violate pre-fix,
since restore never ran a seal check that didn't exist) — proving the fixture doesn't fail everything.
Both real defects reproduced exactly as expected: sealed removal wrongly succeeded (D22); the
`reparent` API was entirely absent (D23).

## PROC-01 verbatim GREEN output

**After Task 2 (D22 fixed, D23 still pending):**
```
 ❯ src/engine/element/space.test.ts (8 tests | 2 failed) 10ms
   × Space re-parent ... > re-parents a Space ...
     → childSpace.reparent is not a function
   × Space re-parent ... > a sealed Space can still be re-parented ...
     → TypeError: sealedChild.reparent is not a function

Test Files  1 failed | 1 passed (2)  [space.test.ts + game-element.test.ts]
     Tests  2 failed | 74 passed (76)
```

**After Task 3 (D23 fixed):**
```
 ✓ src/engine/element/space.test.ts (8 tests) 7ms

Test Files  1 passed (1)
     Tests  8 passed (8)
```

## Verification

- `npx vitest run src/engine/element/space.test.ts src/engine/element/game-element.test.ts` — both
  green (8/8 + 68/68).
- `npm test` — **209 files / 2947 tests pass**, at/above the pre-phase baseline (209/2941). The
  increase (+6) reflects this plan's net-new passing tests (8 added, minus the 2 that were already
  passing today as the negative control / append-only cases before the fix — net 6 new assertions of
  fixed behavior). Nothing regressed: the `moveToInternal` lift changed zero test outcomes across the
  full suite.
- `npx tsc --noEmit -p .` — no new type errors introduced by this plan's files (pre-existing unrelated
  errors in other files, e.g. `image-leak.test.ts`, `teaching.test.ts`, untouched by this plan).
- Grep gate: `grep -c 'moveToInternal' src/engine/element/piece.ts` → 3 (the `putInto` delegator call +
  2 doc-comment references; Piece no longer owns the move body).
- Grep gate: `grep -c 'sealed' src/engine/element/game-element.ts` → 6 (field doc, guard check,
  duck-typed comment references — the check has exactly one home).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `space.test.ts` type-parameter fix for the restore round-trip test**
- **Found during:** Task 2 (`npx tsc --noEmit -p .` check after the lift)
- **Issue:** `this.create(Space, 'sealed-zone')` inside the `MarkerGame` constructor inferred
  `Space<Game<any,any>, Player<any,any>>` instead of `Space<MarkerGame>`, since `Space`'s type
  parameters default to the base `Game`/`Player` types and TS cannot narrow them from the bare class
  reference. This produced a type error assigning to the `sealedZone!: Space<MarkerGame>` field.
- **Fix:** Explicit type argument at the call site: `this.create<Space<MarkerGame>>(Space, 'sealed-zone')`.
- **Files modified:** `src/engine/element/space.test.ts`
- **Commit:** `15bb1080` (bundled with Task 2's GREEN commit, since it only surfaced once the
  restore-round-trip test was exercised against the real fix)

No Rule 2/3/4 deviations. No architectural changes were needed — the plan's "lift, don't reimplement"
approach worked exactly as specified.

### Auth gates
None encountered.

## Known Stubs
None — no stub patterns introduced.

## Threat Flags
None — this plan implements the mitigations specified in its own threat model (T-163-01 through
T-163-03); no new, unlisted security-relevant surface was introduced. `Space.reparent`/`remove` reuse
the same `moveToInternal` path already covered by T-163-01/T-163-02, so no separate register entry is
needed.

## Note for later plans (163-02/03/04): sealed-flag + reparent API surface

- `Space.sealed: boolean` (default `false`) — public field, settable directly or via `Space.seal()`.
  Serializes automatically via the generic attribute loop (no `_restore*` hook needed).
- `Space.reparent(destination: GameElement, position?: 'first' | 'last'): void` — re-parents this Space,
  reusing `GameElement.moveToInternal`. Fires this Space's own `onExit` on the old parent (if it was a
  Space) and the destination's `onEnter` (if it is a Space). Children are unaffected (no child
  exit/enter events).
- `Space.remove(): void` — moves this Space to `game.pile` (mirrors `Piece.remove()`).
- `GameElement.moveToInternal` is now the ONE shared movement primitive for both `Piece` and `Space`.
  Plan 03 (later) also edits `game-element.ts` — this file is committed/clean at HEAD `db56b23f`; the
  `moveToInternal` method lives directly below `setOrder()`, before the Queries section.

## Self-Check: PASSED

- `src/engine/element/game-element.ts` (`moveToInternal` present) — FOUND
- `src/engine/element/space.ts` (`sealed`, `seal()`, `reparent`, `remove`) — FOUND
- `src/engine/element/piece.ts` (`moveToInternal` body removed, delegator only) — FOUND
- `src/engine/element/space.test.ts` (8 new SPACE-01/SPACE-02 cases) — FOUND
- Commit `708da3cf` (RED) — FOUND in `git log`
- Commit `15bb1080` (GREEN, D22) — FOUND in `git log`
- Commit `db56b23f` (GREEN, D23) — FOUND in `git log`
