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
import { afterEach, describe, expect, it, vi } from 'vitest';

import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { REPO_ROOT } from '../spawn-cli.test-helper.js';
import { writeFiles } from '../lib/verify-result.test-helper.js';
import { SMOKE_SEEDS_ENV } from '../../testing/browser-smoke-verdict.js';
import { browserProblem, playwrightConfig, runSmoke } from './smoke.js';
import { isRunning, smokeProject } from './smoke-project.test-helper.js';
import {
  ACE_SEEDS,
  aceGame,
  aceGameDealtSlowly,
  boardThatStarvesThePage,
  boardWithAPointerlessControl,
  boardWithAControlAtItsFoot,
  boardWithATimidControl,
  boardWithAVanishingControl,
  boardThatHidesThePanelForAMoment,
  boardThatRedrawsThePanel,
  panelThatHangsOnThePointer,
  HUNG,
  boardThatReplacesItsFrame,
  boardThatKeepsReordering,
  boardUnderTheHostsCover,
  boardWithDialogs,
  candidateBoard,
  ALONE_REASON,
  fieldsGame,
  gladeSpec,
  gladeWorld,
  greetingsGame,
  greetingsSpec,
  kettleGame,
  NOBODY_CALLED_THAT,
  pointerAimedGame,
  PLAYERS_GET_THE_TABLE,
  QUIET_CLAIM_REASON,
  SLOW_SEED,
  smokeSpec,
  truceGame,
} from './smoke-fixtures.test-helper.js';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 120_000 });

afterEach(() => vi.unstubAllEnvs());

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
  const { outcome, pids, steps, said } = await smokeIn(dir);
  return { dir, outcome, pids, steps, said };
}

/** Runs the smoke check on the greetings game (#470), with the spec's `inputs` written as `inputs`. */
function walkGreetings(inputs: string) {
  return smokeOf(false, { ...greetingsGame(), 'tests/browser/smoke.spec.ts': greetingsSpec(inputs) });
}

/**
 * Runs the smoke check on the project in `dir`, holds it to leaving nothing running and no copy
 * behind, and returns what the walk said it did at each step, in order, and every line the run said.
 */
