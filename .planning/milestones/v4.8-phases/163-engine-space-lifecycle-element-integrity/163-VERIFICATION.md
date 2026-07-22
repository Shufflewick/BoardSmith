---
phase: 163-engine-space-lifecycle-element-integrity
verified: 2026-07-21T14:10:00Z
status: passed
score: 6/6 must-haves verified
overrides_applied: 0
---

# Phase 163: Engine Space Lifecycle & Element Integrity Verification Report

**Phase Goal:** The `Space`/element subsystem's structural gaps are closed — a sealed/append-only Space
whose `onExit` survives restore, Space removal/re-parenting, no hidden-child-count leak, no silent
class-name-collision rename, and no `availableActions`/`actionMetadata` divergence that strands the
board.
**Verified:** 2026-07-21
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Sealed/append-only Space; onExit not bypassed on restore; no corrupt-on-reject (D22) | VERIFIED | `game-element.ts:492-599` — the sealed check (`:548-554`) runs immediately after `oldParent` is captured and strictly BEFORE the splice (`:557-560`); a thrown error leaves `_t.children`/`_t.parent` untouched. `space.ts:117,123` — `sealed` is a plain (non-`_`-prefixed) field, rides the generic attribute-serialization loop, no dedicated restore hook needed. `game.ts` restore (`fromJSON`, `:3135-3143`) rebuilds children directly via array push, never via `moveToInternal` — by design the seal check doesn't apply to restore (not a logical exit), matching the CONTEXT decision. `space.test.ts` (8 cases, all pass) covers sealed-rejection-throws-tree-untouched, sealed-state-survives-restore round trip, and negative control. |
| 2 | Space can be removed/re-parented (D23) | VERIFIED | `space.ts:146` `reparent()`, `:155` `remove()` — both delegate to inherited `GameElement.moveToInternal` (no reimplementation of splice/exit/enter). Doc comment at `:140-145` confirms sealed fences child removal, not the Space's own relocation (grandparent is `oldParent` when the sealed Space itself moves, so the D22 guard is correctly inert there). `space.test.ts` re-parent cases (own onExit fires once on old parent, children ride along with no child exit events, sealed-Space-still-relocatable) all pass. |
| 3 | Hidden Space no longer leaks child count (D24) | VERIFIED | `game.ts:2861-2879` — `'hidden'` branch destructures `children` out of `ownJson` and returns `concealedJson` with NEITHER `childCount` nor `children` key (not `childCount: 0`, actually absent per `'in'` operator per test assertions). `'count-only'` branch (`:2880-2915`, unchanged) still emits `childCount` + anonymized placeholders + populates `idRemap`. `deck-hand-visibility.test.ts`, `zone-visibility-restore.test.ts`, `image-leak.test.ts`, `visible-attributes.test.ts` all assert `'childCount' in x === false` and `'children' in x === false` for `'hidden'` mode. |
| 4 | Class-name collision surfaced, not silently renamed (D25) | VERIFIED | `game-element.ts:51-90` `registerElementClass()` — unregistered name → set; same constructor → no-op (idempotent); builtin-seeded name → legitimate override, silent; real collision (different constructor, already-registered custom name) → throws IFF `isDevMode()` AND `name.length > 2` (minified-name guard, `MINIFIED_NAME_MAX_LENGTH = 2`); else falls through to silent last-wins `Map.set` (prod/minified safety). All three former bare `Map.set` write sites (`registerElements` game.ts:783-786-area, `createElement` game.ts lazy path, `create` game-element.ts:362-366-area) now route through this one guard (confirmed via grep gate in SUMMARY, spot-checked at `game-element.ts:426`). `game.test.ts` 19/19 pass including the 6-case SPACE-04/D25 describe block (real collision throws, idempotent re-register doesn't, minified `H`-name doesn't). |
| 5 | availableActions/actionMetadata cannot diverge (D26) | VERIFIED | `src/session/utils.ts:515-523` — for a real seat (`playerPosition > 0`) with metadata requested, `actionMetadata` is built FIRST via `buildActionMetadata` (condition-checked), then `reconciledAvailableActions = Object.keys(actionMetadata)` — `availableActions` is DERIVED from metadata's keys, not the raw flow snapshot. `useActionController.ts:1332-1344` — the former hard-throw `"No metadata for action"` is now a `devWarn` + benign no-op (`"not ready to start yet"`), confirmed a true no-op (doesn't strand `currentAction.value`/panel state). `action-metadata.test.ts` 11/11 pass including the divergence case (condition flips false mid-step, both sets drop the action) and `useActionController.test.ts` 105/105 pass with the updated no-throw assertion. |
| 6 | Each item closed via fix + regression test + adversarial verify (PROC-01) | VERIFIED | 4 genuine RED commits confirmed in `git log`: `708da3cf` (163-01, test-only, SPACE-01/02), `f31c8b44` (163-02, test-only, SPACE-03), `798ed9d7` (163-03, test-only, SPACE-04), `8d3d1aa3` (163-04, test-only, SPACE-05). Each SUMMARY documents verbatim RED failure output (captured against unfixed source) followed by verbatim GREEN output. 163-04 additionally documents an auto-fixed RED-test bug (`.condition()` API misuse masking the real defect) with a re-verified TRUE RED before the fix landed — genuine adversarial rigor, not rubber-stamped. |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/engine/element/game-element.ts` | `moveToInternal` (shared move primitive) + `registerElementClass` | VERIFIED | Both present, substantive, wired (used by Piece and Space, and by all 3 registry write sites) |
| `src/engine/element/space.ts` | `sealed`, `seal()`, `reparent()`, `remove()` | VERIFIED | All present, delegate to `moveToInternal`, no reimplementation |
| `src/engine/element/piece.ts` | `moveToInternal` body removed, delegator only | VERIFIED | Confirmed via SUMMARY grep gate (3 refs: delegator call + 2 doc comments) |
| `src/engine/element/game.ts` | `'hidden'` mode split from `'count-only'`; registry sites use shared guard | VERIFIED | `:2861-2879` hidden branch, `:2880-2915` count-only branch unchanged; registry write sites route through `registerElementClass` |
| `src/session/utils.ts` | `availableActions` derived from `actionMetadata` keys | VERIFIED | `:515-523`, confirmed by direct read |
| `src/ui/composables/useActionController.ts` | no-metadata throw downgraded to no-op | VERIFIED | `:1340`, confirmed by direct read |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `Piece.putInto`/`remove` | `GameElement.moveToInternal` | inherited method call | WIRED | No override in `piece.ts`, delegates to shared parent method |
| `Space.reparent`/`remove` | `GameElement.moveToInternal` | inherited method call | WIRED | `space.ts:146,155` |
| `buildPlayerState` | `buildActionMetadata` | `reconciledAvailableActions = Object.keys(actionMetadata)` | WIRED | `utils.ts:520-521` |
| `registerElements`/`createElement`/`create` | `registerElementClass` | shared guard call | WIRED | Confirmed at `game-element.ts:426` and via SUMMARY grep gates |

### Check A — moveToInternal Lift Correctness

VERIFIED. `game-element.ts:492-599` reads as a literal relocation of the former `Piece.moveToInternal`
body: cycle guards (`:500-515`) → dev detached-destination warn (`:525-539`) → capture `oldParent`
(`:541`) → **new** D22 sealed check (`:548-554`, inserted, not reordering existing logic) → splice out
(`:556-571`) → duck-typed exit-event trigger (`:573-581`) → attach to new parent (`:584-592`) →
duck-typed enter-event trigger (`:594-598`). The `instanceof Space` → duck-typed conversion
(`typeof x.triggerEvent === 'function'`) mirrors the pre-existing pattern used elsewhere in the file
(`getParentZoneVisibility`), avoiding a circular import without changing behavior — both `Piece`'s old
path and `Space`'s new path fire `triggerEvent` identically when the endpoint is a Space, and are
silently skipped when it's not (same as `instanceof` would gate). Full suite green at 2959/2959, and
163-01's SUMMARY documents an intermediate run (`space.test.ts` + `game-element.test.ts`, 76/76) that
isolates the lift's correctness before the rest of the phase's changes landed. No behavior change to
movement is evident.

### Check B — Phase 159 Redaction Not Weakened

VERIFIED — not weakened. Diffed all three touched test files (`image-leak.test.ts`,
`visible-attributes.test.ts`, `mcts-redaction.test.ts`) between the RED commit and the GREEN commit
directly:
- `mcts-redaction.test.ts`: the CR-02 flow-variable-relink fixture switched from `contentsHidden()` to
  `contentsCountOnly()`. This is correct, not a weakening — D24 makes `'hidden'` emit zero placeholders,
  so `idRemap` is never populated for it; there is nothing left to relink to on that path. `count-only`
  still anonymizes children to synthetic ids and populates `idRemap` exactly as it did pre-163, so the
  CR-02 regression coverage is preserved on a mode where it remains meaningful.
- `image-leak.test.ts`: the SEC-01 "hidden deck child: $images.face redacted" test was rewritten to
  assert full concealment (no `childCount`/`children` key at all) — a STRICTLY STRONGER guarantee than
  the original per-placeholder redaction (a non-owner can no longer learn a card exists at all, let
  alone its face art). The SEC-02 mixed-deck $-key sanitization case moved to `contentsCountOnly()`
  (the `redactHiddenElementAttrs` machinery it actually exercises still has a placeholder to run
  against under count-only). Two cross-surface sweep assertions (`collectAllHiddenAttrs`,
  `collectHiddenIds`) dropped their `>=3` floor to `>=2`, with each drop attributable exactly to the
  `'hidden'` deck fixture now contributing zero nodes by design (verified: the fixture is still present
  in the test, just correctly produces nothing) — not to removed coverage of the hand/count-only
  surfaces, which remain asserted.
- `visible-attributes.test.ts`: `contentsHidden()` container test updated from
  `expect(boardJson.childCount).toBe(1)` to `expect('childCount' in boardJson).toBe(false)` —
  correctly reflects the new true-concealment contract.

No assertion was deleted without a stronger or equivalent replacement; the negative-id anonymization,
`__hidden` marking, and `hiddenIdRemap` relinking mechanisms remain genuinely tested via `'count-only'`
mode, and `'hidden'` mode gained a stronger no-leak guarantee. No gap found.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| SPACE-01 (D22) | 163-01 | Sealed/append-only Space | SATISFIED | See Truth 1 |
| SPACE-02 (D23) | 163-01 | Space removal/re-parent | SATISFIED | See Truth 2 |
| SPACE-03 (D24) | 163-02 | Hidden Space child-count leak | SATISFIED | See Truth 3 |
| SPACE-04 (D25) | 163-03 | Class-name collision guard | SATISFIED | See Truth 4 |
| SPACE-05 (D26) | 163-04 | availableActions/actionMetadata divergence | SATISFIED | See Truth 5 |
| PROC-01 | all | Fix + test + adversarial verify discipline | SATISFIED | See Truth 6 |

No orphaned requirements — all six phase requirements are claimed and evidenced across the 4 plans.

### Anti-Patterns Found

None. No TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER markers found in the touched production files
(`game-element.ts`, `space.ts`, `piece.ts`, `game.ts`, `utils.ts`, `useActionController.ts`). No
stub-shaped returns (`return null`/`{}`/`[]`) introduced by this phase's diffs.

### Test Suite

`npm test` run directly by verifier: **209 files / 2959 tests, all passing** — matches the expected
target and 163-04's final SUMMARY count exactly. No skipped/pending tests observed in the run.

### Human Verification Required

None. All six success criteria are structurally verifiable via direct code inspection + test execution;
no UI/visual/real-time behavior is in scope for this engine-layer phase.

### Gaps Summary

None. All 6 roadmap success criteria verified against actual shipped code (not SUMMARY claims), all 4
RED commits confirmed genuine (test-only, pre-fix failures documented and independently plausible), the
`moveToInternal` lift is a literal relocation with no behavioral drift, and Phase 159's redaction
mechanism is intact and in some respects strengthened, not weakened, by the D24 change.

---

_Verified: 2026-07-21_
_Verifier: Claude (gsd-verifier)_
