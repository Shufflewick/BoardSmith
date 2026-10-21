/**
 * The in-browser smoke check (#453), run for real: a board that hangs the page after a press
 * (#618). It waits out the walk's 60s frozen check. smoke-walk.test-helper.ts says how each walk
 * runs. The check's tests are split across the smoke*.test.ts files so they run side by side
 * (#1319).
 */
import { describe, expect, it, vi } from 'vitest';
import { smokeOf } from './smoke-walk.test-helper.js';
import { boardThatHangsWhenPressed } from './smoke-fixtures.test-helper.js';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 120_000 });

describe('boardsmith verify: the smoke check', () => {
  it('#618: fails a board that hangs the page for good after a press, at the step that met the hang, on the page clock rather than the whole-run limit', async () => {
    const { outcome, steps } = await smokeOf(false, boardThatHangsWhenPressed());

    expect(steps).toContain('smoke step 1: pressing the board\'s "Spin"');
    expect(outcome.passed).toBe(false);
    // The walk's own frozen check ended the step that hung; the 600s limit on the whole run did not.
    expect(outcome.summary, outcome.summary).toMatch(/The walk could not go on at step \d+ of the game dealt from seed "smoke": the page stopped answering for 60s/);
    // Room for the whole run's 600s limit, so a walk that waits on the hung page reports that limit here.
  }, 700_000);
});
