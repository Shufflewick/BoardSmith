/**
 * The in-browser smoke check (#453), run for real: panel buttons and board controls that go away,
 * are redrawn or are disabled under a press (#464, #562, #573). smoke-walk.test-helper.ts says how
 * each walk runs. The check's tests are split across the smoke*.test.ts files so they run side by
 * side (#1319).
 */
import { describe, expect, it, vi } from 'vitest';
import { smokeOf } from './smoke-walk.test-helper.js';
import {
  ACE_SEEDS,
  aceGame,
  boardWithATimidControl,
  boardWithAVanishingControl,
  boardWhoseClockTakesAControl,
  boardThatHidesThePanelForAMoment,
  boardThatRedrawsThePanel,
  boardThatHoldsAnOpenAction,
  HELD_OPEN_PLAY,
  PLAY_HOLD,
  panelThatGoesAwayAsItIsPressed,
  panelThatHangsOnThePointer,
  HUNG,
  smokeSpec,
} from './smoke-fixtures.test-helper.js';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 120_000 });

describe('boardsmith verify: the smoke check', () => {
  it('#464: a control that goes away before a press lands fails that press at once, saying so, and the walk goes on', async () => {
    const { outcome } = await smokeOf(false, boardWithAVanishingControl());

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toBe(
      'The smoke walk, dealt from seed "smoke", found a problem: - Pressing the board\'s "Shy button" did not work: it ' +
        'went away before the press landed.',
    );
  });

  it('#1483 review: a control the pointer hides when it reaches it, leaving it on the page, fails that press at once, saying so', async () => {
    const { outcome } = await smokeOf(false, boardWithAVanishingControl({ hides: true }));

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toBe(
      'The smoke walk, dealt from seed "smoke", found a problem: - Pressing the board\'s "Shy button" did not work: it ' +
        'went away before the press landed.',
    );
  });

  it.each(['setTimeout', 'requestAnimationFrame', 'MessageChannel', 'debounce', 'Transition', 'animationend'] as const)(
    '#1484: a control a pointer handler takes away in a later task (%s) fails that press at once, saying so',
    async (defers) => {
      const { outcome } = await smokeOf(false, boardWithAVanishingControl({ defers }));

      expect(outcome.passed).toBe(false);
      expect(outcome.summary).toBe(
        'The smoke walk, dealt from seed "smoke", found a problem: - Pressing the board\'s "Shy button" did not work: it ' +
          'went away before the press landed.',
      );
    },
  );

  it('#1475: a board control the game takes away by itself before the walk points at it is said, not reported, and pressed when it shows again', async () => {
    const { outcome, steps } = await smokeOf(false, boardWhoseClockTakesAControl());

    expect(steps).toContain('smoke step 1: the board\'s "Stop" went away by itself before the press landed, so the walk presses it when it shows again');
    expect(steps.slice(3, 5)).toEqual(['smoke step 2: pressing the board\'s "Start round 1"', 'smoke step 3: pressing the board\'s "Stop"']);
    expect(outcome.summary).toContain('pressed 4 board controls, with no error.');
    expect(outcome.passed).toBe(true);
  });

  it('#1483: a board control a clock an earlier press started takes away just after the pointer reached it is said, not reported, and pressed when it shows again', async () => {
    const { outcome, steps } = await smokeOf(false, boardWhoseClockTakesAControl({ startedBy: 'click' }));

    expect(steps).toContain('smoke step 2: the board\'s "Stop" went away by itself before the press landed, so the walk presses it when it shows again');
    expect(outcome.summary).toContain('pressed 5 board controls, with no error.');
    expect(outcome.passed).toBe(true);
  });

  it('#1484 review: a board control a clock the pointer reaching an earlier control started takes away is said, not reported, and pressed when it shows again', async () => {
    const { outcome, steps } = await smokeOf(false, boardWhoseClockTakesAControl({ startedBy: 'pointerenter' }));

    expect(steps).toContain('smoke step 2: the board\'s "Stop" went away by itself before the press landed, so the walk presses it when it shows again');
    expect(outcome.summary).toContain('pressed 5 board controls, with no error.');
    expect(outcome.passed).toBe(true);
  });

  it('#1483: a panel button the game takes away by itself as the walk presses it is said, not reported, and taken when it shows again', async () => {
    const { outcome, steps } = await smokeOf(false, {
      ...aceGame(),
      ...panelThatGoesAwayAsItIsPressed(),
      'tests/browser/smoke.spec.ts': smokeSpec(['draw', 'play'], undefined, { seed: ACE_SEEDS.WITHOUT, steps: 12 }),
    });

    expect(steps).toContain('smoke step 1: the panel\'s "draw" went away by itself before the press landed, so the walk presses it when it shows again');
    expect(outcome.summary).toMatch(/^Served by `boardsmith dev` from a fresh start and dealt from seed "blank", a seated player took "draw", "play"/);
    expect(outcome.passed).toBe(true);
  });

  it('#1483 review: a panel button the game takes away by itself now and then, with the action taken in between, is not reported', async () => {
    const { outcome, steps } = await smokeOf(false, {
      ...aceGame(),
      ...panelThatGoesAwayAsItIsPressed({ everyOther: true }),
      'tests/browser/smoke.spec.ts': smokeSpec(['draw', 'play'], undefined, { seed: ACE_SEEDS.WITHOUT, steps: 22 }),
    });

    // Without the third time, this test would not reach the count that reports a button.
    expect(steps.filter((line) => line.includes('the panel\'s "draw" went away by itself'))).toHaveLength(3);
    expect(outcome.summary).not.toContain('went away');
    expect(outcome.passed).toBe(true);
  });

  it('#1475: a board control that goes away by itself each time the walk goes to press it is reported', async () => {
    const { outcome } = await smokeOf(false, boardWhoseClockTakesAControl({ everyTime: true }));

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toBe(
      'The smoke walk, dealt from seed "smoke", found a problem: - Pressing the board\'s "Stop" did not work: it went ' +
        'away by itself each of the 3 times the walk went to press it.',
    );
  });

  it('a control that is disabled by the time the walk goes to press it fails that press, saying so, rather than counting it', async () => {
    const { outcome } = await smokeOf(false, boardWithATimidControl());

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toBe(
      'The smoke walk, dealt from seed "smoke", found a problem: - Pressing the board\'s "Timid button" did not work: it was ' +
        'disabled when the walk went to press it, and still was 5s later.',
    );
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

  it('#1461: an open action the board holds is cancelled with a notice, not reported as an error', async () => {
    const { outcome, said } = await smokeOf(false, {
      ...aceGame(),
      ...boardThatHoldsAnOpenAction(),
      'tests/browser/smoke.spec.ts': smokeSpec(['draw', 'play'], undefined, { seed: ACE_SEEDS.WITHOUT, steps: 12, echo: HELD_OPEN_PLAY }),
    });

    expect(said).toContain(HELD_OPEN_PLAY);

    expect(outcome.summary).not.toContain(PLAY_HOLD);
    expect(outcome.summary).toMatch(/^Served by `boardsmith dev` from a fresh start and dealt from seed "blank", a seated player took "draw", "play"/);
    expect(outcome.passed).toBe(true);
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
});
