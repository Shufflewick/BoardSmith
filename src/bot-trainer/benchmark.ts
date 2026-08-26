import type { Game } from '../engine/index.js';
import { GameRunner, type GameRunnerOptions } from '../runtime/index.js';
import { createBot, type BotStrategy } from '../bot/index.js';
import { SeededRandom } from '../utils/random.js';
import type { GameClass, LearnedObjective, CandidateFeature } from './types.js';

/**
 * Configuration for a single player in a benchmark game
 */
export interface PlayerConfig {
  /** Whether to use bot (true) or random moves (false) */
  useBot: boolean;
  /** MCTS iterations if using bot */
  iterations?: number;
  /** Learned objectives to guide MCTS if using bot */
  objectives?: LearnedObjective[];
}

/**
 * Benchmark configuration
 */
export interface BenchmarkConfig {
  /** Number of games to run */
  gameCount?: number;
  /** Timeout per game in ms */
  timeout?: number;
  /** Maximum actions per game */
  maxActions?: number;
  /** Base seed for reproducibility */
  seed?: string;
  /** MCTS iterations for the trained bot (default 100 for quality evaluation) */
  mctsIterations?: number;
  /** Candidate features for evaluating objectives (required for objectives to work) */
  features?: CandidateFeature[];
  /**
   * Return a result even when some games did not finish, instead of throwing.
   *
   * The default is to throw (#37): an unfinished game means the bot or the
   * game is broken, and a win rate computed around that hole is noise wearing
   * a number's clothes. Set this only when the caller intends to inspect
   * `incomplete`/`failures` itself.
   */
  allowIncomplete?: boolean;
}

/**
 * Benchmark result
 */
export interface BenchmarkResult {
  /**
   * Win rate of the trained bot over DECIDED games (0-1).
   *
   * Games that never finished are excluded from the denominator (#37). Folding
   * them in as draws made a bot that crashed on every call report roughly 50%,
   * which is a number weight evolution will happily optimize towards.
   */
  winRate: number;
  /** Number of wins */
  wins: number;
  /** Number of losses */
  losses: number;
  /** Number of draws — games the GAME itself decided as a tie. */
  draws: number;
  /**
   * Games that reached no outcome: a bot that threw, a game that crashed, a
   * game that hit the action cap or the timeout. Their own category, never
   * mixed into `draws`.
   */
  incomplete: number;
  /** `incomplete` as a fraction of every game attempted (0-1). */
  incompleteRate: number;
  /**
   * Why the incomplete games did not finish, deduplicated. Empty on a healthy
   * run. This is the thing that turns "the bot scores 50%" into a bug report.
   */
  failures: string[];
  /** Total games DECIDED (wins + losses + draws). */
  gamesPlayed: number;
  /** Total games attempted, decided or not. */
  gamesAttempted: number;
  /** Games where trained bot was player 0 */
  gamesAsPlayer0: number;
  /** Games where trained bot was player 1 */
  gamesAsPlayer1: number;
  /** Win rate when playing as player 0 */
  winRateAsPlayer0: number;
  /** Win rate when playing as player 1 */
  winRateAsPlayer1: number;
}

/**
 * Benchmark a trained bot against a random baseline.
 *
 * Plays games where trained bot faces random player in both positions
 * to eliminate first-player advantage bias.
 *
 * @param GameClass - The game class constructor
 * @param gameType - The game type identifier
 * @param objectives - Learned objectives from training
 * @param config - Benchmark configuration
 * @returns Benchmark results with win rate statistics
 */
