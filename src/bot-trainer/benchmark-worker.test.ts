/**
 * #401: `evolve-bot-weights` benchmarks each candidate in a real worker thread,
 * and the worker's entry file has to exist wherever the CLI runs. It did not in
 * either place: from this checkout the worker was asked for as a `.js` file
 * beside the TypeScript sources, and in an installed package the CLI bundle
 * asked for `dist/benchmark-worker.js`, which the build did not emit. Every
 * other test of the evolver fakes the workers, so nothing noticed.
 *
 * So both tests here run the real `boardsmith evolve-bot-weights` as a child
 * process, through `bin/boardsmith.js`, the file both kinds of install start
 * from, and each starts real workers:
 *
 * - from this checkout, where `bin/boardsmith.js` runs the sources under tsx;
 * - from an installed layout (`bin/`, `dist/` and `package.json`, no `.git`),
 *   where it runs the CLI bundle. `dist/` is built here with the options
 *   `boardsmith build` and `boardsmith pack` use, so what runs is what ships.
 *
 * `src/contract/shipped-imports.test.ts` holds the other half: that npm
 * publishes every file that build emits.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { build } from 'esbuild';

import { cliBuildOptions } from '../cli/lib/build-cli.js';
import { REPO_ROOT } from '../contract/vue-tsc-run.test-helper.js';
import { INSTALLED_MODULES } from '../testing/installed-modules.test-helper.js';
import { tempTree } from '../testing/temp-tree.test-helper.js';

const ENGINE = join(REPO_ROOT, 'src/engine/index.ts');

/**
 * Both seats pick 1 or 2 once, and the higher total wins. Small enough that a
 * benchmark of a few hundred games finishes quickly, and decided by the moves,
 * so every game reaches an outcome.
 *
 * Each seat may pick only a value it holds a card for, in a hand no other seat
 * sees (#697). A bot searching from one seat's view cannot see the other
 * seat's hand, so the engine drops that seat's moves from the search rather
 * than guess them. That works only when the bot's code and the game's elements
 * come from one copy of the engine: with two, the bot does not recognise the
 * game's "this copy cannot know that" error, and every benchmark game crashes.
 */
const RULES = `
import { Game, Player, Piece, Space, Action, eachPlayer, actionStep, type GameOptions } from ${JSON.stringify(ENGINE)};
import { objectives } from './bot.js';

class Card extends Piece<HighCardGame> {
  rank!: number;
}

class Hand extends Space<HighCardGame> {}

class HighCardGame extends Game<HighCardGame, Player> {
  picks: number[] = [];

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Card, Hand]);
    for (const player of this.all(Player)) {
      const hand = this.create(Hand, \`hand-\${player.seat}\`);
      hand.player = player;
      hand.contentsVisibleToOwner();
      for (const rank of [1, 2]) hand.create(Card, \`card-\${player.seat}-\${rank}\`, { rank });
    }
    this.registerAction(
      Action.create<HighCardGame>('pick')
        .chooseFrom('value', { choices: [1, 2] })
        .validate((args, ctx) =>
          this.first(Hand, \`hand-\${ctx.player.seat}\`)!.all(Card).some((card) => card.rank === args.value),
        )
        .execute((args, ctx) => {
          const game = ctx.game as HighCardGame;
          game.picks.push(args.value as number);
          if (game.picks.length === game.players.length) {
            const [first, second] = game.picks;
            game.finish(first === second ? [...game.players] : [game.players[first > second ? 0 : 1]]);
          }
          return { success: true };
        }),
    );
    this.setFlow({ root: eachPlayer({ do: actionStep({ actions: ['pick'] }) }) });
  }
}

export const gameDefinition = {
  gameClass: HighCardGame,
  gameType: 'high-card',
  displayName: 'High Card',
  minPlayers: 2,
  maxPlayers: 2,
  bot: { objectives },
};
`;

const BOT = [
  'export const objectives = () => ({',
  "  'always': { checker: (game, playerIndex) => true, weight: 5 },",
  '});',
  '',
].join('\n');

/**
 * Nim from 21 stones, taking 1 to 3, where taking the last stone wins. Its
 * best moves lie several turns ahead, so a search of a few iterations finds
 * them only some of the time, and an unseeded benchmark's win rate differs
 * from run to run (#699). The objective, a multiple of 4 left, is the winning
 * strategy, so its weight matters.
 */
const NIM_RULES = `
import { Game, Player, Action, loop, eachPlayer, actionStep, type GameOptions } from ${JSON.stringify(ENGINE)};
import { objectives } from './bot.js';

class NimGame extends Game<NimGame, Player> {
  stones = 21;

  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create<NimGame>('take')
        .chooseFrom('count', { choices: () => [1, 2, 3].filter((n) => n <= this.stones) })
        .execute((args, ctx) => {
          const game = ctx.game as NimGame;
          game.stones -= args.count as number;
          if (game.stones === 0) game.finish([ctx.player]);
        }),
    );
    this.setFlow({ root: loop({ maxIterations: 30, do: eachPlayer({ do: actionStep({ actions: ['take'] }) }) }) });
  }
}

export const gameDefinition = {
  gameClass: NimGame,
  gameType: 'nim',
  displayName: 'Nim',
  minPlayers: 2,
  maxPlayers: 2,
  bot: { objectives },
};
`;

