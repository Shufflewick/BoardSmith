/**
 * Fixture for UNDO-01 / UNDO-02 regression coverage (server-side undo
 * enforcement fences).
 *
 * Shape (155-03 UPDATE -- see the note below the class for why this is no
 * longer the two-actionStep-per-turn shape it started as):
 *  - 2 players, turn-rotated via a plain `activeSeat` counter (structured
 *    cloneable across the broadcast/postMessage boundary, unlike a live
 *    element flow variable).
 *  - ONE actionStep per turn, offering THREE actions to the active seat:
 *      - `play`   -- ordinary, undoable (default). Negative control: an
 *                    undo attempt after this action must still succeed.
 *      - `lock`   -- declared `.notUndoable()`. An undo attempt after this
 *                    action must be refused, naming the blocking action.
 *      - `endGame`-- calls `ctx.game.finish()`. Reaches `game.phase ===
 *                    'finished'` without ever hand-mutating `game.phase`.
 *  - `repeatUntil: () => false` keeps the SAME action-step frame open
 *    indefinitely (no `minMoves`/`maxMoves` declared -- matches the common
 *    real-game "plain actionStep" shape), so `moveCount` is 1 immediately
 *    after taking the FIRST action -- the moment these tests exercise undo.
 *    None of this fixture's consumers ever take a second action, so the step
 *    never needs to actually complete.
 *
 * 155-03 NOTE (why this changed from a two-actionStep-per-turn shape):
 * `moveCount` is now frame-scoped and authoritative with no fallback
 * (UNDO-03, `session/utils.ts` `computeUndoInfo`). The ORIGINAL shape put
 * `play`/`lock`/`endGame` in their own single-move actionStep, which
 * auto-completes after exactly one move and opens a FRESH `pass` actionStep
 * frame (`moveCount === 0` there) before any test could call undo -- so
 * every undo attempt was refused with the generic "No actions to undo"
 * BEFORE ever reaching the notUndoable/finished-phase fences this fixture
 * exists to exercise. `repeatUntil` keeps the SAME frame (and its moveCount)
 * open across the single action each test takes, which is what actually
 * offers undo the moment these tests need it -- this is CONTEXT D-06's
 * "one undo = one action-step" contract working as intended, not a
 * workaround around it.
 */

import {
  Game,
  Player,
  Action,
  defineFlow,
  sequence,
  actionStep,
  execute,
  loop,
  type GameOptions,
} from '../../../engine/index.js';
import type { GameDefinitionLike } from '../../stateless-ops.js';

class UndoFenceGame extends Game<UndoFenceGame, Player> {
  /** Seat (1-indexed) whose turn it is. A plain number so it round-trips
   *  through the snapshot cleanly (unlike a live element flow variable). */
  activeSeat = 1;

  constructor(options: GameOptions) {
    super(options);

    // `play`: ordinary action, undoable by default.
    this.registerAction(Action.create('play').execute(() => ({ success: true })));

    // `lock`: declared non-undoable -- the UNDO-01 enforcement target.
    this.registerAction(Action.create('lock').notUndoable().execute(() => ({ success: true })));

    // `endGame`: reaches the finished phase via the real API, never by
    // hand-mutating `game.phase` -- the UNDO-02 finished-phase fence target.
    this.registerAction(
      Action.create('endGame').execute((_args, ctx) => {
        ctx.game.finish();
        return { success: true };
      }),
    );

    const activePlayer = (ctx: { game: Game }) =>
      ctx.game.getPlayer((ctx.game as UndoFenceGame).activeSeat)!;

    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 1000,
          while: (ctx) => !ctx.game.isFinished(),
          do: sequence(
            actionStep({ actions: ['play', 'lock', 'endGame'], player: activePlayer, repeatUntil: () => false }),
            execute((ctx) => {
              const game = ctx.game as UndoFenceGame;
              if (!game.isFinished()) {
                game.activeSeat = game.activeSeat >= game.players.length ? 1 : game.activeSeat + 1;
              }
            }),
          ),
        }),
      }),
    );
  }
}

export { UndoFenceGame };

export const undoFenceFixtureDefinition: GameDefinitionLike = {
  gameClass: UndoFenceGame,
  gameType: 'undo-fence',
  minPlayers: 2,
  maxPlayers: 2,
};
