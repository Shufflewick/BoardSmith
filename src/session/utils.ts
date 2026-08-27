/**
 * Shared utility functions for game hosting
 */

import { Player, canSeatAct, availableActionsForSeat, type FlowState, type Game, type ActionDefinition, type ActionTrace, type PendingActionState } from '../engine/index.js';
import { buildActionMetadata, buildPickMetadata } from '../engine/element/action-metadata.js';
import { getActiveTutorialStepView } from '../engine/tutorial/gate.js';
import { devWarn } from '../utils/dev.js';
import { describeCheckpointAbsence } from '../runtime/index.js';
import type { GameRunner } from '../runtime/index.js';
import type { PlayerGameState, ActionMetadata, PickMetadata, SerializedFlowDebugInfo, SerializedPendingActionState } from './types.js';
import type { ElementJSON } from '../engine/index.js';

// Re-export so existing consumers (session barrel, external callers) are unchanged
export { buildActionMetadata, buildPickMetadata } from '../engine/element/action-metadata.js';

/**
 * Recursively locate a node by element id within an already-filtered
 * `ElementJSON` tree (SEC-03 / F8). Used to derive `state.players` from the
 * same per-viewer-filtered `truthView` that backs `state.view`, instead of a
 * parallel unfiltered `player.toJSON()` pass -- see `buildPlayerState` below.
 */
function findElementJSONById(json: ElementJSON, id: number): ElementJSON | undefined {
  if (json.id === id) return json;
  if (!json.children) return undefined;
  for (const child of json.children) {
    const found = findElementJSONById(child, id);
    if (found) return found;
  }
  return undefined;
}

/**
 * Generate a random 8-character game ID
 */
export function generateGameId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

/**
 * Check if it's a specific player's turn
 */
export function isPlayersTurn(flowState: FlowState | undefined, playerPosition: number): boolean {
  return canSeatAct(flowState, playerPosition);
}

/**
 * Serialize `game.getFlowDebugInfo()` into the shared plain-object shape
 * (`SerializedFlowDebugInfo`) that travels over the wire. Flow position is
 * public game structure (T-123-08) — safe to compute once and reuse across
 * every seat/spectator. `describe()` is a METHOD on the engine's
 * FlowDebugInfo and does NOT survive serialization, so it is captured here
 * into a plain `description` string before anything is sent to a client.
 *
 * Single shared serializer reused by both session hosts (GameSession's live
 * broadcast() and SnapshotSessionHost's stateless op path) plus the
 * debug:flow-state op — one source of truth for the wire shape (Pit of
 * Success: no divergent per-host copies).
 */
export function serializeFlowDebugInfo(game: Game): SerializedFlowDebugInfo {
  const info = game.getFlowDebugInfo();
  return {
    phase: info.phase,
    step: info.step,
    path: info.path,
    awaiting: info.awaiting,
    description: info.describe(),
  };
}

/**
 * Serialize a live `PendingActionState` into its JSON-safe wire shape
 * (`SerializedPendingActionState`) — `onSelectFired`'s `Set<number>` becomes a
 * plain `number[]` (`JSON.stringify(new Set(...))` produces `"{}"`, silently
 * dropping the accumulated indices).
 *
 * Also copies `collectedArgs` and `repeating.accumulated` one level deep, so
 * the returned object is never the live mutable state a caller could
 * continue to observe mutate via subsequent selection steps (CR-01) — the
 * same guarantee `GameRunner.getPendingAction()` (runtime/runner.ts) provides
 * on the testing path.
 *
 * Single shared serializer reused by `GameSession.broadcast()`, `PickHandler`
 * (selection-step responses), and the `debug:flow-state` stateless op — one
 * wire shape for `PendingActionState` everywhere (Pit of Success: no
 * divergent per-host copies, mirroring `serializeFlowDebugInfo()` above).
 */
export function serializePendingActionState(s: PendingActionState): SerializedPendingActionState {
  return {
    ...s,
    collectedArgs: { ...s.collectedArgs },
    repeating: s.repeating ? { ...s.repeating, accumulated: [...s.repeating.accumulated] } : undefined,
    onSelectFired: s.onSelectFired ? Array.from(s.onSelectFired) : undefined,
  };
}

/**
 * Build metadata for a single action by name.
 * Used for followUp actions that aren't in the current available actions.
 * Does NOT check the action's condition (followUp actions bypass conditions).
 *
 * @param knownArgs Optional args to use when evaluating dynamic prompts (for followUp actions)
 */
