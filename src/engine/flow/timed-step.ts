/**
 * A STEP THE HOST TIMES (#300, #1830), in one place.
 *
 * An `actionStep` or `simultaneousActionStep` may be declared `timed: true`:
 * the host closes it when the table's time per turn runs out, with the game's
 * `idleAction`. The step says nothing about how long that is. The engine's
 * whole part is here -- read the mark back off a flow state, and find every
 * step that carries it. The engine keeps no clock and never closes a step.
 */
import type { FlowNode } from './types.js';
import { walkFlowNodes } from './walk-flow-nodes.js';

/** The minimal flow-state shape {@link stepIsTimed} reads. */
export interface TimedStepState {
  complete?: boolean;
  timed?: true;
}

/**
 * Whether a timed step is open, read structurally from a flow state that may
 * have crossed a `structuredClone`/RPC boundary -- the same way `dueSeats` and
 * `flowBoundaryKey` read theirs.
 */
export function stepIsTimed(flowState: TimedStepState | undefined | null): boolean {
  return !!flowState && !flowState.complete && flowState.timed === true;
}

/**
 * The name of every step in these flows declared `timed: true`, each once, in
 * the order first found. An unnamed step is reported by its node type.
 */
export function timedStepNames(roots: readonly FlowNode[]): string[] {
  const names = new Set<string>();
  for (const root of roots) {
    for (const node of walkFlowNodes(root)) {
      if (node.type !== 'action-step' && node.type !== 'simultaneous-action-step') continue;
      if (node.config.timed !== true) continue;
      names.add(node.config.name ?? node.type);
    }
  }
  return [...names];
}
