/**
 * #399: evolve-bot-weights bundles the project's rules itself, from source,
 * into its own `commandBuildDir`, the way simulate does, and hands that bundle
 * to the weight evolver's workers. It used to look for three prebuilt files,
 * one of which (`.boardsmith/rules-bundle.mjs`) no command writes.
 *
 * The evolver is replaced here, because a real evolution plays hundreds of
 * games in worker threads. What is under test is where the rules come from:
 * the path the evolver is given, that the file exists and loads while the
 * evolution runs, and that it is gone afterwards with the rest of
 * `.boardsmith/` untouched.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { commandBuildDir, scratchDir } from '../lib/project-paths.js';

interface EvolverCall {
  gameType: string;
  modulePath: string;
  bundleExistedDuringEvolution: boolean;
  bundleExportedGameClass: boolean;
}
const evolverCalls: EvolverCall[] = [];

vi.mock('../../bot-trainer/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../bot-trainer/index.js')>();
  class RecordingEvolver {
    constructor(
      _gameClass: unknown,
      private readonly gameType: string,
      private readonly modulePath: string,
    ) {}
    async evolve(objectives: Array<{ featureId: string; weight: number }>) {
      const bundleExistedDuringEvolution = existsSync(this.modulePath);
      let bundleExportedGameClass = false;
      if (bundleExistedDuringEvolution) {
        // Dynamic import: the bundle the command under test just wrote.
        const loaded = (await import(`${pathToFileURL(this.modulePath).href}?probe=${evolverCalls.length}`)) as {
          gameDefinition?: { gameClass?: unknown };
        };
        bundleExportedGameClass = typeof loaded.gameDefinition?.gameClass === 'function';
      }
      evolverCalls.push({
        gameType: this.gameType,
        modulePath: this.modulePath,
        bundleExistedDuringEvolution,
        bundleExportedGameClass,
      });
      return { initialFitness: 0.5, bestFitness: 0.5, objectives };
    }
  }
  return { ...original, WeightEvolver: RecordingEvolver };
});

const { evolveBotWeightsCommand } = await import('./evolve-bot-weights.js');

const fixture = resolve(dirname(fileURLToPath(import.meta.url)), 'simulate.fixture.ts');

const BOT = [
  'export const objectives = () => ({',
  "  'always': { checker: (game, playerIndex) => true, weight: 5 },",
  '});',
  '',
].join('\n');

/** A game project whose rules index is `rules` and whose rules directory holds a bot; the cwd moves into it. */
function projectWith(rules: string): string {
  const dir = tempTree('boardsmith-evolve-399-');
  writeFileSync(join(dir, 'boardsmith.json'), JSON.stringify({ name: 'fixture', backend: 'table' }));
  mkdirSync(join(dir, 'src', 'rules'), { recursive: true });
  writeFileSync(join(dir, 'src', 'rules', 'index.ts'), rules);
  writeFileSync(join(dir, 'src', 'rules', 'bot.ts'), BOT);
  process.chdir(dir);
  return dir;
}

describe('evolve-bot-weights bundles the rules into its own build directory (#399)', () => {
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    evolverCalls.length = 0;
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it('evolves against a fresh bundle of the source rules and removes only that bundle', async () => {
    const dir = projectWith(
      [
        `import { DeadEndGame } from ${JSON.stringify(fixture)};`,
        `export const gameDefinition = { gameClass: DeadEndGame, gameType: 'dead-end', displayName: 'Fixture',`,
        `  minPlayers: 3, maxPlayers: 4 };`,
      ].join('\n'),
    );
    const scratchFile = join(scratchDir(dir), 'keep.txt');
    mkdirSync(scratchDir(dir), { recursive: true });
    writeFileSync(scratchFile, 'keep me\n');

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await evolveBotWeightsCommand({ generations: '1', population: '1', mcts: '1', workers: '1' });
    } finally {
      log.mockRestore();
    }

    expect(evolverCalls).toHaveLength(1);
    const [call] = evolverCalls;
    expect(call.gameType).toBe('dead-end');
    expect(dirname(call.modulePath)).toBe(commandBuildDir(process.cwd(), 'evolve-bot-weights'));
    expect(call.bundleExistedDuringEvolution, 'the workers were handed a path with no file behind it').toBe(true);
    expect(call.bundleExportedGameClass, 'the bundle did not export the game class').toBe(true);

    expect(existsSync(commandBuildDir(dir, 'evolve-bot-weights')), 'the build directory was left behind').toBe(false);
    expect(readFileSync(scratchFile, 'utf-8')).toBe('keep me\n');
  });

  it('removes its build directory when the rules fail to load, and says so readably', async () => {
    const dir = projectWith('export const gameDefinition = ;\n');

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await expect(evolveBotWeightsCommand({ generations: '1', population: '1' })).rejects.toThrow(
        "Evolving this bot's weights failed",
      );
    } finally {
      log.mockRestore();
    }
    expect(evolverCalls).toHaveLength(0);
    expect(existsSync(commandBuildDir(dir, 'evolve-bot-weights'))).toBe(false);
  });
});