export async function benchmarkBot<G extends Game>(
  GameClass: GameClass<G>,
  gameType: string,
  objectives: LearnedObjective[],
  config: BenchmarkConfig = {}
): Promise<BenchmarkResult> {
  const gameCount = config.gameCount ?? 100;
  const timeout = config.timeout ?? 60000;
  const maxActions = config.maxActions ?? 300;
  const seed = config.seed ?? 'benchmark';
  const mctsIterations = config.mctsIterations ?? 100;
  const features = config.features ?? [];

  // Split games evenly between the two seats so first-player advantage is not
  // scored as skill; an odd count gives the extra game to seat 0.
  const halfCount = Math.floor(gameCount / 2);
  const schedule: Array<{ trainedPlayerIndex: number; seed: string }> = [
    ...Array.from({ length: halfCount }, (_, i) => ({ trainedPlayerIndex: 0, seed: `${seed}-p0-${i}` })),
    ...Array.from({ length: halfCount }, (_, i) => ({ trainedPlayerIndex: 1, seed: `${seed}-p1-${i}` })),
    ...(gameCount % 2 !== 0 ? [{ trainedPlayerIndex: 0, seed: `${seed}-extra` }] : []),
  ];

  const tally = {
    win: 0, loss: 0, draw: 0, incomplete: 0,
    winsAsPlayer0: 0, gamesAsPlayer0: 0,
    winsAsPlayer1: 0, gamesAsPlayer1: 0,
  };
  const failures = new Set<string>();

  for (const { trainedPlayerIndex, seed: gameSeed } of schedule) {
    const { outcome, reason } = await runBenchmarkGame(GameClass, gameType, {
      trainedPlayerIndex,
      objectives,
      features,
      mctsIterations,
      timeout,
      maxActions,
      seed: gameSeed,
    });

    if (trainedPlayerIndex === 0) tally.gamesAsPlayer0++;
    else tally.gamesAsPlayer1++;

    tally[outcome]++;
    if (outcome === 'win') {
      if (trainedPlayerIndex === 0) tally.winsAsPlayer0++;
      else tally.winsAsPlayer1++;
    }
    if (reason) failures.add(reason);
  }

  const gamesPlayed = tally.win + tally.loss + tally.draw;
  const gamesAttempted = schedule.length;
  const incompleteRate = gamesAttempted > 0 ? tally.incomplete / gamesAttempted : 0;

  // A seat that never finished a game has no rate; reporting one over a
  // denominator that excludes its failures would read as a real result.
  const decidedAsPlayer0 = tally.gamesAsPlayer0;
  const decidedAsPlayer1 = tally.gamesAsPlayer1;

  const result: BenchmarkResult = {
    winRate: gamesPlayed > 0 ? tally.win / gamesPlayed : 0,
    wins: tally.win,
    losses: tally.loss,
    draws: tally.draw,
    incomplete: tally.incomplete,
    incompleteRate,
    failures: [...failures],
    gamesPlayed,
    gamesAttempted,
    gamesAsPlayer0: tally.gamesAsPlayer0,
    gamesAsPlayer1: tally.gamesAsPlayer1,
    winRateAsPlayer0: decidedAsPlayer0 > 0 ? tally.winsAsPlayer0 / decidedAsPlayer0 : 0,
    winRateAsPlayer1: decidedAsPlayer1 > 0 ? tally.winsAsPlayer1 / decidedAsPlayer1 : 0,
  };

  // Fail the run rather than hand back a rate the caller will treat as skill.
  if (tally.incomplete > 0 && config.allowIncomplete !== true) {
    throw new Error(
      `Benchmark aborted: ${tally.incomplete} of ${gamesAttempted} games did not finish, so the ` +
      `${(result.winRate * 100).toFixed(1)}% win rate describes only the ${gamesPlayed} that did.\n` +
      `  ${[...failures].map((f) => `- ${f}`).join('\n  ')}\n` +
      `  Fix the bot or the game. Pass allowIncomplete: true only to inspect the failures yourself.`
    );
  }

  return result;
}

interface BenchmarkGameOptions {
  trainedPlayerIndex: number;
  objectives: LearnedObjective[];
  features: CandidateFeature[];
  mctsIterations: number;
  timeout: number;
  maxActions: number;
  seed: string;
}

type GameOutcome = 'win' | 'loss' | 'draw' | 'incomplete';

/** One game's result, plus why it did not finish when it did not. */
interface BenchmarkGameResult {
  outcome: GameOutcome;
  /** Present only for `incomplete` — what stopped the game. */
  reason?: string;
}

/**
 * Run a single benchmark game
 */
