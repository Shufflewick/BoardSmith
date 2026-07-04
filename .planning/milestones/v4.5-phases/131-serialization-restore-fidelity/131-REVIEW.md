---
phase: 131-serialization-restore-fidelity
reviewed: 2026-07-02T23:20:00Z
depth: standard
review_iteration: 2
files_reviewed: 24
files_reviewed_list:
  - docs/common-pitfalls.md
  - src/cli/commands/dev.ts
  - src/cli/dev-host/multiplayer-host.ts
  - src/engine/command/visibility.ts
  - src/engine/element/checkpoint-aliasing.test.ts
  - src/engine/element/game-element.ts
  - src/engine/element/game.ts
  - src/engine/element/handler-restore.test.ts
  - src/engine/element/piece.ts
  - src/engine/element/space.ts
  - src/engine/element/types.ts
  - src/engine/element/visible-attributes.test.ts
  - src/engine/element/zone-visibility-restore.test.ts
  - src/session/debug-data-gating.test.ts
  - src/session/game-session.ts
  - src/session/headless-session.ts
  - src/session/pending-action-manager.ts
  - src/session/player-state-visibility.test.ts
  - src/session/restore-snapshot-authoritative.test.ts
  - src/session/state-history.ts
  - src/session/stateless-ops.ts
  - src/session/teaching-disabled-persistence.test.ts
  - src/session/types.ts
  - src/session/utils.ts
findings:
  critical: 0
  warning: 0
  info: 4
  total: 4
status: clean
---

# Phase 131: Code Review Report

**Reviewed:** 2026-07-02 (iteration 2 — fix verification)
**Depth:** standard
**Files Reviewed:** 24
**Status:** clean (all Critical/Warning findings fixed; Info findings IN-01..04 remain open by design)

## Summary

Iteration 2 re-review of the Phase 131 fix loop (commits 1ffc119, 2442ec9, fec683b, e798e3b, 53bf43c, 3c86d9e, 1552088). All six prior findings (CR-01, CR-02, WR-01..04) are **verified resolved** — each fix was traced through code and confirmed by its regression tests, which pass along with the full engine/session/cli/runtime suites (1108 tests, 83 files). `npx tsc --noEmit` errors are confined to pre-existing test files untouched by the fixes.

Verification highlights:
- **CR-01** — the `visibleAttributes` whitelist is now hoisted above all three zone-visibility early-return branches (`game.ts:2774-2800`); `hidden`, `count-only`, and `owner` branches all spread the redacted `ownJson`. Spectators (`visibilityPosition === -1`) take the non-owner path everywhere. 4 regression tests cover each branch plus the owner-as-self case.
- **CR-02** — `Game.toJSON()` deep-copies `messages`/`settings` via `serializeValue` and copies `animationEvents`; `copyVisibilityState` (new, `visibility.ts:75`) is applied at all four visibility boundaries (`GameElement.toJSON`/`fromJSON`, `Space.toJSON`/`_restoreZoneVisibility`). On the adopt side, `loadSerializedState`'s reference assignment of `messages`/`settings` is genuinely de-aliased by `resolveElementReferences` — I confirmed neither key is in `Game.unserializableAttributes`, so `deserializeValue` rebuilds them into fresh structures (and re-resolves `__playerRef`/`__elementRef`, so `getFormattedMessages()` still works post-restore). The 5-test `checkpoint-aliasing.test.ts` suite deliberately avoids JSON round-trips, closing the masking gap called out in iteration 1. Side effect checked: serializing message `data` through `serializeValue` turns live Player refs into `__playerRef` tagged shapes — the UI only reads `msg.text`, and this actually *reduces* what a raw Player object used to leak over the wire.
- **WR-01** — `instanceof Player` replaced with the same `'seat' in element` duck-typing used by `serializeValue`/`currentPlayer`/`getPlayer` (`game.ts:2783-2786`).
- **WR-02** — re-binding key is now `${className}:${name}:${spaceOnlyIndexPath}`; the piece-shift cross-wire regression test fails pre-fix and passes post-fix. **However, a residual collision case survives the fix — see new WR-05 below (proven by repro).**
- **WR-03** — constraint documented on `Space.onEnter`/`onExit` JSDoc and as pitfall 21; dev-mode detached-destination detection added in `Piece.moveToInternal` (`piece.ts:90-104`) with correct `game.pile` exemption (pile has no parent, so the ancestor walk never fires on it); 2 tests cover no-warn-live and warn-after-restore.
- **WR-04** — `executeOp` gained a dedicated `hostOptions?: { teachingDisabled?: boolean }` 6th parameter; `hint`/`heatmapToggle`/`startTutorial` gate on it, never on `gameOptions`. `MultiplayerHost` no longer injects the flag into `startGameOptions`/`baseOptions` (so it cannot persist into `snapshot.gameOptions`); `dev.ts` forwards it. `headless-session.ts` omits `hostOptions` — correct, it exposes no teaching-lockout option, and the default is teaching-enabled. D-01 non-collision and no-leak tests present.

