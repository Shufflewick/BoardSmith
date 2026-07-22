# Phase 163: Engine Space Lifecycle & Element Integrity - Context

**Gathered:** 2026-07-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Close five engine `Space`/element structural defects (D22–D26): a sealed/append-only Space whose
`onExit` survives restore, Space removal/re-parenting, no hidden-child-count leak, no silent
class-name-collision rename, and no `availableActions`/`actionMetadata` divergence that strands the
board.

IN SCOPE: `src/engine/element/{space,piece,game-element,game,action-metadata}.ts`, and (defensively)
`src/ui/composables/useActionController.ts:1335` for D26. Net-new tests in `src/engine/element/*.test.ts`.

OUT OF SCOPE: removing per-game workarounds (Phase 169), and any broader element-model redesign.
</domain>

<decisions>
## Implementation Decisions

### D22/SPACE-01 — Sealed / append-only Space
- Add a `sealed`/append-only flag on `Space` (`space.ts:61` area). A sealed Space **rejects a Piece
  removal** — `Piece.moveToInternal`'s old-parent removal (`piece.ts:133-152`) throws an ACTIONABLE
  error BEFORE the `splice`, so a rejected removal leaves `_t.children`/`_t.parent` untouched (no
  corrupt-on-reject). **Adding is allowed** (append-only).
- Restore (`game.ts:3124-3132`) bypasses the check by design — restore is not a logical exit;
  `onExit` effects are already in the serialized state, and handlers are re-attached (`game.ts:3103,
  3157`). Add a test asserting a sealed Space's state + onExit-effects survive a restore round-trip.

### D23/SPACE-02 — Space removal / re-parent
- Add a remove/re-parent capability to `Space` (a `Space.remove()`/reparent method, or lift `putInto`
  to `GameElement`) reusing `Piece.moveToInternal`'s splice + enter + exit machinery
  (`piece.ts:81-168`) and its existing cycle guards (`piece.ts:88-104`).
- **Removing/re-parenting a Space fires its own `onExit`** on the parent it leaves (a logical exit);
  its children go with it (their parent — the moved Space — is unchanged, so no child exit events).
- A sealed Space still can't have its Pieces removed (D22), but the Space ITSELF can be re-parented
  unless separately sealed against that — keep D22's seal about child removal, D23 about the Space's
  own relocation.

### D24/SPACE-03 — Hidden Space child-count leak
- In the hidden branch (`game.ts:2867-2901`), gate emission of `childCount`/`hiddenChildren` on the
  mode: **`'hidden'` emits NEITHER `childCount` nor per-child placeholders** (true concealment);
  **`'count-only'` keeps the count** (that is its defined purpose). Also fix the count-only leaf branch
  (`game.ts:2772`) consistently.
- The `concealFromEverySeat` "smell" is games hiding each child individually to fake concealment
  (no such engine symbol exists) — the `'hidden'` mode now makes that workaround unnecessary.

### D25/SPACE-04 — Class-name collision (Hand → Hand2)
- On registering a DIFFERENT constructor under an already-registered name (`registerElements`
  `game.ts:783-786`; lazy paths `game.ts:800-807`, `game-element.ts:362-366`), **throw an actionable
  error** naming the colliding class and telling the designer to rename it — NEVER silently overwrite
  (today `Map.set` clobbers).
- **Dev-mode only**: gate the collision check to non-minified/dev builds (e.g. `import.meta.env.DEV`
  and/or skip single-char/minified-looking names) so a legitimately name-collapsed MINIFIED production
  bundle does not false-throw. The designer sees the collision during development; prod is unaffected.
- Registering the SAME constructor again (idempotent re-registration) is fine — only a
  different-constructor-same-name collision throws.

### D26/SPACE-05 — availableActions vs actionMetadata divergence
- **Single source of truth**: derive `availableActions` from the SAME condition-checked set
  `buildActionMetadata` (`action-metadata.ts:27`, drops unknown at `:44` / condition-false at `:52-53`)
  produces — so an action whose condition is now false is dropped from BOTH, and metadata can never be
  a strict subset that strands the panel. Reconcile in `buildPlayerState`/`getActionSpace`
  (`game.ts:1059-1064`).