async function runBenchmarkGame<G extends Game>(
  GameClass: GameClass<G>,
  gameType: string,
  options: BenchmarkGameOptions
): Promise<BenchmarkGameResult> {
  const { trainedPlayerIndex, objectives, features, mctsIterations, timeout, maxActions, seed } = options;
  const randomPlayerIndex = trainedPlayerIndex === 0 ? 1 : 0;
  const startTime = Date.now();

  /** A game that reached no outcome, and what stopped it. */
  const incomplete = (reason: string): BenchmarkGameResult => ({ outcome: 'incomplete', reason });

  try {
    const runnerOptions: GameRunnerOptions<G> = {
      GameClass,
      gameType,
      gameOptions: {
        playerCount: 2,
        seed,
      },
    };
    const runner = new GameRunner(runnerOptions);
    let flowState = runner.start();

    // Create objectives function for MCTS
    const botObjectives = createObjectivesFunction(objectives, features);

    let actionCount = 0;

    while (!flowState.complete && actionCount < maxActions) {
      if (Date.now() - startTime > timeout) {
        return incomplete(`A game hit the ${timeout}ms timeout after ${actionCount} actions.`);
      }
      if (!flowState.awaitingInput) {
        return incomplete('A game stopped awaiting input before it completed.');
      }

      // currentPlayer is a POSITION (1-indexed), trainedPlayerIndex is an INDEX (0-indexed)
      const currentPlayer = flowState.currentPlayer;
      if (currentPlayer === undefined) {
        return incomplete('A game was awaiting input with no current player.');
      }

      const availableActions = flowState.availableActions ?? [];
      if (availableActions.length === 0) {
        return incomplete(`No action was available to seat ${currentPlayer}, and the game was not over.`);
      }

      // The trained bot searches; the opponent is the same bot at one
      // iteration, which is essentially random but always produces valid args.
      const trainedPosition = trainedPlayerIndex + 1;
      const isTrainedSeat = currentPlayer === trainedPosition;
      const bot = createBot(
        runner.game,
        GameClass,
        gameType,
        currentPlayer,
        runner.actionHistory,
        isTrainedSeat ? mctsIterations : 1,
        isTrainedSeat && objectives.length > 0 ? { objectives: botObjectives } : undefined
      );

      let action: string;
      let args: Record<string, unknown>;
      try {
        const move = await bot.play();
        if (!move) {
          // The bot found nothing searchable from this seat's view (#29). In a
          // live game that stalls one seat; in a benchmark the game cannot
          // proceed, and a game that cannot proceed is not a draw (#37).
          return incomplete(
            `The ${isTrainedSeat ? 'trained' : 'baseline'} bot had no searchable move for seat ` +
            `${currentPlayer}: ${bot.lastStallReason ?? 'no reason recorded'}`
          );
        }
        action = move.action;
        args = move.args;
      } catch (error) {
        // #37: this used to substitute a RANDOM bot for the crashing one and
        // play on. A trained bot whose objectives function threw on every call
        // therefore scored like a random player — roughly 50% against random —
        // and evolution optimized that noise. A bot that cannot move is the
        // result.
        return incomplete(
          `The ${isTrainedSeat ? 'trained' : 'baseline'} bot could not choose a move for seat ` +
          `${currentPlayer}: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      const result = runner.performAction(action, currentPlayer, args);
      if (!result.success) {
        return incomplete(
          `Seat ${currentPlayer}'s "${action}" could not be completed: ${result.error ?? 'no reason given'}`
        );
      }

      actionCount++;
      flowState = runner.getFlowState() ?? flowState;
    }

    if (!flowState.complete) {
      return incomplete(`A game hit the ${maxActions}-action cap without finishing.`);
    }

    // winners contains player POSITIONS (1-indexed), not indices (0-indexed)
    const winners = (runner.game.settings.winners as number[]) ?? [];

    // A game the GAME decided as a tie. This is the only thing that is a draw.
    if (winners.length === 0) {
      return { outcome: 'draw' };
    }

    const trainedPosition = trainedPlayerIndex + 1;
    const randomPosition = randomPlayerIndex + 1;

    if (winners.includes(trainedPosition)) {
      // A shared win is a tie, decided by the game.
      return { outcome: winners.includes(randomPosition) ? 'draw' : 'win' };
    }

    return { outcome: 'loss' };
  } catch (error) {
    // #37: `catch { return 'draw' }` made a crashing game look like a close one.
    return incomplete(
      `A game crashed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Create an objectives function from learned objectives
 */
function createObjectivesFunction(
  learnedObjectives: LearnedObjective[],
  features: CandidateFeature[]
): BotStrategy['objectives'] {
  // Build feature lookup map
  const featureMap = new Map(features.map(f => [f.id, f]));

  return (game: Game, playerIndex: number) => {
    const objectives: Record<string, { checker: () => number; weight: number }> = {};

    for (const obj of learnedObjectives) {
      const feature = featureMap.get(obj.featureId);
      if (!feature) continue;

      objectives[obj.featureId] = {
        checker: () => {
          // Evaluate the feature and convert boolean to number (0 or 1)
          return feature.evaluate(game, playerIndex) ? 1 : 0;
        },
        weight: obj.weight,
      };
    }

    return objectives;
  };
}
