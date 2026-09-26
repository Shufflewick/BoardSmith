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
 *
 * Both runs happen while the file is collected, where no test timeout applies
 * (#354, #355, #363, #417): a run bundles the rules and loads the bot trainer's
 * module graph, several seconds on a busy machine. The tests assert what each
 * run recorded.
 */
import { describe, it, expect, vi } from 'vitest';
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

/** A game project whose rules index is `rules` and whose rules directory holds a bot. */
function projectWith(rules: string): string {
  const dir = tempTree('boardsmith-evolve-399-');
  writeFileSync(join(dir, 'boardsmith.json'), JSON.stringify({ name: 'fixture', backend: 'table' }));
  mkdirSync(join(dir, 'src', 'rules'), { recursive: true });
  writeFileSync(join(dir, 'src', 'rules', 'index.ts'), rules);
  writeFileSync(join(dir, 'src', 'rules', 'bot.ts'), BOT);
  return dir;
}

interface EvolveRun {
  /** The project's directory, as the command saw it as its cwd. */
  projectDir: string;
  evolverCalls: EvolverCall[];
  /** What the command threw, or undefined when it finished. */
  error: unknown;
}

/** Runs the command from inside `dir`, then moves the cwd back. */
async function evolveIn(dir: string, options: Parameters<typeof evolveBotWeightsCommand>[0]): Promise<EvolveRun> {
  const originalCwd = process.cwd();
  evolverCalls.length = 0;
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  process.chdir(dir);
  const projectDir = process.cwd();
  let error: unknown;
  try {
    await evolveBotWeightsCommand(options);
  } catch (thrown) {
    error = thrown;
  } finally {
    process.chdir(originalCwd);
    log.mockRestore();
  }
  return { projectDir, evolverCalls: [...evolverCalls], error };
}

const evolvedDir = projectWith(
  [
    `import { DeadEndGame } from ${JSON.stringify(fixture)};`,
    `export const gameDefinition = { gameClass: DeadEndGame, gameType: 'dead-end', displayName: 'Fixture',`,
    `  minPlayers: 3, maxPlayers: 4 };`,
  ].join('\n'),
);
const scratchFile = join(scratchDir(evolvedDir), 'keep.txt');
mkdirSync(scratchDir(evolvedDir), { recursive: true });
writeFileSync(scratchFile, 'keep me\n');
const evolved = await evolveIn(evolvedDir, { generations: '1', population: '1', mcts: '1', workers: '1' });

const brokenDir = projectWith('export const gameDefinition = ;\n');
const broken = await evolveIn(brokenDir, { generations: '1', population: '1' });

describe('evolve-bot-weights bundles the rules into its own build directory (#399)', () => {
  it('evolves against a fresh bundle of the source rules and removes only that bundle', () => {
    expect(evolved.error).toBeUndefined();
    expect(evolved.evolverCalls).toHaveLength(1);
    const [call] = evolved.evolverCalls;
    expect(call.gameType).toBe('dead-end');
    expect(dirname(call.modulePath)).toBe(commandBuildDir(evolved.projectDir, 'evolve-bot-weights'));
    expect(call.bundleExistedDuringEvolution, 'the workers were handed a path with no file behind it').toBe(true);
    expect(call.bundleExportedGameClass, 'the bundle did not export the game class').toBe(true);

    expect(existsSync(commandBuildDir(evolvedDir, 'evolve-bot-weights')), 'the build directory was left behind').toBe(
      false,
    );
    expect(readFileSync(scratchFile, 'utf-8')).toBe('keep me\n');
  });

  it('removes its build directory when the rules fail to load, and says so readably', () => {
    expect(broken.error).toBeInstanceOf(Error);
    expect((broken.error as Error).message).toContain("Evolving this bot's weights failed");
    expect(broken.evolverCalls).toHaveLength(0);
    expect(existsSync(commandBuildDir(brokenDir, 'evolve-bot-weights'))).toBe(false);
  });
});