One **new Warning** (WR-05) was found in the WR-02 fix itself, proven with a standalone repro. It has since been **fixed** (commit `4185043`) — see its Resolution note below.

## Critical Issues

None remaining.

### CR-01: Zone-visibility early returns bypass SEC-02 `visibleAttributes` filtering for the container element itself — RESOLVED

**File:** `src/engine/element/game.ts:2746-2829` (as originally reported)
**Issue:** (iteration 1) The zone-visibility branches in `toJSONForPlayer`'s `filterElement` early-returned with the container's full, unfiltered attribute set, bypassing the SEC-02 whitelist for any Space combining `static visibleAttributes` with zone visibility.
**Resolution:** status: fixed, **VERIFIED (iteration 2)** — whitelist hoisted above the zone branches (`game.ts:2774-2800`); all three early returns spread `ownJson`. Verified for opponents AND spectators. 4 regression tests in `visible-attributes.test.ts` (hidden / count-only / owner-as-non-owner / owner-as-self) pass.

### CR-02: `Game.toJSON()` embeds live references — undo/rewind/time-travel silently fail to roll back `settings` and `messages` — RESOLVED

**File:** `src/engine/element/game.ts:2652-2686`, `src/engine/element/game-element.ts:793-798, 1027-1048`, `src/engine/element/space.ts:144-167`
**Issue:** (iteration 1) `toJSON()` emitted `messages`/`settings`/`_visibility`/`_zoneVisibility` by live reference; retained checkpoints aliased the live game, and live-path undo could never roll those fields back.
**Resolution:** status: fixed, **VERIFIED (iteration 2)** — emit side deep-copies (`serializeValue` for messages/settings, `copyVisibilityState` for visibility state, shallow-copied animation events); adopt side de-aliases (`copyVisibilityState` in `fromJSON`/`_restoreZoneVisibility`, `resolveElementReferences` rebuild of messages/settings — confirmed neither is in `unserializableAttributes` so the rebuild actually runs; nested de-aliasing proven by test 3 of `checkpoint-aliasing.test.ts`). All 5 aliasing tests pass with zero JSON round-trips, including live-path `undoToTurnStart` rollback of messages, settings and zone-visibility grants.

## Warnings

### WR-05 (NEW, iteration 2): Space-only handler key maps every non-Space ancestor to `-1`, silently cross-wiring same-name Spaces nested under Players or Pieces — RESOLVED

