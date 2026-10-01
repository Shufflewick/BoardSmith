/**
 * The in-browser smoke check (#453), run for real: `boardsmith dev` serving a scaffolded game, and
 * the game's own `tests/browser/smoke.spec.ts` walking it in Chromium.
 *
 * Each run needs the Chromium this BoardSmith's Playwright drives. Without it these tests fail
 * with the check's own message saying to run `boardsmith install-browser`; they are never skipped.
 */
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { REPO_ROOT } from '../spawn-cli.test-helper.js';
import { writeFiles } from '../lib/verify-result.test-helper.js';
import { browserProblem, runSmoke } from './smoke.js';
import { isRunning, smokeProject } from './smoke-project.test-helper.js';
import { KEYBOARD_ONLY_BOARD, PLAYERS_GET_THE_TABLE, QUIET_CLAIM_REASON, smokeSpec, TRUCE_GAME } from './smoke-fixtures.test-helper.js';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 120_000 });

const quiet = () => {};

/** Every process whose command line mentions `text`, other than this `ps` itself. */
function processesMentioning(text: string): string[] {
  const listed = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf-8' });
  return listed.split('\n').filter((line) => line.includes(text) && !line.includes('ps -axo'));
}

/** A table board that complains on the console the moment it renders. */
const COMPLAINING_BOARD = `<script setup lang="ts">
import { onMounted } from 'vue';
onMounted(() => console.error('the table lost its deck'));
</script>

<template>
  <div class="complaining-board">A board</div>
</template>
`;

/**
 * Runs the smoke check on the fixture `files` make of a scaffold, and holds it to leaving nothing
 * running and no copy behind, whatever its outcome.
 */
async function smokeOf(world: boolean, files: Record<string, string> = {}) {
  const dir = await smokeProject(world, files);
  const { outcome, pids } = await runSmoke({ projectDir: dir, log: quiet });
  expect(pids.filter(isRunning)).toEqual([]);
  expect(existsSync(join(dir, '.boardsmith', 'smoke'))).toBe(false);
  return { dir, outcome, pids };
}

