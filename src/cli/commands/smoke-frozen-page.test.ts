/**
 * The in-browser smoke check (#453), run for real: a page that stops answering altogether (#609).
 * It waits out the walk's 60s frozen check. smoke-walk.test-helper.ts says how each walk runs. The
 * check's tests are split across the smoke*.test.ts files so they run side by side (#1319).
 */
import { describe, expect, it, vi } from 'vitest';
import { smokeOf } from './smoke-walk.test-helper.js';
import { boardThatStarvesThePage } from './smoke-fixtures.test-helper.js';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 120_000 });

describe('boardsmith verify: the smoke check', () => {
  it('#609: fails a page that stops answering altogether, saying so, rather than waiting on it for good', async () => {
    const { outcome } = await smokeOf(false, boardThatStarvesThePage({ forGood: true }));

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toMatch(/The walk could not go on: the page stopped answering for 60s/);
  });
});