**File:** `src/engine/element/game.ts:2942-2951` (`spaceHandlerKey`), `src/engine/element/game.ts:2976-3002` (re-binding loop)
**Issue:** The WR-02 fix computes the index path over **Space siblings only**: `spaceSiblings.indexOf(el)` where `el` walks the ancestor chain. When an ancestor is NOT a Space (a Player or a Piece — both extend `GameElement` directly), `indexOf` returns `-1` for that level, and **every** non-Space ancestor at the same depth collapses to the same `-1` segment. Two same-class, same-name Spaces under different non-Space parents therefore produce **identical keys**, e.g. the natural per-player pattern:
```typescript
const h1 = this.getPlayer(1)!.create(Hand, 'hand'); // key: Hand:hand:-1/0
const h2 = this.getPlayer(2)!.create(Hand, 'hand'); // key: Hand:hand:-1/0  ← collision
```
At capture time `capturedHandlers.set` silently overwrites (last writer wins); at restore time BOTH matching Spaces receive the same (last-captured) handler object — and no `devWarn` fires, because every key "matches". **Proven by repro** (standalone script, seed `'s'`): after `GameRunner.fromSnapshot`, moving a card into player 1's hand fires **player 2's** onEnter handler (`p1Enter: 0, p2Enter: 1`; expected `1, 0`). This is the exact silent-wrong-game-logic failure WR-02 was meant to close, surviving through a different ancestor type. Note also that both restored Spaces share one live `_eventHandlers` object (`_restoreEventHandlers` assigns by reference), so a later `onEnter` on one would mutate the other.
**Fix:** Give non-Space ancestors a real discriminator instead of `-1`. Player elements never move, and a Space nested under a Piece moves *with* the piece (so no positional key is stable for it anyway). Two-part fix:
```typescript
// in spaceHandlerKey's ancestor walk:
if (el instanceof Space) {
  const spaceSiblings = el._t.parent._t.children.filter((c) => c instanceof Space);
  path.unshift(String(spaceSiblings.indexOf(el)));
} else {
  // Non-Space ancestor (Player/Piece): discriminate by class + name
  // (constructor-assigned, stable) rather than a positional index.
  path.unshift(`${el.constructor.name}[${el.name ?? ''}]`);
}
```
And fail loud on residual ambiguity: at capture time, if `capturedHandlers.has(key)`, `devWarn` that two handler-bearing Spaces have indistinguishable identities and that re-binding for that key is ambiguous (and skip re-binding it, rather than silently wiring both to one handler set). Add a regression test: two `player.create(Hand, 'hand')` spaces with per-player onEnter counters, snapshot, restore, assert each hand fires only its own handler.
**Resolution:** status: fixed (commit `4185043`) — `spaceHandlerKey` now discriminates Player ancestors by **seat** (the documented stable cross-restore identity; class+name alone would collide when `gameOptions.playerNames` supplies duplicate names, using the same `'seat' in el` duck-typing as WR-01) and other non-Space ancestors by `${constructor.name}[${name}]`. Note the reviewer's Space-under-Piece scenario cannot occur — `Piece.create` throws on Space creation (engine invariant), so only Players and direct `GameElement` subclasses can be non-Space ancestors. Fail-loud guards added on BOTH sides: capture-time duplicate keys `devWarn` (`ambiguous-event-handler-key:*`) and the key is dropped from re-binding entirely; a second restored Space matching an already-bound key also `devWarn`s (`ambiguous-event-handler-rebind:*`) and stays unbound. The shared-`_eventHandlers`-reference side note is also fixed: `_restoreEventHandlers` now copies the handler arrays into a fresh container. 4 regression tests in `handler-restore.test.ts`: per-player `Hand` cross-wire repro (dealing to player 1 fired player 2's handler pre-fix — RED confirmed, exactly matching the reviewer's repro counts — GREEN post-fix, both directions) plus a constructed-ambiguity test (two same-name `GameElement` boxes with same-name `Slot`s) asserting the devWarn fires and neither slot gets a possibly-wrong handler. Full suite green: 2135 tests, 168 files; `tsc --noEmit` clean for all modified files.

### WR-01: SEC-02 ownership check uses `element instanceof Player` — RESOLVED

**File:** `src/engine/element/game.ts:2783-2786`
**Resolution:** status: fixed, **VERIFIED (iteration 2)** — seat duck-typing in place, matching `serializeValue`/`currentPlayer`/`getPlayer`. Pitfall-4 owner/non-owner/spectator tests pass.

