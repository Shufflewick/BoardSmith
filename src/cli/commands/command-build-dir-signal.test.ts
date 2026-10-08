/**
 * A RUN STOPPED BY A SIGNAL REMOVES ITS BUILD DIRECTORY (#543).
 *
 * Every run of validate, simulate, build and evolve-bot-weights bundles the rules into a build
 * directory of its own under `.boardsmith/` and removes it in a `finally`. Node skips `finally`
 * when a signal ends the process, so a run stopped with Ctrl+C left its directory behind, and
 * since each run names its own, they piled up.
 *
 * The rules here print a line and then never finish loading, so each command is stopped while
 * it holds its build directory with the bundle in it. Spawned through the real CLI, because what
 * is under test is how the PROCESS ends.
 *
 * build and evolve-bot-weights go through the same `withCommandBuildDir` (`build.test.ts` holds
 * every command to it) but are not spawned here: build runs Vite over the rules before it loads
 * them, and evolve-bot-weights needs a bot with objectives, so neither reaches its build
 * directory in this project.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';

import { devProject, EXIT_WITHIN_MS } from './dev-project.test-helper.js';
import { collectOutput } from '../lib/child-output.js';
import { REPO_ROOT } from '../spawn-cli.test-helper.js';
import { commandBuildDirs } from '../lib/command-build-dirs.test-helper.js';

// Each run bundles the project's rules. A hang guard, not a budget.
vi.setConfig({ testTimeout: 120_000 });

const LOADING = 'the rules are loading and will not finish';

/** Rules that announce they are loading and then never finish, keeping the process alive. */
const HANGING_RULES = [
  `console.log(${JSON.stringify(LOADING)});`,
  'await new Promise(() => { setInterval(() => {}, 1_000); });',
  'export const gameDefinition = {};',
].join('\n');

/** Run `boardsmith <args>` in `cwd`, send `signal` once the rules are loading, and say how it ended. */
async function stopWhileLoading(cwd: string, args: string[], signal: NodeJS.Signals) {
  const child = spawn(process.execPath, [join(REPO_ROOT, 'bin', 'boardsmith.js'), ...args], { cwd });
  const output = collectOutput(child);
  const ended = new Promise<{ signal: NodeJS.Signals | null; stuck: boolean }>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ signal: null, stuck: true });
    }, EXIT_WITHIN_MS);
    child.on('exit', (_code, endedBy) => {
      clearTimeout(timer);
      resolve({ signal: endedBy, stuck: false });
    });
  });
  const loading = await new Promise<boolean>((resolve) => {
    child.stdout.on('data', () => {
      if (output().includes(LOADING)) resolve(true);
    });
    child.on('exit', () => resolve(false));
  });
  expect(loading, `boardsmith ${args[0]} ended before its rules started loading:\n${output()}`).toBe(true);
  child.kill(signal);
  return { ...(await ended), output: output() };
}

describe('a run stopped by a signal removes its build directory (#543)', () => {
  for (const [command, signal] of [
    ['simulate', 'SIGINT'],
    ['validate', 'SIGTERM'],
  ] as const) {
    it(`${command}, stopped with ${signal}`, async () => {
      const cwd = await devProject(false);
      writeFileSync(join(cwd, 'src', 'rules', 'index.ts'), HANGING_RULES);

      const ended = await stopWhileLoading(cwd, [command], signal);

      expect(ended.stuck, ended.output).toBe(false);
      // It still ends the way that signal ends a process, so a stopped run never reads as a pass.
      expect(ended.signal, ended.output).toBe(signal);
      expect(commandBuildDirs(cwd, command), `the build directory was left behind:\n${ended.output}`).toEqual([]);
    });
  }
});
