import { describe, it, expect } from 'vitest';
import {
  Game,
  Action,
  FlowEngine,
  defineFlow,
  sequence,
  actionStep,
  ifThen,
  switchOn,
  type FlowNode,
  type GameOptions,
} from '../index.js';
import { captureDevState, validateFlowPosition } from './dev-state.js';

/**
 * #330: when an HMR edit truncates the flow position, the recovery position
 * `validateFlowPosition` builds must resume in the branch the game actually
 * took. An `if`/`switch` records that branch only in its frame data, so these
 * tests drive a real engine into a non-first branch, apply a simulated code
 * edit that invalidates the position below the branch, and restore the
 * recovery position into the edited flow.
 *
 * Each branch is `sequence(first, <named inner sequence>, last)`, and the
 * position is taken on the inner sequence's second step. The edit drops that
 * step, so the recovery keeps the path down to the taken branch's sequence and
 * the restored engine is at the named inner sequence of whichever branch it
 * navigated into. Both branches have the same shape, so restoring into the
 * wrong one succeeds silently, which is the bug.
 */
type BranchKind = 'if' | 'switch';

const step = (name: string) => actionStep<RecoveryGame>({ name, actions: ['go'] });

function named(name: string, ...steps: FlowNode<RecoveryGame>[]): FlowNode<RecoveryGame> {
  return { type: 'sequence', config: { name, steps } };
}

/** A branch body; `edited` is the simulated code edit that removes a step. */
function branch(prefix: string, edited: boolean): FlowNode<RecoveryGame> {
  const inner = edited
    ? named(`${prefix}-inner`, step(`${prefix}-inner-1`))
    : named(`${prefix}-inner`, step(`${prefix}-inner-1`), step(`${prefix}-inner-2`));
  return sequence(step(`${prefix}-first`), inner, step(`${prefix}-last`));
}

function recoveryFlow(kind: BranchKind, edited: boolean) {
  const taken = kind === 'if'
    ? ifThen<RecoveryGame>({ condition: () => false, then: branch('then', edited), else: branch('else', edited) })
    : switchOn<RecoveryGame>({
      on: () => 'c',
      cases: { a: branch('case-a', edited), b: branch('case-b', edited), c: branch('case-c', edited) },
    });
  return defineFlow<RecoveryGame>({ root: sequence(step('start'), taken) });
}

class RecoveryGame extends Game<RecoveryGame> {
  constructor(options: GameOptions, kind: BranchKind, edited: boolean) {
    super(options);
    this.registerActions(Action.create<RecoveryGame>('go').execute(() => ({ success: true })));
    this.setFlow(recoveryFlow(kind, edited));
  }
}

const cases: { kind: BranchKind; taken: string }[] = [
  { kind: 'if', taken: 'else' },
  { kind: 'switch', taken: 'case-c' },
];

describe('#330: HMR flow recovery resumes in the branch the game took', () => {
  for (const { kind, taken } of cases) {
    it(`restores a truncated position into the taken ${kind} branch (${taken})`, () => {
      const live = new RecoveryGame({ playerCount: 1, seed: 'hmr' }, kind, false);
      live.startFlow();
      // start -> <taken>-first -> <taken>-inner-1 -> <taken>-inner-2
      for (let i = 0; i < 3; i++) live.continueFlow('go', {}, 1);
      expect(live.getFlowDebugInfo().step).toBe(`${taken}-inner-2`);

      const edited = new RecoveryGame({ playerCount: 1, seed: 'hmr' }, kind, true);
      const validation = validateFlowPosition(
        captureDevState(live),
        new FlowEngine(edited, recoveryFlow(kind, true)),
      );
      expect(validation.valid).toBe(false);
      const recovery = validation.recoveryPosition!;
      expect(recovery).toBeDefined();

      edited.startFlow();
      edited.restoreFlow(recovery);
      expect(edited.getFlowDebugInfo().step).toBe(`${taken}-inner`);
    });
  }
});
