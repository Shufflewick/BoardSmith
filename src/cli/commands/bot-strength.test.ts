import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { botStrengthCommand, runBotStrength } from './bot-strength.js';
import { loadSimulation } from './simulate.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

const here = dirname(fileURLToPath(import.meta.url));

const engine = JSON.stringify(resolve(here, '../../engine/index.ts'));

/** A project of `rules` (a rules index that adds `amount` 1, 2 or 3 per move), with a `biggest` policy that always adds 3. */
function project(rules: string[]): string {
  const dir = tempTree('boardsmith-bot-strength-');
  const files: Record<string, string> = {
    'boardsmith.json': JSON.stringify({ name: 'race', backend: 'table' }),
    'src/rules/index.ts': rules.join('\n'),
    'src/sim/index.ts': [
      `import { greedy } from ${JSON.stringify(resolve(here, '../../sim/index.ts'))};`,
      `export const policies = { biggest: greedy((_game, move) => Number(move.args.amount)) };`,
    ].join('\n'),
  };
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), contents);
  }
  return dir;
}

/** A race for 2 or 3 players: each seat in turn adds 1, 2 or 3 to its own score, and the first to reach 10 wins. */
const raceProject = project([
  `import { Game, Action, loop, eachPlayer, actionStep } from ${engine};`,
  `class RaceGame extends Game {`,
  `  scores = {}; first = 0;`,
  `  constructor(options) {`,
  `    super(options);`,
  `    for (const player of this.players) this.scores[player.seat] = 0;`,
  `    this.registerAction(Action.create('add').chooseFrom('amount', { choices: [1, 2, 3] }).execute((args, ctx) => {`,
  `      const game = ctx.game; const seat = ctx.player.seat;`,
  `      game.scores[seat] += args.amount;`,
  `      if (game.first === 0 && game.scores[seat] >= 10) game.first = seat;`,
  `    }));`,
  `    this.setFlow({ root: loop({ while: (ctx) => ctx.game.first === 0, maxIterations: 50,`,
  `      do: eachPlayer({ do: actionStep({ actions: ['add'] }) }) }) });`,
  `  }`,
  `  getWinners() { return [...this.players].filter((player) => player.seat === this.first); }`,
  `}`,
  `export const gameDefinition = { gameClass: RaceGame, gameType: 'race', displayName: 'Race', minPlayers: 2, maxPlayers: 3 };`,
]);

/** A cooperative game for 2 players: three rounds of adding to one shared total, and everyone wins when it reaches 14. */
const teamProject = project([
  `import { Game, Action, loop, eachPlayer, actionStep } from ${engine};`,
  `class TeamGame extends Game {`,
  `  total = 0; moves = 0;`,
  `  constructor(options) {`,
  `    super(options);`,
  `    this.registerAction(Action.create('add').chooseFrom('amount', { choices: [1, 2, 3] }).execute((args, ctx) => {`,
  `      ctx.game.total += args.amount; ctx.game.moves++;`,
  `    }));`,
  `    this.setFlow({ root: loop({ while: (ctx) => ctx.game.moves < 6, maxIterations: 50,`,
  `      do: eachPlayer({ do: actionStep({ actions: ['add'] }) }) }) });`,
  `  }`,
  `  getWinners() { return this.total >= 14 ? [...this.players] : []; }`,
  `}`,
  `export const gameDefinition = { gameClass: TeamGame, gameType: 'team', displayName: 'Team', minPlayers: 2, maxPlayers: 2 };`,
]);