describe('boardsmith verify: the smoke check', () => {
  it('walks the table scaffold: a seated player takes both of its actions, with no error, and nothing is left running', async () => {
    const { dir, outcome, pids } = await smokeOf(false);

    expect(outcome.summary).toMatch(/^Served by `boardsmith dev` from a fresh start, a seated player took "draw", "play"/);
    expect(outcome.passed).toBe(true);
    expect(outcome.counts).toMatchObject({ actions: 2 });
    expect(pids.length).toBeGreaterThanOrEqual(2);
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf-8' })).toBe('');
  });

  it("walks the world scaffold: the page attaches to a seat and takes the world's verb, with no error", async () => {
    const { dir, outcome } = await smokeOf(true);

    expect(outcome.summary).toMatch(/^Served by `boardsmith dev` from a fresh start, a seated player took "tend"/);
    expect(outcome.passed).toBe(true);
    expect(existsSync(join(dir, '.boardsmith-dev-world'))).toBe(false);
  });

  it('fails on a console error and on an action the spec does not list, naming both, and stops everything it started', async () => {
    const { outcome } = await smokeOf(false, {
      'src/ui/components/GameTable.vue': COMPLAINING_BOARD,
      'src/ui/uis.ts': PLAYERS_GET_THE_TABLE,
      'tests/browser/smoke.spec.ts':
        "import { defineSmokeTest } from 'boardsmith/testing/browser';\n\ndefineSmokeTest({ actions: ['draw'] });\n",
    });

    expect(outcome).toMatchObject({ passed: false, next: expect.stringMatching(/boardsmith smoke/) });
    expect(outcome.summary).toMatch(
      /^The smoke walk found 2 problems: - A console error: the table lost its deck.*The game offered "play", which tests\/browser\/smoke\.spec\.ts does not list\. Add it to `actions` there\./s,
    );
  });

  it('#457: presses a keyboard-only board control (invisible, no pointer, over a surface that takes the pointer) from the keyboard', async () => {
    const { outcome } = await smokeOf(false, KEYBOARD_ONLY_BOARD);

    expect(outcome.summary).toMatch(/^Served by `boardsmith dev` from a fresh start, a seated player took "draw", "play" and pressed 1 board control, with no error\./);
    expect(outcome.passed).toBe(true);
  });

  it(
    '#458, #459: takes a game-ending action once and starts a new game for the rest, then stops taking it so a game can go ' +
      'on, acts for the other seat to accept an offer, ' +
      'completes a two-card pick in the panel and a two-to-three-card pick on the board, and does not require the action the spec declares out of reach',
    async () => {
      const { outcome } = await smokeOf(false, {
        ...TRUCE_GAME,
        'tests/browser/smoke.spec.ts': smokeSpec(['concede', 'draw', 'play', 'trade', 'offerTruce', 'acceptTruce', 'rally', 'claimTruce'], {
          claimTruce: QUIET_CLAIM_REASON,
        }),
      });

      expect(outcome.summary).toMatch(
        /^Served by `boardsmith dev` from a fresh start, a seated player took "acceptTruce", "concede", "draw", "offerTruce", "play", "rally", "trade" and pressed \d+ board controls?, with no error, over [3-9] games \(a new one each time a game ended with listed actions still to take\)\. Not required, as tests\/browser\/smoke\.spec\.ts says a walk from a fresh game cannot reach them: "claimTruce"\.$/,
      );
      expect(outcome.passed).toBe(true);
    },
  );

  it('#458: reports an action the spec declares out of reach that the walk took anyway, so the declaration can go', async () => {
    const { outcome } = await smokeOf(false, {
      ...TRUCE_GAME,
      'tests/browser/smoke.spec.ts': smokeSpec(['concede', 'draw', 'play', 'trade', 'offerTruce', 'acceptTruce', 'rally', 'claimTruce'], {
        acceptTruce: 'Only the other seat may accept a truce, and a walk plays one seat.',
        claimTruce: QUIET_CLAIM_REASON,
      }),
    });

    expect(outcome.passed).toBe(true);
    expect(outcome.summary).toMatch(
      /The walk took "acceptTruce", which tests\/browser\/smoke\.spec\.ts says a walk from a fresh game cannot reach: remove it from `unreachable` there, so the walk requires it\.$/,
    );
  });

  it('fails a spec that passes without walking the game', async () => {
    const { outcome } = await smokeOf(false, {
      'tests/browser/smoke.spec.ts': "import { test } from '@playwright/test';\n\ntest('opens nothing', () => {});\n",
    });

    expect(outcome).toMatchObject({
      passed: false,
      summary: 'tests/browser/smoke.spec.ts passed without walking the game: it has no `defineSmokeTest` call, so nothing took an action.',
    });
  });

  it("fails with boardsmith dev's own words when it cannot start, and stops it", async () => {
    const { outcome, pids } = await smokeOf(false, { 'src/rules/index.ts': "throw new Error('these rules do not load');\n" });

    expect(pids.length).toBeGreaterThan(0);
    expect(outcome.summary).toMatch(/`boardsmith dev` stopped before it was ready\. Its last output: .*these rules do not load/s);
    expect(outcome).toMatchObject({ passed: false, next: expect.stringMatching(/^Run `boardsmith dev` to see it fail/) });
  });

  it('refuses a project with no smoke test, saying what to write, and starts nothing', async () => {
    const dir = await smokeProject(false);
    execFileSync('git', ['rm', '-q', 'tests/browser/smoke.spec.ts'], { cwd: dir });

    const { outcome, pids } = await runSmoke({ projectDir: dir, log: quiet });

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toBe('This project has no tests/browser/smoke.spec.ts, so nothing opens the game in a browser.');
    expect(outcome.next).toMatch(/defineSmokeTest\(\{ actions: \[/);
    expect(pids).toEqual([]);
  });

  it('stops boardsmith dev and the browser run, and removes its copy, when it is interrupted', async () => {
    const dir = await smokeProject(false);
    const cli = spawn(process.execPath, [join(REPO_ROOT, 'bin', 'boardsmith.js'), 'smoke'], { cwd: dir });
    let output = '';
    const serving = new Promise<string>((resolve) => {
      const read = (chunk: Buffer) => {
        output += chunk;
        const port = /serving a fresh copy of the game at http:\/\/127\.0\.0\.1:(\d+)/.exec(output)?.[1];
        if (port) resolve(port);
      };
      cli.stdout.on('data', read);
      cli.stderr.on('data', read);
    });
    const port = await serving;

    const exited = once(cli, 'exit');
    cli.kill('SIGTERM');
    const [, signal] = (await exited) as [number | null, NodeJS.Signals | null];

    expect(signal).toBe('SIGTERM');
    expect(processesMentioning(`dev --port ${port}`)).toEqual([]);
    expect(processesMentioning(join(dir, '.boardsmith', 'smoke'))).toEqual([]);
    expect(existsSync(join(dir, '.boardsmith', 'smoke'))).toBe(false);
  });
});

describe('browserProblem', () => {
  it('says which command installs the browser when it is missing, and nothing when it is there', async () => {
    const missing = browserProblem({ version: '1.63.0', executable: '/nowhere/chrome' });
    expect(missing?.passed).toBe(false);
    expect(missing?.summary).toMatch(/Playwright 1\.63\.0 looks for Chromium at \/nowhere\/chrome/);
    expect(missing?.next).toMatch(/^Run `boardsmith install-browser`/);

    const tree = tempTree('bs-smoke-browser-');
    await writeFiles(tree, { chrome: '' });
    expect(browserProblem({ version: '1.63.0', executable: join(tree, 'chrome') })).toBeUndefined();
  });
});
