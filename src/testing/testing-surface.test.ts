/**
 * The `boardsmith/testing` barrel offers one way to do each thing. These names
 * were removed because another export already does the same job, or nothing
 * used them (#517, #518, #519). Re-adding one turns this red.
 */
import { describe, it, expect } from 'vitest';
import * as testingBarrel from 'boardsmith/testing';

describe('boardsmith/testing export surface', () => {
  it.each([
    // #517: one way to run an action (doAction / tryAction / action()) and one to assert it fails
    'simulateAction',
    'simulateActions',
    'assertActionSucceeds',
    // #518: simulateRandomGames / replayRandomGame are the one play-to-the-end driver
    'playUntilComplete',
    'GameStuckError',
    // #519: nothing used these
    'assertFlowState',
    'assertGameFinished',
    'getVisibleElements',
    'assertTutorialStep',
    'viewPlayerRef',
    'assertViewFixtureShape',
  ])('does not export %s', (name) => {
    expect(testingBarrel).not.toHaveProperty(name);
  });

  it('still exports the ways to run an action and to assert one fails', () => {
    expect(typeof testingBarrel.TestGame.prototype.doAction).toBe('function');
    expect(typeof testingBarrel.TestGame.prototype.tryAction).toBe('function');
    expect(typeof testingBarrel.TestGame.prototype.action).toBe('function');
    expect(typeof testingBarrel.assertActionFails).toBe('function');
  });

  it('asks whether an element is visible one way: the standalone isElementVisible (#519)', () => {
    expect(typeof testingBarrel.isElementVisible).toBe('function');
    expect(testingBarrel.TestGame.prototype).not.toHaveProperty('isElementVisible');
    expect(testingBarrel.TestGame.prototype).not.toHaveProperty('getVisibleElements');
  });
});
