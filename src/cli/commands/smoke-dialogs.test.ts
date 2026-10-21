/**
 * The in-browser smoke check (#453), run for real: dialogs, and a press that replaces the game's
 * frame (#461). smoke-walk.test-helper.ts says how each walk runs. The check's tests are split
 * across the smoke*.test.ts files so they run side by side (#1319).
 */
import { describe, expect, it, vi } from 'vitest';
import { smokeOf } from './smoke-walk.test-helper.js';
import { boardThatReplacesItsFrame, boardWithDialogs } from './smoke-fixtures.test-helper.js';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 120_000 });

describe('boardsmith verify: the smoke check', () => {
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

  it('a press that replaces the game\'s frame is reported, and the walk goes on in the new frame', async () => {
    const { outcome, steps } = await smokeOf(false, boardThatReplacesItsFrame());

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toContain(
      '- Pressing the board\'s "Start over" replaced the game\'s page, so the walk could not see what the press did.',
    );
    expect(outcome.summary).not.toContain('could not go on');
    expect(steps).toContain('smoke step 2: nothing is offered; waiting for a turn');
  });
});
