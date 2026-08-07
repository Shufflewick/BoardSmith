/**
 * Fixtures for the RNG-scumming fences (#18):
 *
 *  - `UndoPolicy.fenceRandomRewind` — refuse an undo whose span consumed a
 *    random draw, so a draw cannot be re-rolled by undoing and then acting in
 *    a different order.
 *  - `hostOptions.randomness: 'forbidden'` — an order-entry / intent-capture
 *    session that may not draw at all.
 *
 * `ScumGame` (sequential, one seat) offers three actions chosen so a test can
 * separate "did anything draw" from "did anything happen":
 *
 *  - `move`   — mutates state, draws NOTHING. Undo across it must stay legal
 *               even under the fence, and it must be legal in an order-entry
 *               session.
 *  - `note`   — a second non-drawing mutation, so a reorder test has two
 *               order-independent actions to swap.
 *  - `gamble` — draws once and records the value as `lastRoll`. The action a
 *               player would want to re-roll.
 *  - `scout`  — draws once and records nothing. This is the whole exploit in
 *               one action: interposing it between an undo and a repeat
 *               `gamble` moves the generator, so the "same" gamble lands on a
 *               different value. Without the fence a private session can
 *               repeat that until the roll suits them, unobserved.
 *
 * The single `actionStep` uses `repeatUntil: () => false` so every action in a
 * test lands in the SAME frame: `moveCount` keeps rising and undo stays
 * available at the frame's turn-start boundary, which is where the fence is
 * evaluated. (Same reason as `undo-fence-fixture.ts` — see its note.)
 *
 * `SimulScumGame` is the simultaneous twin: two seats under one
 * `simultaneousActionStep`, used to pin the fence's deliberately conservative
 * behaviour — a draw by ANOTHER seat since your turn began fences YOUR undo,
 * because a shared random stream must not be rewound underneath the seats that
 * already saw it.
 *
 * Nothing in either game draws during construction or setup, so an order-entry
 * session can `start` cleanly and only the drawing ACTIONS fail.
 */

import {
  Game,
  Player,
  Action,
  defineFlow,
  sequence,
  actionStep,
  simultaneousActionStep,
  loop,
  type GameOptions,
} from '../../../engine/index.js';
import type { GameDefinitionLike } from '../../stateless-ops.js';

class ScumGame extends Game<ScumGame, Player> {
  /** Bumped by `move`. No randomness involved. */
  moves = 0;
  /** Set by `note`. A second non-drawing mutation, independent of `moves`. */
  noted = false;
  /** The most recent `gamble` result — what a scummer wants to re-roll. */
  lastRoll = 0;
  /** How many times `scout` burned a draw. */
  scouted = 0;

  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create('move').execute((_args, ctx) => {
        (ctx.game as ScumGame).moves += 1;
        return { success: true };
      }),
    );

    this.registerAction(
      Action.create('note').execute((_args, ctx) => {
        (ctx.game as ScumGame).noted = true;
        return { success: true };
      }),
    );

    this.registerAction(
      Action.create('gamble').execute((_args, ctx) => {
        const game = ctx.game as ScumGame;
        game.lastRoll = Math.floor(game.random() * 1_000_000) + 1;
        return { success: true };
      }),
    );

    this.registerAction(
      Action.create('scout').execute((_args, ctx) => {
        const game = ctx.game as ScumGame;
        game.random();
        game.scouted += 1;
        return { success: true };
      }),
    );

    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 1000,
          while: (ctx) => !ctx.game.isFinished(),
          do: sequence(
            actionStep({
              actions: ['move', 'note', 'gamble', 'scout'],
              player: (ctx) => ctx.game.getPlayer(1)!,
              repeatUntil: () => false,
            }),
          ),
        }),
      }),
    );
  }
}

class SimulScumGame extends Game<SimulScumGame, Player> {
  lastRoll = 0;
  notes = 0;

  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create('note').execute((_args, ctx) => {
        (ctx.game as SimulScumGame).notes += 1;
        return { success: true };
      }),
    );

    this.registerAction(
      Action.create('gamble').execute((_args, ctx) => {
        const game = ctx.game as SimulScumGame;
        game.lastRoll = Math.floor(game.random() * 1_000_000) + 1;
        return { success: true };
      }),
    );

    this.setFlow(
      defineFlow({
        root: simultaneousActionStep({
          name: 'orders',
          players: () => this.players,
          actions: ['note', 'gamble'],
          // Never individually done and never step-wide done: the step stays
          // open for the whole test, so both seats keep acting into one frame
          // and each seat's undo boundary stays its own first action.
          playerDone: () => false,
          allDone: () => false,
        }),
      }),
    );
  }
}

export { ScumGame, SimulScumGame };

/** Competitive: a draw, once made, is final. */
export const fencedScumDefinition: GameDefinitionLike = {
  gameClass: ScumGame as new (...args: unknown[]) => unknown,
  gameType: 'scum-fenced',
  minPlayers: 1,
  maxPlayers: 1,
  undo: { fenceRandomRewind: true },
};

/**
 * The SAME game with the fence left at its default (off) — the control that
 * demonstrates the exploit still exists when a game does not declare the
 * policy, so a test can fail if the fence ever stops firing.
 */
export const unfencedScumDefinition: GameDefinitionLike = {
  gameClass: ScumGame as new (...args: unknown[]) => unknown,
  gameType: 'scum-unfenced',
  minPlayers: 1,
  maxPlayers: 1,
};

/**
 * Fenced, and with a retention window too short to reach the undo target. The
 * fence cannot establish whether a draw happened in a span it has no checkpoint
 * for, and must refuse rather than guess.
 */
export const fencedPrunedScumDefinition: GameDefinitionLike = {
  gameClass: ScumGame as new (...args: unknown[]) => unknown,
  gameType: 'scum-fenced-pruned',
  minPlayers: 1,
  maxPlayers: 1,
  undo: { fenceRandomRewind: true },
  checkpoints: { max: 1 },
};

export const fencedSimulScumDefinition: GameDefinitionLike = {
  gameClass: SimulScumGame as new (...args: unknown[]) => unknown,
  gameType: 'scum-simul-fenced',
  minPlayers: 2,
  maxPlayers: 2,
  undo: { fenceRandomRewind: true },
};
