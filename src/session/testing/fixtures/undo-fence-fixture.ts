/**
 * Fixture for UNDO-01 / UNDO-02 regression coverage (server-side undo
 * enforcement fences).
 *
 * Shape (mirrors `collect-turns-fixture.ts`'s two-actionStep-per-turn
 * pattern, so undo is offered mid-turn -- the only state in which undo is
 * ever eligible):
 *  - 2 players, turn-rotated via a plain `activeSeat` counter (structured
 *    cloneable across the broadcast/postMessage boundary, unlike a live
 *    element flow variable).
 *  - Turn step 1 offers THREE actions to the active seat:
 *      - `play`   -- ordinary, undoable (default). Negative control: an
 *                    undo attempt after this action must still succeed.
 *      - `lock`   -- declared `.notUndoable()`. An undo attempt after this
 *                    action must be refused, naming the blocking action.
 *      - `endGame`-- calls `ctx.game.finish()`. Reaches `game.phase ===
 *                    'finished'` without ever hand-mutating `game.phase`.
 *  - Turn step 2 offers only `pass`, keeping the SAME player current
 *    (`actionsThisTurn === 1`) so undo is eligible at the moment the test
 *    intervenes with an undo op instead of completing the turn normally.
 *  - No `minMoves`/`maxMoves` on either actionStep -- matches the common
 *    real-game shape (plain `actionStep({ actions: [...] })`).
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

    // `pass`: ordinary, recorded no-op action that completes the turn's
    // second actionStep.
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));

    const activePlayer = (ctx: { game: Game }) =>
      ctx.game.getPlayer((ctx.game as UndoFenceGame).activeSeat)!;

    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 1000,
          while: (ctx) => !ctx.game.isFinished(),
          do: sequence(
            actionStep({ actions: ['play', 'lock', 'endGame'], player: activePlayer }),
            actionStep({ actions: ['pass'], player: activePlayer }),
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
  gameClass: UndoFenceGame as new (...args: unknown[]) => unknown,
  gameType: 'undo-fence',
  minPlayers: 2,
  maxPlayers: 2,
};
