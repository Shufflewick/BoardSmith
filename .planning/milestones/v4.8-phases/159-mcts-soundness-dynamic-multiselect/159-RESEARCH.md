# Phase 159: MCTS Soundness + Dynamic multiSelect - Research

**Researched:** 2026-07-20
**Confidence:** HIGH (both defects root-caused via codebase scout)

## Summary

Two AI defects. AI-01 is a shared root cause (function-valued `multiSelect` dropped in enumeration AND
metadata). AI-02 is a clone-source bug (`toJSON` full truth instead of `toJSONForPlayer` redacted) plus
a simultaneous-step sequentialization bug. Redaction already exists — reuse it.

## AI-01 — Dynamic multiSelect (D9, delivers C.2)

- Skip site (enumeration): `enumerate-moves.ts:190-206` — `typeof multiSelect === 'function'` → devWarn
  + skip (optional → skip pick; required → `[]` combos → action contributes no moves → root can throw
  "No available moves" `mcts-bot.ts:217`).
- Omission site (metadata): `buildPickMetadata` (`action-metadata.ts:148-158` choice, `:202-212`
  elements) emits `base.multiSelect` only when NOT a function → panel `sel.multiSelect` undefined →
  `ActionPanel.vue:901` checkbox branch skipped → single-select fallback.
- Static path (works): `parseMultiSelect` (`:98`) + `generateCombinations` (`:115`) +
  `combinationsOfSize` (`:136`). Function CHOICES already resolve via `getSelectionChoices`
  (`_getChoices` `:237-247`).
- Builder shapes: `chooseFrom` (`action-builder.ts:212-270`), `chooseElements` (`:400-489`);
  `multiSelect?: number | MultiSelectConfig | ((ctx)=>…)` (`:244`,`:448`); `MultiSelectConfig`
  (`types.ts:114`).
- **Fix**: a shared `resolveMultiSelect(selection, ctx)` → concrete `{min,max}` | undefined | (throw).
  Call from both skip site and both metadata sites. Concrete → existing combination machinery + emit
  metadata; undefined → single-select; throw → fail loud. Remove the silent-skip devWarn.

## AI-02 — MCTS redacted-view soundness (D8)

- Clone source: `createSnapshot` (`snapshot.ts:173`) uses `state: game.toJSON()` (`:184`) — FULL truth.
  Called by bot `captureSnapshot` (`mcts-bot.ts:1066`). Redacted analogue `toJSONForPlayer` exists
  (`game.ts:2738`, used at `snapshot.ts:261`).
- Restore: `restoreGame` (`mcts-bot.ts:1088-1121`) → `loadSerializedState` (STATE-AUTHORITATIVE, no
  replay).
- Simultaneous sequentialization: `enumerateMovesForSimulation` (`:865-872`),
  `getCurrentPlayerFromFlowState` (`:901-908`) pick one `awaitingPlayers` seat at a time on a
  fully-visible clone → later co-decider sees earlier pick.
- **Fix**: bot clones from `toJSONForPlayer(botSeat)` (redacted); correct the simultaneous loop so
  co-deciders don't leak picks. **CAUTION**: `createSnapshot` has non-bot callers — add a per-seat
  option or a bot-specific redacted snapshot path; do NOT change `createSnapshot`'s default for all
  callers.

## Pitfalls

- Do NOT invent redaction — reuse `toJSONForPlayer(seat)`.
- The 1-move short-circuit (`mcts-bot.ts:224-226`) bypasses cloning — clone/redaction tests need ≥2
  moves.
- `restoreGame` is no-replay/state-authoritative — a redacted clone must still restore into a valid
  playable game (redacted-unknown elements must round-trip through `loadSerializedState`). Verify the
  redacted view is restorable, not just serializable.
- Don't break non-bot `createSnapshot` consumers.

## Validation Architecture

| Req | Defect | Layer | Validation | File |
|-----|--------|-------|-----------|------|
| AI-01 | D9 | engine enumeration | RED: function-valued multiSelect throws "No available moves"/skips pre-fix; post-fix enumerates multi-element combos. | `src/ai/mcts-multiselect.test.ts` / `enumerate-moves.test.ts` |
| AI-01 | D9/C.2 | metadata + panel | RED: `buildPickMetadata` omits multiSelect for the function form pre-fix; post-fix emits resolved `{min,max}` so the panel completes it (no single-select fallback). | `action-metadata` test + panel/controller test |
| AI-01 | D9 | fail-loud | A multiSelect resolver that THROWS fails loud (actionable), never silently skips. | enumeration test |
| AI-02 | D8 | AI clone | RED: the bot's clone exposes another seat's hidden attrs pre-fix; post-fix derives from `toJSONForPlayer` and does not. ≥2 moves. | `src/ai/mcts-redaction.test.ts` |
| AI-02 | D8 | exploitability | A scenario exploitable with the naive bot (move betrays hidden knowledge) is non-exploitable after. | `mcts-redaction.test.ts` |
| AI-02 | D8 | simultaneous | Co-deciders in one simultaneous step don't see each other's picks. | `mcts-bot` sim test |
| PROC-01 | — | process | Each: fix + RED proven on pre-fix + adversarial before close. | git RED→GREEN |

### Wave 0 gaps
- No test drives a function-valued multiSelect through enumeration OR the panel — net-new.
- No test asserts the bot's clone redaction — net-new; must use ≥2 moves.
- Restorability of a redacted clone through `loadSerializedState` is unverified — add a guard test.
