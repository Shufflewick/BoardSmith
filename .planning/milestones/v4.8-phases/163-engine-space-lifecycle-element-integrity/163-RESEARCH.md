# Phase 163: Engine Space Lifecycle & Element Integrity - Research

**Researched:** 2026-07-21
**Confidence:** HIGH (all five loci pinned via codebase scout — see 163-CONTEXT.md code_context)

## Summary

Five engine Space/element defects, each with an exact locus (see CONTEXT `<code_context>`). D22 (sealed
Space) + D23 (Space remove/reparent) share `piece.ts`/`space.ts` movement machinery. D24 (hidden count)
is `game.ts` serializer. D25 (name collision) is the `game.ts` registry. D26 (actions/metadata) spans
`game.ts` + `action-metadata.ts` + a UI defensive no-op.

## Fix loci (verbatim from scout)
- **D22:** `sealed` flag on Space (`space.ts:61`); enforce in `Piece.moveToInternal` old-parent removal
  (`piece.ts:133-152`) — throw BEFORE splice. Restore (`game.ts:3124`) bypasses by design.
- **D23:** add Space remove/reparent reusing `moveToInternal` (`piece.ts:81-168`) + cycle guards
  (`piece.ts:88-104`); Space's own onExit fires on old parent.
- **D24:** hidden branch `game.ts:2867-2901` + count-only leaf `:2772` — gate `childCount`/placeholders
  on `mode !== 'hidden'`.
- **D25:** `registerElements` `game.ts:783-786` + lazy `game.ts:800-807`, `game-element.ts:362-366` —
  throw on different-constructor-same-name, dev-mode-gated.
- **D26:** derive availableActions from the condition-checked `buildActionMetadata` set
  (`game.ts:1059-1064`, `action-metadata.ts:27/:44/:52-53`); downgrade `useActionController.ts:1335`
  throw → no-op.

## Pitfalls
- D22: reject BEFORE the splice (no corrupt-on-reject); restore must still bypass (not a logical exit).
- D24: do NOT regress Phase 159's redaction (negative ids `game.ts:2878-2892`, `__hidden`,
  hiddenIdRemap) — suppress only the COUNT for `'hidden'`. `deck-hand-visibility.test.ts`,
  `image-leak.test.ts`, `zone-visibility-restore.test.ts` must stay green.
- D25: minified prod bundles collapse names — the collision throw MUST be dev-gated to avoid a
  false-positive in production; idempotent same-constructor re-registration must NOT throw.
- D26: an action whose condition is now false should be dropped from BOTH sets (it's genuinely
  unavailable) — don't just paper the throw; fix the divergence at source.

## Validation Architecture

| Req | Defect | Layer | Validation | File |
|-----|--------|-------|-----------|------|
| SPACE-01 | D22 | engine | RED: a Piece removal from a sealed Space throws + leaves tree untouched; sealed state+onExit-effects survive restore. | `space.test.ts` |
| SPACE-02 | D23 | engine | RED: a Space cannot be removed/reparented pre-fix; post-fix it can, onExit fires on old parent, children move with it. | `space.test.ts` |
| SPACE-03 | D24 | engine serializer | RED: a `'hidden'` Space's toJSONForPlayer emits NO childCount/placeholders (pre-fix leaks count); `'count-only'` still shows count; Phase-159 redaction intact. | `deck-hand-visibility.test.ts` / `zone-visibility-restore.test.ts` |
| SPACE-04 | D25 | engine registry | RED: two different classes named `Hand` → throw actionable (dev); same-constructor re-register fine; minified-name no-throw. | `game.test.ts` / new registry test |
| SPACE-05 | D26 | engine + UI | RED: an action in availableActions with a now-false condition is dropped from BOTH (no divergence); the UI no-op path proven (no "No metadata" throw stranding the board). | `action-metadata.test.ts` |
| PROC-01 | — | process | Each: fix + RED on pre-fix + adversarial before close. | git RED→GREEN |

### Wave 0 gaps
- No sealed-Space, Space-reparent, hidden-count-suppression, name-collision, or actions-divergence test
  exists — all net-new.