/** A score-attack solo game: five moves that each add 1, 2 or 3 to the score, and its one seat wins whenever it ends. */
const solo = (metrics: string) => project([
  `import { Game, Action, loop, actionStep, defineMetrics } from ${engine};`,
  `class SoloGame extends Game {`,
  `  score = 0; moves = 0;`,
  `  constructor(options) {`,
  `    super(options);`,
  `    this.registerAction(Action.create('add').chooseFrom('amount', { choices: [1, 2, 3] }).execute((args, ctx) => {`,
  `      ctx.game.score += args.amount; ctx.game.moves++;`,
  `    }));`,
  `    this.setFlow({ root: loop({ while: (ctx) => ctx.game.moves < 5, maxIterations: 50, do: actionStep({ actions: ['add'] }) }) });`,
  `  }`,
  `  getWinners() { return [...this.players]; }`,
  `}`,
  `export const gameDefinition = { gameClass: SoloGame, gameType: 'solo', displayName: 'Solo', minPlayers: 1, maxPlayers: 1${metrics} };`,
]);
const scoredSoloProject = solo(', metrics: defineMetrics(({ finalScore }) => ({ points: finalScore((game) => game.score) }))');
const unscoredSoloProject = solo('');

/** A cooperative game for 2 players, scored by its total: six moves, lost only when every move adds 3. */
const scoredTeamProject = project([
  `import { Game, Action, loop, eachPlayer, actionStep, defineMetrics } from ${engine};`,
  `class ScoredTeamGame extends Game {`,
  `  total = 0; moves = 0; lost = false;`,
  `  constructor(options) {`,
  `    super(options);`,
  `    this.registerAction(Action.create('add').chooseFrom('amount', { choices: [1, 2, 3] }).execute((args, ctx) => {`,
  `      ctx.game.total += args.amount; ctx.game.moves++;`,
  `      if (ctx.game.total === 18) ctx.game.lost = true;`,
  `    }));`,
  `    this.setFlow({ root: loop({ while: (ctx) => ctx.game.moves < 6, maxIterations: 50,`,
  `      do: eachPlayer({ do: actionStep({ actions: ['add'] }) }) }) });`,
  `  }`,
  `  getWinners() { return this.lost ? [] : [...this.players]; }`,
  `}`,
  `export const gameDefinition = { gameClass: ScoredTeamGame, gameType: 'scored-team', displayName: 'Scored team',`,
  `  minPlayers: 2, maxPlayers: 2, metrics: defineMetrics(({ finalScore }) => ({ total: finalScore((game) => game.total) })) };`,
]);

/** Bundled while the file is collected (#363). */
const bundle = (dir: string) => loadSimulation(dir, join(dir, 'src', 'rules'), tempTree('boardsmith-bot-strength-bundle-'), undefined);
const rules = await bundle(raceProject);
const teamRules = await bundle(teamProject);
const scoredSoloRules = await bundle(scoredSoloProject);
const scoredTeamRules = await bundle(scoredTeamProject);
const run = { gamesPerSeat: 30, playerCounts: [2, 3], seed: 'fixed', jobs: 2 };

describe('runBotStrength', () => {
  it('finds a policy that plays better than its opponents stronger at every player count, in every seat', async () => {
    const result = await runBotStrength(rules, { ...run, bot: 'biggest', against: 'random' });

    expect(result.failing).toEqual([]);
    expect(result.counts!.map((c) => [c.players, c.seatGames, c.by, c.stronger])).toEqual([[2, 60, 'wins', true], [3, 90, 'wins', true]]);
  }, 120_000);

  it('does not find a policy stronger than the same policy', async () => {
    const result = await runBotStrength(rules, { ...run, playerCounts: [2], bot: 'random', against: 'random' });

    expect(result.counts!.map((c) => c.stronger)).toEqual([false]);
  }, 120_000);

  it('counts a win shared by every seat, so a bot that helps its team win is stronger', async () => {
    const result = await runBotStrength(teamRules, { ...run, playerCounts: [2], bot: 'biggest', against: 'random' });

    expect(result.counts!.map((c) => c.stronger)).toEqual([true]);
  }, 120_000);

  it('measures a count where every seat wins every game by final score, so a solo bot that scores more is stronger', async () => {
    const result = await runBotStrength(scoredSoloRules, { ...run, playerCounts: [1], bot: 'biggest', against: 'random' });

    expect(result.counts!.map((c) => [c.by, c.stronger])).toEqual([['score', true]]);
  }, 120_000);

  it('measures by wins, not score, when the bot loses games every seat always won without it', async () => {
    const result = await runBotStrength(scoredTeamRules, { ...run, playerCounts: [2], bot: 'biggest', against: 'random' });

    expect(result.counts!.map((c) => [c.by, c.stronger])).toEqual([['wins', false]]);
  }, 120_000);

  it('does not find a solo policy stronger by final score than the same policy', async () => {
    const result = await runBotStrength(scoredSoloRules, { ...run, playerCounts: [1], bot: 'random', against: 'random' });

    expect(result.counts!.map((c) => [c.by, c.stronger])).toEqual([['score', false]]);
  }, 120_000);
});

