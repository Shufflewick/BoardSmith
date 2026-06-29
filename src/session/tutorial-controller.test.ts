/**
 * TutorialController tests
 *
 * Covers:
 * - Lifecycle transitions: start → advance → skip → exit
 * - Broadcast assertions (exactly one broadcast per lifecycle call)
 * - Error when tutorialDefinition is absent
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Game,
  Space,
  Piece,
  Player,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  type FlowContext,
} from '../engine/index.js';
import { GameRunner } from '../runtime/runner.js';
import { TutorialController } from './tutorial-controller.js';
import type { TutorialDefinition } from '../engine/tutorial/types.js';

// ============================================
// Test game classes
// ============================================

class TutorialTestGame extends Game<TutorialTestGame, Player> {
  constructor(options: { playerCount: number; playerNames?: string[]; seed?: string }) {
    super(options);
    this.registerElements([TestSpace]);

    const moveAction = Action.create('move')
      .prompt('Move a piece')
      .chooseFrom('piece', { choices: ['a', 'b', 'c'] })
      .execute(() => {});

    const passAction = Action.create('pass')
      .prompt('Pass')
      .execute(() => {});

    this.registerActions(moveAction, passAction);

    const flow = defineFlow({
      root: loop({
        while: () => true,
        maxIterations: 20,
        do: eachPlayer({
          do: actionStep({ actions: ['move', 'pass'] }),
        }),
      }),
    });
    this.setFlow(flow);
  }
}

class TestSpace extends Space<TutorialTestGame> {}

const TWO_STEP_TUTORIAL: TutorialDefinition = {
  steps: [
    { id: 'step-1', gate: { action: 'move' } },
    { id: 'step-2', gate: { action: 'pass' } },
  ],
};

const THREE_STEP_TUTORIAL: TutorialDefinition = {
  steps: [
    { id: 'step-a', gate: { action: 'move' } },
    { id: 'step-b', gate: { action: 'pass' } },
    { id: 'step-c', gate: { action: 'move' } },
  ],
};

// ============================================
// Helpers
// ============================================

function makeRunner(tutorial?: TutorialDefinition): GameRunner<TutorialTestGame> {
  const runner = new GameRunner<TutorialTestGame>({
    GameClass: TutorialTestGame,
    gameType: 'tutorial-test',
    gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'test', tutorial },
  });
  runner.start();
  return runner;
}

// ============================================
// Lifecycle tests
// ============================================

describe('TutorialController — lifecycle', () => {
  let broadcastSpy: ReturnType<typeof vi.fn>;
  let runner: GameRunner<TutorialTestGame>;
  let controller: TutorialController<TutorialTestGame>;

  beforeEach(() => {
    broadcastSpy = vi.fn();
    runner = makeRunner(TWO_STEP_TUTORIAL);
    controller = new TutorialController(() => runner, { broadcast: broadcastSpy });
  });

  it('start() sets status to running on first step and broadcasts once', () => {
    controller.start(1);

    const progress = runner.game.tutorialProgress.get(1);
    expect(progress?.status).toBe('running');
    expect(progress?.stepId).toBe('step-1');
    expect(broadcastSpy).toHaveBeenCalledTimes(1);
  });

  it('advance() moves to next step and broadcasts once', () => {
    controller.start(1);
    broadcastSpy.mockClear();

    controller.advance(1);

    const progress = runner.game.tutorialProgress.get(1);
    expect(progress?.status).toBe('running');
    expect(progress?.stepId).toBe('step-2');
    expect(broadcastSpy).toHaveBeenCalledTimes(1);
  });

  it('advance() on last step completes the tutorial', () => {
    controller.start(1);
    controller.advance(1); // step-1 → step-2
    broadcastSpy.mockClear();

    controller.advance(1); // step-2 → completed

    const progress = runner.game.tutorialProgress.get(1);
    expect(progress?.status).toBe('completed');
    expect(broadcastSpy).toHaveBeenCalledTimes(1);
  });

  it('skip() advances past the current step and broadcasts once', () => {
    controller.start(1);
    broadcastSpy.mockClear();

    controller.skip(1);

    const progress = runner.game.tutorialProgress.get(1);
    expect(progress?.stepId).toBe('step-2');
    expect(broadcastSpy).toHaveBeenCalledTimes(1);
  });

  it('skip() on last step completes the tutorial', () => {
    controller.start(1);
    controller.advance(1); // step-1 → step-2
    broadcastSpy.mockClear();

    controller.skip(1); // step-2 → completed

    const progress = runner.game.tutorialProgress.get(1);
    expect(progress?.status).toBe('completed');
    expect(broadcastSpy).toHaveBeenCalledTimes(1);
  });

  it('exit() sets status to exited and broadcasts once', () => {
    controller.start(1);
    broadcastSpy.mockClear();

    controller.exit(1);

    const progress = runner.game.tutorialProgress.get(1);
    expect(progress?.status).toBe('exited');
    expect(broadcastSpy).toHaveBeenCalledTimes(1);
  });

  it('exit() after advance still exits', () => {
    controller.start(1);
    controller.advance(1);
    broadcastSpy.mockClear();

    controller.exit(1);

    const progress = runner.game.tutorialProgress.get(1);
    expect(progress?.status).toBe('exited');
    expect(broadcastSpy).toHaveBeenCalledTimes(1);
  });

  it('each lifecycle op produces exactly one broadcast', () => {
    controller.start(1);
    expect(broadcastSpy).toHaveBeenCalledTimes(1);

    controller.advance(1);
    expect(broadcastSpy).toHaveBeenCalledTimes(2);

    controller.skip(1);
    expect(broadcastSpy).toHaveBeenCalledTimes(3);

    controller.exit(1);
    expect(broadcastSpy).toHaveBeenCalledTimes(4);
  });

  it('manages progress independently per seat', () => {
    controller.start(1);
    controller.start(2);

    controller.advance(1); // seat 1 at step-2

    expect(runner.game.tutorialProgress.get(1)?.stepId).toBe('step-2');
    expect(runner.game.tutorialProgress.get(2)?.stepId).toBe('step-1');
  });

  it('gating goes inert after exit (status exited)', () => {
    controller.start(1);
    controller.exit(1);

    // Exited tutorials have no active step; gate is lifted
    const progress = runner.game.tutorialProgress.get(1);
    expect(progress?.status).toBe('exited');
    // getTutorialDisabledActions should return empty when exited
    const disabled = runner.game.getTutorialDisabledActions(1);
    expect(disabled).toEqual({});
  });
});

// ============================================
// Error handling tests
// ============================================

describe('TutorialController — error handling', () => {
  it('throws actionable error when tutorialDefinition is absent', () => {
    const runner = makeRunner(undefined); // No tutorial
    const controller = new TutorialController(() => runner, { broadcast: vi.fn() });

    expect(() => controller.start(1)).toThrow('GameDefinition.tutorial');
    expect(() => controller.advance(1)).toThrow('GameDefinition.tutorial');
    expect(() => controller.skip(1)).toThrow('GameDefinition.tutorial');
    expect(() => controller.exit(1)).toThrow('GameDefinition.tutorial');
  });

  it('error message names the missing property for actionability', () => {
    const runner = makeRunner(undefined);
    const controller = new TutorialController(() => runner, { broadcast: vi.fn() });

    expect(() => controller.start(1)).toThrow(
      /GameDefinition\.tutorial/
    );
  });

  // MR-03: start() on a tutorial with zero steps must fail loud with an actionable error.
  it('start() throws an actionable error when the tutorial definition has zero steps', () => {
    const emptyTutorial: TutorialDefinition = { steps: [] };
    const runner = makeRunner(emptyTutorial);
    const controller = new TutorialController(() => runner, { broadcast: vi.fn() });

    expect(() => controller.start(1)).toThrow(/steps/i);
  });

  it('error message for zero-steps tutorial mentions TutorialDefinition.steps', () => {
    const emptyTutorial: TutorialDefinition = { steps: [] };
    const runner = makeRunner(emptyTutorial);
    const controller = new TutorialController(() => runner, { broadcast: vi.fn() });

    expect(() => controller.start(1)).toThrow(
      /TutorialDefinition\.steps|no steps|at least one step/i
    );
  });
});

// ============================================
// Three-step transition tests
// ============================================

describe('TutorialController — three-step tutorial', () => {
  let broadcastSpy: ReturnType<typeof vi.fn>;
  let runner: GameRunner<TutorialTestGame>;
  let controller: TutorialController<TutorialTestGame>;

  beforeEach(() => {
    broadcastSpy = vi.fn();
    runner = makeRunner(THREE_STEP_TUTORIAL);
    controller = new TutorialController(() => runner, { broadcast: broadcastSpy });
  });

  it('advances through all three steps correctly', () => {
    controller.start(1);
    expect(runner.game.tutorialProgress.get(1)?.stepId).toBe('step-a');

    controller.advance(1);
    expect(runner.game.tutorialProgress.get(1)?.stepId).toBe('step-b');

    controller.advance(1);
    expect(runner.game.tutorialProgress.get(1)?.stepId).toBe('step-c');

    controller.advance(1);
    expect(runner.game.tutorialProgress.get(1)?.status).toBe('completed');
    expect(runner.game.tutorialProgress.get(1)?.stepId).toBe('step-c');
  });
});

// ============================================
// R-01: setup callback tests
// ============================================

describe('TutorialController — setup callback (R-01)', () => {
  it('start() calls the setup callback before setting initial progress', () => {
    const setupSpy = vi.fn();
    const tutorialWithSetup: TutorialDefinition = {
      setup: setupSpy,
      steps: [{ id: 'step-1', gate: { action: 'move' } }],
    };
    const runner = makeRunner(tutorialWithSetup);
    const controller = new TutorialController(() => runner, { broadcast: vi.fn() });

    controller.start(1);

    // setup must have been called exactly once.
    expect(setupSpy).toHaveBeenCalledTimes(1);
    // setup receives the live game instance.
    expect(setupSpy).toHaveBeenCalledWith(runner.game);
    // progress is set after setup runs.
    expect(runner.game.tutorialProgress.get(1)?.stepId).toBe('step-1');
  });

  it('start() works correctly when no setup callback is provided', () => {
    // Should not throw; tutorial starts normally without setup.
    const runner = makeRunner(TWO_STEP_TUTORIAL);
    const controller = new TutorialController(() => runner, { broadcast: vi.fn() });

    expect(() => controller.start(1)).not.toThrow();
    expect(runner.game.tutorialProgress.get(1)?.stepId).toBe('step-1');
  });
});