export function buildSingleActionMetadata(
  game: Game,
  player: Player,
  actionName: string,
  knownArgs?: Record<string, unknown>
): ActionMetadata | undefined {
  const actions = (game as any)._actions as Map<string, ActionDefinition>;
  const actionDef = actions?.get(actionName);

  if (!actionDef) {
    console.warn(`[buildSingleActionMetadata] Action "${actionName}" not found in game._actions`);
    return undefined;
  }

  const pickMetas: PickMetadata[] = [];

  for (const selection of actionDef.selections) {
    const pickMeta = buildPickMetadata(game, player, selection, knownArgs);
    pickMetas.push(pickMeta);
  }

  return {
    name: actionName,
    prompt: actionDef.prompt,
    help: actionDef.help,
    ...(actionDef.manual ? { manual: true } : {}),
    selections: pickMetas,
  };
}

/**
 * Compute turn start action index and actions this turn for a player.
 *
 * `moveCount` (from `FlowState`, published for every active action step --
 * `engine.ts` `getState()`) is the SOLE authoritative source (UNDO-03). There
 * is no fallback: a solo game (or any same-player-repeats shape) has no
 * "different player" boundary to scan backward for, so a history-scanning
 * heuristic silently rewinds the ENTIRE game on first undo -- the D5
 * game-erasing defect this function used to contain (deleted, not replaced).
 * `moveCount === undefined` means "not currently in an action step" and is
 * treated as undo-unavailable, per the project's no-backward-compatibility
 * rule -- never as "guess from history."
 *
 * This correctly handles games with phases where the same player can act at
 * the end of one phase and start of the next (e.g., MERC where Rebel Player
 * acts at end of Day 1 and start of Day 2): moveCount resets to 0 for the new
 * action-step frame, so undo is (correctly) bounded to that frame and cannot
 * reach back across the phase boundary into the prior one.
 *
 * @param actionHistory - The action history to scan
 * @param currentPlayer - The current player's position
 * @param moveCount - Move count from FlowState (actions taken in the current
 *   action-step frame). `undefined` means no action step is currently active.
 */
export function computeUndoInfo(
  actionHistory: Array<{ player: number; undoable?: boolean }>,
  currentPlayer: number | undefined,
  moveCount?: number
): { turnStartActionIndex: number; actionsThisTurn: number; hasNonUndoableAction: boolean } {
  if (currentPlayer === undefined || actionHistory.length === 0 || moveCount === undefined) {
    return { turnStartActionIndex: actionHistory.length, actionsThisTurn: 0, hasNonUndoableAction: false };
  }

  // moveCount tells us how many actions were taken in the current action-step
  // frame. Only check the last 'moveCount' actions for non-undoable actions.
  let hasNonUndoableAction = false;
  const turnStartActionIndex = Math.max(0, actionHistory.length - moveCount);

  for (let i = actionHistory.length - 1; i >= turnStartActionIndex; i--) {
    if (actionHistory[i].undoable === false) {
      hasNonUndoableAction = true;
      break;
    }
  }

  return { turnStartActionIndex, actionsThisTurn: moveCount, hasNonUndoableAction };
}

/**
 * The minimal `FlowState` shape {@link computeUndoEligibility} reads. Kept
 * structural (not the concrete engine `FlowState`) so both executors --
 * `state-history.ts` (real `FlowState`) and `stateless-ops.ts` (its own
 * narrower `BotFlowState`) -- can pass their own flow-state type without a
 * cast, the same way `seat-activity.ts`'s `SeatActivityState` does.
 */
export interface UndoFlowState {
  currentPlayer?: number;
  moveCount?: number;
  awaitingPlayers?: Array<{ playerIndex: number; completed: boolean; availableActions?: string[] }>;
  /**
   * Set by the engine when the active action-step frame was entered by
   * re-prompting the seat that had just acted, and the step did not say
   * whether that continues the seat's turn (`ActionStepConfig.turnScope`).
   * `moveCount` is 0 there for a STRUCTURAL reason, not because the seat has
   * done nothing -- see {@link undoUnavailableMessage}.
   */
  turnScopeUndeclared?: string;
}

/**
 * The refusal a seat gets when it is eligible to undo but `actionsThisTurn`
 * is 0, shared by both executors (`state-history.ts` `undoToTurnStart` and
 * `stateless-ops.ts` `handleUndo`) so the two cannot drift.
 *
 * Normally that genuinely means "you have not acted yet this turn". But a
 * seat that just acted and was immediately re-prompted in a fresh action-step
 * frame ALSO reads as 0, and reporting "No actions to undo" there is what made
 * an undeclared `turnScope` look like a deliberate no-undo design for so long
 * (issues 144/145). When the engine has flagged that case, say so instead.
 */
