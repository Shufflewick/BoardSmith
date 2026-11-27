import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { styleText } from 'node:util';

import { summarize, type Summary } from '../../sim/report.js';
import { declaredGameOptionsOf } from '../../session/game-option-selection.js';
import { parsePositiveWholeNumber } from '../../utils/positive-whole-number.js';
import { withCommandBuildDir } from '../lib/command-build-dir.js';
import { requireGameProject, requireRulesIndex, resolveRulesDir } from '../lib/game-project.js';
import { simulateReplayCommand } from '../lib/replay-command.js';
import { seatPolicies } from '../lib/sim-shard.js';
import type { GameMetricSummary } from '../../sim/play-game.js';
import {
  loadSimulation,
  parsePlayerCounts,
  resolveSimulationGameOptions,
  runSimulation,
  type LoadedSimulation,
  type PerGameReport,
} from './simulate.js';

interface BotStrengthOptions {
  /** The policy measured: `mcts:<level>` or any `boardsmith simulate` policy name. */
  bot?: string;
  /** The policy every other seat plays. */
  against?: string;
  /** Games per seat at each player count. */
  games?: string;
  players?: string;
  seed?: string;
  jobs?: string;
}

export interface RunBotStrengthOptions {
  bot: string;
  against: string;
  gamesPerSeat: number;
  playerCounts: number[];
  seed: string;
  jobs: number;
}

/** How the bot did at one player count, over every seat. */
export type StrengthAtCount = {
  players: number;
  /** Games played times seats the bot took: one per game per seat. */
  seatGames: number;
  /**
   * Seed by seed, the bot seat's win credit or score minus the same seat's when every seat plays the
   * opponents' policy, averaged over the seats the bot took: one value per seed, so the seats share its luck.
   */
  gain: Summary;
  /** Seeds whose gain is above 0. */
  better: number;
  /** Seeds whose gain is below 0. */
  worse: number;
  /** The low end of `gain`'s 95% interval is above 0, and an exact one-sided sign test of `better` against `worse` passes at 2.5%. */
  stronger: boolean;
} & (
  | {
      by: 'wins';
      /** The bot's share of the wins, a win shared by k seats counting 1/k to each. */
      botShare: number;
      /** One seat's share of the wins when every seat plays the opponents' policy, on the same seeds. */
      baselineShare: number;
      /** Every seat won every game, with the bot and without, and the game declares no `finalScore` metric to measure it by. */
      unmeasured: boolean;
    }
  | {
      /** Every seat won every game, with the bot and without, so the bot's final score is compared with the baseline's instead. */
      by: 'score';
      /** The `finalScore` metric compared. */
      metric: string;
    }
);

/** A game that did not finish, and the `--policy` flags it was played with. */
type FailingGame = PerGameReport & { policyFlags: string[] };

export interface BotStrengthResult {
  failing: FailingGame[];
  /** The game options every game was played with, which a replay command must carry. */
  gameOptions: Record<string, unknown>;
  /** One entry per player count, or `null` when a game did not finish, which stops the run. */
  counts: StrengthAtCount[] | null;
}

type PlayedGame = { winners: number[]; metrics: GameMetricSummary };

/** `seat`'s share of `game`'s win: 1/k when it is one of k winners. */
const winCredit = (game: PlayedGame, seat: number) => (game.winners.includes(seat) ? 1 / game.winners.length : 0);

/** The chance of `k` or more heads in `n` fair coin flips. */
function chanceOfAtLeast(k: number, n: number): number {
  let logWays = 0;
  let chance = 0;
  for (let j = 0; j <= n; j++) {
    if (j >= k) chance += Math.exp(logWays - n * Math.LN2);
    logWays += Math.log(n - j) - Math.log(j + 1);
  }
  return chance;
}

/** Seed by seed, `value` of the bot's seat minus the same seat's in the baseline game, averaged over the seats. */
function pairedGain(baseline: PlayedGame[], botRuns: PlayedGame[][], value: (game: PlayedGame, seat: number) => number) {
  const gains = baseline.map((game, g) => botRuns.reduce((sum, games, i) => sum + value(games[g], i + 1) - value(game, i + 1), 0) / botRuns.length);
  const gain = summarize(gains);
  // Win credits of 1/2, 1/3 and 1/6 can cancel to a rounding error rather than exactly 0.
  const better = gains.filter((g) => g > 1e-9).length;
  const worse = gains.filter((g) => g < -1e-9).length;
  // The normal interval alone is too narrow when few seeds differ, and has no width at all on one seed.
  return { gain, better, worse, stronger: gain.low > 0 && chanceOfAtLeast(better, better + worse) <= 0.025 };
}

