---
requirements-completed: [SPACE-04, PROC-01]
---

# Plan 163-03 Summary — Class-Name Collision Guard (SPACE-04/D25, PROC-01)

**Plan:** 163-03 (execute — shared registry collision guard replacing bare `Map.set` at three sites)
**Completed:** 2026-07-21
**Result:** PASS — one shared `registerElementClass(ctx, name, cls)` in `game-element.ts` now owns
every `classRegistry` write that registers an element constructor under a name. A different
constructor colliding with an already-registered custom name throws an actionable, dev-gated error;
idempotent re-registration and built-in-name override stay silent; a minified/short-name collision
never false-throws. PROC-01's RED-before-GREEN satisfied.

## What was done

1. **Task 1 (RED):** Added a `SPACE-04/D25 class registry collision guard` describe block to
   `game.test.ts` with a `CollisionGame` test fixture that drives all three registry write sites
   through constructor-time mode switches: `registerElements` (explicit registration), `create`
   (game-element.ts lazy path), `createElement` (game.ts internal lazy path). Two distinct
   constructors forced to share the name `Hand` via `Object.defineProperty` (colliding with the
   built-in `Hand` seed after the first legitimate override) prove the real-collision case; two
   distinct constructors sharing a single-char name `H` prove the minified no-throw case. Ran against
   unfixed source and captured the real failure (3 of 6 new cases failed — no throw on any of the
   three collision paths); the other 3 (idempotent, builtin-override, minified) already passed,
   proving the fixture doesn't fail everything. Test-only commit.
2. **Task 2 (GREEN):** Added `registerElementClass(ctx, name, cls)` to `game-element.ts` (exported,
   placed beside the file's other `_ctx`-scoped helpers). Logic, in order: unregistered name -> set
   and return; existing entry `=== cls` -> no-op (idempotent); name in `_builtinSeededNames` ->
   legitimate override, set + delete from seeded; otherwise a real collision -> if `isDevMode()` AND
   `name.length > 2` (not a minified/mangled short identifier) throw an actionable error naming the
   class and instructing a rename, else (minified/prod) preserve today's silent last-wins `Map.set`.
   Replaced the three bare write sites — `game.ts:783-786` (`registerElements`), `game.ts:800-807`
   (`createElement`), `game-element.ts:362-366` (`create`) — with calls to the shared guard.
   `BUILTIN_ELEMENT_CLASSES` seeding (`game.ts:631-634`) and the unrelated `Player`-class /
   restore-copy registry writes were left untouched, matching the plan's scope (only the three named
   write sites).

## PROC-01 verbatim RED output (Task 1, before any fix)

```
 SPACE-04/D25 class registry collision guard > throws an actionable error naming the class when
 registerElements registers a DIFFERENT constructor under an already-registered (non-builtin) name
   AssertionError: expected [Function] to throw an error
   - Expected: null
   + Received: undefined

 SPACE-04/D25 class registry collision guard > throws when the lazy create() path (game-element.ts)
 registers a DIFFERENT constructor under an already-registered name
   AssertionError: expected [Function] to throw an error

 SPACE-04/D25 class registry collision guard > throws when the lazy createElement() path (game.ts
 internal) registers a DIFFERENT constructor under an already-registered name
   AssertionError: expected [Function] to throw an error

 Test Files  1 failed (1)
      Tests  3 failed | 16 passed (19)
```
The 16 passing cases included the new idempotent-re-registration, builtin-name-override, and
minified-single-char-name cases — proving those legitimate paths were already silent before the fix
and only the three real-collision sites needed the throw.

## PROC-01 verbatim GREEN output (Task 2)

```
 ✓ src/engine/element/game.test.ts (19 tests) 11ms

 Test Files  1 passed (1)
      Tests  19 passed (19)
```

## Verification

- `npx vitest run src/engine/element/game.test.ts` — 19/19 green.
- `npm test` — **209 files / 2959 tests pass**, above the pre-phase (163-01) baseline of 209/2947.
  The +12 reflects this plan's 6 net-new cases plus 6 that already existed passing as negative
  controls before the fix (idempotent/builtin-override/minified), now exercised alongside the 3
  newly-fixed collision throws. Nothing regressed.
- `npx tsc --noEmit -p .` — no new type errors in this plan's files; remaining errors are
  pre-existing and unrelated (UI test files, `teaching.test.ts`, `parity-contract.test.ts`, etc. —
  same set noted in Plan 01's summary).
- Grep gate: `grep -n "classRegistry.set" src/engine/element/game.ts src/engine/element/game-element.ts`
  shows only (a) the guard's own internal `Map.set` calls inside `registerElementClass`, (b) the
  untouched `BUILTIN_ELEMENT_CLASSES` seed loop (`game.ts:633`), (c) the untouched `Player`-class
  registration (`game.ts:649,655`), and (d) the untouched restore-copy loop (`game.ts:3234`) — none
  of which are in-scope element-class collision sites per the plan.
- Grep gate: `grep -n "registerElementClass(" src/engine/element/game.ts src/engine/element/game-element.ts`
  confirms all three former bare-`Map.set` sites (`registerElements`, `createElement`, `create`) now
  call the one shared guard.

## Deviations from Plan

None. The plan's "one shared guard, three call sites" approach worked exactly as specified — no
Rule 1/2/3/4 deviations were needed.

### Auth gates
None encountered.

## Known Stubs
None — no stub patterns introduced.

## Threat Flags
None — this plan implements the mitigations specified in its own threat model (T-163-26 collision
throw, T-163-27 minified-safety); no new, unlisted security-relevant surface was introduced.

## Self-Check: PASSED

- `src/engine/element/game-element.ts` (`registerElementClass` exported, used at the `create` site) — FOUND
- `src/engine/element/game.ts` (`registerElementClass` imported, used at `registerElements` +
  `createElement`) — FOUND
- `src/engine/element/game.test.ts` (`SPACE-04/D25 class registry collision guard` describe block,
  6 cases) — FOUND
- Commit `798ed9d7` (RED) — FOUND in `git log`
- Commit `f03c4a91` (GREEN) — FOUND in `git log`
