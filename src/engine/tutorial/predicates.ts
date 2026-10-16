/**
 * Named predicate helpers for tutorial `advanceWhen` conditions.
 *
 * Each helper returns a single-label `TutorialAdvanceCondition` (a
 * `Record<string, (ctx: TutorialGateContext) => boolean>`) that can be
 * spread directly into `advanceWhen` on a `TutorialStep`:
 *
 * @example
 * ```typescript
 * // Advance off the intro step after the learner's first action:
 * { id: 'intro', gate: { action: 'move' }, advanceWhen: { ...afterFirstTurn() } }
 *
 * // Advance after the learner has taken 3 turns:
 * { id: 'practice', gate: { action: 'move' }, advanceWhen: { ...afterTurns(3) } }
 *
 * // Advance when a capture becomes the only legal move:
 * { id: 'capture-hint', gate: { action: 'move' }, advanceWhen: { ...whenForced('capture') } }
 * ```
 *
 * **Design principle — pure predicate factories, no event bus:**
 * These helpers compile to plain labeled predicates that the shared
 * `evaluateConditionWithTrace` evaluator runs post-action. There are no
 * subscriptions, event emitters, or timers — just read-only game inspection.
 *
 * **Composition:** Multiple helpers can be spread into one `advanceWhen` object.
 * All predicates must pass simultaneously (AND semantics, mirroring action
 * `ObjectCondition`):
 * ```typescript
 * advanceWhen: { ...afterTurns(2), ...whenForced('capture') }
 * ```
 */

import type { TutorialAdvanceCondition, TutorialGateContext } from './types.js';

/**
 * Returns a labeled `advanceWhen` predicate that fires after the tutorial
 * learner has completed their first turn.
 *
 * Alias for `afterTurns(1)`. See {@link afterTurns} for detailed semantics
 * and caveats.
 *
 * **Post-action safety (no flash-skip):** evaluated after each action, never
 * at turn start. False at game start → the intro step's content renders
 * before any action is taken, and the step advances only after the learner
 * acts. This is the correct replacement for a hypothetical "before first turn"
 * trigger (which would flash-skip the intro immediately).
 */
export function afterFirstTurn(): TutorialAdvanceCondition {
  return afterTurns(1);
}

/**
 * Returns a labeled `advanceWhen` predicate that fires after the tutorial
 * learner has completed `n` of their own turns.
 *
 * **Turn signal derivation — documented approximation:**
 * Turn counting uses two signals from `game.getFlowState().position`:
 *
 * 1. `iterations` — the `__iter_<depth>` loop counters. Only the outermost
 *    loop's counter is read: it counts rounds, starting at 1 at game start
 *    (first round in progress). Subtracting 1 normalises to 0 before the first
 *    turn. Inner loops, such as a turn the same seat keeps playing (a
 *    multi-jump, an extra ask), are ignored, so one learner turn counts once.
 *
 * 2. `playerIndex` — the seat of the player currently awaiting input.
 *    After the learner acts within a round, `playerIndex` changes to another
 *    player's seat, signalling that the learner has contributed their turn for
 *    that round even before the round's loop counter increments.
 *
 * Completed turns ≈ `(sum(iterations) − 1) + (playerIndex !== learnerSeat ? 1 : 0)`
 *
 * **Assumption:** the learner (`ctx.seat`) is the FIRST player to act within
 * each round of the flow (i.e., `eachPlayer` begins with the learner's seat).
 * This is the standard pattern for tutorials where the learner leads. If another
 * player acts first within a round, `playerIndex !== learnerSeat` is already
 * true at game start, causing the predicate to fire prematurely. In that case,
 * write a custom `advanceWhen` predicate instead.
 *
 * **Flow structure requirement:** the predicate relies on an outer `loop` node
 * around `eachPlayer`, whose iteration counter it reads, and on the learner
 * taking one turn per round of it. For bare `eachPlayer` without a `loop`,
 * `iterations` is empty and the predicate never fires — document this if your
 * tutorial uses a non-looping flow.
 *
 * No new persistent state is introduced; only existing flow state is read.
 *
 * @param n - Number of learner turns that must complete before firing.
 */
export function afterTurns(n: number): TutorialAdvanceCondition {
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(
      `afterTurns(n): n must be a positive integer, got ${n}. ` +
      `Use afterFirstTurn() for n=1, or afterTurns(2), afterTurns(3), etc.`
    );
  }
  return {
    [`after ${n} turn${n === 1 ? '' : 's'}`]: (ctx: TutorialGateContext): boolean => {
      const flowState = ctx.game.getFlowState();
      if (!flowState) return false;

      const { iterations, playerIndex } = flowState.position;

      // The outermost loop's counter is the round number: 1 at game start, so
      // subtracting 1 normalises to 0 before the learner has acted. Inner loops
      // (a multi-step turn) are ignored. A restored position stamps 0 on every
      // non-loop frame, and a loop with frames above it has always begun its body,
      // so the outermost loop is the shallowest counter above 0 (getPosition
      // emits the counters shallowest first).
      const roundsStarted = Object.values(iterations).find((count) => count > 0) ?? 0;

      // Within the current round: the learner has already acted if it is now
      // another player's turn (playerIndex changed away from the learner's seat).
      // This contributes +1 for mid-round evaluation without waiting for the full
      // round counter to increment.
      const learnerActedThisRound =
        playerIndex !== undefined && playerIndex !== ctx.seat;

      const completedTurns = (roundsStarted - 1) + (learnerActedThisRound ? 1 : 0);

      return completedTurns >= n;
    },
  };
}

/**
 * Returns a labeled `advanceWhen` predicate that fires when `actionName` is
 * the ONLY action available to the tutorial learner — i.e., the action is
 * "forced" (no other legal moves exist).
 *
 * **Use case:** a generic stand-in for "a forced capture" and similar exclusive-
 * action mechanics. When the game's rules reduce the learner's action set to
 * exactly one option, this predicate fires, allowing the tutorial to advance to
 * a step that explains the forced play.
 *
 * **Implementation:** delegates to `game.getAvailableActions(player)` — the
 * same source the action panel and UI consult — so tutorial state is always
 * consistent with actual game state.
 *
 * Does NOT fire if multiple actions are available (even if all others are
 * tutorial-gated). Combine with a `gate` on the advanced step to restrict
 * the learner to the forced action once the step advances.
 *
 * @param actionName - The action that must be the sole available action.
 */
export function whenForced(actionName: string): TutorialAdvanceCondition {
  return {
    [`${actionName} is the only available action`]: (ctx: TutorialGateContext): boolean => {
      const player = ctx.game.getPlayer(ctx.seat);
      if (!player) return false;

      const available = ctx.game.getAvailableActions(player as Parameters<typeof ctx.game.getAvailableActions>[0]);
      return available.length === 1 && available[0].name === actionName;
    },
  };
}
