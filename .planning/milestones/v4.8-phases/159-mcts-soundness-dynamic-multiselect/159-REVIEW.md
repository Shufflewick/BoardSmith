---
phase: 159-mcts-soundness-dynamic-multiselect
reviewed: 2026-07-20T00:00:00Z
depth: deep
files_reviewed: 5
files_reviewed_list:
  - src/engine/utils/resolve-multiselect.ts
  - src/engine/utils/enumerate-moves.ts
  - src/engine/element/action-metadata.ts
  - src/engine/utils/snapshot.ts
  - src/ai/mcts-bot.ts
findings:
  critical: 2
  warning: 1
  info: 0
  total: 3
status: resolved (2 criticals fixed)
gap_closure:
  date: 2026-07-20
  cr-01: fixed (commits d10f127e RED, f678360d GREEN)
  cr-02: fixed (commits d10f127e RED, f678360d GREEN)
  wr-01: not addressed — out of scope for this gap-closure pass (see note below)
---

## Gap Closure (2026-07-20)

Both CRITICAL findings below are fixed, RED-first (PROC-01), in
`src/ai/mcts-redaction.test.ts` + `src/ai/mcts-bot.ts` /
`src/engine/element/game.ts` / `src/engine/flow/engine.ts` /
`src/engine/utils/snapshot.ts`. `npm test`: 198 files / 2842 tests green
(2839 baseline + 3 new).

- **CR-01**: `runSearch()` now builds the redacted `searchGame` FIRST (via
  the existing `captureSnapshot`/`restoreGame`), then runs root
  `enumerateAllMoves`, `threatResponseMoves`, and `uctConstant` against it
  unconditionally — including the `allMoves.length===1` fast path, which
  previously returned before the redacted clone was ever built.
- **CR-02**: `toJSONForPlayer` now optionally populates an
  `originalId -> syntheticId` remap as it anonymizes fungible hidden-zone
  children; `createSnapshot` carries it as `hiddenIdRemap` on the `forSeat`
  path; `FlowEngine` holds it for its instance lifetime and uses it both to
  relink flow variables AND to resolve `forEach`'s own per-iteration
  `frame.data.forEachItems` lookup (which re-resolves by original id on
  every iteration, including ones deep in an MCTS search well after the
  initial restore). `mcts-bot`'s `restoreGame` forwards the root remap to
  descendant clones (e.g. the T-159-07 simultaneous baseline) that
  redact-clone an already-redacted `searchGame` and so never collect a
  fresh remap of their own.

**WR-01** (dependent `multiSelect` metadata divergence) was NOT addressed
in this pass — it is a Warning, not a Critical, and was out of scope for
this gap-closure request (CR-01/CR-02 only). It remains open for a future
pass.

# Phase 159: Code Review Report

**Reviewed:** 2026-07-20
**Depth:** deep
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Traced `createSnapshot`'s `forSeat` opt-in, `MCTSBot.captureSnapshot`/`restoreGame`, the new `simultaneousBaseline` freeze, and the shared `resolveMultiSelect` helper across `enumerate-moves.ts` and `action-metadata.ts`. The default (non-`forSeat`) `createSnapshot` path is unchanged (confirmed safe for `GameRunner`/session callers), and the `simultaneousBaseline` capture/clear logic is sound (captured before the first co-decider's move, cleared as soon as `awaitingPlayers` empties, correctly re-armed on later fresh simultaneous steps).

However, two Critical gaps remain in the AI-02 soundness story, and one Warning breaks the "panel and MCTS never disagree" guarantee this phase's docs claim for `resolveMultiSelect`.

## Critical Issues

### CR-01: Root move enumeration reads the full-truth game, not the redacted clone

**File:** `src/ai/mcts-bot.ts:214, 229, 247`
**Issue:** `runSearch()` computes `allMoves` via `this.enumerateAllMoves(this.game, flowState)` (line 229) and evaluates `this.threatResponseMoves(this.game, this.playerIndex, allMoves)` (line 247) and `this.uctConstant?.(this.game, ...)` (line 214) — all against `this.game`, the caller's **original, un-redacted** game instance. The T-159-06 redaction fix (`captureSnapshot()` → `createSnapshot(..., { forSeat: this.playerIndex })`) only takes effect at line 270-271, when `this.searchGame` is created — *after* `allMoves` has already been computed from full truth.

Consequences:
- `enumerateSelectionsCore` → `game.getSelectionChoices(...)` runs against `this.game`. Any selection `condition`/`filterBy`/choice-availability logic that reads opponent hidden state (a filter that legitimately differs when evaluated against the true tree vs. the seat-redacted tree) leaks into the move set the bot considers — the exact class of leak AI-02 exists to close.
- The `allMoves.length === 1` fast path (lines 237-239) returns `allMoves[0]` directly, **without ever constructing the redacted `searchGame`** — the whole redaction never runs for a forced move whose "forced-ness" was itself computed from full truth.
- `threatResponseMoves`/`uctConstant`, both user-supplied game-specific hooks, are handed the true game object and can read arbitrary opponent hidden state to bias move selection, bypassing the search sandbox entirely.