export function undoUnavailableMessage(flowState: UndoFlowState | undefined): string {
  const step = flowState?.turnScopeUndeclared;
  if (!step) return 'No actions to undo';
  return (
    `Undo is unavailable here because flow step '${step}' does not say whether re-entering ` +
    `it continues the same turn. Add turnScope: 'continue' to that actionStep if the seat is ` +
    `still taking one turn (undo then reaches back over the whole run), or turnScope: 'restart' ` +
    `if each entry starts a new turn (undo is then correctly unavailable at its start).`
  );
}

/**
 * Whether `seat` is a participant of the CURRENT simultaneous step --
 * present in `awaitingPlayers`, regardless of its own `completed` flag.
 * Deliberately NOT `canSeatAct`/`dueSeats` (`engine/flow/seat-activity.ts`):
 * those answer "can seat N act RIGHT NOW", which is false the instant a
 * seat commits -- exactly the seat whose OWN undo we need to allow (D4:
 * "allow undo for any seat that... was awaiting and has committed this
 * step").
 */
function isSimultaneousParticipant(flowState: UndoFlowState | undefined, seat: number): boolean {
  return !!flowState?.awaitingPlayers?.some((p) => p.playerIndex === seat);
}

/**
 * Per-seat rewind boundary for a simultaneous-step undo (D4). Unlike
 * {@link computeUndoInfo} (sequential, single-actor turn boundary), a
 * simultaneous step can have MULTIPLE seats acting independently within the
 * same step -- the boundary must come from the REQUESTING seat's own
 * action(s) in history, never from `moveCount` directly (moveCount is the
 * step-wide total across every seat, not this seat's own scope).
 *
 * **Step-window bound (load-bearing, D4 plan-check WARNING -- the
 * simultaneous analogue of the MERC same-player-across-phases guard
 * `computeUndoInfo`'s doc comment calls out for the sequential path):** the
 * search for the seat's own action is bounded to
 * `[actionHistory.length - moveCount, actionHistory.length)` -- the CURRENT
 * simultaneous step's action window (160-02 taught `FlowState.moveCount` to
 * also publish for an active simultaneous step, engine.ts
 * `executeSimultaneousActionStep`/`resumeSimultaneousAction`) -- and never
 * scans further back into a PRIOR step/phase where the same seat may also
 * have acted. Without this bound, a seat that acted once in an EARLIER
 * step and once in the CURRENT one -- with no OTHER seat's action between
 * them -- would have its undo silently reach back and discard the earlier
 * step's action too.
 *
 * **Co-decider boundary (T-160-04, elevation-of-privilege mitigation; F-05
 * fix):** the boundary is the START OF THE TRAILING RUN of the requesting
 * seat's OWN actions -- i.e. only the seat that acted LAST may undo, and it
 * rewinds exactly its own contiguous actions at the end of history. Because
 * that run extends to the end, restoring to it discards no co-decider action
 * (the restore target is a single linear point in `actionHistory`, not a
 * per-seat diff). A seat that is not the last actor is refused (`undefined`).
 * Anchoring on the seat's FIRST action instead (the pre-F-05 bug) refused
 * every seat on common interleavings like `[A, B, A]`, leaving nobody able to
 * undo.
 */
export function simultaneousUndoBoundary(
  actionHistory: Array<{ player: number }>,
  moveCount: number | undefined,
  seat: number,
): { turnStartActionIndex: number; actionsThisTurn: number } | undefined {
  if (moveCount === undefined || actionHistory.length === 0) return undefined;

  const windowStart = Math.max(0, actionHistory.length - moveCount);

  // F-05 (SIM-02): anchor on the START OF THE TRAILING RUN of this seat's own
  // actions, not its FIRST action in the window. The checkpoint restore target
  // is a single linear point in `actionHistory`, so undo must not reach past a
  // co-decider's action. Only the seat that acted LAST can undo (its own
  // trailing run extends to the end of history, so nothing else is discarded).
  // With `[A, B, A]` the old first-action anchor saw `B` after `A₁` and refused
  // for BOTH seats — leaving nobody able to undo. The trailing run of A is just
  // `A₂`, which A may soundly undo.
  const last = actionHistory.length - 1;
  if (actionHistory[last].player !== seat) return undefined;

  let runStart = last;
  while (runStart - 1 >= windowStart && actionHistory[runStart - 1].player === seat) {
    runStart -= 1;
  }

  return { turnStartActionIndex: runStart, actionsThisTurn: actionHistory.length - runStart };
}

