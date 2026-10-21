/**
 * The in-browser smoke check (#453), run for real: the walks of the scaffolds, a spec it refuses,
 * and how it starts and stops. smoke-walk.test-helper.ts says how each walk runs. The check's tests
 * are split across the smoke*.test.ts files so they run side by side (#1319).
 */
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { REPO_ROOT } from '../spawn-cli.test-helper.js';
import { writeFiles } from '../lib/verify-result.test-helper.js';
import { browserProblem, playwrightChromium, playwrightConfig, readPlaywrightReport, runSmoke } from './smoke.js';
import { chromium as boardsmithChromium } from '@playwright/test';
import { smokeProject } from './smoke-project.test-helper.js';
import { quiet, smokeOf } from './smoke-walk.test-helper.js';
import { boardWithAPointerlessControl, PLAYERS_GET_THE_TABLE, smokeSpec } from './smoke-fixtures.test-helper.js';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 120_000 });

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

describe('boardsmith verify: the smoke check', () => {
  it('walks the table scaffold: a seated player takes both of its actions, with no error, and nothing is left running', async () => {
    const { dir, outcome, pids } = await smokeOf(false);

    expect(outcome.summary).toMatch(/^Served by `boardsmith dev` from a fresh start and dealt from seed "smoke", a seated player took "draw", "play"/);
    expect(outcome.passed).toBe(true);
    expect(outcome.counts).toMatchObject({ actions: 2 });
    expect(pids.length).toBeGreaterThanOrEqual(2);
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf-8' })).toBe('');
  });

  it('refuses a tracked file it cannot look at when it copies the game, rather than leaving it out of the copy', async () => {
    const dir = await smokeProject(false, { 'notes/rules.md': 'house rules\n' });
    chmodSync(join(dir, 'notes'), 0o000);
    try {
      await expect(runSmoke({ projectDir: dir, log: quiet })).rejects.toThrow(`Could not read ${join(dir, 'notes', 'rules.md')} (EACCES)`);
    } finally {
      chmodSync(join(dir, 'notes'), 0o755);
    }
    expect(existsSync(join(dir, '.boardsmith', 'smoke'))).toBe(false);
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
      /^The smoke walk, dealt from seed "smoke", found 2 problems: - A console error: the table lost its deck.*The game offered "play", which tests\/browser\/smoke\.spec\.ts does not list\. Add it to `actions` there\./s,
    );
  });

  it('#457: presses a keyboard-only board control (invisible, no pointer, over a surface that takes the pointer) from the keyboard', async () => {
    const { outcome } = await smokeOf(false, boardWithAPointerlessControl({ invisible: true }));

    // 2: the lantern, and the door that only the lantern's own click handler puts on the board.
    expect(outcome.summary).toMatch(/^Served by `boardsmith dev` from a fresh start and dealt from seed "smoke", a seated player took "draw", "play" and pressed 2 board controls, with no error\./);
    expect(outcome.passed).toBe(true);
  });

  it('#457: fails on a visible board control a mouse cannot press, rather than pressing it from the keyboard', async () => {
    const { outcome } = await smokeOf(false, boardWithAPointerlessControl({ invisible: false }));

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toBe(
      'The smoke walk, dealt from seed "smoke", found a problem: - Pressing the board\'s "Light the lantern" did not work: another element covers it, so a pointer cannot reach it.',
    );
  });

  it('#924: refuses a spec whose `steps` is not a positive whole number, which would walk no step', async () => {
    const { outcome } = await smokeOf(false, { 'tests/browser/smoke.spec.ts': smokeSpec(['draw', 'play'], undefined, { steps: 0 }) });

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toContain('`steps` in tests/browser/smoke.spec.ts takes a positive whole number, got "0".');
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

describe('playwrightConfig (#464)', () => {
  it('bounds every action, read and page load the walk makes, so nothing it waits on can wait out the run', async () => {
    const tree = tempTree('bs-smoke-config-');
    await writeFiles(tree, { 'playwright.config.mjs': playwrightConfig(tree, 'http://127.0.0.1:5173') });
    // Dynamic import: the config module the test just wrote.
    const { default: config } = (await import(pathToFileURL(join(tree, 'playwright.config.mjs')).href)) as {
      default: { use: { actionTimeout: number; navigationTimeout: number } };
    };
    expect(config.use.actionTimeout).toBe(15_000);
    expect(config.use.navigationTimeout).toBe(90_000);
  });
});

describe('playwrightChromium', () => {
  it("is BoardSmith's own Playwright Chromium, the one the browser regressions launch (#533)", async () => {
    const found = await playwrightChromium();
    expect(found.chromium).toBe(boardsmithChromium);
    expect(found.executable).toBe(boardsmithChromium.executablePath());
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

describe('readPlaywrightReport (#1049)', () => {
  it('reads no report when the walk wrote none, or wrote only part of one', async () => {
    const dir = tempTree('bs-smoke-report-');
    expect(await readPlaywrightReport(join(dir, 'report.json'))).toBeUndefined();
    writeFileSync(join(dir, 'report.json'), '{"suites": [{"title": "smo');
    expect(await readPlaywrightReport(join(dir, 'report.json'))).toBeUndefined();
  });

  it('refuses a report it cannot read, rather than reading it as no report', async () => {
    const dir = tempTree('bs-smoke-report-');
    mkdirSync(join(dir, 'report.json'));
    await expect(readPlaywrightReport(join(dir, 'report.json'))).rejects.toThrow(`Could not read ${join(dir, 'report.json')} (EISDIR)`);
  });
});
