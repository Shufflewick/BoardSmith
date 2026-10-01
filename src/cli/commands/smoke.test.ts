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
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { REPO_ROOT } from '../spawn-cli.test-helper.js';
import { writeFiles } from '../lib/verify-result.test-helper.js';
import { browserProblem, playwrightConfig, runSmoke } from './smoke.js';
import { isRunning, smokeProject } from './smoke-project.test-helper.js';
import {
  ACE_SEEDS,
  aceGame,
  boardWithAPointerlessControl,
  boardWithAControlAtItsFoot,
  boardWithAVanishingControl,
  boardThatHidesThePanelForAMoment,
  boardWithDialogs,
  candidateBoard,
  fieldsGame,
  pointerAimedGame,
  PLAYERS_GET_THE_TABLE,
  QUIET_CLAIM_REASON,
  smokeSpec,
  truceGame,
} from './smoke-fixtures.test-helper.js';

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
  const { outcome, pids, steps } = await smokeIn(dir);
  return { dir, outcome, pids, steps };
}

/**
 * Runs the smoke check on the project in `dir`, holds it to leaving nothing running and no copy
 * behind, and returns what the walk said it did at each step, in order.
 */
async function smokeIn(dir: string) {
  const said: string[] = [];
  const { outcome, pids } = await runSmoke({ projectDir: dir, log: (line) => said.push(line) });
  expect(pids.filter(isRunning)).toEqual([]);
  expect(existsSync(join(dir, '.boardsmith', 'smoke'))).toBe(false);
  return { outcome, pids, steps: said.filter((line) => /^smoke( step \d+)?: /.test(line)) };
}

