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
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
} from '../../engine/index.js';

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

    this.setFlow(
      defineFlow({
        root: loop({
          while: (ctx) => ctx.game.total < 12,
          maxIterations: 50,
          do: eachPlayer({ do: actionStep({ actions: ['add', 'sign'] }) }),
        }),
      }),
    );
  }
}
