/**
 * A fixture game for the replay-hint tests (#322). Kept out of the test file so
 * a test project's rules index can import it and the real CLI can bundle and
 * run it, which is the only way to prove a printed command replays the game.
 *
 * Whether a game fails depends on everything a replay has to carry: the
 * per-game seed (which picks the running total's path), the seat count (fewer
 * than three seats crash at setup) and the `deadEnd` game option (the total at
 * which the only move takes typed text, so the random simulator gets stuck).
 */
import {
  Game,
  Player,
  Action,
  loop,
  eachPlayer,
  actionStep,
  defineMetrics,
  type GameOptions,
} from '../../engine/index.js';
import { isDevMode } from '../../utils/dev.js';

export class DeadEndGame extends Game<DeadEndGame, Player> {
  // Read by the action conditions and the flow's loop condition below; fallow
  // cannot follow `ctx.game.total`.
  // fallow-ignore-next-line unused-class-member
  total = 0;
  readonly deadEnd: number;

  constructor(options: GameOptions) {
    super(options);
    if (options.playerCount < 3) {
      throw new Error(`DeadEndGame needs at least 3 players, got ${options.playerCount}`);
    }
    this.deadEnd = (options as { deadEnd?: number }).deadEnd ?? 5;

    this.registerAction(
      Action.create<DeadEndGame>('add')
        .condition({ 'not at the dead end': (ctx) => ctx.game.total !== ctx.game.deadEnd })
        .chooseFrom('amount', { choices: [1, 2, 3] })
        .execute((args, ctx) => {
          ctx.game.total += args.amount as number;
          return { success: true };
        }),
    );
    // The only move at the dead end takes typed text, which the random
    // simulator cannot generate.
    this.registerAction(
      Action.create<DeadEndGame>('sign')
        .condition({ 'at the dead end': (ctx) => ctx.game.total === ctx.game.deadEnd })
        .enterText('name', {})
        .execute((_args, ctx) => {
          ctx.game.total++;
          return { success: true };
        }),
    );

    this.setFlow({
      root: loop({
        while: (ctx) => ctx.game.total < 12,
        maxIterations: 50,
        do: eachPlayer({ do: actionStep({ actions: ['add', 'sign'] }) }),
      }),
    });
  }
}

/** The metrics of {@link ScoreGame}, which a test project wires as `gameDefinition.metrics` (#556). */
export const scoreMetrics = defineMetrics(({ count, category, finalScore }) => ({
  added: count({ by: 'category' }),
  /** The mode each game was played in, so a test can see production mode was used. */
  mode: category(['development', 'production']),
  score: finalScore((game: ScoreGame, player) => game.scores[player.seat]),
}));

/**
 * Each seat adds one of `amounts` (1 to 3 by default) to its own score, recording the amount, until a
 * round ends with someone at `target` (6 by default) or more. A move that would take a score over
 * `limit` throws, which production mode reports without the throw's own text. With
 * `breakInProduction`, every move throws in production mode and none does in development mode.
 */
export class ScoreGame extends Game<ScoreGame, Player> {
  scores: Record<number, number> = {};

  constructor(options: GameOptions & { target?: number; limit?: number; amounts?: number[]; breakInProduction?: boolean }) {
    super(options);
    const { target = 6, limit = Infinity, amounts = [1, 2, 3], breakInProduction = false } = options;
    for (const player of this.players) this.scores[player.seat] = 0;
    scoreMetrics.mode.record(this, isDevMode() ? 'development' : 'production');
    this.registerAction(
      Action.create<ScoreGame>('add')
        .chooseFrom('amount', { choices: amounts })
        .execute((args, ctx) => {
          const score = ctx.game.scores[ctx.player.seat] + (args.amount as number);
          if (score > limit) throw new Error(`a score of ${score} is over the limit of ${limit}`);
          if (breakInProduction && !isDevMode()) throw new Error('this move breaks in production mode');
          ctx.game.scores[ctx.player.seat] = score;
          scoreMetrics.added.add(ctx.game, String(args.amount));
        }),
    );
    this.setFlow({
      root: loop({
        while: (ctx) => Math.max(...Object.values(ctx.game.scores)) < target,
        maxIterations: 50,
        do: eachPlayer({ do: actionStep({ actions: ['add'] }) }),
      }),
    });
  }
}
