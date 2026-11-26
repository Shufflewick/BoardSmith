/**
 * The in-browser smoke check (#453), run for real: a game whose action bar starts closed, which
 * promises its board offers every action, phones included (#1827). smoke-walk.test-helper.ts says
 * how each walk runs. The check's tests are split across the smoke*.test.ts files so they run side
 * by side (#1319).
 */
import { describe, expect, it, vi } from 'vitest';
import { smokeOf } from './smoke-walk.test-helper.js';
import { closedBarGame } from './smoke-fixtures.test-helper.js';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 120_000 });

describe('boardsmith smoke', () => {
  it('#1827: advises, and passes, a game starting its bar closed whose board never starts an action, or starts one only off a phone', async () => {
    const { outcome } = await smokeOf(false, closedBarGame({ boardStarts: ['draw'], hiddenOnPhones: true }));

    expect(outcome.passed, outcome.summary).toBe(true);
    expect(outcome.summary).toMatch(
      / with no error\. Smoke used the panel to start "play" and saw no board start for it\. On a phone, smoke used the panel to start "draw" and saw no board start for it\. Check the board offers them, or drop actionBarStartsCollapsed\.$/,
    );
  });

  it('#1827: gives no advice for a game starting its bar closed whose board starts every action, on a phone too, behind controls that start nothing', async () => {
    const { outcome } = await smokeOf(false, closedBarGame({ boardStarts: ['draw', 'play'], decoys: 3 }));

    expect(outcome.passed, outcome.summary).toBe(true);
    expect(outcome.summary).toMatch(/^Served by `boardsmith dev` from a fresh start and dealt from seed "smoke", a seated player took "draw", "play" and pressed \d+ board controls?, with no error\.$/);
  });
});