/**
 * Play the bot in each seat in turn against `against` in every other seat, and every seat as
 * `against`, on the same seeds, so a seat's own advantage counts the same for both.
 */
export async function runBotStrength(rules: LoadedSimulation, options: RunBotStrengthOptions): Promise<BotStrengthResult> {
  const gameOptions = resolveSimulationGameOptions(declaredGameOptionsOf(rules.gameDefinition), []);
  const play = async (players: number, policyFlags: string[]) => {
    const { failing, games } = await runSimulation(rules, {
      gamesPerCount: options.gamesPerSeat,
      playerCounts: [players],
      seed: options.seed,
      policyFlags,
      gameOptions,
      jobs: options.jobs,
    });
    return { failing: failing.map((game) => ({ ...game, policyFlags })), games };
  };
  const scoreMetric = Object.values(rules.gameDefinition.metrics ?? {}).find((metric) => metric.kind === 'finalScore')?.name;
  const counts: StrengthAtCount[] = [];
  for (const players of options.playerCounts) {
    const baseline = await play(players, [options.against]);
    if (baseline.failing.length > 0) return { failing: baseline.failing, gameOptions, counts: null };
    const botRuns = [];
    for (let seat = 1; seat <= players; seat++) {
      const run = await play(players, [options.against, `${seat}=${options.bot}`]);
      if (run.failing.length > 0) return { failing: run.failing, gameOptions, counts: null };
      botRuns.push(run.games);
    }
    const seatGames = options.gamesPerSeat * players;
    const everySeatWon = [baseline.games, ...botRuns].every((games) => games.every((game) => game.winners.length === players));
    if (everySeatWon && scoreMetric !== undefined) {
      const paired = pairedGain(baseline.games, botRuns, (game, seat) => game.metrics.values[scoreMetric][seat - 1]);
      counts.push({ players, seatGames, ...paired, by: 'score', metric: scoreMetric });
      continue;
    }
    const paired = pairedGain(baseline.games, botRuns, winCredit);
    const botShare = botRuns.reduce((sum, games, i) => sum + games.reduce((s, game) => s + winCredit(game, i + 1), 0), 0) / seatGames;
    const baselineShare = baseline.games.filter((game) => game.winners.length > 0).length / options.gamesPerSeat / players;
    counts.push({ players, seatGames, ...paired, by: 'wins', botShare, baselineShare, unmeasured: everySeatWon });
  }
  return { failing: [], gameOptions, counts };
}

const percent = (value: number) => `${(value * 100).toFixed(0)}%`;
/** `value` with its sign, none when it rounds to 0. */
function signed(value: number, format: (value: number) => string): string {
  const magnitude = format(Math.abs(value));
  return `${format(0) === magnitude ? '' : value < 0 ? '-' : '+'}${magnitude}`;
}
const playersAt = (counts: StrengthAtCount[]) => counts.map((c) => `${c.players} player${c.players === 1 ? '' : 's'}`).join(' and ');

function printCounts(counts: StrengthAtCount[]): void {
  const rows = [['Players', 'Bot', 'Baseline', 'Gain on the same seeds (95%)', 'Seeds better/worse', 'Stronger']];
  for (const c of counts) {
    const format = c.by === 'wins' ? percent : (value: number) => value.toFixed(1);
    const [bot, baseline] = c.by === 'wins' ? [`${percent(c.botShare)} of ${c.seatGames}`, percent(c.baselineShare)] : [`${c.metric} of ${c.seatGames}`, ''];
    const gain = `${signed(c.gain.mean, format)} (${signed(c.gain.low, format)} to ${signed(c.gain.high, format)})`;
    rows.push([String(c.players), bot, baseline, gain, `${c.better}/${c.worse}`, c.stronger ? 'yes' : 'no']);
  }
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  for (const row of rows) console.log(row.map((cell, column) => cell.padEnd(widths[column])).join('  ').trimEnd());
  const byScore = counts.filter((c) => c.by === 'score');
  if (byScore.length > 0) {
    console.log(
      `\nAt ${playersAt(byScore)} every seat won every game, so the bot is measured by how much more ${byScore[0].metric} ` +
        `it scores than the same seat on the same seeds: the first finalScore metric gameDefinition.metrics declares, higher taken as better.`,
    );
  }
}

