/**
 * The in-browser smoke check (#453), run for real: a page or a deal kept busy, as on a loaded
 * machine (#609, #666). smoke-walk.test-helper.ts says how each walk runs. The check's tests are
 * split across the smoke*.test.ts files so they run side by side (#1319).
 */
import { describe, expect, it, vi } from 'vitest';
import { smokeOf } from './smoke-walk.test-helper.js';
import { aceGameDealtSlowly, boardThatStarvesThePage, boardThatHoldsItsFrames, SLOW_SEED, smokeSpec } from './smoke-fixtures.test-helper.js';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 120_000 });

describe('boardsmith verify: the smoke check', () => {
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

  it('#666: reports a call into a live page that ran past its page time as that call taking too long, not as a control that never became pressable', async () => {
    const { outcome } = await smokeOf(false, boardThatHoldsItsFrames());

    expect(outcome.summary).toContain('Pressing the board\'s "Hold" did not work: waiting for the page to paint was still not done after 5s');
    expect(outcome.summary).not.toContain('did not become pressable');
    expect(outcome.summary).not.toContain('replaced');
    expect(outcome.summary).not.toContain('did not answer');
    expect(outcome.passed).toBe(false);
  });
});
