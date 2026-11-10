/**
 * The in-browser smoke check (#453), run for real: a follow-up that re-opens itself after every
 * choice (#1596). smoke-walk.test-helper.ts says how each walk runs. The check's tests are split
 * across the smoke*.test.ts files so they run side by side (#1319).
 */
import { describe, expect, it, vi } from 'vitest';
import { smokeOf } from './smoke-walk.test-helper.js';
import { smokeSpec, stashGame } from './smoke-fixtures.test-helper.js';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 120_000 });

describe('boardsmith verify: the smoke check', () => {
  it('#1596: skips a follow-up that re-opens an action it has taken, and goes on to the actions still to take', async () => {
    const { outcome, steps } = await smokeOf(false, {
      ...stashGame(),
      'tests/browser/smoke.spec.ts': smokeSpec(['explore', 'collect', 'draw'], undefined, { steps: 20 }),
    });

    expect(outcome.passed, outcome.summary).toBe(true);
    expect(outcome.summary).toContain('a seated player took "collect", "draw", "explore"');
    expect(steps).toContain('smoke step 3: pressing "Done collecting" for "collect"');
    // Each "explore" the walk takes again still gets a real choice of "collect" before its Skip.
    const turn = ['taking "explore"', 'pressing "rope" for "collect"', 'pressing "Done collecting" for "collect"'];
    const presses = steps.flatMap((line) => turn.filter((said) => line.endsWith(`: ${said}`)));
    expect(presses.slice(0, 6)).toEqual([...turn, ...turn]);
  });
});