/** The verdict, and whether the run passed. */
function printVerdict(run: RunBotStrengthOptions, counts: StrengthAtCount[]): boolean {
  const weak = counts.filter((c) => !c.stronger);
  if (weak.length === 0) {
    console.log(styleText('green', `\n${run.bot} beats ${run.against} at every player count.`));
    return true;
  }
  const notShown = (kept: StrengthAtCount[], why: string) =>
    kept.length === 0 ? [] : [`${run.bot} is not shown to beat ${run.against} at ${playersAt(kept)}: ${why}`];
  const strengthen =
    `Strengthen the bot's hooks in src/rules/bot.ts (see /bs-build-bot), or play more games with --games to narrow the interval.`;
  const gainNotAbove = (measure: string) =>
    `the low end of the 95% interval of how much more ${measure} than the same seat with every seat playing ${run.against}, on the same seeds, ` +
    `is not above 0, or the seeds it did better on do not outnumber those it did worse on by more than chance allows. ${strengthen}`;
  const lines = [
    ...notShown(weak.filter((c) => c.by === 'wins' && !c.unmeasured), gainNotAbove('win share it takes')),
    ...notShown(weak.filter((c) => c.by === 'score'), gainNotAbove('it scores')),
    ...notShown(
      weak.filter((c) => c.by === 'wins' && c.unmeasured),
      `every seat won every game, both with ${run.bot} and with every seat playing ${run.against}, so this comparison has no room to show a difference. ` +
        'Declare a finalScore metric in gameDefinition.metrics (see defineMetrics) to measure such a count by score; ' +
        'without one, record this result as it is: no change to the hooks can pass it.',
    ),
  ];
  console.error(styleText('red', `\n${lines.join('\n')}\nThe same run again: --seed ${run.seed}`));
  return false;
}

export async function botStrengthCommand(options: BotStrengthOptions): Promise<void> {
  const cwd = process.cwd();
  const configPath = requireGameProject(cwd);
  const config = JSON.parse(readFileSync(configPath, 'utf-8')) as { paths?: { rules?: string }; gameOptions?: unknown };
  const rulesPath = resolveRulesDir(cwd, config);
  requireRulesIndex(rulesPath);
  const refuse = (error: unknown) => console.error(styleText('red', (error as Error).message));
  let flags: Omit<RunBotStrengthOptions, 'playerCounts'>;
  try {
    flags = {
      bot: options.bot ?? 'mcts:medium',
      against: options.against ?? 'random',
      gamesPerSeat: parsePositiveWholeNumber('--games', options.games ?? '20'),
      seed: options.seed ?? crypto.randomUUID(),
      jobs: options.jobs === undefined ? availableParallelism() : parsePositiveWholeNumber('--jobs', options.jobs),
    };
  } catch (error) {
    refuse(error);
    process.exitCode = 1;
    return;
  }

  const passed = await withCommandBuildDir(cwd, 'bot-strength', async (tempDir) => {
    const rules = await loadSimulation(cwd, rulesPath, tempDir, config.gameOptions, 'bot-strength');
    let run: RunBotStrengthOptions;
    try {
      run = { ...flags, playerCounts: parsePlayerCounts(options.players, rules.gameDefinition) };
      for (const players of run.playerCounts) seatPolicies([run.against, `1=${run.bot}`], rules.policies, players);
    } catch (error) {
      refuse(error);
      return false;
    }
    console.log(styleText('cyan', `\nBot strength: ${run.bot} against ${run.against} (seed: ${run.seed}, ${run.gamesPerSeat} games per seat)\n`));
    const result = await runBotStrength(rules, run);
    for (const g of result.failing) {
      console.error(styleText('red', `Game ${g.index} ${g.status} (seed ${g.seed}) after ${g.turns} action(s).`));
      if (g.error) console.error(styleText('dim', `  ${g.error}`));
      if (g.productionOnly) continue;
      const replay = simulateReplayCommand({ seed: g.seed, playerCount: g.players }, result.gameOptions, g.policyFlags);
      console.error(styleText('dim', `  Replay: ${replay}`));
    }
    if (result.counts === null) {
      console.error(styleText('bold', `\n${result.failing.length} game(s) did not finish, so no strength is reported.`));
      return false;
    }
    printCounts(result.counts);
    return printVerdict(run, result.counts);
  });
  process.exitCode = passed ? 0 : 1;
}
