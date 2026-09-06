/**
 * Fixture games for the choice-cardinality audit (#172). Kept out of the test
 * file so `auditChoiceCardinality` runs against real game classes through the
 * real engine — the audit's whole value is that its counts are the ones move
 * enumeration actually produces.
 */
import {
  Game,
  Player,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
} from '../../engine/index.js';

const VERBS = Array.from({ length: 40 }, (_, i) => `verb-${i}`);

/** A game whose length is measured by a turn counter. */
interface TurnCounted {
  turns: number;
}

/** Four turns of the named actions, then the game ends. */
function shortFlow(actions: string[]) {
  return defineFlow({
    root: loop({
      while: (ctx) => (ctx.game as unknown as TurnCounted).turns < 4,
      maxIterations: 20,
      do: eachPlayer({ do: actionStep({ actions }) }),
    }),
  });
}

/** Every action here does the same thing: burn a turn so the flow advances. */
function burnTurn(_args: unknown, ctx: { game: TurnCounted }) {
  ctx.game.turns++;
  return { success: true };
}

/**
 * One step offers 40 flat choices with nothing shaping them (the wall of
 * buttons); a second offers the same 40 anchored on the board, which is the
 * correct shape and must not be flagged.
 */
export class WideGame extends Game<WideGame, Player> {
  // Read by the flow's loop condition below; fallow cannot follow `ctx.game.turns`.
  // fallow-ignore-next-line unused-class-member
  turns = 0;

  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create<WideGame>('shout')
        .chooseFrom('verb', { choices: VERBS })
        .execute(burnTurn),
    );

    this.registerAction(
      Action.create<WideGame>('mark')
        .chooseFrom('square', {
          choices: VERBS,
          boardRefs: (choice) => ({
            refs: [{ role: 'target', ref: { notation: String(choice) } }],
          }),
        })
        .execute(burnTurn),
    );

    this.setFlow(shortFlow(['shout', 'mark']));
  }
}

/** Every step is small enough to read as a sentence. Nothing to report. */
export class NarrowGame extends Game<NarrowGame, Player> {
  // fallow-ignore-next-line unused-class-member
  turns = 0;

  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create<NarrowGame>('pick')
        .chooseFrom('value', { choices: [1, 2, 3] })
        .execute(burnTurn),
    );

    this.setFlow(shortFlow(['pick']));
  }
}
