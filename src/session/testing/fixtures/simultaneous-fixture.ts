/**
 * Reusable ≥2-seat `simultaneousActionStep` fixture, shared across Phase 160
 * plans (D3/SIM-01 checkpoint aliasing, D21/SIM-03 allDone-on-empty, and
 * Plan 02's per-seat undo work).
 *
 * Two `CommitPlayer`s each independently `commit` under ONE
 * `simultaneousActionStep`. Completion is driven by TWO independent inputs
 * so a test can reach both the ordinary happy path and the D21 edge case:
 *
 *  - `playerDone` (per-seat): a seat is done once it has committed.
 *  - `allDone` (step-wide): gated on `game.roundClosed`, a flag that is
 *    INDEPENDENT of the individual seats having committed. This models a
 *    real "all players ready AND the host/referee closes the round" shape
 *    (business condition unrelated to per-seat completion) — the exact
 *    shape that reaches "every seat individually done, but allDone still
 *    false" (the D21 empty/all-completed-but-not-done edge).
 *
 * Usable two ways:
 *  - Full session (`createHeadlessSession(simultaneousFixtureDefinition, ...)`)
 *    for session/undo-layer tests (Plan 02).
 *  - Direct `Game` API (`new CommitGame(...)`, `game.startFlow()`,
 *    `game.continueFlow(...)`, `game.getFlowState()`) for engine-layer tests
 *    (Plan 01) that need to drive `FlowEngine.resume()` with an explicit or
 *    omitted `playerIndex`.
 */

import {
  Game,
  Player,
  Action,
  defineFlow,
  simultaneousActionStep,
  type GameOptions,
} from '../../../engine/index.js';
import type { GameDefinitionLike } from '../../stateless-ops.js';

/** A player who independently commits during the shared simultaneous step. */
class CommitPlayer extends Player<CommitGame, CommitPlayer> {
  committed = false;
}

class CommitGame extends Game<CommitGame, CommitPlayer> {
  static PlayerClass = CommitPlayer;

  /**
   * Step-wide completion gate, independent of per-seat `committed`. Starts
   * closed (false) so a test can drive every seat to `committed: true`
   * while `allDone` still reports false — the D21 edge — then flip it to
   * observe the step complete cleanly.
   */
  roundClosed = false;

  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create('commit')
        .condition({
          'has not committed yet': (ctx) => !(ctx.player as CommitPlayer).committed,
        })
        .execute((_args, ctx) => {
          (ctx.player as CommitPlayer).committed = true;
          return { success: true };
        }),
    );

    // Available to every awaiting seat regardless of its own `committed`
    // flag -- lets a Plan 02 test reach `game.isFinished()` from WITHIN the
    // simultaneous step (one seat ends the game while a co-decider has
    // already committed), exercising Phase 155's finished-phase undo fence
    // without inventing a second fixture or a `.notUndoable()` action.
    this.registerAction(
      Action.create('endGame').execute((_args, ctx) => {
        ctx.game.finish();
        return { success: true };
      }),
    );

    // `.notUndoable()` variant of `commit` -- lets a Plan 02 test exercise
    // Phase 155's non-undoable fence (UNDO-01) from WITHIN a simultaneous
    // step, per-seat, without a second fixture.
    this.registerAction(
      Action.create('lockCommit')
        .notUndoable()
        .condition({
          'has not committed yet': (ctx) => !(ctx.player as CommitPlayer).committed,
        })
        .execute((_args, ctx) => {
          (ctx.player as CommitPlayer).committed = true;
          return { success: true };
        }),
    );

    this.setFlow(
      defineFlow({
        root: simultaneousActionStep({
          name: 'commit-step',
          players: () => this.players,
          actions: ['commit', 'endGame', 'lockCommit'],
          playerDone: (_ctx, p) => (p as CommitPlayer).committed,
          allDone: () => this.roundClosed,
        }),
      }),
    );
  }
}

export { CommitGame, CommitPlayer };

export const simultaneousFixtureDefinition: GameDefinitionLike = {
  gameClass: CommitGame as new (...args: unknown[]) => unknown,
  gameType: 'simultaneous',
  minPlayers: 2,
  maxPlayers: 4,
};
