# Phase 159: MCTS Soundness + Dynamic multiSelect - Context

**Gathered:** 2026-07-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Unblock and make sound the AI opponents by closing two defects:
- **AI-01 (D9, delivers feature C.2):** function-valued / dynamic `multiSelect` must ENUMERATE in
  MCTS (no "No available moves" throw, no silent skip) AND complete natively through the action-panel
  auto-UI (no single-select fallback). Shared root cause: function-valued `multiSelect` is dropped in
  both the enumeration core and `buildPickMetadata`.
- **AI-02 (D8):** the MCTS bot must clone only a per-seat REDACTED view (`toJSONForPlayer`) instead of
  the full un-redacted truth (`toJSON`), and must not sequentialize simultaneous reveals (a later
  co-decider seeing an earlier one's pick within the same simultaneous step).

IN SCOPE: `src/engine/utils/enumerate-moves.ts`, `src/engine/element/action-metadata.ts`
(`buildPickMetadata`), a shared multiSelect resolver, `src/engine/utils/snapshot.ts` (`createSnapshot`
redaction), `src/ai/mcts-bot.ts` (clone source + simultaneous-step enumeration), and net-new AI/engine
tests.

OUT OF SCOPE: **full determinization** (sampling plausible hidden worlds + multi-world MCTS) — that is
an AI-strength feature, deferred. The bar here is SOUNDNESS (non-exploitable), not stronger play.
Also out: removing per-game AI workarounds (Phase 169), and the excluded checkers-dependent test.
</domain>

<decisions>
## Implementation Decisions

### multiSelect Resolution (AI-01 / C.2)
- Introduce **one shared engine helper** `resolveMultiSelect(selection, ctx)` (name at Claude's
  discretion) that evaluates a function-valued `multiSelect` to a concrete `{min, max}` config, and is
  called by BOTH `enumerate-moves.ts` (`:190-206`) and `buildPickMetadata`
  (`action-metadata.ts:148-158` choice / `:202-212` elements). Single source of truth — MCTS and the
  panel must never disagree on whether a selection is multi-select.
- The function receives the **same ctx as function-valued choices** (the `getSelectionChoices` context:
  game / player / currentArgs). Parity with the already-working function-valued *choices* path.
- **Fail-loud semantics (roadmap SC3):**
  - Resolves to a **concrete config** → enumerate combinations (reuse `parseMultiSelect` +
    `generateCombinations`) AND emit `base.multiSelect` in the pick metadata so the panel widget
    engages.
  - Returns **`undefined`** → legitimately "not a multiSelect in this state" → degrade to single-select
    (this is valid, not an error).
  - **Throws** → fail loud with an actionable error; NEVER silently skip. The old
    "cannot be statically enumerated → skipped" devWarn path is removed.
- Panel + MCTS engage off the **same resolved metadata**; no single-select fallback for a selection
  that resolves to a concrete multiSelect config.

### MCTS Hidden-Info Approach (AI-02)
- **Redact-only soundness** (NOT determinization). The bot clones `game.toJSONForPlayer(botSeat)` in
  `createSnapshot`/`captureSnapshot` so it never sees opponents' hidden info. This meets SC2's bar
  ("non-exploitable where the naive bot was").
- Hidden elements clone in their **redacted form**; the bot treats them as fixed unknowns and does NOT
  fabricate/guess hidden state.
- Determinization (sampling plausible hidden worlds, multi-world search) is explicitly **deferred** to a
  future AI-strength feature.

### Simultaneous-Reveal Soundness (AI-02)
- In a simultaneous step, co-deciders must **not see each other's picks**. The current
  `enumerateMovesForSimulation` (`mcts-bot.ts:865-872`) / `getCurrentPlayerFromFlowState`
  (`:901-908`) resolve deciders one-at-a-time on a fully-visible clone — fix so a committed co-decider
  move is not fed back to a later co-decider within the same simultaneous step.
- Redaction alone only PARTLY fixes this (a redacted clone hides pending picks); the enumeration loop
  must also be corrected. Fix **both** the clone source and the loop.
- Scope: the bot's own-seat decision AND the rollout simulation of simultaneous steps.

### Test & Verification Strategy (PROC-01)
- **AI-01 RED**: new `src/ai/mcts-multiselect.test.ts` (and/or extend
  `src/engine/utils/enumerate-moves.test.ts`): a function-valued `multiSelect` currently throws
  "No available moves" / is silently skipped; post-fix it enumerates multi-element combinations AND the
  panel completes it. This is the "previously un-enumerable → silently skipped damage case now
  enumerates and is exercised" (fail-loud principle).
- **AI-02 RED**: new `src/ai/mcts-redaction.test.ts`: assert the bot's cloned/search state does NOT
  expose another seat's hidden attributes (clone derives from `toJSONForPlayer`, not `toJSON`). Must
  present **≥2 moves** so the `allMoves.length === 1` short-circuit (`mcts-bot.ts:224`) doesn't bypass
  the clone path.
- **Exploitability**: a scenario exploitable with the naive bot (the bot "knew" a hidden card) is
  non-exploitable after the fix.
- **Harness**: in-file `Game` subclasses driving `MCTSBot` directly (per `mcts-restore.test.ts`), NOT
  the excluded checkers-dependent `mcts-bot.test.ts`. Tests needing the clone path must offer ≥2 moves.

### Claude's Discretion
- The exact name/signature of the shared `resolveMultiSelect` helper and where it lives (engine util).
- How to represent "a hidden element the bot must not see" in the redacted clone during enumeration
  (reuse whatever `toJSONForPlayer` already produces).
- The precise mechanism for keeping simultaneous co-decider picks isolated (e.g. enumerate all
  co-deciders from the SAME pre-reveal snapshot), provided the test proves no leak.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Redaction already exists**: `game.toJSONForPlayer(seat)` (`game.ts:2738`) — canonical per-seat
  serializer (uses `getEffectiveVisibility`/`isVisibleTo`, `redactHiddenElementAttrs`); spectator =
  seat `-1`. Already consumed by `createPlayerView` (`snapshot.ts:217`, `:261`) and session
  `buildPlayerState` (`utils.ts:287`). REUSE THIS — do not invent redaction.
- **multiSelect combination machinery** is already there for the static case: `parseMultiSelect`
  (`enumerate-moves.ts:98-110`), `generateCombinations` (`:115-131`), `combinationsOfSize`
  (`:136-155`). The fix routes the function form into this same machinery after resolving it.
- **Function-valued CHOICES already work**: `_getChoices` (`enumerate-moves.ts:237-247`) →
  `game.getSelectionChoices(...)` evaluates function choices against live state. The multiSelect fix
  mirrors this exact pattern for the multiSelect config.

### Established Patterns
- `buildPickMetadata` (`action-metadata.ts:99`) feeds BOTH MCTS-adjacent tooling and the panel; it
  currently emits `base.multiSelect` ONLY when `typeof multiSelect !== 'function'` (`:148-158`,
  `:202-212`) — the omission is the shared root cause of both defect halves.
- Panel consumes metadata: `useActionController.resolveMultiSelectConfig` (`:1785-1796`) and
  `ActionPanel.getMultiSelectConfig` (`:183-202`), gating the checkbox widget at `ActionPanel.vue:901`.
  No panel change needed once metadata carries the resolved `{min,max}`.
- MCTS enumeration delegates to the shared engine core `enumerateSelectionsCore` (`mcts-bot.ts:937`) —
  the bot has NO multiSelect logic of its own; fix the core.

### Integration Points
- Enumeration skip (D9a): `enumerate-moves.ts:190-206` (the `typeof multiSelect === 'function'` →
  devWarn+skip block to REPLACE with resolve-then-enumerate).
- Metadata omission (D9b/C.2): `action-metadata.ts:148-158` (choice) & `:202-212` (elements).
- Clone source (D8): `snapshot.ts:184` `game.toJSON()` → per-seat `toJSONForPlayer(seat)`; called from
  `captureSnapshot` (`mcts-bot.ts:1066`); restore via `restoreGame`/`loadSerializedState`
  (`mcts-bot.ts:1088-1121`, STATE-AUTHORITATIVE no-replay).
- Simultaneous handling (D8): `mcts-bot.ts:865-872`, `:901-908` (`awaitingPlayers` sequentialization).
- 1-move short-circuit: `mcts-bot.ts:224-226` — cloning tests need ≥2 moves.

</code_context>

<specifics>
## Specific Ideas

- The multiSelect defect closes run-003 BSR-12 and Doom BS-5 and delivers feature C.2
  (panel-completable multi-element selection). The "un-enumerable → silently skipped" case is a
  fail-loud violation — the fix must make it enumerate AND be exercised by a test, not just stop
  warning.
- The redaction fix's success bar is "non-exploitable where the naive bot was" — the exploitability
  test should encode a concrete scenario where the OLD bot's move betrayed knowledge of a hidden card,
  and prove the new bot can't.
- `createSnapshot` is shared beyond the bot — check every caller before changing its default; the
  redaction may need to be a bot-specific path (a `forSeat` option) rather than changing `createSnapshot`
  for all callers. (Flag for the planner: don't break non-bot `createSnapshot` consumers.)

</specifics>

<deferred>
## Deferred Ideas

- Full determinization / information-set MCTS (sampling hidden worlds) — a future AI-strength feature.
- Removing per-game AI workarounds and re-verifying deferred AI opponents — Phase 169.
- Any change to the excluded checkers-dependent `mcts-bot.test.ts`.

</deferred>
