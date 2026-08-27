/**
 * Fixture for UNDO-02 execute-barrier regression coverage (155-02).
 *
 * Flow shape (the plan's literal shape): `sequence(actionStep, execute,
 * actionStep)`, single player throughout (no turn rotation, so the
 * backward-scan fallback's "different player" boundary can never mask the
 * defect):
 *
 *  - `actionStep1` offers a single, plain (no `minMoves`/`maxMoves`) action
 *    `act1`. A plain action step auto-completes after one move and clears
 *    `currentActionConfig`, so `FlowState` never reports `moveCount` for it
 *    (moveCount is only surfaced when the action-step config declares
 *    `minMoves`/`maxMoves` -- `engine.ts` `getState()`).
 *  - `execute({ irreversible: true })` stands in for a real COMMITMENT (a
 *    dealt hand, a revealed role). The MARKER is what fences undo; the `score`
 *    increment is just an observable proxy so tests can read the effect
 *    straight off the serialized state without walking the element tree.
 *    An UNMARKED `execute()` would (correctly) not fence anything -- see
 *    `execute-barrier-undo.test.ts`'s bookkeeping counterpart.
 *  - `actionStep2` offers `act2`, configured with `maxMoves: 2` (two moves
 *    required) so it reports a real, moveCount-based turn-start boundary
 *    WHILE it's still open:
 *      - Mid-step, after the FIRST of the two `act2` moves, `moveCount` is
 *        defined (`computeUndoInfo` branch B) and bounds any undo to no
 *        earlier than the barrier -- the negative control (undo succeeds,
 *        stops short of the barrier).
 *      - Once BOTH `act2` moves are made, the step auto-completes and
 *        `currentActionConfig` clears, so `flowState.moveCount` reverts to
 *        `undefined` for the NEXT undo attempt. `computeUndoInfo` then falls
 *        back to its backward-scan branch, which knows nothing about the
 *        execute() node and scans all the way back to action index 0 (every
 *        action so far was the same player) -- pre-fix, this crosses the
 *        barrier and silently discards `execute()`'s committed `score`
 *        increment along with `act1`.
 *  - A trailing `actionStep3` (`idle`, no limits, always available) keeps the
 *    flow -- and therefore `game.phase` -- open past `actionStep2`. Without
 *    it, `actionStep2` completing would also complete the root `sequence`,
 *    which auto-finishes the game and makes every undo attempt fail on the
 *    UNRELATED finished-phase fence (T-155-05's sibling, not this defect).
 *    `idle` is never invoked by the regression tests.
 *
 * Works with BOTH `createHeadlessSession` (stateless) and `GameSession.create`
 * (stateful), mirroring `collect-turns-fixture.ts`'s export shape.
 */

import {
  Game,
  Player,
  Action,
  defineFlow,
  sequence,
  actionStep,
  execute,
  type GameOptions,
} from '../../../engine/index.js';
import type { GameDefinitionLike } from '../../stateless-ops.js';

class ExecuteBarrierGame extends Game<ExecuteBarrierGame, Player> {
  /** Observable proxy for the commitment written by the irreversible
   *  execute() node. A plain Game property (not an element), so it round-trips
   *  through toJSON()/undo restore as an ordinary serialized field -- easy to
   *  assert on directly. */
  score = 0;

  constructor(options: GameOptions) {
    super(options);

    this.registerAction(Action.create('act1').execute(() => ({ success: true })));
    this.registerAction(Action.create('act2').execute(() => ({ success: true })));
    // `idle`: always available, no limits -- keeps the flow (and thus
    // `game.phase`) open past actionStep2 so undo attempts exercise the
    // barrier fence rather than the unrelated finished-phase fence. Never
    // called by the regression tests; it just holds the flow open.
    this.registerAction(Action.create('idle').execute(() => ({ success: true })));

    const p1 = (ctx: { game: Game }) => ctx.game.getPlayer(1)!;

    this.setFlow(
      defineFlow({
        root: sequence(
          actionStep({ actions: ['act1'], player: p1 }),
          execute(
            (ctx) => {
              (ctx.game as ExecuteBarrierGame).score += 1;
            },
            // Declares the commitment: this is the fence these tests exercise.
            { irreversible: true },
          ),
          // Each of these steps is its own closed turn: the barrier tests pin
          // that undo never reaches behind the step it is offered in.
          actionStep({ actions: ['act2'], player: p1, maxMoves: 2, turnScope: 'restart' }),
          actionStep({ actions: ['idle'], player: p1, turnScope: 'restart' }),
        ),
      }),
    );
  }
}

export { ExecuteBarrierGame };

export const executeBarrierFixtureDefinition: GameDefinitionLike = {
  gameClass: ExecuteBarrierGame,
  gameType: 'execute-barrier',
  minPlayers: 1,
  maxPlayers: 1,
};
