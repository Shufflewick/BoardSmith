import { describe, it, expect } from 'vitest';
import { walkFlowNodes } from './walk-flow-nodes.js';
import type { FlowNode } from './types.js';

function actionStepNode(actions: string[], name?: string): FlowNode {
  return { type: 'action-step', config: { actions, name } };
}

function executeNode(name?: string): FlowNode {
  return { type: 'execute', config: { fn: () => {}, name } };
}

describe('walkFlowNodes', () => {
  it('yields both action-step nodes inside a sequence', () => {
    const a = actionStepNode(['draw'], 'a');
    const b = actionStepNode(['play'], 'b');
    const root: FlowNode = { type: 'sequence', config: { steps: [a, b] } };

    const visited = [...walkFlowNodes(root)];

    expect(visited).toContain(root);
    expect(visited).toContain(a);
    expect(visited).toContain(b);
    expect(visited).toHaveLength(3);
  });

  it('yields the inner action-step via config.do for loop / phase / each-player', () => {
    const inner = actionStepNode(['roll'], 'inner');

    const loopNode: FlowNode = { type: 'loop', config: { do: inner } };
    expect([...walkFlowNodes(loopNode)]).toContain(inner);

    const phaseInner = actionStepNode(['roll'], 'phase-inner');
    const phaseNode: FlowNode = { type: 'phase', config: { name: 'setup', do: phaseInner } };
    expect([...walkFlowNodes(phaseNode)]).toContain(phaseInner);

    const eachPlayerInner = actionStepNode(['roll'], 'ep-inner');
    const eachPlayerNode: FlowNode = { type: 'each-player', config: { do: eachPlayerInner } };
    expect([...walkFlowNodes(eachPlayerNode)]).toContain(eachPlayerInner);
  });

  it('yields the inner action-step via config.do for repeat and for-each', () => {
    const repeatInner = actionStepNode(['roll'], 'repeat-inner');
    const repeatNode: FlowNode = { type: 'repeat', config: { times: 3, do: repeatInner } };
    expect([...walkFlowNodes(repeatNode)]).toContain(repeatInner);

    const forEachInner = actionStepNode(['roll'], 'fe-inner');
    const forEachNode: FlowNode = {
      type: 'for-each',
      config: { collection: [1, 2, 3], as: 'item', do: forEachInner },
    };
    expect([...walkFlowNodes(forEachNode)]).toContain(forEachInner);
  });

  it('yields all nested action-step nodes for an if with then+else', () => {
    const thenNode = actionStepNode(['thenAction'], 'then');
    const elseNode = actionStepNode(['elseAction'], 'else');
    const ifNode: FlowNode = {
      type: 'if',
      config: { condition: () => true, then: thenNode, else: elseNode },
    };

    const visited = [...walkFlowNodes(ifNode)];
    expect(visited).toContain(thenNode);
    expect(visited).toContain(elseNode);
  });

  it('yields all nested action-step nodes for a switch with two cases + default', () => {
    const caseA = actionStepNode(['caseAAction'], 'caseA');
    const caseB = actionStepNode(['caseBAction'], 'caseB');
    const defaultNode = actionStepNode(['defaultAction'], 'default');
    const switchNode: FlowNode = {
      type: 'switch',
      config: {
        on: () => 'a',
        cases: { a: caseA, b: caseB },
        default: defaultNode,
      },
    };

    const visited = [...walkFlowNodes(switchNode)];
    expect(visited).toContain(caseA);
    expect(visited).toContain(caseB);
    expect(visited).toContain(defaultNode);
  });

  it('leaf nodes (execute, action-step) yield only themselves', () => {
    const exec = executeNode('exec');
    expect([...walkFlowNodes(exec)]).toEqual([exec]);

    const step = actionStepNode(['x'], 'step');
    expect([...walkFlowNodes(step)]).toEqual([step]);
  });

  it('yields the inner action-step via config.players/actions for simultaneous-action-step (leaf)', () => {
    const simStep: FlowNode = {
      type: 'simultaneous-action-step',
      config: { actions: ['x'] },
    };
    expect([...walkFlowNodes(simStep)]).toEqual([simStep]);
  });
});
