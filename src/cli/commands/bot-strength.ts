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
  /** The share of those the bot won alone. */
  botShare: Share;
  /** The share a seat wins alone when every seat plays the opponents' policy, on the same seeds. */
  baselineShare: number;
  /** The bot's share, at the low end of its 95% interval, is above the baseline. */
  stronger: boolean;
}

/** A game that did not finish, and the `--policy` flags it was played with. */
type FailingGame = PerGameReport & { policyFlags: string[] };

export interface BotStrengthResult {
  failing: FailingGame[];
  /** One entry per player count, or `null` when any game did not finish. */
  counts: StrengthAtCount[] | null;
}

/**
 * Play the bot in each seat in turn against `against` in every other seat, and every seat as
 * `against`, on the same seeds, so a seat's own advantage counts the same for both.
 */
export async function runBotStrength(rules: LoadedSimulation, options: RunBotStrengthOptions): Promise<BotStrengthResult> {
  const gameOptions = resolveSimulationGameOptions(declaredGameOptionsOf(rules.gameDefinition), []);
  const failing: FailingGame[] = [];
  const play = async (players: number, policyFlags: string[]) => {
    const { failing: failed, report } = await runSimulation(rules, {
      gamesPerCount: options.gamesPerSeat,
      playerCounts: [players],
      seed: options.seed,
      policyFlags,
      gameOptions,
      jobs: options.jobs,
    });
    failing.push(...failed.map((game) => ({ ...game, policyFlags })));
    return report?.[0];
  };
  const counts: StrengthAtCount[] = [];
  for (const players of options.playerCounts) {
    const baseline = await play(players, [options.against]);
    let wins = 0;
    for (let seat = 1; seat <= players; seat++) {
      const report = await play(players, [options.against, `${seat}=${options.bot}`]);
      if (report) wins += Math.round(report.winShare[seat].share * report.games);
    }
    if (!baseline) continue;
    const seatGames = options.gamesPerSeat * players;
    const botShare = share(wins, seatGames);
    const baselineShare = (1 - baseline.tieRate.share) / players;
    counts.push({ players, seatGames, botShare, baselineShare, stronger: botShare.low > baselineShare });
  }
  return { failing, counts: failing.length > 0 ? null : counts };
}

const percent = (value: number) => `${(value * 100).toFixed(0)}%`;

function printCounts(counts: StrengthAtCount[]): void {
  console.log('Players  Bot win share (95% interval)  Baseline  Stronger');
  for (const c of counts) {
    const botShare = `${percent(c.botShare.share)} (${percent(c.botShare.low)}-${percent(c.botShare.high)}) of ${c.seatGames}`;
    console.log(`${String(c.players).padEnd(9)}${botShare.padEnd(30)}${percent(c.baselineShare).padEnd(10)}${c.stronger ? 'yes' : 'no'}`);
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
        `is not above the share a seat wins when every seat plays ${run.against}. Strengthen the bot's hooks in src/rules/bot.ts ` +
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

  const passed = await withCommandBuildDir(cwd, 'bot-strength', async (tempDir) => {
    const rules = await loadSimulation(cwd, rulesPath, tempDir, config.gameOptions, 'bot-strength');
    let run: RunBotStrengthOptions;
    try {
      run = {
        bot: options.bot ?? 'mcts:medium',
        against: options.against ?? 'random',
        gamesPerSeat: parsePositiveWholeNumber('--games', options.games ?? '20'),
        playerCounts: parsePlayerCounts(options.players, rules.gameDefinition),
        seed: options.seed ?? crypto.randomUUID(),
        jobs: options.jobs === undefined ? availableParallelism() : parsePositiveWholeNumber('--jobs', options.jobs),
      };
      for (const players of run.playerCounts) seatPolicies([run.against, `1=${run.bot}`], rules.policies, players);
    } catch (error) {
      console.error(styleText('red', (error as Error).message));
      return false;
    }
    console.log(styleText('cyan', `\nBot strength: ${run.bot} against ${run.against} (seed: ${run.seed}, ${run.gamesPerSeat} games per seat)\n`));
    const result = await runBotStrength(rules, run);
    for (const g of result.failing) {
      console.error(styleText('red', `Game ${g.index} ${g.status} (seed ${g.seed}) after ${g.turns} action(s).`));
      if (g.error) console.error(styleText('dim', `  ${g.error}`));
      if (!g.productionOnly) console.error(styleText('dim', `  Replay: ${simulateReplayCommand({ seed: g.seed, playerCount: g.players }, {}, g.policyFlags)}`));
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
