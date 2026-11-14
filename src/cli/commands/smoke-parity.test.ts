/**
 * The in-browser smoke check (#453), run for real, holding the board to the Action Panel (#1642): a
 * board may not start an action the panel does not offer, nor show a selection that is not the
 * panel's. smoke-walk.test-helper.ts says how each walk runs.
 */
import { describe, expect, it, vi } from 'vitest';
import { smokeOf } from './smoke-walk.test-helper.js';
import { boardThatSelectsACard, boardThatStartsAHiddenAction } from './smoke-fixtures.test-helper.js';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 120_000 });

describe('boardsmith verify: the smoke check holds the board to the Action Panel (#1642)', () => {
  it('fails a board control that starts an action the panel does not offer, naming the action, the press and what the panel offered', async () => {
    const { outcome } = await smokeOf(false, boardThatStartsAHiddenAction());

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toContain(
      '"vote" started after the walk pressed the board\'s "Vote" at step 1 of the game dealt from seed "blank", but the Action Panel ' +
        'did not offer it then: it offered "draw".',
    );
  });

  it('fails a board that shows a thing selected while the panel has nothing selected', async () => {
    const { outcome } = await smokeOf(false, boardThatSelectsACard({ shared: false }));

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toContain(
      'The board showed "Cards / 7" selected while the Action Panel had nothing selected, after the walk pressed the board\'s "Card 7" ' +
        'at step 1 of the game dealt from seed "blank".',
    );
  });

  it('passes a board that selects through the shared selection and marks what it names', async () => {
    const { outcome } = await smokeOf(false, boardThatSelectsACard({ shared: true }));

    expect(outcome.passed, outcome.summary).toBe(true);
  });
});
