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
    const reason = getGateReasonForValue(step, 'move', 'a', 'piece');
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

  it('applies per-selection gating by element id: matching element is allowed, non-matching is blocked', () => {
    const step: TutorialStep = {
      id: 's',
      gate: { action: 'move', selections: { piece: { id: 42 } } },
    };
    // matching element: allowed
    expect(getGateReasonForValue(step, 'move', { id: 42 }, 'piece')).toBeNull();
    // non-matching element: blocked
    expect(getGateReasonForValue(step, 'move', { id: 99 }, 'piece')).not.toBeNull();
  });

  it('unspecified selection name permits all its values (back-compatible)', () => {
    const step: TutorialStep = {
      id: 's',
      gate: { action: 'move', selections: { piece: { id: 42 } } },
    };
    // 'destination' has no entry in selections → all values allowed
    expect(getGateReasonForValue(step, 'move', { toNotation: 'a1' }, 'destination')).toBeNull();
    expect(getGateReasonForValue(step, 'move', { toNotation: 'h8' }, 'destination')).toBeNull();
  });

  it('applies per-selection field equality for choice objects (toNotation)', () => {
    const step: TutorialStep = {
      id: 's',
      gate: { action: 'move', selections: { destination: { toNotation: 'd4' } } },
    };
    // matching destination: allowed
    expect(getGateReasonForValue(step, 'move', { toNotation: 'd4', pieceId: 1 }, 'destination')).toBeNull();
    // non-matching destination: blocked
    expect(getGateReasonForValue(step, 'move', { toNotation: 'e5', pieceId: 1 }, 'destination')).not.toBeNull();
  });

  it('non-object/null value never matches a non-empty matcher (no crash, returns reason)', () => {
    const step: TutorialStep = {
      id: 's',
      gate: { action: 'move', selections: { piece: { id: 42 } } },
    };
    expect(getGateReasonForValue(step, 'move', null, 'piece')).not.toBeNull();
    expect(getGateReasonForValue(step, 'move', 'string-value', 'piece')).not.toBeNull();
    expect(getGateReasonForValue(step, 'move', 99, 'piece')).not.toBeNull();
  });

  it('no selections on gate: all values of the allowed action are permitted (legacy back-compat)', () => {
    const step: TutorialStep = {
      id: 's',
      gate: { action: 'move' },
    };
    expect(getGateReasonForValue(step, 'move', { id: 1 }, 'piece')).toBeNull();
    expect(getGateReasonForValue(step, 'move', { toNotation: 'x5' }, 'destination')).toBeNull();
  });

  it('selections: primitive rank string matched via { value } key — allows matching, blocks non-matching', () => {
    const step: TutorialStep = {
      id: 's',
      gate: { action: 'ask', selections: { rank: { value: '7' } } },
    };
    // (a) matching primitive string: should be allowed (returns null).
    // FAILS against current code — the opening guard returns false for all primitives.
    expect(getGateReasonForValue(step, 'ask', '7', 'rank')).toBeNull();
    // (b) non-matching string: gated (returns non-null reason)
    expect(getGateReasonForValue(step, 'ask', 'K', 'rank')).not.toBeNull();
    // (c) strict equality: number 7 must NOT match string '7'
    expect(getGateReasonForValue(step, 'ask', 7, 'rank')).not.toBeNull();
  });

  it('selections: existing object field-equality path unchanged after primitive-matcher change (regression guard)', () => {
    const step: TutorialStep = {
      id: 's',
      gate: { action: 'ask', selections: { target: { value: 2 } } },
    };
    // matching object via general field equality: allowed
    expect(getGateReasonForValue(step, 'ask', { value: 2, display: 'Bob' }, 'target')).toBeNull();
    // non-matching object: gated
    expect(getGateReasonForValue(step, 'ask', { value: 3, display: 'Cat' }, 'target')).not.toBeNull();
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
