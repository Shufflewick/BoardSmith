/**
 * #322: the replay command BoardSmith prints for a failing random game must
 * play THAT game. Each test runs the real CLI in a real project, takes the
 * command it printed, runs it exactly as printed through a shell, and checks
 * that the replay fails the same way.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { validateChoiceCardinality } from './validate.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(here, 'simulate.fixture.ts');
const cli = resolve(here, '../../../bin/boardsmith.js');

/** A table-game project whose rules are the dead-end fixture game. */
function deadEndProject(): string {
  const cwd = tempTree('bs-simulate-replay-');
  writeFileSync(join(cwd, 'boardsmith.json'), JSON.stringify({ name: 'fixture', backend: 'table' }));
  mkdirSync(join(cwd, 'src', 'rules'), { recursive: true });
  writeFileSync(
    join(cwd, 'src', 'rules', 'index.ts'),
    [
      `import { DeadEndGame } from ${JSON.stringify(fixture)};`,
      `export const gameDefinition = { gameClass: DeadEndGame, gameType: 'fixture', displayName: 'Fixture',`,
      `  minPlayers: 3, maxPlayers: 4, gameOptions: { deadEnd: { type: 'number', label: 'Dead end' } } };`,
    ].join('\n'),
  );
  return cwd;
}

/** Run a `boardsmith ...` command line through a shell, as a person pasting it would. */
function runPrinted(cwd: string, commandLine: string): string {
  expect(commandLine.startsWith('boardsmith ')).toBe(true);
  const run = spawnSync(`node ${JSON.stringify(cli)}${commandLine.slice('boardsmith'.length)}`, {
    cwd,
    shell: true,
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
  });
  return `${run.stdout}${run.stderr}`;
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
  const turnsBySeed = new Map(
    [...output.matchAll(/Game \d+ \(seed (.+)\): (\w+) \S+ (\d+) turn\(s\)/g)].map((m) => [m[1], m[3]]),
  );
  return [...output.matchAll(/^Game \d+ (\w+) \(seed (.+)\)\.\n {2}(.+)\n {2}Replay: (.+)$/gm)].map((m) => ({
    status: m[1],
    seed: m[2],
    turns: turnsBySeed.get(m[2]) ?? 'missing',
    error: m[3],
    replay: m[4],
  }));
}

describe('a printed replay command plays the game that failed (#322)', () => {
  it('boardsmith simulate: every failing game replays to the same failure', () => {
    const cwd = deadEndProject();

    const output = runPrinted(
      cwd,
      `boardsmith simulate --games 6 --players 3 --seed 'replay me' --game-option deadEnd=7`,
    );
    const failures = failuresIn(output);
    // Not the first game only: a later game's seed is the one a base-seed hint gets wrong.
    expect(failures.filter((f) => !f.seed.endsWith('-0')).length, output).toBeGreaterThan(0);

    for (const failure of failures) {
      const replayed = failuresIn(runPrinted(cwd, failure.replay));
      expect(replayed, failure.replay).toEqual([failure]);
    }
  }, 120_000);

  it('boardsmith simulate refuses --replay alongside a batch flag, which it would ignore', () => {
    const cwd = deadEndProject();

    expect(runPrinted(cwd, 'boardsmith simulate --replay x-3-0 --seed x')).toMatch(/--replay.*cannot be used with.*--seed/);
    expect(runPrinted(cwd, 'boardsmith simulate --replay x-3-0 --games 2')).toMatch(/--replay.*cannot be used with.*--games/);
  }, 60_000);

  it('boardsmith validate: the choice cardinality check names a command that replays its failure', async () => {
    const cwd = deadEndProject();

    const result = await validateChoiceCardinality(cwd, false);
    const failure = /seed (\S+): (.+?)\. "(boardsmith [^"]+)" shows the same failure/s.exec(result.message);
    expect(failure, result.message).not.toBeNull();
    const [, seed, reason, command] = failure!;

    const replayed = failuresIn(runPrinted(cwd, command));
    expect(replayed).toHaveLength(1);
    expect(replayed[0].seed).toBe(seed);
    expect(`${replayed[0].error}.`).toContain(reason);
  }, 120_000);
});
