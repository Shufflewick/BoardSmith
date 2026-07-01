import { describe, it, expect } from 'vitest';
import { describeFlowPosition } from './describe-flow-position.js';
import type { FlowNode, FlowPosition, FlowState } from './types.js';

function actionStepNode(actions: string[], name?: string): FlowNode {
  return { type: 'action-step', config: { actions, name } };
}

function position(path: number[]): FlowPosition {
  return { path, iterations: {}, variables: {} };
}

function flowState(overrides: Partial<FlowState> = {}): FlowState {
  return {
    position: position([]),
    complete: false,
    awaitingInput: true,
    ...overrides,
  };
}

describe('describeFlowPosition', () => {
  it('reads phase from FlowState.currentPhase and step from the named leaf node', () => {
    const step = actionStepNode(['play'], 'player-turn');
    const root: FlowNode = {
      type: 'phase',
      config: { name: 'pegging', do: step },
    };

    const info = describeFlowPosition(root, position([0]), flowState({
      currentPhase: 'pegging',
      currentPlayer: 2,
    }));

    expect(info.phase).toBe('pegging');
    expect(info.step).toBe('player-turn');
    expect(info.path).toEqual([0]);
    expect(info.awaiting).toEqual({ currentPlayer: 2, awaitingPlayers: undefined });
    expect(info.describe()).toBe('phase *pegging* -> step *player-turn*, waiting on seat 2');
  });

  it('falls back to the node type when the deepest node has no config.name', () => {
    const step = actionStepNode(['roll']); // no name
    const root: FlowNode = {
      type: 'phase',
      config: { name: 'setup', do: step },
    };

    const info = describeFlowPosition(root, position([0]), flowState({ currentPhase: 'setup' }));

    expect(info.step).toBe('action-step');
    expect(info.step).not.toBe('undefined');
    expect(() => info.describe()).not.toThrow();
  });

  it('walks nested loop / each-player structures following the path', () => {
    const innerStep = actionStepNode(['draw'], 'draw-step');
    const loopNode: FlowNode = { type: 'loop', config: { do: innerStep } };
    const eachPlayerNode: FlowNode = { type: 'each-player', config: { do: loopNode } };
    const root: FlowNode = {
      type: 'phase',
      config: { name: 'main', do: eachPlayerNode },
    };

    // path: phase -> each-player -> loop -> action-step
    const info = describeFlowPosition(root, position([0, 0, 0]), flowState({
      currentPhase: 'main',
      awaitingPlayers: [
        { playerIndex: 1, availableActions: ['draw'], completed: false },
        { playerIndex: 3, availableActions: ['draw'], completed: false },
      ],
    }));

    expect(info.phase).toBe('main');
    expect(info.step).toBe('draw-step');
    expect(info.awaiting).toEqual({ currentPlayer: undefined, awaitingPlayers: [1, 3] });
    expect(info.describe()).toBe('phase *main* -> step *draw-step*, waiting on seats 1, 3');
  });

  it('degrades gracefully on an out-of-range path instead of throwing', () => {
    const step = actionStepNode(['play'], 'only-step');
    const root: FlowNode = {
      type: 'sequence',
      config: { steps: [step] },
    };

    // Index 5 doesn't exist among the sequence's single step.
    const info = describeFlowPosition(root, position([5, 2, 9]), flowState());

    expect(info.step).toBe('sequence');
    expect(info.path).toEqual([5, 2, 9]);
    expect(() => info.describe()).not.toThrow();
  });

  it('omits the "waiting on" clause when there is no current player or awaiting players', () => {
    const step = actionStepNode(['play'], 'idle-step');
    const root: FlowNode = { type: 'sequence', config: { steps: [step] } };

    const info = describeFlowPosition(root, position([0]), flowState());

    expect(info.describe()).toBe('step *idle-step*');
  });
});