const NIM_BOT = [
  'export const objectives = (game) => ({',
  "  'multiple-of-four': { checker: () => game.stones % 4 === 0, weight: 1 },",
  '});',
  '',
].join('\n');

/** A game project with a bot to evolve: High Card unless other rules are given. */
function gameProject(rules = RULES, bot = BOT): string {
  const dir = tempTree('bs-benchmark-worker-401-');
  writeFileSync(join(dir, 'boardsmith.json'), JSON.stringify({ name: 'evolve-fixture', backend: 'table' }));
  mkdirSync(join(dir, 'src', 'rules'), { recursive: true });
  writeFileSync(join(dir, 'src', 'rules', 'index.ts'), rules);
  writeFileSync(join(dir, 'src', 'rules', 'bot.ts'), bot);
  return dir;
}

/**
 * BoardSmith as an install lays it out: `package.json`, `bin/`, `src/` and the
 * built `dist/`, with no `.git`, so `bin/boardsmith.js` runs the bundle. `src/`
 * and the packages are this checkout's, since copying them is not what is under
 * test. `dist/` is built from inside it, as `boardsmith pack` builds it in the
 * package it packs. Built here, at the top of the file, where no test timeout
 * applies.
 */
const INSTALLED = tempTree('bs-benchmark-worker-401-install-');
mkdirSync(join(INSTALLED, 'bin'));
copyFileSync(join(REPO_ROOT, 'bin', 'boardsmith.js'), join(INSTALLED, 'bin', 'boardsmith.js'));
copyFileSync(join(REPO_ROOT, 'package.json'), join(INSTALLED, 'package.json'));
symlinkSync(join(REPO_ROOT, 'src'), join(INSTALLED, 'src'), 'dir');
symlinkSync(INSTALLED_MODULES, join(INSTALLED, 'node_modules'), 'dir');
await build(cliBuildOptions(INSTALLED));

/**
 * Run `boardsmith evolve-bot-weights` from `bin` in a fresh project, as a person
 * would (in `cwd`, a fresh High Card project by default), with `--workers 1`
 * and then `flags`. `botTs` is the bot.ts it leaves.
 */
function evolveWith(
  bin: string,
  flags: string[] = [],
  cwd = gameProject(),
): { status: number | null; output: string; botTs: string } {
  const run = spawnSync(
    process.execPath,
    [bin, 'evolve-bot-weights', '--generations', '1', '--population', '2', '--mcts', '5', '--workers', '1', ...flags],
    { cwd, encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } },
  );
  return {
    status: run.status,
    output: stripVTControlCharacters(`${run.stdout}${run.stderr}`),
    botTs: readFileSync(join(cwd, 'src', 'rules', 'bot.ts'), 'utf-8'),
  };
}

/** What a finished evolution whose every benchmark ran in a working worker prints. */
function expectEvolvedInRealWorkers({ status, output }: { status: number | null; output: string }): void {
  // A worker that fails to start reports "Benchmark worker crashed"; one that
  // starts but cannot run its benchmark reports "Benchmark worker error". The
  // second still lets the evolution finish, scoring the candidate 0, so the
  // exit code alone would miss it.
  expect(output).not.toContain('Benchmark worker');
  expect(status, output).toBe(0);
  expect(output).toContain('Evolution complete');
  expect(output).toContain('Initial win rate:');
}

describe('evolve-bot-weights benchmarks in real workers, on the engine the game is built with (#401, #697)', () => {
  it('from this checkout, where the CLI runs the TypeScript sources', () => {
    expectEvolvedInRealWorkers(evolveWith(join(REPO_ROOT, 'bin', 'boardsmith.js')));
  }, 180_000);

  it('from an installed package, where the CLI runs the built bundle', () => {
    expectEvolvedInRealWorkers(evolveWith(join(INSTALLED, 'bin', 'boardsmith.js')));
  }, 180_000);
});

describe('evolve-bot-weights --seed is reproducible whatever the worker count (#699)', () => {
  /** What a seeded run decided: its printed results and the weights it wrote, without the date it ran. */
  function decided(bin: string, flags: string[]): string {
    const run = evolveWith(bin, flags, gameProject(NIM_RULES, NIM_BOT));
    expectEvolvedInRealWorkers(run);
    const results = run.output.slice(run.output.indexOf('=== Evolution Results'), run.output.indexOf('=== Done'));
    return `${results}\n${run.botTs.replace(/^\/\/ Weight Evolution \(.*\):$/m, '')}`;
  }

  it('evolves the same weights from the same seed, on one worker or three', () => {
    const bin = join(REPO_ROOT, 'bin', 'boardsmith.js');
    const flags = ['--population', '4', '--mcts', '10', '--seed', 'repeatable'];
    const onOne = decided(bin, flags);
    expect(onOne).toContain('Optimized weights:');
    expect(decided(bin, flags)).toBe(onOne);
    expect(decided(bin, [...flags, '--workers', '3'])).toBe(onOne);
  }, 300_000);
});
