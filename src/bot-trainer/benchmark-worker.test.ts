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
import { copyFileSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
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
 */
const RULES = `
import { Game, Player, Action, eachPlayer, actionStep, type GameOptions } from ${JSON.stringify(ENGINE)};
import { objectives } from './bot.js';

class HighCardGame extends Game<HighCardGame, Player> {
  picks: number[] = [];

  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create<HighCardGame>('pick')
        .chooseFrom('value', { choices: [1, 2] })
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

/** A game project with a bot to evolve. */
function gameProject(): string {
  const dir = tempTree('bs-benchmark-worker-401-');
  writeFileSync(join(dir, 'boardsmith.json'), JSON.stringify({ name: 'high-card', backend: 'table' }));
  mkdirSync(join(dir, 'src', 'rules'), { recursive: true });
  writeFileSync(join(dir, 'src', 'rules', 'index.ts'), RULES);
  writeFileSync(join(dir, 'src', 'rules', 'bot.ts'), BOT);
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

/** Run `boardsmith evolve-bot-weights` from `bin` in a fresh project, as a person would. */
function evolveWith(bin: string): { status: number | null; output: string } {
  const run = spawnSync(
    process.execPath,
    [bin, 'evolve-bot-weights', '--generations', '1', '--population', '2', '--mcts', '1', '--workers', '1'],
    { cwd: gameProject(), encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } },
  );
  return { status: run.status, output: stripVTControlCharacters(`${run.stdout}${run.stderr}`) };
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

describe('evolve-bot-weights starts real benchmark workers (#401)', () => {
  it('from this checkout, where the CLI runs the TypeScript sources', () => {
    expectEvolvedInRealWorkers(evolveWith(join(REPO_ROOT, 'bin', 'boardsmith.js')));
  }, 180_000);

  it('from an installed package, where the CLI runs the built bundle', () => {
    expectEvolvedInRealWorkers(evolveWith(join(INSTALLED, 'bin', 'boardsmith.js')));
  }, 180_000);
});