/**
 * Single shared "may `seat` undo right now, and if so from where?" answer
 * (D4), consumed by BOTH executors (`state-history.ts`'s `undoToTurnStart`
 * and `stateless-ops.ts`'s `handleUndo`) plus `buildPlayerState`'s advisory
 * `canUndo` -- the parity contract this repo enforces (a change to one
 * executor without its twin is the drift bug T-160-* guards against).
 *
 * Branches on whether the flow is CURRENTLY in a simultaneous step
 * (`flowState.awaitingPlayers?.length > 0`): sequential undo keeps its
 * EXACT existing `computeUndoInfo`/`currentPlayer` contract (UNDO-03) --
 * this function does not change sequential behavior at all -- while a
 * simultaneous step routes through {@link isSimultaneousParticipant} +
 * {@link simultaneousUndoBoundary} instead of the `currentPlayer` pin.
 *
 * `eligible` is deliberately the SEAT-IDENTITY check only (sequential:
 * `currentPlayer === seat`; simultaneous: seat is a participant of the
 * current step) -- NOT folded together with `actionsThisTurn > 0`. Callers
 * (`undoToTurnStart`/`handleUndo`) check these as two SEPARATE gates with
 * two DIFFERENT refusal messages ("It's not your turn" vs "No actions to
 * undo") -- the same two-step shape those callers have always had. Folding
 * them into one boolean would report "not your turn" for a seat that IS
 * eligible but simply hasn't acted yet.
 */
export function computeUndoEligibility(
  actionHistory: Array<{ player: number; undoable?: boolean }>,
  flowState: UndoFlowState | undefined,
  seat: number,
): { eligible: boolean; turnStartActionIndex: number; actionsThisTurn: number; hasNonUndoableAction: boolean } {
  const isSimultaneousStep = (flowState?.awaitingPlayers?.length ?? 0) > 0;

  if (isSimultaneousStep) {
    if (!isSimultaneousParticipant(flowState, seat)) {
      return { eligible: false, turnStartActionIndex: actionHistory.length, actionsThisTurn: 0, hasNonUndoableAction: false };
    }

    // Participant, but either hasn't acted yet this step OR its own action
    // is not undo-safe (a co-decider acted afterward, T-160-04) -- reported
    // as "no actions to undo" (actionsThisTurn 0), NOT "not your turn": the
    // seat unambiguously IS part of this step.
    const boundary = simultaneousUndoBoundary(actionHistory, flowState?.moveCount, seat);
    if (!boundary) {
      return { eligible: true, turnStartActionIndex: actionHistory.length, actionsThisTurn: 0, hasNonUndoableAction: false };
    }

    let hasNonUndoableAction = false;
    for (let i = boundary.turnStartActionIndex; i < actionHistory.length; i++) {
      if (actionHistory[i].undoable === false) {
        hasNonUndoableAction = true;
        break;
      }
    }

    return { eligible: true, ...boundary, hasNonUndoableAction };
  }

  // Sequential (UNCHANGED contract, UNDO-03): the same computation
  // `buildPlayerState` has always used, with the seat-identity check kept
  // separate from `actionsThisTurn` exactly as it always was.
  const { turnStartActionIndex, actionsThisTurn, hasNonUndoableAction } = computeUndoInfo(
    actionHistory,
    flowState?.currentPlayer,
    flowState?.moveCount,
  );
  const eligible = flowState?.currentPlayer === seat;
  return { eligible, turnStartActionIndex, actionsThisTurn, hasNonUndoableAction };
}

/**
 * Thrown by {@link assertUndoAllowed} when a server-side undo/rewind fence
 * refuses the operation. Never a silent no-op (D-02 / T-155-04): every
 * refusal carries an actionable message naming why, and the two undo
 * executors (`stateless-ops.ts`) catch it at their own OpResult boundary
 * while the two stateful methods (`state-history.ts`) already have a
 * try/catch that converts any thrown Error into `{ success: false, error }`.
 *
 * Message content is intentionally limited to the action name/index or the
 * phase reason -- no file paths, line numbers, or stack traces (project hard
 * rule; T-155-03).
 */
export type UndoRefusalReason =
  | 'non-undoable'
  | 'finished-phase'
  | 'execute-barrier'
  | 'random-fence';

export class UndoRefusedError extends Error {
  readonly reason: UndoRefusalReason;

