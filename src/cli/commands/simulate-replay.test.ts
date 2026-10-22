/**
 * #322: the replay command BoardSmith prints for a failing random game must
 * play THAT game. Each test takes the command BoardSmith printed in a real
 * project, has a shell split it into words exactly as a pasted line would be,
 * hands those words to the real `boardsmith` command tree, and checks that the
 * replay fails the same way.
 *
 * One command per file runs as a real child process, because the entry point's
 * wiring is worth one spawn. Every other command runs in-process: each spawn is
 * seconds of Node and tsx start-up, and several of them in one test timed out
 * on a loaded machine (#340).
 */
import { describe, it, expect, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { CommanderError } from 'commander';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { createProgram } from '../cli.js';
import { projectRules, validateChoiceCardinality } from './validate.js';
import { scoreProject } from './simulate-project.test-helper.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(here, 'simulate.fixture.ts');
// These tests run the fixture by its path; this links them to it, loading nothing (#1415).
import.meta.glob('./simulate.fixture.ts');
const simIndex = resolve(here, '../../sim/index.ts');
const cli = resolve(here, '../../../bin/boardsmith.js');

/** A table-game project whose rules are the dead-end fixture game, with a greedy policy named `biggest`. */
function deadEndProject(): string {
  const cwd = tempTree('bs-simulate-replay-');
  writeFileSync(join(cwd, 'boardsmith.json'), JSON.stringify({ name: 'fixture', backend: 'table', gameOptions: [{ id: 'deadEnd', type: 'number', label: 'Dead end', default: 5 }] }));
  mkdirSync(join(cwd, 'src', 'rules'), { recursive: true });
  writeFileSync(
    join(cwd, 'src', 'rules', 'index.ts'),
    [
      `import { DeadEndGame } from ${JSON.stringify(fixture)};`,
      `export const gameDefinition = { gameClass: DeadEndGame, gameType: 'fixture', displayName: 'Fixture',`,
      `  minPlayers: 3, maxPlayers: 4 };`,
    ].join('\n'),
  );
  mkdirSync(join(cwd, 'src', 'sim'), { recursive: true });
  writeFileSync(
    join(cwd, 'src', 'sim', 'index.ts'),
    [
      `import { greedy } from ${JSON.stringify(simIndex)};`,
      `export const policies = { biggest: greedy((_game, move) => Number(move.args.amount)) };`,
    ].join('\n'),
  );
  return cwd;
}

/** Run a `boardsmith ...` command line through a shell as a real process, as a person pasting it would. */
function spawnPrinted(cwd: string, commandLine: string): string {
  expect(commandLine.startsWith('boardsmith ')).toBe(true);
  const run = spawnSync(`node ${JSON.stringify(cli)}${commandLine.slice('boardsmith'.length)}`, {
    cwd,
    shell: true,
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
  });
  return `${run.stdout}${run.stderr}`;
}

/** The words a POSIX shell makes of `line`, quoting and all. */
function shellWords(line: string): string[] {
  const run = spawnSync('sh', ['-c', `printf '%s\\0' ${line}`], { encoding: 'utf-8' });
  expect(run.status, run.stderr).toBe(0);
  return run.stdout.split('\0').slice(0, -1);
}

/**
 * Run a printed `boardsmith ...` command line in-process: the shell splits it,
 * the real command tree parses it in `cwd`, and everything it prints, commander's
 * own refusals included, comes back as one string.
 */
async function runPrinted(cwd: string, commandLine: string): Promise<string> {
  expect(commandLine.startsWith('boardsmith ')).toBe(true);
  const words = shellWords(commandLine.slice('boardsmith '.length));
  const printed: string[] = [];
  const capture = (...parts: unknown[]) => void printed.push(parts.map(String).join(' '));
  const program = createProgram();
  const command = program.commands.find((c) => c.name() === words[0]);
  expect(command, `${words[0]} is not a boardsmith command`).toBeDefined();
  for (const each of [program, command!]) {
    each.exitOverride().configureOutput({ writeOut: capture, writeErr: capture });
  }
  const log = vi.spyOn(console, 'log').mockImplementation(capture);
  const error = vi.spyOn(console, 'error').mockImplementation(capture);
  const home = process.cwd();
  const exitCode = process.exitCode;
  process.chdir(cwd);
  try {
    await program.parseAsync(words, { from: 'user' });
  } catch (err) {
    if (!(err instanceof CommanderError)) throw err;
  } finally {
    process.chdir(home);
    process.exitCode = exitCode;
    log.mockRestore();
    error.mockRestore();
  }
  return stripVTControlCharacters(printed.join('\n'));
}

/** A failing game as `boardsmith simulate` reports it, minus its position in the run. */
interface ReportedFailure {
  seed: string;
  status: string;
  turns: string;
  error: string;
  replay: string;
}

function failuresIn(output: string): ReportedFailure[] {
  return [...output.matchAll(/^Game \d+ (\w+) \(seed (.+?)\) after (\d+) action\(s\)\.\n {2}(.+)\n {2}Replay: (.+)$/gm)].map(
    (m) => ({ status: m[1], seed: m[2], turns: m[3], error: m[4], replay: m[5] }),
  );
}

describe('a printed replay command plays the game that failed (#322)', () => {
  it('boardsmith simulate: every failing game replays to the same failure', async () => {
    const cwd = deadEndProject();

    const output = spawnPrinted(
      cwd,
      `boardsmith simulate --games 6 --players 3 --seed 'replay me' --game-option deadEnd=7`,
    );
    const failures = failuresIn(output);
    // Not the first game only: a later game's seed is the one a base-seed hint gets wrong.
    expect(failures.filter((f) => !f.seed.endsWith('-0')).length, output).toBeGreaterThan(0);

    for (const failure of failures) {
      const replayed = failuresIn(await runPrinted(cwd, failure.replay));
      expect(replayed, failure.replay).toEqual([failure]);
    }
  }, 60_000);

  it('boardsmith simulate: a failing game played by other policies replays with them (#556)', async () => {
    const cwd = deadEndProject();

    const output = await runPrinted(
      cwd,
      `boardsmith simulate --games 6 --players 3 --seed 'greedy replay' --game-option deadEnd=7 --policy 2=biggest`,
    );
    const failures = failuresIn(output);
    expect(failures.length, output).toBeGreaterThan(0);

    for (const failure of failures) {
      expect(failure.replay).toContain('--policy 2=biggest');
      const replayed = failuresIn(await runPrinted(cwd, failure.replay));
      expect(replayed, failure.replay).toEqual([failure]);
    }
  }, 60_000);

  it('boardsmith simulate --compare: a failing variant replays with its data file swapped (#556)', async () => {
    const cwd = scoreProject();

    const output = await runPrinted(
      cwd,
      'boardsmith simulate --games 2 --players 2 --seed swap --game-option limit=4 --compare src/rules/data/amounts.csv=data/one.csv,data/three.csv',
    );
    // A limit of 4 stops every game short of the target of 6, whichever amounts it plays.
    const failures = failuresIn(output);
    expect(failures, output).toHaveLength(4);
    expect(failures.filter((f) => f.replay.includes('--compare src/rules/data/amounts.csv=data/three.csv'))).toHaveLength(2);

    for (const failure of failures) {
      expect(failure.replay).toContain('--game-option limit=4');
      const replayed = failuresIn(await runPrinted(cwd, failure.replay));
      expect(replayed, failure.replay).toEqual([failure]);
    }
  }, 60_000);

  it('boardsmith simulate refuses --replay alongside a batch flag, which it would ignore', async () => {
    const cwd = deadEndProject();

    expect(await runPrinted(cwd, 'boardsmith simulate --replay x-3-0 --seed x')).toMatch(/--replay.*cannot be used with.*--seed/);
    expect(await runPrinted(cwd, 'boardsmith simulate --replay x-3-0 --games 2')).toMatch(/--replay.*cannot be used with.*--games/);
    expect(await runPrinted(cwd, 'boardsmith simulate --replay x-3-0 --jobs 2')).toMatch(/--replay.*cannot be used with.*--jobs/);
  });

  it('boardsmith validate: the choice cardinality check names a command that replays its failure', async () => {
    const cwd = deadEndProject();

    const result = await validateChoiceCardinality(projectRules(cwd), false);
    const failure = /seed (\S+): (.+?)\. "(boardsmith [^"]+)" shows the same failure/s.exec(result.message);
    expect(failure, result.message).not.toBeNull();
    const [, seed, reason, command] = failure!;

    const replayed = failuresIn(await runPrinted(cwd, command));
    expect(replayed).toHaveLength(1);
    expect(replayed[0].seed).toBe(seed);
    expect(`${replayed[0].error}.`).toContain(reason);
  }, 60_000);
});
