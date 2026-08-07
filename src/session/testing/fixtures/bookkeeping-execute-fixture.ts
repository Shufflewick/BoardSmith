/**
 * The negative half of UNDO-02's commitment fence: an UNMARKED `execute()`.
 *
 * Deliberately the same flow shape as `execute-barrier-fixture.ts` — the only
 * difference is that this fixture's `execute()` carries no
 * `{ irreversible: true }`. Everything it touches is game state, which a
 * checkpoint restore reproduces exactly, so undo and rewind must be free to
 * cross it.
 *
 * This is the shape most real games have: an `actionStep` followed by a
 * bookkeeping `execute()` that flips a turn flag or advances the active seat
 * (Checkers' move loop, and the turn-advance node in
 * `collect-turns-fixture.ts`). While EVERY `execute()` fenced undo, a single
 * such node put the fence at the current action count on every turn, so undo
 * and debug rewind could never reach behind the current turn — in a survey of
 * the example games, only the two with no flow-level `execute()` at all could
 * rewind. The fence is for effects a restore cannot honestly take back (a
 * dealt hand, a revealed role), not for bookkeeping.
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

class BookkeepingExecuteGame extends Game<BookkeepingExecuteGame, Player> {
  /** Written by the unmarked execute() — ordinary state, restored by undo. */
  turnFlag = 0;

  constructor(options: GameOptions) {
    super(options);

    this.registerAction(Action.create('act1').execute(() => ({ success: true })));
    this.registerAction(Action.create('act2').execute(() => ({ success: true })));
    this.registerAction(Action.create('idle').execute(() => ({ success: true })));

    const p1 = (ctx: { game: Game }) => ctx.game.getPlayer(1)!;

    this.setFlow(
      defineFlow({
        root: sequence(
          actionStep({ actions: ['act1'], player: p1 }),
          // NO `{ irreversible: true }` — this is bookkeeping, and undo may
          // cross it.
          execute((ctx) => {
            (ctx.game as BookkeepingExecuteGame).turnFlag += 1;
          }),
          actionStep({ actions: ['act2'], player: p1, maxMoves: 2 }),
          // Holds the flow (and `game.phase`) open so undo attempts reach the
          // commitment fence rather than the unrelated finished-phase fence.
          actionStep({ actions: ['idle'], player: p1 }),
        ),
      }),
    );
  }
}

export { BookkeepingExecuteGame };

export const bookkeepingExecuteFixtureDefinition: GameDefinitionLike = {
  gameClass: BookkeepingExecuteGame as new (...args: unknown[]) => unknown,
  gameType: 'bookkeeping-execute',
  minPlayers: 1,
  maxPlayers: 1,
};
