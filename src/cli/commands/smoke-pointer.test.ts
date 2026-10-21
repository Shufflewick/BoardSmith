/**
 * The in-browser smoke check (#453), run for real: board controls that are hard to point at,
 * covered, or moved under the pointer (#468, #478, #646, #647). smoke-walk.test-helper.ts says how
 * each walk runs. The check's tests are split across the smoke*.test.ts files so they run side by
 * side (#1319).
 */
import { describe, expect, it, vi } from 'vitest';
import { smokeOf } from './smoke-walk.test-helper.js';
import {
  boardWithAControlAtItsFoot,
  boardThatKeepsReordering,
  boardThatMovesUnderThePress,
  MOVED_UNDER_THE_PRESS,
  boardThatTakesFocusUnderThePress,
  boardUnderTheHostsCover,
  candidateBoard,
  smokeSpec,
} from './smoke-fixtures.test-helper.js';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 120_000 });

describe('boardsmith verify: the smoke check', () => {
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

  it('presses the board control it found, though the board moved another into its place before the press', async () => {
    const { outcome, steps } = await smokeOf(false, boardThatKeepsReordering());

    expect(outcome.passed, outcome.summary).toBe(true);
    expect(steps.filter((line) => /pressing the board's "(North|South|East)"/.test(line))).toHaveLength(3);
  });

  it('#647: looks again when its click on a board control would land on another, because the board moved them as the pointer went down, and presses each control once', async () => {
    const { outcome, steps, said } = await smokeOf(false, {
      ...boardThatMovesUnderThePress({ always: false }),
      'tests/browser/smoke.spec.ts': smokeSpec(['draw', 'play'], undefined, { echo: MOVED_UNDER_THE_PRESS }),
    });

    // The board moved its buttons under the walk's first press: without it, this test would not
    // exercise the click that landed on another button.
    expect(said.filter((line) => line.includes(MOVED_UNDER_THE_PRESS))).toHaveLength(1);
    expect(outcome.summary).not.toContain('did not work');
    expect(steps.filter((line) => /pressing the board's "(North|South|East)"/.test(line))).toHaveLength(3);
    expect(outcome.passed, outcome.summary).toBe(true);
  });

  it('#647: gives up on a board control that moves every time its click goes down, and says it kept moving', async () => {
    const { outcome, said } = await smokeOf(false, {
      ...boardThatMovesUnderThePress({ always: true }),
      'tests/browser/smoke.spec.ts': smokeSpec(['draw', 'play'], undefined, { echo: MOVED_UNDER_THE_PRESS }),
    });

    expect(said.filter((line) => line.includes(MOVED_UNDER_THE_PRESS)).length).toBeGreaterThan(1);
    expect(outcome.summary).toContain('did not work: it kept moving out from under the pointer, so no click landed on it.');
    expect(outcome.passed).toBe(false);
  });

  it("#646: follows the active seat though the game's frame took focus and closed the seat menu while the pointer was down on \"Follow active seat\"", async () => {
    const { outcome } = await smokeOf(false, boardThatTakesFocusUnderThePress());

    expect(outcome.passed, outcome.summary).toBe(true);
  });
});