  constructor(message: string, reason: UndoRefusalReason) {
    super(message);
    this.name = 'UndoRefusedError';
    this.reason = reason;
  }
}

/**
 * Single shared server-side undo/rewind guard (D-01/D-09) consumed by ALL
 * FOUR undo/rewind entry points -- `stateless-ops.ts`'s `handleUndo` and
 * `handleDebugRewind`, and `state-history.ts`'s `undoToTurnStart` and
 * `rewindToAction`. This is the fix for UNDO-01 (`.notUndoable()` was never
 * enforced server-side -- only hidden via the client's advisory `canUndo`)
 * and UNDO-02 (the `finished`-phase fence AND the durable execute()-barrier
 * fence).
 *
 * Four independent, composable checks (order does not matter -- Open
 * Question 2, 155-RESEARCH.md -- each is O(1)/O(k) and evaluates against the
 * SAME inputs regardless of what ran before it):
 *  1. Phase fence: refuse up front once `game.isFinished()` (D-04) --
 *     checked before any checkpoint lookup, never by silently rolling the
 *     phase back via a pre-finish checkpoint.
 *  2. Non-undoable fence: scan `actionHistory[turnStartActionIndex..end)`
 *     for an entry recorded with `undoable === false`
 *     (`.notUndoable()` -> `action-builder.ts`) and refuse, naming the
 *     blocking action by name and index.
 *  3. Commitment fence (155-02): refuse when
 *     `turnStartActionIndex < executeBarrierIndex` -- the target would rewind
 *     through a completed `execute({ irreversible: true })` node, taking back
 *     something a state restore cannot honestly take back (above all,
 *     information a human has already seen: a dealt hand, a revealed role).
 *     An ordinary bookkeeping `execute()` does NOT fence undo -- its effects
 *     are state, and state restores. `executeBarrierIndex` is `GameRunner`'s durable
 *     replacement for the transient `frame.completed` flag (see
 *     `runner.ts`'s doc comments) -- callers pass `runner.executeBarrierIndex`
 *     directly; there is nothing else to compute.
 *  4. Random fence (#18): opt-in per game via
 *     `GameDefinition.undo: { fenceRandomRewind: true }` and passed here as
 *     `fenceRandomRewind`. Refuse when the seeded RNG position at the target
 *     checkpoint differs from the live one -- i.e. a random draw was consumed
 *     inside the span being rewound. Undo already restores `randomState`, so
 *     redoing the SAME action cannot re-roll; what scums is REORDERING (undo,
 *     act differently first, then draw again on a different generator
 *     position), which a private session with unlimited undo can repeat
 *     unobserved. Off by default: it costs a cooperative game a legitimate
 *     take-back, and only a competitive session needs it.
 *
 * Every argument is REQUIRED, including `fenceRandomRewind`. An optional
 * fence is a fence a new call site forgets, and forgetting is silent -- the
 * undo simply succeeds. Callers pass the runner itself rather than its parts,
 * so there is nothing to recompute and nothing to mismatch.
 *
 * Throws {@link UndoRefusedError}; returns normally (void) when the undo/
 * rewind is allowed. This is the pit-of-success mechanic (D-02): a new call
 * site that forgets to call this guard is the ONLY way to reintroduce the
 * old client-trusted-enforcement bug -- there is no boolean flag a caller
 * could compute and then ignore.
 */
