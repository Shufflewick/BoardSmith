/**
 * The in-browser smoke check (#453), run for real: verbs the panel lists under its things (#1651).
 * smoke-walk.test-helper.ts says how each walk runs. The check's tests are split across the
 * smoke*.test.ts files so they run side by side (#1319).
 */
import { describe, expect, it, vi } from 'vitest';
import { smokeOf } from './smoke-walk.test-helper.js';
import { pastureGame } from './smoke-fixtures.test-helper.js';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 120_000 });

const selections = (steps: readonly string[], mark: string) => steps.filter((line) => line.endsWith(`: opening the panel's thing "${mark}"`)).length;

describe('boardsmith smoke', () => {
  it('#1651: selects each thing in the panel, takes the verbs listed under it, and selects one again once an action was taken since', async () => {
    const { outcome, steps } = await smokeOf(false, pastureGame({ bare: false }));

    expect(outcome.passed, outcome.summary).toBe(true);
    expect(outcome.summary).toContain('a seated player took "draw", "harvest", "tend"');
    expect(selections(steps, 'Pastures / north') + selections(steps, 'Pastures / south'), steps.join('\n')).toBeGreaterThan(2);
  });

  it('#1651 review: takes the verbs of a panel that offers nothing but things', async () => {
    const { outcome, steps } = await smokeOf(false, pastureGame({ bare: true }));

    expect(outcome.passed, outcome.summary).toBe(true);
    expect(outcome.summary).toContain('a seated player took "harvest", "tend"');
    expect(steps.filter((line) => line.includes('waiting for a turn')), steps.join('\n')).toEqual([]);
  });
});