**Fix:** Compute `allMoves`/threat response/UCT constant against a redacted clone (or reorder to build `searchGame` first, then enumerate from it), e.g.:
```ts
// Build the redacted search sandbox FIRST, then enumerate/threat-check from it.
this.rootSnapshot = this.captureSnapshot();
this.searchGame = this.restoreGame(this.rootSnapshot) as G;
const rootFlowState = this.searchGame.getFlowState()!;
const allMoves = this.enumerateAllMoves(this.searchGame, rootFlowState);
// ...threatResponseMoves(this.searchGame, ...), uctConstant?.(this.searchGame, ...)
```

### CR-02: Redacted hidden-zone children get synthetic ids that break flow-variable relinking on restore

**File:** `src/engine/element/game.ts:2866, 2893` (via `src/ai/mcts-bot.ts:1174, 1190` `restoreGame`)
**Issue:** `toJSONForPlayer`'s hidden/count-only and owner-only zone branches replace each hidden child's real id with a synthetic one (`id: -(element._t.id * 1000 + i)`), recomputed by array index on every call. `MCTSBot.captureSnapshot()` now feeds this redacted JSON into `restoreGame()`, which calls `game.loadSerializedState(snapshot.state)` and then `game.restoreFlowState(snapshot.flowState)`.

`restoreFlowState` → `FlowEngine.restoreFullState` → `relinkFlowVariables` (`src/engine/flow/engine.ts:89-96`) resolves element-valued flow variables (e.g. an `eachPlayer`/`forEach` `as` binding, or any flow variable holding a `GameElement`) by looking up `game.getElementById(value.__flowElementId)` using the **original** id captured in `flowState` from the live (un-redacted) `this.game`. If that variable points at an element that is hidden from the bot's seat, the redacted tree no longer has an element with that id (it now has a synthetic negative id, or is a placeholder), so `getElementById` returns `undefined` and `relinkFlowVariables` — by design ("left as-is so the staleness surfaces loudly") — leaves the raw `{ __flowElementId, className }` marker object in the flow variable instead of a live `GameElement`.

For any game whose flow keeps an element-typed variable referencing a currently-hidden element (a plausible pattern for hidden-info games — the exact games AI-02 targets), the redacted `searchGame`'s flow state is now corrupted: subsequent flow logic/conditions that dereference that variable (`variable.someAttribute`) will throw a `TypeError` or silently misbehave, since the value is a plain marker object, not a `GameElement`. This is not caught anywhere in `restoreGame`/`captureSnapshot` and will surface as an opaque runtime error deep in `continueFlow`, not at snapshot/restore time.

**Fix:** Either (a) keep hidden elements' *ids* stable across redaction (only strip identity-bearing *attributes*, not the id) so flow-variable relinking survives, or (b) have `restoreFlowState`/`relinkFlowVariables` fail loudly and immediately during `MCTSBot.restoreGame` (rather than silently degrading a variable to a marker object) so this case is at least detectable, or (c) explicitly document/assert that MCTS search is unsupported for games with element-typed flow variables over hidden elements and guard against it at bot construction time.

## Warnings

### WR-01: `buildActionMetadata` never threads accumulated args between selections — dependent `multiSelect` functions diverge from MCTS enumeration

**File:** `src/engine/element/action-metadata.ts:66-69`, compare `src/engine/utils/enumerate-moves.ts:194`
**Issue:** `enumerate-moves.ts`'s `_enumerateRecursive` correctly threads the args accumulated from earlier selections into `resolveMultiSelect(selection, { game, player, args: currentArgs })` (line 194), so a function-valued `multiSelect` on selection N can legitimately read `ctx.args` from selections `0..N-1` picked earlier in the same enumeration path.

`buildActionMetadata`'s per-action loop, however, calls `buildPickMetadata(game, player, selection)` for **every** selection with no `knownArgs` (`action-metadata.ts:66-69`), so `ctx.args` is always `{}` inside `resolveMultiSelect` for the static metadata build — including for selection N>0. The on-demand `/selection-choices` endpoint (`GameShell.vue` `fetchPickChoices`) only refreshes the **choices list**, never re-resolves `multiSelect` metadata as the player fills in earlier selections.

Net effect: for any action whose `multiSelect` function on a later selection depends on an earlier selection's picked value (a supported, documented use of the `{ game, player, args }` ctx contract), the static `ActionMetadata` sent to the panel — and thus the checkbox widget's min/max — will disagree with what MCTS enumerates for the same action/selection, directly contradicting the phase's stated goal ("so the panel and MCTS never disagree" — module doc, `resolve-multiselect.ts:9-11`, and repeated in both `buildPickMetadata` call sites).

**Fix:** Either thread `knownArgs` progressively through `buildActionMetadata`'s selection loop when a static best-effort is desired (won't fully fix it, since the panel still hasn't collected real values before the user picks), or explicitly document that `multiSelect` functions must not depend on `ctx.args` from sibling selections in the same action (and enforce/detect it), or have the panel re-fetch pick metadata (not just choices) per selection step as the player fills in earlier args.

---

_Reviewed: 2026-07-20_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
