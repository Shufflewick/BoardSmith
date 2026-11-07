/**
 * The in-browser smoke check (#453), run for real: an action the step clock greys (#1547).
 * smoke-walk.test-helper.ts says how each walk runs. The check's tests are split across the
 * smoke*.test.ts files so they run side by side (#1319).
 */
import { describe, expect, it, vi } from 'vitest';
import { smokeOf } from './smoke-walk.test-helper.js';
import { playbackGame, smokeSpec } from './smoke-fixtures.test-helper.js';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 120_000 });

describe('boardsmith verify: the smoke check', () => {
  it('#1547: skips the wait for an action the step clock greys, as a player would wait, so it takes it however fast it walks', async () => {
    const { outcome, steps } = await smokeOf(false, { ...playbackGame(), 'tests/browser/smoke.spec.ts': smokeSpec(['levelUp', 'ready'], undefined, { steps: 8 }) });

    expect(outcome.summary).toMatch(/a seated player took "levelUp", "ready"/);
    expect(outcome.passed).toBe(true);
    expect(steps.some((line) => line.endsWith('skipping the step clock\'s wait, with "levelUp" still to take and greyed'))).toBe(true);
  });

  it('#1593: walks as it would without an `unreachable` declaration, so the action it says to remove one for is still taken once it is removed', async () => {
    const { outcome, steps } = await smokeOf(false, {
      ...playbackGame(),
      'tests/browser/smoke.spec.ts': smokeSpec(['levelUp', 'ready'], { levelUp: 'Greyed by the step clock for ten minutes, which a walk never waits out.' }, { steps: 8 }),
    });

    expect(steps.some((line) => line.endsWith('skipping the step clock\'s wait, with "levelUp" still to take and greyed'))).toBe(true);
    expect(outcome.passed).toBe(true);
    expect(outcome.summary).toMatch(/a seated player took "levelUp", "ready".*The walk took "levelUp", which .* remove it from `unreachable` there/);
  });
});