export function assertUndoAllowed(args: {
  runner: GameRunner;
  actionHistory: Array<{ player: number; undoable?: boolean; name?: string }>;
  turnStartActionIndex: number;
  fenceRandomRewind: boolean;
}): void {
  const { runner, actionHistory, turnStartActionIndex, fenceRandomRewind } = args;
  const game = runner.game;
  const executeBarrierIndex = runner.executeBarrierIndex;

  if (game.isFinished()) {
    throw new UndoRefusedError('Cannot undo: the game is finished.', 'finished-phase');
  }

  for (let i = turnStartActionIndex; i < actionHistory.length; i++) {
    if (actionHistory[i].undoable === false) {
      const name = actionHistory[i].name ?? 'action';
      throw new UndoRefusedError(
        `Cannot undo: action ${i} (${name}) is marked notUndoable.`,
        'non-undoable',
      );
    }
  }

  if (turnStartActionIndex < executeBarrierIndex) {
    throw new UndoRefusedError(
      `Cannot undo past action ${executeBarrierIndex}: a step marked ` +
      `execute({ irreversible: true }) has committed there. If that step only ` +
      `changes game state (scoring, moving pieces, flow bookkeeping), drop the ` +
      `flag — state is restored by undo, and marking it needlessly blocks undo ` +
      `for the rest of the game.`,
      'execute-barrier',
    );
  }

  if (!fenceRandomRewind) return;

  const targetRandomState = runner.randomStateAt(turnStartActionIndex);
  if (targetRandomState === undefined) {
    // The CAUSE is not assumed here. A missing checkpoint is `pruned` (a
    // `checkpoints: { max }` the author can raise) or `uncaptured` (above all
    // `checkpoints: { enabled: false }`, which the epic mandates on resolver
    // sessions — telling that author to raise `max` names a knob they never
    // set). `describeCheckpointAbsence` already distinguishes them, so the
    // fence asks it rather than hardcoding one.
    throw new UndoRefusedError(
      `Cannot undo to action ${turnStartActionIndex}: this game fences undo ` +
      `across random draws, so it needs the retained checkpoint there to tell ` +
      `whether a draw was consumed — but ` +
      `${describeCheckpointAbsence(runner.checkpointWindow(), turnStartActionIndex)}`,
      'random-fence',
    );
  }
  if (targetRandomState !== game.getRandomState()) {
    throw new UndoRefusedError(
      `Cannot undo past action ${turnStartActionIndex}: a random draw was ` +
      `consumed there, and this game fences undo across draws so a draw ` +
      `cannot be re-rolled by undoing and acting in a different order. ` +
      `Nothing is wrong with the move you made — the result is simply final.`,
      'random-fence',
    );
  }
}

/**
 * Build a player's view of the game state
 */
