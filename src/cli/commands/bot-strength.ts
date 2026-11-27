import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { styleText } from 'node:util';

import { share, type Share } from '../../sim/report.js';
import { declaredGameOptionsOf } from '../../session/game-option-selection.js';
import { parsePositiveWholeNumber } from '../../utils/positive-whole-number.js';
import { withCommandBuildDir } from '../lib/command-build-dir.js';
import { requireGameProject, requireRulesIndex, resolveRulesDir } from '../lib/game-project.js';
import { simulateReplayCommand } from '../lib/replay-command.js';
import { seatPolicies } from '../lib/sim-shard.js';
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
export interface StrengthAtCount {
  players: number;
  /** Games played times seats the bot took: one per game per seat. */
  seatGames: number;
  /** The bot's share of the wins, a win shared by k seats counting 1/k to each. */
  botShare: Share;
  /** One seat's share of the wins when every seat plays the opponents' policy, on the same seeds. */
  baselineShare: Share;
  /** The low end of the bot's 95% interval is above the high end of the baseline's. */
  stronger: boolean;
}

/** A game that did not finish, and the `--policy` flags it was played with. */
type FailingGame = PerGameReport & { policyFlags: string[] };

export interface BotStrengthResult {
  failing: FailingGame[];
  /** The game options every game was played with, which a replay command must carry. */
  gameOptions: Record<string, unknown>;
  /** One entry per player count, or `null` when a game did not finish, which stops the run. */
  counts: StrengthAtCount[] | null;
}

/** `seat`'s share of each game's win: 1/k when it is one of k winners. */
const winCredit = (winners: number[][], seat: number) =>
  winners.reduce((sum, won) => sum + (won.includes(seat) ? 1 / won.length : 0), 0);

/** A share whose bounds are divided by `seats`: one seat's part of a share of the games. */
const perSeat = (games: Share, seats: number): Share => ({ share: games.share / seats, low: games.low / seats, high: games.high / seats });

/**
 * Play the bot in each seat in turn against `against` in every other seat, and every seat as
 * `against`, on the same seeds, so a seat's own advantage counts the same for both.
 */
export async function runBotStrength(rules: LoadedSimulation, options: RunBotStrengthOptions): Promise<BotStrengthResult> {
  const gameOptions = resolveSimulationGameOptions(declaredGameOptionsOf(rules.gameDefinition), []);
  const play = async (players: number, policyFlags: string[]) => {
    const { failing, winners } = await runSimulation(rules, {
      gamesPerCount: options.gamesPerSeat,
      playerCounts: [players],
      seed: options.seed,
      policyFlags,
      gameOptions,
      jobs: options.jobs,
    });
    return { failing: failing.map((game) => ({ ...game, policyFlags })), winners };
  };
  const counts: StrengthAtCount[] = [];
  for (const players of options.playerCounts) {
    const baseline = await play(players, [options.against]);
    if (baseline.failing.length > 0) return { failing: baseline.failing, gameOptions, counts: null };
    let credit = 0;
    for (let seat = 1; seat <= players; seat++) {
      const run = await play(players, [options.against, `${seat}=${options.bot}`]);
      if (run.failing.length > 0) return { failing: run.failing, gameOptions, counts: null };
      credit += winCredit(run.winners, seat);
    }
    const seatGames = options.gamesPerSeat * players;
    const botShare = share(credit, seatGames);
    const anyoneWon = baseline.winners.filter((won) => won.length > 0).length;
    const baselineShare = perSeat(share(anyoneWon, options.gamesPerSeat), players);
    counts.push({ players, seatGames, botShare, baselineShare, stronger: botShare.low > baselineShare.high });
  }
  return { failing: [], gameOptions, counts };
}

const percent = (value: number) => `${(value * 100).toFixed(0)}%`;
const interval = (s: Share) => `${percent(s.share)} (${percent(s.low)}-${percent(s.high)})`;

function printCounts(counts: StrengthAtCount[]): void {
  console.log('Players  Bot win share (95%)      Baseline (95%)        Stronger');
  for (const c of counts) {
    const botShare = `${interval(c.botShare)} of ${c.seatGames}`;
    console.log(`${String(c.players).padEnd(9)}${botShare.padEnd(26)}${interval(c.baselineShare).padEnd(22)}${c.stronger ? 'yes' : 'no'}`);
  }
}

/** The verdict, and whether the run passed. */
function printVerdict(run: RunBotStrengthOptions, counts: StrengthAtCount[]): boolean {
  const weak = counts.filter((c) => !c.stronger).map((c) => `${c.players} players`);
  if (weak.length === 0) {
    console.log(styleText('green', `\n${run.bot} beats ${run.against} at every player count.`));
    return true;
  }
  console.error(
    styleText(
      'red',
      `\n${run.bot} is not shown to beat ${run.against} at ${weak.join(' and ')}: the low end of its win share's 95% interval ` +
        `is not above the high end of a seat's share when every seat plays ${run.against}. Strengthen the bot's hooks in src/rules/bot.ts ` +
        `(see /bs-build-bot), or play more games with --games to narrow the interval. The same run again: --seed ${run.seed}`,
    ),
  );
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
