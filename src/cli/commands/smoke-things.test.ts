/**
 * The in-browser smoke check (#453), run for real: verbs the panel lists under its things (#1651).
 * smoke-walk.test-helper.ts says how each walk runs. The check's tests are split across the
 * smoke*.test.ts files so they run side by side (#1319).
 */
import { describe, expect, it, vi } from 'vitest';
import { smokeOf } from './smoke-walk.test-helper.js';
import { cardsAsThingsGame } from './smoke-fixtures.test-helper.js';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 120_000 });

describe('boardsmith verify: the smoke check', () => {
  it('#1651: selects a thing in the panel and takes the verbs listed under it', async () => {
    const { outcome, steps } = await smokeOf(false, cardsAsThingsGame());

    expect(outcome.passed, outcome.summary).toBe(true);
    expect(outcome.summary).toContain('a seated player took "discard", "draw", "play"');
    expect(steps.some((line) => /: opening the panel's thing "Cards \/ \d+"$/.test(line)), steps.join('\n')).toBe(true);
  });
});