describe('boardsmith verify: the smoke check', () => {
  it('walks the table scaffold: a seated player takes both of its actions, with no error, and nothing is left running', async () => {
    const { dir, outcome, pids } = await smokeOf(false);

    expect(outcome.summary).toMatch(/^Served by `boardsmith dev` from a fresh start and dealt from seed "smoke", a seated player took "draw", "play"/);
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

  it(
    '#458, #459: takes a game-ending action once and starts a new game for the rest, then stops taking it so a game can go ' +
      'on, acts for the other seat to accept an offer, ' +
      'completes a two-card pick in the panel and a two-to-three-card pick on the board, and does not require the action the spec declares out of reach',
    async () => {
      const { outcome } = await smokeOf(false, {
        ...truceGame(),
        'tests/browser/smoke.spec.ts': smokeSpec(['concede', 'draw', 'play', 'trade', 'offerTruce', 'acceptTruce', 'rally', 'claimTruce'], {
          claimTruce: QUIET_CLAIM_REASON,
        }),
      });

      expect(outcome.summary).toMatch(
        /^Served by `boardsmith dev` from a fresh start and dealt from seed "smoke", a seated player took "acceptTruce", "concede", "draw", "offerTruce", "play", "rally", "trade" and pressed \d+ board controls?, with no error, over [3-9] games \(a new one each time a game ended with listed actions still to take\)\. Not required, as tests\/browser\/smoke\.spec\.ts says a walk from a fresh game cannot reach them: "claimTruce" \("Offered only after forty rounds in which nobody played a card, and the walk plays cards every round\."\)\.$/,
      );
      expect(outcome.passed).toBe(true);
    },
  );

  it('#458: reports an action the spec declares out of reach that the walk took anyway, so the declaration can go', async () => {
    const { outcome } = await smokeOf(false, {
      ...truceGame(),
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

  it('#458: fails on an error raised only in a later game, after the first one ended, and walks on past it', async () => {
    const { outcome } = await smokeOf(false, {
      ...truceGame({ acceptTruceFails: true }),
      'tests/browser/smoke.spec.ts': smokeSpec(['concede', 'draw', 'play', 'trade', 'offerTruce', 'acceptTruce', 'rally', 'claimTruce'], {
        claimTruce: QUIET_CLAIM_REASON,
      }),
    });

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toMatch(/- The panel offered "acceptTruce", and taking it failed: .*the truce table collapsed/);
    // The failure is reported once, and the walk goes on rather than retrying it: it still reaches
    // "rally", which only a game that goes on after the failure offers.
    expect(outcome.summary.match(/taking it failed/g)).toHaveLength(1);
    expect(outcome.summary).not.toContain('"rally"');
  });

  it(
    '#460: deals each game from the seeds the spec lists, walking each in turn, reaches an action only one deal offers, ' +
      'and takes the same steps on a second run',
    async () => {
      const dir = await smokeProject(false, {
        ...aceGame(),
        'tests/browser/smoke.spec.ts': smokeSpec(['draw', 'play', 'showAce'], undefined, { seed: [ACE_SEEDS.WITHOUT, ACE_SEEDS.WITH], steps: 20 }),
      });

      const first = await smokeIn(dir);
      const second = await smokeIn(dir);

      expect(first.outcome.summary).toMatch(
        /^Served by `boardsmith dev` from a fresh start and dealt from seed "plain", then from seed "4", a seated player took "draw", "play", "showAce" and pressed \d+ board controls?, with no error\./,
      );
      expect(first.outcome.passed).toBe(true);
      // The steps name the cards each choice pressed, so the same steps are the same deals walked the same way.
      expect(first.steps).toContain('smoke: dealing a game from seed "plain"');
      expect(first.steps.some((line) => /pressing "[^"]+" for "play"/.test(line))).toBe(true);
      expect(second.steps).toEqual(first.steps);
    },
  );

  it('#460: `boardsmith smoke --seed` deals from the seeds it names instead of the spec\'s', async () => {
    const dir = await smokeProject(false, {
      ...aceGame(),
      'tests/browser/smoke.spec.ts': smokeSpec(['draw', 'play', 'showAce'], undefined, { seed: ACE_SEEDS.WITHOUT, steps: 20 }),
    });
    const { outcome } = await runSmoke({ projectDir: dir, log: quiet, seeds: [ACE_SEEDS.WITH] });

    expect(outcome.summary).toMatch(/^Served by `boardsmith dev` from a fresh start and dealt from seed "4", a seated player took "draw", "play", "showAce"/);
    expect(outcome.passed).toBe(true);
  });

  it('#460: fails a walk whose only deal does not offer a listed action, saying to choose a seed whose deal does', async () => {
    const { outcome } = await smokeOf(false, {
      ...aceGame(),
      'tests/browser/smoke.spec.ts': smokeSpec(['draw', 'play', 'showAce'], undefined, { seed: ACE_SEEDS.WITHOUT, steps: 20 }),
    });

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toMatch(
      /^The smoke walk, dealt from seed "plain", found a problem: - The walk never saw "showAce" offered in 20 steps from a fresh game dealt from seed "plain"\. .*choose a seed whose deal offers it, and list it in `seed` there\./,
    );
  });

  it('#460: fails a world spec that names a seed, since `boardsmith dev` deals a world from its own', async () => {
    const { outcome } = await smokeOf(true, { 'tests/browser/smoke.spec.ts': smokeSpec(['tend'], undefined, { seed: '7' }) });

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toBe(
      'The smoke walk found a problem: - This game is a persistent world, which `boardsmith dev` deals from the one seed it ' +
        'gives that world, so `seed` in tests/browser/smoke.spec.ts cannot choose its deal. Remove `seed` there (and run ' +
        '`boardsmith smoke` without `--seed`).',
    );
  });

  it('#460: says a walk that stopped because nothing was offered for a while stopped for that, not for want of steps', async () => {
    // A world's plot has two rows that each grow five times, so after ten tends nothing is offered
    // until the clock ripens them, ten minutes on. "harvest" is listed and the world never offers it.
    const { outcome } = await smokeOf(true, { 'tests/browser/smoke.spec.ts': smokeSpec(['tend', 'harvest']) });

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toMatch(
      /- The walk never saw "harvest" offered\. It stopped at step \d+, because no seat had been offered anything for 30s, so more `steps` would not help\./,
    );
    expect(outcome.summary).not.toMatch(/raise `steps`/);
  });

  it(
    '#461: while a modal dialog is open presses only what is in it, each control once, closing it again with the control ' +
      'that closed it before, and closes one with nothing to press by Escape',
    async () => {
      const { outcome, steps } = await smokeOf(false, boardWithDialogs({ rulesStayOpen: false }));

      expect(outcome.summary).toMatch(
        /^Served by `boardsmith dev` from a fresh start and dealt from seed "smoke", a seated player took "draw", "play" and pressed 8 board controls, with no error\./,
      );
      expect(steps.slice(1, 10)).toEqual([
        'smoke step 1: pressing the board\'s "Look through discards"',
        'smoke step 2: pressing "Sort" in the dialog "Discards"',
        'smoke step 3: pressing "Close discards" in the dialog "Discards"',
        'smoke step 4: pressing the board\'s "Look through discards again"',
        'smoke step 5: closing the dialog "Discards" with "Close discards"',
        'smoke step 6: pressing the board\'s "Read the rules"',
        'smoke step 7: closing the dialog "Rules" with Escape',
        'smoke step 8: pressing the board\'s "Plan A"',
        'smoke step 9: pressing the board\'s "Plan B"',
      ]);
    },
  );

  it('#461: reaches a dialog control after the one that closes it, by opening the dialog again with what opened it', async () => {
    const { outcome, steps } = await smokeOf(false, boardWithDialogs({ rulesStayOpen: false, closeFirst: true }));

    expect(outcome.passed).toBe(true);
    expect(steps.slice(1, 6)).toEqual([
      'smoke step 1: pressing the board\'s "Look through discards"',
      'smoke step 2: pressing "Close discards" in the dialog "Discards"',
      'smoke step 3: pressing the board\'s "Look through discards" again, to reach what is left in the dialog it opens',
      'smoke step 4: pressing "Sort" in the dialog "Discards"',
      'smoke step 5: closing the dialog "Discards" with "Close discards"',
    ]);
  });

  it('#461: fails on a modal dialog nothing closes, since a player in it has no way back to the game', async () => {
    const { outcome } = await smokeOf(false, boardWithDialogs({ rulesStayOpen: true }));

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toContain(
      '- The dialog "Rules" stayed open after the walk pressed everything in it and then Escape, so a player in it has no ' +
        'way back to the game.',
    );
  });

  it('#464: a control that goes away before a press lands fails that press at once, saying so, and the walk goes on', async () => {
    const { outcome } = await smokeOf(false, boardWithAVanishingControl());

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toBe(
      'The smoke walk, dealt from seed "smoke", found a problem: - Pressing the board\'s "Shy button" did not work: it ' +
        'went away before the press landed.',
    );
  });

  it(
    '#465 to #467: enters a number its field accepts, and the next one up when the game refuses it, and gives up on an ' +
      'action it cannot finish once, reporting it, without taking it again while the panel offers anything else',
    async () => {
      const { outcome, steps } = await smokeOf(false, {
        ...fieldsGame(),
        'tests/browser/smoke.spec.ts': smokeSpec(['code', 'kindle', 'draw', 'rest']),
      });

      expect(outcome.passed).toBe(false);
      expect(outcome.summary).toMatch(
        /^The smoke walk, dealt from seed "smoke", found 2 problems: - The panel opened "code" at step 2 of the game dealt from seed "smoke", and pressing its choices changed nothing: .*Digits only\. - The panel offered "code", but the walk never took it in 60 steps\. The errors above, if any, say why\.$/,
      );
      expect(steps).toContain('smoke step 4: entering "1" for "kindle"');
      // The game refuses one log with its own message, and the walk tries two: the refusal, and
      // the error toast that says it, are the game working, not a problem. Later fires take two at once.
      expect(steps.filter((line) => line.endsWith('entering "1" for "kindle"'))).toHaveLength(1);
      expect(steps.filter((line) => line.endsWith('entering "2" for "kindle"')).length).toBeGreaterThan(0);
      expect(steps.filter((line) => line.endsWith('taking "code"'))).toHaveLength(1);
    },
  );

  it('#468: presses a pointer-aimed board candidate at a point it names a choice the game accepts, not at its refused centre', async () => {
    const { outcome, steps } = await smokeOf(false, {
      ...pointerAimedGame(),
      'tests/browser/smoke.spec.ts': smokeSpec(['claim', 'rest']),
    });

    expect(outcome.summary).toMatch(/^Served by `boardsmith dev` from a fresh start and dealt from seed "smoke", a seated player took "claim", "rest"/);
    expect(outcome.passed).toBe(true);
    expect(steps.some((line) => /pressing "[^"]+" for "claim"/.test(line))).toBe(true);
  });

  it('#466: reports an action whose rules crash on the number the walk entered, rather than trying the next number', async () => {
    const { outcome, steps } = await smokeOf(false, {
      ...fieldsGame({ kindleCrashesAtOne: true }),
      'tests/browser/smoke.spec.ts': smokeSpec(['code', 'kindle', 'draw', 'rest']),
    });

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toContain(
      '- The panel offered "kindle", and taking it failed: The "kindle" action could not be completed because of an error in ' +
        "the game's rules. Nothing was changed. (the hearth cracked)",
    );
    expect(outcome.summary).toMatch(/- The game showed an error: The "kindle" action could not be completed/);
    expect(steps.some((line) => line.endsWith('entering "2" for "kindle"'))).toBe(false);
  });

  describe('#468: pressing a candidate that is hard to point at', () => {
    const claimed = /^Served by `boardsmith dev` from a fresh start and dealt from seed "smoke", a seated player took "claim", "rest"/;
    const spec = { 'tests/browser/smoke.spec.ts': smokeSpec(['claim', 'rest']) };

    it.each([
      ['lifts when pointed at, and is followed until it settles', 'lifts'],
      ['never stands still, and is pressed where it is', 'restless'],
      ['is covered at its centre, and is pressed where it shows', 'partlyCovered'],
    ] as const)('claims a card that %s', async (_, kind) => {
      const { outcome } = await smokeOf(false, { ...candidateBoard(kind), ...spec });

      expect(outcome.summary).toMatch(claimed);
      expect(outcome.passed).toBe(true);
    });

    it('scrolls a board control out from under the action panel to press it', async () => {
      const { outcome, steps } = await smokeOf(false, boardWithAControlAtItsFoot());

      expect(outcome.passed).toBe(true);
      expect(steps).toContain('smoke step 1: pressing the board\'s "Ring the far bell"');
    });

    it('fails a card something covers whole, saying so', async () => {
      const { outcome } = await smokeOf(false, { ...candidateBoard('covered'), ...spec });

      expect(outcome.passed).toBe(false);
      expect(outcome.summary).toContain(
        '- Pressing "r0c0" while answering "claim" did not work: another element covers it, so a pointer cannot reach it.',
      );
    });

    it('reads an error toast over a control, waits for it to go, and presses again', async () => {
      const { outcome, steps } = await smokeOf(false, { ...candidateBoard('toast'), ...spec });

      // The toast is an error, so it fails the walk; the presses it covered both landed.
      expect(outcome.summary).toBe(
        'The smoke walk, dealt from seed "smoke", found a problem: - The game showed an error: The ravens are loud.',
      );
      expect(steps).toContain('smoke step 1: pressing the board\'s "Ring the bell"');
      expect(steps.some((line) => /pressing "r0c0" for "claim"/.test(line))).toBe(true);
    });
  });

  it('waits for a panel button that is gone for a moment to come back, rather than reporting it', async () => {
    const { outcome, steps } = await smokeOf(false, {
      ...aceGame(),
      ...boardThatHidesThePanelForAMoment(),
      'tests/browser/smoke.spec.ts': smokeSpec(['draw', 'play'], undefined, { seed: ACE_SEEDS.WITHOUT, steps: 12 }),
    });

    expect(steps.slice(1, 3)).toEqual(['smoke step 1: pressing the board\'s "Look away"', 'smoke step 2: taking "draw"']);
    expect(outcome.summary).toMatch(/^Served by `boardsmith dev` from a fresh start and dealt from seed "plain", a seated player took "draw", "play"/);
    expect(outcome.passed).toBe(true);
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