async function smokeIn(dir: string) {
  const said: string[] = [];
  const { outcome, pids } = await runSmoke({ projectDir: dir, log: (line) => said.push(line) });
  expect(pids.filter(isRunning)).toEqual([]);
  expect(existsSync(join(dir, '.boardsmith', 'smoke'))).toBe(false);
  return { outcome, pids, said, steps: said.filter((line) => /^smoke( step \d+)?: /.test(line)) };
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
        /^Served by `boardsmith dev` from a fresh start and dealt from seed "blank", then from seed "0", a seated player took "draw", "play", "showAce" and pressed \d+ board controls?, with no error\./,
      );
      expect(first.outcome.passed).toBe(true);
      // The steps name the cards each choice pressed, so the same steps are the same deals walked the same way.
      expect(first.steps).toContain('smoke: dealing a game from seed "blank"');
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

    expect(outcome.summary).toMatch(/^Served by `boardsmith dev` from a fresh start and dealt from seed "0", a seated player took "draw", "play", "showAce"/);
    expect(outcome.passed).toBe(true);
  });

  it('#460: fails a walk whose only deal does not offer a listed action, saying to choose a seed whose deal does, and deals from the spec\'s seed whatever seeds the environment names', async () => {
    // A `boardsmith smoke --seed` run hands its walk the seeds in this variable; a check run inside
    // it (a game's own test suite running `boardsmith verify`, say) must not inherit them.
    vi.stubEnv(SMOKE_SEEDS_ENV, JSON.stringify([ACE_SEEDS.WITH]));
    const { outcome } = await smokeOf(false, {
      ...aceGame(),
      'tests/browser/smoke.spec.ts': smokeSpec(['draw', 'play', 'showAce'], undefined, { seed: ACE_SEEDS.WITHOUT, steps: 20 }),
    });

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toMatch(
      /^The smoke walk, dealt from seed "blank", found a problem: - The walk never saw "showAce" offered in 20 steps from a fresh game dealt from seed "blank"\. .*choose a seed whose deal offers it, and list it in `seed` there\./,
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

  it('#461: fails on a dialog whose Close does nothing, though a Close closed another dialog before, and closes it with Escape', async () => {
    const { outcome, steps } = await smokeOf(false, boardWithDialogs({ rulesStayOpen: false, brokenCopy: true }));

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toBe(
      'The smoke walk, dealt from seed "smoke", found a problem: - The dialog "Opponent\'s discards" stayed open after the walk ' +
        'pressed "Close discards" in it to close it, as that had closed a dialog before, so a player who presses it stays in the dialog.',
    );
    const closing = steps.findIndex((line) => line.endsWith('closing the dialog "Opponent\'s discards" with "Close discards"'));
    expect(closing).toBeGreaterThan(0);
    expect(steps[closing + 1]).toMatch(/closing the dialog "Opponent's discards" with Escape$/);
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

  it('a press that replaces the game\'s frame is reported, and the walk goes on in the new frame', async () => {
    const { outcome, steps } = await smokeOf(false, boardThatReplacesItsFrame());

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toContain(
      '- Pressing the board\'s "Start over" replaced the game\'s page, so the walk could not see what the press did.',
    );
    expect(outcome.summary).not.toContain('could not go on');
    expect(steps).toContain('smoke step 2: nothing is offered; waiting for a turn');
  });

  it('a control that is disabled by the time the walk goes to press it fails that press, saying so, rather than counting it', async () => {
    const { outcome } = await smokeOf(false, boardWithATimidControl());

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toBe(
      'The smoke walk, dealt from seed "smoke", found a problem: - Pressing the board\'s "Timid button" did not work: it was ' +
        'disabled when the walk went to press it, and still was 5s later.',
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

  describe("#478: a board control the page around the game covers", () => {
    it('waits for a toast in the page around the game to go, and presses again', async () => {
      const { outcome, steps } = await smokeOf(false, boardUnderTheHostsCover('toast'));

      expect(outcome.summary).not.toContain('Pressing the board');
      expect(outcome.passed).toBe(true);
      expect(steps).toContain('smoke step 1: pressing the board\'s "Ring the bell"');
    });

    it('fails a press that something other than a toast in the page around the game takes, saying so', async () => {
      const { outcome } = await smokeOf(false, boardUnderTheHostsCover('banner'));

      expect(outcome.passed).toBe(false);
      expect(outcome.summary).toContain(
        '- Pressing the board\'s "Ring the bell" did not work: the click reached nothing in the game, so something over ' +
          "the game's frame (the page around it) took it.",
      );
    });
  });

  it('waits for a panel button that is gone for a moment to come back, and takes the action then, rather than reporting it', async () => {
    const { outcome, steps } = await smokeOf(false, {
      ...aceGame(),
      ...boardThatHidesThePanelForAMoment(),
      'tests/browser/smoke.spec.ts': smokeSpec(['draw', 'play'], undefined, { seed: ACE_SEEDS.WITHOUT, steps: 12 }),
    });

    // "draw" was taken at step 2, when its button came back: a press that had not landed would leave
    // it untaken, and step 3 taking it again.
    expect(steps.slice(1, 4)).toEqual([
      'smoke step 1: pressing the board\'s "Look away"',
      'smoke step 2: taking "draw"',
      'smoke step 3: taking "play"',
    ]);
    expect(outcome.summary).toMatch(/^Served by `boardsmith dev` from a fresh start and dealt from seed "blank", a seated player took "draw", "play"/);
    expect(outcome.passed).toBe(true);
  });

  it('reports a panel button that is gone and never comes back, since the panel took back what it offered', async () => {
    const { outcome, steps } = await smokeOf(false, {
      ...aceGame(),
      ...boardThatHidesThePanelForAMoment({ forGood: true }),
      'tests/browser/smoke.spec.ts': smokeSpec(['draw', 'play'], undefined, { seed: ACE_SEEDS.WITHOUT, steps: 4 }),
    });

    expect(steps.slice(1, 3)).toEqual(['smoke step 1: pressing the board\'s "Look away"', 'smoke step 2: taking "draw"']);
    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toContain('- The panel showed its "draw", and it was still gone 5s later, when the walk went to press it.');
    expect(outcome.summary).toContain('- The panel offered "draw", but the walk never took it in 4 steps.');
  });

  it('#562: presses a panel button the panel redrew as a new element just as the walk went to press it', async () => {
    const { outcome, steps } = await smokeOf(false, {
      ...aceGame(),
      ...boardThatRedrawsThePanel(),
      'tests/browser/smoke.spec.ts': smokeSpec(['draw', 'play'], undefined, { seed: ACE_SEEDS.WITHOUT, steps: 12 }),
    });

    expect(outcome.summary).not.toContain('did not work');
    expect(steps.slice(1, 3)).toEqual(['smoke step 1: taking "draw"', 'smoke step 2: taking "play"']);
    expect(outcome.passed).toBe(true);
  });

  it('#573: presses a panel button again when its click ran out of time after only the pointer pressed it, and takes the action once', async () => {
    const { outcome, steps, said } = await smokeOf(false, {
      ...aceGame(),
      ...panelThatHangsOnThePointer(),
      'tests/browser/smoke.spec.ts': smokeSpec(['draw', 'play'], undefined, { seed: ACE_SEEDS.WITHOUT, steps: 3, echo: HUNG }),
    });

    // The page hung the first press of each action: without it, this test would not exercise the
    // press whose click never arrived.
    expect(said.filter((line) => line.includes(HUNG))).toEqual([`${HUNG} "draw"`, `${HUNG} "play"`]);

    // "draw" was taken at step 1 by the second press: a walk that counted the first press as landed
    // would leave it untaken, and take it again at step 2.
    expect(outcome.summary).not.toContain('did not work');
    expect(outcome.summary).not.toContain('clicked twice');
    expect(steps.slice(1, 3)).toEqual(['smoke step 1: taking "draw"', 'smoke step 2: taking "play"']);
    expect(outcome.passed).toBe(true);
  });

  it('presses the board control it found, though the board moved another into its place before the press', async () => {
    const { outcome, steps } = await smokeOf(false, boardThatKeepsReordering());

    expect(outcome.passed, outcome.summary).toBe(true);
    expect(steps.filter((line) => /pressing the board's "(North|South|East)"/.test(line))).toHaveLength(3);
  });

  it(
    "#470: types the value a spec's `inputs` give a field, reading the page when the spec says how, and its own text in " +
      'any other field; one the page gives no value for yet is cancelled and taken once the page gives one',
    async () => {
      const { outcome, steps } = await walkGreetings(`{
    greet: { whom: theOther },
    // Nothing until the log shows a card drawn, as a page that does not show the name yet gives none.
    wave: { whom: async (view) => ((await view.texts(LOG)).some((line) => line.endsWith('drew a card.')) ? theOther(view) : undefined) },
    pledge: { coins: 7 },
  }`);

      expect(outcome.summary).toMatch(
        /^Served by `boardsmith dev` from a fresh start and dealt from seed "smoke", a seated player took "draw", "greet", "note", "pledge", "wave"/,
      );
      expect(outcome.passed).toBe(true);
      // What the walk typed, without the step it typed it at. It acts for each seat in turn, so the
      // other player's name is whichever seat it is not.
      const entered = new Set(steps.map((line) => line.replace(/^smoke step \d+: /, '').replace(/Player [12]/, 'Player N')));
      for (const typed of [
        'entering "Player N" for "greet", from `inputs`',
        'entering "7" for "pledge", from `inputs`',
        'entering "smoke test" for "note"',
        'entering "Player N" for "wave", from `inputs`',
      ]) {
        expect(entered).toContain(typed);
      }
      expect(steps.filter((line) => line.endsWith('`inputs` gives no value for "whom" of "wave" yet; cancelling it until the game moves on'))).toHaveLength(1);
    },
  );

  it(
    "#470: fails on a value from the spec's `inputs` the game refuses, naming it; on a value of the walk's own the game " +
      'refuses, saying how to give the right one; and on an action whose input never gave a value',
    async () => {
      const { outcome, steps } = await walkGreetings(`{
    greet: { whom: 'Nobody' },
    wave: { whom: () => undefined },
  }`);

      expect(outcome.passed).toBe(false);
      expect(outcome.summary).toContain(
        `- The panel offered "greet", and taking it failed: ${NOBODY_CALLED_THAT} The walk typed "Nobody" in its field ` +
          '"whom", as `inputs.greet.whom` in tests/browser/smoke.spec.ts gives it.',
      );
      expect(outcome.summary).toContain(
        '- The panel offered "pledge", and taking it failed: The pot takes seven coins. The game refused each of the 3 ' +
          'numbers the walk entered. The walk typed "3" in its field "coins". If the game needs a particular value there, ' +
          'such as a name the board shows, give it in `inputs` in tests/browser/smoke.spec.ts.',
      );
      expect(outcome.summary).toContain(
        '- The panel offered "wave", but the walk never took it in 60 steps: when it last opened it, `inputs.wave.whom` in ' +
          'tests/browser/smoke.spec.ts gave no text for its field "whom", so the walk cancelled it.',
      );
      expect(outcome.summary).not.toMatch(/"(note|draw)", but the walk never took it/);
      // An action put off is tried again in turn with the others, not after every move, so however
      // many are put off the rest of the game keeps its steps.
      const times = (what: RegExp) => steps.filter((line) => what.test(line)).length;
      const putOff = times(/`inputs` gives no value for "whom" of "wave" yet/);
      expect(putOff).toBeGreaterThan(1);
      expect(putOff).toBeLessThanOrEqual(times(/: taking "note"$/) + 1);
      expect(putOff).toBeLessThanOrEqual(times(/: taking "draw"$/) + 1);
    },
  );

  it(
    "#470: fails on a spec input that throws, one naming a field the action does not have, and a number from `inputs` " +
      'the game refuses, which it enters once and never moves up',
    async () => {
      const { outcome, steps } = await walkGreetings(`{
    greet: { whom: () => { throw new Error('the players panel moved'); } },
    wave: { whim: theOther },
    pledge: { coins: 3 },
  }`);

      expect(outcome.passed).toBe(false);
      expect(outcome.summary).toContain(
        '- `inputs.greet.whom` in tests/browser/smoke.spec.ts failed while the walk answered "greet": the players panel moved',
      );
      expect(outcome.summary).toContain(
        '- `inputs.wave.whim` in tests/browser/smoke.spec.ts names a field the walk never met in "wave", whose fields it met ' +
          'are "whom". Name the field by the pick name its rules give it.',
      );
      expect(outcome.summary).toContain(
        '- The panel offered "pledge", and taking it failed: The pot takes seven coins. The walk typed "3" in its field ' +
          '"coins", as `inputs.pledge.coins` in tests/browser/smoke.spec.ts gives it.',
      );
      expect(outcome.summary).not.toContain('refused each of');
      expect(steps.filter((line) => /: entering "\d+" for "pledge"/.test(line))).toEqual([expect.stringMatching(/: entering "3" for "pledge", from `inputs`$/)]);
    },
  );

  it('#473: fails a table game that hangs once every listed action was taken, naming the step and the deal it stalled at', async () => {
    const { outcome } = await smokeOf(false, {
      ...kettleGame(),
      'tests/browser/smoke.spec.ts': smokeSpec(['draw', 'wait'], { wait: 'Greyed out until the kettle boils, and in this game it never does.' }),
    });

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toMatch(
      /^The smoke walk, dealt from seed "smoke", found a problem: - The game stalled at step \d+ of the game dealt from seed "smoke": no seat was offered anything for 30s, and the game was not over, so the players at that table could never finish it\./,
    );
  });

  it(
    '#472, #474: in a world walked from one seat, says why an action the panel only greyed out was never taken, and waits ' +
      'out a slow command within its step rather than spending the next one waiting for a turn',
    async () => {
      const { outcome, steps } = await smokeOf(true, { ...gladeWorld(), 'tests/browser/smoke.spec.ts': gladeSpec({ steps: 8 }) });

      expect(outcome.passed).toBe(false);
      expect(outcome.summary).toMatch(
        new RegExp(
          '^The smoke walk found a problem: - The panel offered "greet" only greyed out in 8 steps from a fresh game, so the ' +
            `walk could never take it\\. The panel gave these reasons, the latest last: "Arrive first\\."; "${ALONE_REASON}" ` +
            '.*If it needs another player there too, list the ' +
            'seats the walk plays in `seats` there',
        ),
      );
      expect(steps.some((line) => line.endsWith('taking "rest"'))).toBe(true);
      expect(steps.filter((line) => line.includes('waiting for a turn'))).toEqual([]);
    },
  );

  it('#562: counts a panel press that reached its button as landed, though the page was too busy to answer within one look, and does not press it again', async () => {
    const { outcome, steps } = await smokeOf(true, { ...gladeWorld({ busy: true }), 'tests/browser/smoke.spec.ts': gladeSpec({ steps: 8 }) });

    expect(outcome.summary).not.toContain('did not work');
    expect(steps.filter((line) => line.endsWith('taking "arrive"'))).toHaveLength(1);
    expect(steps.some((line) => line.endsWith('taking "rest"'))).toBe(true);
  });

  it(
    '#471: plays the seats a world spec names, each in a browser of its own, the second following the first, and takes ' +
      'an action that needs another player there as soon as the page shows one, naming that player from `inputs`',
    async () => {
      const { outcome, steps } = await smokeOf(true, { ...gladeWorld(), 'tests/browser/smoke.spec.ts': gladeSpec({ seats: '[1, 4]', steps: 30 }) });

      expect(outcome.summary).toMatch(
        /^Served by `boardsmith dev` from a fresh start, players at seats 1 and 4 took "arrive", "greet", "look", "rest", "stroll"/,
      );
      expect(outcome.passed).toBe(true);
      expect(steps).toContain('smoke: seat 4 joins the world in a browser of its own');
      expect(steps.some((line) => /: acting as seat 4$/.test(line))).toBe(true);
      // Seat 4 arrives, which only it is then offered, and follows seat 1 from there, so the two stroll on together.
      expect(steps[steps.findIndex((line) => line.endsWith(': acting as seat 4')) + 1]).toMatch(/: taking "arrive"$/);
      expect(steps.some((line) => line.endsWith(': taking "look", as seat 1 did'))).toBe(true);
      expect(steps.some((line) => line.endsWith(': taking "stroll", as seat 1 did'))).toBe(true);
      expect(steps.some((line) => /: entering "seat [14]" for "greet", from `inputs`$/.test(line))).toBe(true);
      // "greet" was put off while neither had looked, and taken again as soon as a look showed the
      // other seat there, before the walk strolled on.
      const taking = steps.filter((line) => /: taking "[a-z]+"$/.test(line)).map((line) => line.replace(/^smoke step \d+: /, ''));
      const looked = taking.indexOf('taking "look"');
      expect(looked).toBeGreaterThan(taking.indexOf('taking "greet"'));
      expect(taking.indexOf('taking "greet"', looked)).toBeLessThan(taking.indexOf('taking "stroll"'));
      expect(steps.filter((line) => line.includes('waiting for a turn'))).toEqual([]);
    },
  );

  it('#471: fails a walk whose second seat alone fails, naming that seat in every problem from its browser', async () => {
    const { outcome } = await smokeOf(true, { ...gladeWorld({ stumbles: true }), 'tests/browser/smoke.spec.ts': gladeSpec({ seats: '[1, 4]', steps: 12 }) });

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toMatch(/- In seat 4's browser: The panel offered "arrive", and taking it failed: .*seat four tripped on a root/);
    const fromABrowser = outcome.summary.match(/In seat \d+'s browser/g) ?? [];
    expect(fromABrowser.length).toBeGreaterThan(0);
    expect(new Set(fromABrowser)).toEqual(new Set(["In seat 4's browser"]));
  });

  it('#471: a seat after the first opens an action group to reach what only it is offered', async () => {
    const { outcome, steps } = await smokeOf(true, {
      ...gladeWorld({ manners: true }),
      'tests/browser/smoke.spec.ts': gladeSpec({ seats: '[1, 4]', steps: 40, manners: true }),
    });

    expect(outcome.summary).toMatch(/^Served by `boardsmith dev` from a fresh start, players at seats 1 and 4 took "arrive", "bow", "greet"/);
    expect(outcome.passed).toBe(true);
    const opening = steps.findIndex((line) => line.endsWith(`: opening the panel's group "Manners"`));
    expect(opening).toBeGreaterThan(0);
    expect(steps.slice(0, opening).reverse().find((line) => /: acting as seat \d+$/.test(line))).toMatch(/acting as seat 4$/);
  });

  it('#471: fails a world spec that names a seat the world does not have, saying which seats it has', async () => {
    const { outcome } = await smokeOf(true, { ...gladeWorld(), 'tests/browser/smoke.spec.ts': gladeSpec({ seats: '[1, 9]', steps: 4 }) });

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toMatch(
      /^The smoke walk found \d+ problems: - The walk could not go on: `seats` in tests\/browser\/smoke\.spec\.ts names seat 9, but this world has seats 1 to 8\. Name seats it has\. /,
    );
  });

  it('#471: fails a table spec that names `seats`, since the walk acts for every seat at a table', async () => {
    const { outcome } = await smokeOf(false, {
      'tests/browser/smoke.spec.ts': "import { defineSmokeTest } from 'boardsmith/testing/browser';\n\ndefineSmokeTest({ actions: ['draw', 'play'], seats: 2 });\n",
    });

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toBe(
      'The smoke walk, dealt from seed "smoke", found a problem: - This game is played at a table, where the walk acts for ' +
        'every seat in turn, so `seats` in tests/browser/smoke.spec.ts has nothing to choose. Remove `seats` there.',
    );
  });

  it('#609: waits out a page kept too busy to answer for longer than a press is given, as a loaded machine does, and walks on', async () => {
    const { outcome } = await smokeOf(false, boardThatStarvesThePage());

    expect(outcome.summary).not.toContain('did not answer');
    expect(outcome.summary).toMatch(/^Served by `boardsmith dev` from a fresh start and dealt from seed "smoke", a seated player took /);
    expect(outcome.passed).toBe(true);
  });

  it('#609: waits out a deal that keeps boardsmith dev busy for longer than a deal is given, as a loaded machine does, and walks it', async () => {
    const { outcome, said } = await smokeOf(false, {
      ...aceGameDealtSlowly(),
      'tests/browser/smoke.spec.ts': smokeSpec(['draw', 'play', 'showAce'], { showAce: 'Offered only to a seat dealt the ace.' }, { seed: SLOW_SEED, steps: 4 }),
    });

    expect(said).toContain(`smoke: dealing a game from seed "${SLOW_SEED}"`);
    expect(outcome.summary).not.toContain('had not dealt');
    expect(outcome.passed).toBe(true);
  });

  it('#609: fails a page that stops answering altogether, saying so, rather than waiting on it for good', async () => {
    const { outcome } = await smokeOf(false, boardThatStarvesThePage({ forGood: true }));

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toMatch(/The walk could not go on: the page stopped answering for 60s/);
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
