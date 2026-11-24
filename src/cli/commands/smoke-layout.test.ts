/**
 * The in-browser smoke check (#453), run for real: a board that scrolls sideways on a phone (#1797).
 * smoke-walk.test-helper.ts says how each walk runs. The check's tests are split across the
 * smoke*.test.ts files so they run side by side (#1319).
 */
import { describe, expect, it, vi } from 'vitest';
import { smokeOf } from './smoke-walk.test-helper.js';
import { boardWithALog } from './smoke-fixtures.test-helper.js';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 120_000 });

describe('boardsmith smoke', () => {
  it('#1797: fails a board whose log scrolls sideways on a phone held upright, naming the log, its widths and the phone', async () => {
    const { outcome } = await smokeOf(false, boardWithALog('tooWide'));

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toMatch(
      /- On a phone at 390x844 \(portrait, touch\), \[data-testid="game-log"\] scrolls sideways: its content is 5\d\dpx wide in a box \d+px wide, first seen at step 1 of the game dealt from seed "smoke"\./,
    );
  });

  it.each([
    { table: 'fits', shape: 'a log that fits a phone' },
    { table: 'pans', shape: 'a log wider than a phone in a box marked as meant to pan' },
    { table: 'map', shape: 'a map wider than a phone, marked as meant to pan, that the board region pans' },
  ] as const)('#1797: passes a board with $shape', async ({ table }) => {
    const { outcome } = await smokeOf(false, boardWithALog(table));

    expect(outcome.passed, outcome.summary).toBe(true);
  });
});