export function buildPlayerState(
  runner: GameRunner,
  playerNames: string[],
  playerPosition: number,
  options?: { includeActionMetadata?: boolean; includeDebugData?: boolean }
): PlayerGameState {
  const flowState = runner.getFlowState();

  // Truth view -- always the current game state
  const playerView = runner.getPlayerView(playerPosition);
  const truthView = playerView.state;

  const isMyTurn = isPlayersTurn(flowState, playerPosition);

  // Get available actions for this seat. Handles both simultaneous steps
  // (awaitingPlayers) and sequential steps (currentPlayer); for sequential
  // flows only the current player sees available actions, which prevents
  // clients from prematurely starting actions during another player's turn.
  const availableActions = availableActionsForSeat(flowState, playerPosition);

  // Compute undo eligibility -- awaiting-aware (D4/SIM-02): a sequential
  // step keeps the exact `computeUndoInfo`/`currentPlayer` contract
  // (UNDO-03); a simultaneous step allows any awaiting-or-completed-this-
  // step seat, with the boundary from THAT seat's own action(s), not the
  // turn-wide moveCount. See computeUndoEligibility's doc comment.
  const { eligible: canUndoEligible, turnStartActionIndex, actionsThisTurn, hasNonUndoableAction } = computeUndoEligibility(
    runner.actionHistory,
    flowState,
    playerPosition
  );

  // Can undo if: eligible (my turn, sequential; or my own committed
  // simultaneous action, bounded per-seat) AND no non-undoable action was
  // taken within that boundary.
  const canUndo = canUndoEligible && actionsThisTurn > 0 && !hasNonUndoableAction;

  // Get the full player data including custom properties (abilities, score, etc.)
  // for the UI.
  //
  // SEC-03 (F8): this MUST be derived from `truthView` -- the already
  // per-viewer-filtered tree that also backs `state.view` -- rather than a
  // second, unfiltered `player.toJSON()` pass. A raw pass bypasses every
  // visibility mechanism (zone/element hiding AND the SEC-02
  // `visibleAttributes` whitelist), broadcasting every custom Player
  // attribute to every seat and spectator regardless of what the truth view
  // redacted. Routing through `truthView` makes `state.players` inherit all
  // of that filtering for free -- one chokepoint, not two parallel channels.
  const allPlayers = runner.game.players;
  const fullPlayerData = allPlayers.map((player: any) => {
    const node = findElementJSONById(truthView, player.id);
    if (node) {
      // Flatten attributes to root level so UI can access p.color, p.position directly
      const flattened: { name: string; seat: number; [key: string]: unknown } = {
        ...node,
        name: node.name ?? player.name ?? `Player ${player.seat}`,
        ...(node.attributes || {}),
        // Ensure seat is set (use player.seat, which is the 1-indexed position)
        seat: player.seat,
      };
      delete flattened.attributes;
      delete flattened.children;
      delete flattened.childCount;

      return flattened;
    }
    // The Player node itself was filtered out of this viewer's truthView
    // entirely (e.g. individually hidden) -- fall back to the minimal public
    // identity rather than leaking anything from the raw player object.
    return { name: player.name ?? `Player ${player.seat}`, seat: player.seat };
  });

  // D26/SPACE-05: `availableActions` (raw, from the flow's action-step
  // snapshot -- see comment above) and `actionMetadata` (condition-checked
  // at broadcast time) must be the SAME set for a real seat, or the client
  // can be offered an action it cannot start ("No metadata for action",
  // stranding the panel). Reconcile here: when metadata is built for a real
  // seat, `state.availableActions` is derived from the metadata's own keys
  // -- the condition-checked set -- rather than the raw snapshot. Spectators
  // (position 0) and the no-metadata-requested path keep the raw list; they
  // never receive metadata and so cannot strand a panel on it.
  let reconciledAvailableActions = availableActions;
  let actionMetadata: Record<string, ActionMetadata> | undefined;
  if (options?.includeActionMetadata && availableActions.length > 0 && playerPosition > 0) {
    const player = runner.game.getPlayer(playerPosition);
    if (player) {
      actionMetadata = buildActionMetadata(runner.game, player, availableActions);
      reconciledAvailableActions = Object.keys(actionMetadata);

      // F-10/SPACE-05: the reconciliation above silently narrows the flow's
      // offered `availableActions` to the condition-checked set. That narrowing
      // hides a real game bug — the flow's actionStep offered an action whose
      // own conditions are false — so surface it loudly instead (fail fast and
      // loud). devWarn dedups per key, so this is one line per offending set.
      const dropped = availableActions.filter((a) => !(a in actionMetadata!));
      if (dropped.length > 0) {
        if (reconciledAvailableActions.length === 0 && isMyTurn) {
          // Every offered action failed its conditions AND it is this seat's
          // turn: the board is STRANDED (isMyTurn with no startable action, the
          // flow still awaiting it). This never resolves on its own.
          devWarn(
            `stranded-seat-no-startable-action:${playerPosition}:${dropped.sort().join(',')}`,
            `Seat ${playerPosition} is on-turn but EVERY action the flow offered ` +
            `(${dropped.join(', ')}) fails its own condition() — the seat has no startable ` +
            `action and the flow is still awaiting it, stranding the board. An actionStep must ` +
            `only offer actions whose conditions can currently be satisfied (gate the actionStep, ` +
            `or fix the action conditions).`,
          );
        } else {
          devWarn(
            `condition-false-action-offered:${dropped.sort().join(',')}`,
            `The flow offered action(s) [${dropped.join(', ')}] to seat ${playerPosition}, but ` +
            `their condition() returned false, so they were dropped from the broadcast. This ` +
            `silent narrowing hides a game bug: an actionStep should not offer an action whose ` +
            `conditions are currently unsatisfiable. Gate the actionStep or fix the condition.`,
          );
        }
      }
    }
  }

  const state: PlayerGameState = {
    phase: runner.game.phase,
    players: fullPlayerData,
    currentPlayer: flowState?.currentPlayer,
    availableActions: reconciledAvailableActions,
    isMyTurn,
    view: truthView,
    canUndo,
    // Gated on `canUndoEligible`, not `isMyTurn` (D4/SIM-02): a seat that
    // has already committed its simultaneous action is no longer "due"
    // (`isMyTurn`/`canSeatAct` is false the instant it commits) but IS
    // still eligible to see/undo its own turnStartActionIndex.
    actionsThisTurn: canUndoEligible ? actionsThisTurn : 0,
    turnStartActionIndex: canUndoEligible ? turnStartActionIndex : undefined,
    messages: playerView.messages.length > 0 ? playerView.messages : undefined,
    // Unconditional, unlike turnStartActionIndex -- see PlayerGameState.actionCount doc.
    actionCount: runner.actionHistory.length,
    // Unconditional for the same reason: a count, not content -- see
    // PlayerGameState.restoreEpoch.
    restoreEpoch: runner.restoreEpoch,
  };

  // Action metadata was built above (single-source reconciliation with
  // availableActions, D26/SPACE-05) -- attach it here if present.
  if (actionMetadata) {
    state.actionMetadata = actionMetadata;
  }

  // Optionally include custom debug data
  if (options?.includeDebugData) {
    const customDebug = runner.game.getCustomDebugData();
    if (Object.keys(customDebug).length > 0) {
      state.customDebug = customDebug;
    }
  }

  // Include colorSelectionEnabled from game settings so clients know to show color swatches
  // (In lobby mode this comes from LobbyInfo, but in non-lobby mode like --bot, this is the only source)
  if (runner.game.settings.colorSelectionEnabled) {
    state.colorSelectionEnabled = true;
  }

  // Include animation events if any are pending
  const animationEvents = runner.game.pendingAnimationEvents;
  if (animationEvents.length > 0) {
    state.animationEvents = animationEvents;
    state.lastAnimationEventId = animationEvents[animationEvents.length - 1].id;
  }

  // Signal whether the game has a tutorial definition (for ControlsMenu gating).
  // No seat guard — the menu item shows for any connected player or spectator.
  if (runner.game.tutorialDefinition) {
    state.hasTutorial = true;
  }

  // Tutorial projection — parity with createPlayerView (T-104-07).
  // Uses the shared getActiveTutorialStepView helper so this call site and
  // createPlayerView cannot diverge. Skip for spectators (position 0).
  if (playerPosition > 0) {
    const tutorial = getActiveTutorialStepView(runner.game, playerPosition);
    if (tutorial !== undefined) {
      state.tutorial = tutorial;
    }
    // Disabled-action reasons are NOT tutorial-only: an action's own
    // `.disabled()` rule applies in ordinary play. Projected for every seated
    // player (spectators have no actions to disable), parity with
    // createPlayerView.
    const disabled = runner.game.getDisabledActions(playerPosition);
    if (Object.keys(disabled).length > 0) {
      state.disabledActions = disabled;
    }
  }

  return state;
}

