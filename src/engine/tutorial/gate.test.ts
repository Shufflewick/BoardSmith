/**
 * Tests for tutorial gate evaluation helpers (Phase 106, Plan 01).
 *
 * Covers:
 *   1. Labeled-predicate gate blocks actions and surfaces the failing label (MR-02).
 *   2. Labeled-predicate gate permits all actions when all predicates return true.
 *   3. Allow-list gate behavior is unchanged by the MR-02 refactor.
 *   4. Per-value gating is absent for labeled-condition gates.
 */

import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  type FlowContext,
} from '../index.js';
import { GameRunner } from '../../runtime/runner.js';
import { TutorialController } from '../../session/tutorial-controller.js';
import { getActionLevelDisabledReasons, getGateReasonForValue, getActiveStep } from './gate.js';
import type { TutorialDefinition, TutorialStep } from './types.js';

// ============================================================
// Minimal test game
// ============================================================

class GateTestGame extends Game<GateTestGame, Player> {
  constructor(options: { playerCount: number; playerNames?: string[]; seed?: string }) {
    super(options);

    const moveAction = Action.create('move')
      .prompt('Move')
      .chooseFrom('dest', { choices: ['a', 'b', 'c'] })
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

function makeRunner(options?: { seed?: string }) {
  const runner = new GameRunner<GateTestGame>({
    GameClass: GateTestGame,
    gameType: 'gate-test',
    gameOptions: {
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
      seed: options?.seed ?? 'gate-test',
    },
  });
  runner.start();
  return runner;
}

const AVAILABLE_ACTIONS = ['move', 'pass'];

// ============================================================
// Labeled-predicate gate (MR-02)
// ============================================================

describe('labeled-predicate condition gate (MR-02)', () => {
  it('blocks all available actions when a labeled predicate returns false', () => {
    const runner = makeRunner();
    runner.game.tutorialDefinition = {
      steps: [
        {
          id: 'step-1',
          gate: { 'must be player turn': (_ctx) => false },
        },
      ],
    };
    runner.game.tutorialProgress.set(1, { stepId: 'step-1', status: 'running' });

    const disabled = getActionLevelDisabledReasons(runner.game, 1, AVAILABLE_ACTIONS);

    expect('move' in disabled).toBe(true);
    expect('pass' in disabled).toBe(true);
  });

  it('includes the failing label in the reason string', () => {
    const runner = makeRunner({ seed: 'failing-label' });
    runner.game.tutorialDefinition = {
      steps: [
        {
          id: 'step-1',
          gate: { 'must be player turn': (_ctx) => false },
        },
      ],
    };
    runner.game.tutorialProgress.set(1, { stepId: 'step-1', status: 'running' });

    const disabled = getActionLevelDisabledReasons(runner.game, 1, AVAILABLE_ACTIONS);

    expect(disabled['move']).toContain('must be player turn');
    expect(disabled['pass']).toContain('must be player turn');
  });

  it('passes all actions when all labeled predicates return true', () => {
    const runner = makeRunner({ seed: 'all-pass' });
    runner.game.tutorialDefinition = {
      steps: [
        {
          id: 'step-1',
          gate: { 'must be player turn': (_ctx) => true },
        },
      ],
    };
    runner.game.tutorialProgress.set(1, { stepId: 'step-1', status: 'running' });

    const disabled = getActionLevelDisabledReasons(runner.game, 1, AVAILABLE_ACTIONS);

    expect(disabled).toEqual({});
  });

  it('surfaces the first failing label when multiple predicates fail', () => {
    const runner = makeRunner({ seed: 'multi-fail' });
    runner.game.tutorialDefinition = {
      steps: [
        {
          id: 'step-1',
          gate: {
            'condition A': (_ctx) => false,
            'condition B': (_ctx) => false,
          },
        },
      ],
    };
    runner.game.tutorialProgress.set(1, { stepId: 'step-1', status: 'running' });

    const disabled = getActionLevelDisabledReasons(runner.game, 1, AVAILABLE_ACTIONS);

    // The first failing label must appear in the reason
    expect(disabled['move']).toContain('condition A');
  });

  it('does not apply per-value gating for labeled-condition gates', () => {
    const runner = makeRunner({ seed: 'no-per-value' });
    runner.game.tutorialDefinition = {
      steps: [
        {
          id: 'step-1',
          gate: { 'always block': (_ctx) => false },
        },
      ],
    };
    runner.game.tutorialProgress.set(1, { stepId: 'step-1', status: 'running' });

    const step = getActiveStep(runner.game, 1)!;
    // Per-value gating must be null for labeled-condition gates
    const reason = getGateReasonForValue(step, 'move', 'a');
    expect(reason).toBeNull();
  });
});

// ============================================================
// Allow-list gate — unchanged by MR-02
// ============================================================

describe('allow-list gate — unchanged by MR-02 refactor', () => {
  it('blocks actions not in the allow list', () => {
    const runner = makeRunner({ seed: 'allow-list' });
    runner.game.tutorialDefinition = {
      steps: [
        {
          id: 'step-1',
          gate: { action: 'move' },
        },
      ],
    };
    runner.game.tutorialProgress.set(1, { stepId: 'step-1', status: 'running' });

    const disabled = getActionLevelDisabledReasons(runner.game, 1, AVAILABLE_ACTIONS);

    expect('pass' in disabled).toBe(true);
    expect('move' in disabled).toBe(false);
  });

  it('permits only the allowed action', () => {
    const runner = makeRunner({ seed: 'allow-list-permit' });
    runner.game.tutorialDefinition = {
      steps: [
        {
          id: 'step-1',
          gate: { action: 'move' },
        },
      ],
    };
    runner.game.tutorialProgress.set(1, { stepId: 'step-1', status: 'running' });

    const disabled = getActionLevelDisabledReasons(runner.game, 1, AVAILABLE_ACTIONS);

    expect('move' in disabled).toBe(false);
  });

  it('applies per-value gating when from/to are specified', () => {
    const runner = makeRunner({ seed: 'per-value' });
    runner.game.tutorialDefinition = {
      steps: [
        {
          id: 'step-1',
          gate: { action: 'move', from: 'a', to: 'b' },
        },
      ],
    };
    runner.game.tutorialProgress.set(1, { stepId: 'step-1', status: 'running' });

    const step = getActiveStep(runner.game, 1)!;
    expect(getGateReasonForValue(step, 'move', 'a')).toBeNull();
    expect(getGateReasonForValue(step, 'move', 'b')).toBeNull();
    expect(getGateReasonForValue(step, 'move', 'c')).not.toBeNull();
  });
});

// ============================================================
// No tutorial active — zero overhead
// ============================================================

describe('no tutorial active', () => {
  it('returns empty record when no tutorial is running', () => {
    const runner = makeRunner({ seed: 'no-tutorial' });

    const disabled = getActionLevelDisabledReasons(runner.game, 1, AVAILABLE_ACTIONS);

    expect(disabled).toEqual({});
  });
});