### WR-02: Handler re-binding key can silently cross-wire handlers between same-class Spaces when sibling indices shift — RESOLVED (with residual: see WR-05)

**File:** `src/engine/element/game.ts:2942-2951`, `src/engine/element/space.ts:316-333`
**Resolution:** status: fixed, **VERIFIED (iteration 2)** for the reported scenario — key is class name + element name + Space-only index path; the piece-before-two-buckets cross-wire regression test passes and fails pre-fix; devWarn strengthened to mention possible absorption by a same-keyed sibling. The residual non-Space-ancestor collision is tracked separately as WR-05.

### WR-03: Re-bound handler closures can act on the discarded pre-restore tree — RESOLVED

**File:** `src/engine/element/space.ts:246-289`, `src/engine/element/piece.ts:82-104`, `docs/common-pitfalls.md` (pitfall 21)
**Resolution:** status: fixed, **VERIFIED (iteration 2)** — JSDoc WRONG/RIGHT examples on `onEnter`/`onExit`, pitfall 21 with symptoms section, and dev-mode detached-destination detection in `moveToInternal` (ancestor-containment walk; `game.pile` correctly exempt because it has no parent). Both tests pass (no warn on live game; warn fires post-restore).

### WR-04: Stateless ops read `teachingDisabled` from `gameOptions`, contradicting D-01 — RESOLVED

**File:** `src/session/stateless-ops.ts:1019-1098`, `src/cli/dev-host/multiplayer-host.ts:93-113, 532-543`, `src/cli/commands/dev.ts:22, 525-527`
**Resolution:** status: fixed, **VERIFIED (iteration 2)** — dedicated `hostOptions` parameter; all three assist-op gates read it; `MultiplayerHost` keeps the flag out of both option bags so it cannot persist into `snapshot.gameOptions`; `dev.ts` forwards it; `headless-session.ts` correctly omits it (no lockout option exists there; default is teaching-enabled). D-01 non-collision and no-leak tests pass. The decision NOT to strip a game-defined `gameOptions.teachingDisabled` is correct per D-01.

## Info

(Unchanged from iteration 1 — Info items were not in scope for the fix loop and remain open.)

### IN-01: `buildPlayerState`'s `playerNames` parameter is dead

**File:** `src/session/utils.ts:219-224`
**Issue:** The `playerNames: string[]` parameter is never referenced in the function body (names come from the filtered view / `player.name`). Every caller threads it anyway, implying it affects output when it does not.
**Fix:** Remove the parameter (No-Backward-Compatibility rule) or actually use it as a name override for the `players` fallback entries.

### IN-02: Anonymized placeholder ID scheme can collide for large zones

**File:** `src/engine/element/game.ts:2821, 2848`
**Issue:** Hidden-zone child placeholders use `id: -(element._t.id * 1000 + i)`. A zone with ≥1000 hidden children overflows into the ID range of element `_t.id + 1`'s zone, producing duplicate negative IDs across containers in a single view.
**Fix:** Derive from a wider stride or a per-view counter.

### IN-03: A restored session can never re-enable `debugEnabled`

**File:** `src/session/game-session.ts:784-841`
**Issue:** `GameSession.restore()` has no `debugEnabled` parameter (defaults to `false`) — correct secure default, but asymmetric with `create()` and undocumented.
**Fix:** Document on `restore()`'s JSDoc if intentional; otherwise add an optional parameter defaulting to `false`.

### IN-04: 13-positional-parameter private constructor invites silent argument drift

**File:** `src/session/game-session.ts:326-340, 763, 839`
**Issue:** Several optional same-typed positional parameters; call sites pass `undefined, undefined` placeholders. Any future middle insertion would type-check while shifting semantics.
**Fix:** Collapse the tail into a single options object.

---

_Reviewed: 2026-07-02 (iteration 2)_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