- **Defense-in-depth**: downgrade `useActionController.ts:1335`'s `No metadata for action` THROW to a
  no-op / resync (log + skip), so even a transient divergence can never strand the board with a thrown
  error.

### Test & Verification Strategy (PROC-01)
- **D22**: sealed Space rejects a Piece removal (throws, tree untouched) + a sealed-state-survives-
  restore case. Home: `space.test.ts`.
- **D23**: a Space is removed/re-parented, its onExit fires on the old parent, children move with it.
  `space.test.ts`.
- **D24**: a `'hidden'` Space's `toJSONForPlayer` emits NO `childCount`/placeholders; `'count-only'`
  still does. `zone-visibility-restore.test.ts` / `deck-hand-visibility.test.ts`.
- **D25**: registering two different classes named `Hand` throws (dev) with an actionable message;
  same-constructor re-register is fine; a minified-name case does NOT throw. `game.test.ts` / new
  registry test.
- **D26**: an action in availableActions whose condition is now false → dropped from availableActions
  too (no divergence), and the UI no-op path proven. `action-metadata.test.ts`.

### Claude's Discretion
- The exact flag name/shape for a sealed Space and the remove/reparent method name.
- The exact minified-name heuristic for D25 (import.meta.env.DEV vs a name-length/pattern check) —
  provided a real collision throws in dev and a minified bundle does not false-throw.
- Whether D26 reconciles by having `buildActionMetadata` return the authoritative set that
  availableActions is derived from, or by filtering availableActions through the same condition check —
  provided the two cannot diverge.

</decisions>

<code_context>
## Existing Code Insights (from scout — trust these loci)
- D22: Space `space.ts:61`; onExit `:284`; `Piece.moveToInternal` `piece.ts:81`, old-parent splice
  `:133-147`, `triggerEvent('exit')` `:150-152`; restore rebuild `game.ts:3124-3132`.
- D23: `GameElement.addChild` `game-element.ts:393-401`, `removeChild` (protected) `:406-412`; only
  Piece has putInto/remove (`piece.ts:74,186`); Space has none.
- D24: `toJSONForPlayer` `game.ts:2753`; `childCount` leaks at `:2772` (count-only leaf) and `:2900`
  (hidden/count-only container); anonymized ids `:2878-2892`; Phase-159 `hiddenIdRemap` `:2879-2885`.
- D25: registry `game.ts:631-634` (builtins), `registerElements` `:783-786`, lazy `:800-807` +
  `game-element.ts:362-366`. NO existing Hand2/dedup logic — collisions silently `Map.set`.
- D26: availableActions `game.ts:1059` (`availableActionsForSeat`); metadata `game.ts:1062`
  (`buildActionMetadata`, `action-metadata.ts:27`, drops at `:44`/`:52-53`); throw
  `useActionController.ts:1335`.
- Phase 159 already changed `toJSONForPlayer` (hiddenIdRemap for flow-var relink) — D24 builds on that
  surface; don't regress the negative-id anonymization or the redaction tests.

</code_context>

<specifics>
## Specific Ideas
- D22/D24/D25 Seven; D23 Doom; D26 Lanternfall. All engine-layer; Phase 169 removes game workarounds.
- D26's "No metadata" strands the board — the RED should reproduce an action offered in
  availableActions but dropped from metadata (condition-false) and prove the board isn't stranded.
- D24 must not regress Phase 159's redaction (negative ids, __hidden, hiddenIdRemap) — only suppress
  the COUNT for `'hidden'`.

</specifics>

<deferred>
## Deferred Ideas
- Removing per-game concealFromEverySeat-style workarounds — Phase 169.
- A broader element-model / slot redesign — out of scope; D23 adds remove/reparent, not a redesign.

</deferred>