/** Runs bot-strength from inside `dir`. Returns what it printed and the exit code. */
async function botStrengthIn(
  options: Parameters<typeof botStrengthCommand>[0],
  dir = raceProject,
): Promise<{ printed: string; exitCode: unknown }> {
  const originalCwd = process.cwd();
  const originalExitCode = process.exitCode;
  const printed: string[] = [];
  const capture = (...parts: unknown[]) => void printed.push(parts.map(String).join(' '));
  const log = vi.spyOn(console, 'log').mockImplementation(capture);
  const error = vi.spyOn(console, 'error').mockImplementation(capture);
  process.chdir(dir);
  try {
    await botStrengthCommand(options);
    return { printed: stripVTControlCharacters(printed.join('\n')), exitCode: process.exitCode };
  } finally {
    process.chdir(originalCwd);
    process.exitCode = originalExitCode;
    log.mockRestore();
    error.mockRestore();
  }
}

describe('boardsmith bot-strength', () => {
  it('passes when the bot beats its opponents at every player count', async () => {
    const { printed, exitCode } = await botStrengthIn({ bot: 'biggest', games: '30', players: '2', seed: 'fixed', jobs: '2' });

    expect(exitCode).toBe(0);
    expect(printed).toMatch(/biggest beats random at every player count/);
  }, 120_000);

  it('fails, naming the player count and how to strengthen the bot, when the bot is not shown to beat them', async () => {
    const { printed, exitCode } = await botStrengthIn({ bot: 'random', games: '30', players: '2', seed: 'fixed', jobs: '2' });

    expect(exitCode).toBe(1);
    expect(printed).toMatch(/random is not shown to beat random at 2 players/);
    expect(printed).toMatch(/--seed fixed/);
  }, 120_000);

  it('passes a solo count by final score and names the metric it compared', async () => {
    const { printed, exitCode } = await botStrengthIn({ bot: 'biggest', games: '30', seed: 'fixed', jobs: '2' }, scoredSoloProject);

    expect(exitCode).toBe(0);
    expect(printed).toMatch(/points/);
    expect(printed).toMatch(/biggest beats random at every player count/);
  }, 120_000);

  it('fails a count where every seat wins every game, saying a finalScore metric would let it be measured', async () => {
    const { printed, exitCode } = await botStrengthIn({ bot: 'biggest', games: '30', seed: 'fixed', jobs: '2' }, unscoredSoloProject);

    expect(exitCode).toBe(1);
    expect(printed).toMatch(/biggest is not shown to beat random at 1 player: every seat won every game played as random, so win share cannot show/);
    expect(printed).toMatch(/finalScore metric/);
  }, 120_000);

  it('refuses an unknown policy by name before playing', async () => {
    const { printed, exitCode } = await botStrengthIn({ against: 'brute', games: '30', players: '2', seed: 'fixed', jobs: '2' });

    expect(exitCode).toBe(1);
    expect(printed).toMatch(/Unknown policy "brute"/);
  }, 120_000);
});