// ============================================
// Element diffing (time-travel debugging)
// ============================================

/**
 * The added/removed/changed element IDs between two state views.
 */
export interface ElementDiff {
  added: number[];
  removed: number[];
  changed: number[];
}

interface ComparableElement {
  parentId: number | null;
  attrs: string;
}

/**
 * Serialize the game-state attributes of a view node for comparison.
 * Excludes player objects and internal metadata so that diffs reflect
 * actual game state changes only.
 */
function comparableAttrs(node: Record<string, unknown>): string {
  const attrs = node.attributes as Record<string, unknown> | undefined;
  if (!attrs) return '';
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    // Skip player objects and internal metadata
    if (key === 'player' || key === 'game' || key.startsWith('_')) continue;
    filtered[key] = value;
  }
  return JSON.stringify(filtered);
}

/**
 * Walk a view tree, collecting every id-bearing element keyed by id, along
 * with its parent id and comparable attributes. Nodes without an id are
 * transparent: recursion continues with the same parent.
 */
function collectElements(
  node: unknown,
  map: Map<number, ComparableElement>,
  parentId: number | null = null,
): void {
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  if (typeof obj.id === 'number') {
    map.set(obj.id, { parentId, attrs: comparableAttrs(obj) });
    if (Array.isArray(obj.children)) {
      for (const child of obj.children) collectElements(child, map, obj.id);
    }
  } else if (Array.isArray(obj.children)) {
    for (const child of obj.children) collectElements(child, map, parentId);
  }
}

/**
 * Compute the element-level diff between two player-state view trees.
 *
 * An element is:
 * - `added` if its id appears only in `toView`,
 * - `removed` if its id appears only in `fromView`,
 * - `changed` if it moved to a different parent OR its comparable
 *   attributes changed.
 *
 * This is the single source of truth shared by GameSession's state-history
 * diff and the stateless executor's debug state diff.
 */
export function computeElementDiff(fromView: unknown, toView: unknown): ElementDiff {
  const fromElements = new Map<number, ComparableElement>();
  const toElements = new Map<number, ComparableElement>();
  collectElements(fromView, fromElements);
  collectElements(toView, toElements);

  const added: number[] = [];
  const removed: number[] = [];
  const changed: number[] = [];

  for (const [id, to] of toElements.entries()) {
    const from = fromElements.get(id);
    if (!from) {
      added.push(id);
    } else if (from.parentId !== to.parentId || from.attrs !== to.attrs) {
      // Element moved to a different parent OR its attributes changed
      changed.push(id);
    }
  }

  for (const id of fromElements.keys()) {
    if (!toElements.has(id)) removed.push(id);
  }

  return { added, removed, changed };
}

/**
 * Build action traces for debugging.
 * Returns detailed information about why each action is or isn't available.
 */
export function buildActionTraces(
  runner: GameRunner,
  playerPosition: number
): ActionTrace[] {
  // playerPosition is 1-indexed
  const player = runner.game.getPlayer(playerPosition);
  if (!player) {
    return [];
  }
  return runner.game.getActionTraces(player);
}
