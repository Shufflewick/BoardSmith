/**
 * A STEP THE HOST TIMES (#300, #1830), in one place.
 *
 * An `actionStep` or `simultaneousActionStep` may be declared `timed: true`,
 * or `timed: { watchSeconds }` to open on watch time (#1831): the host closes it
 * when the table's time per turn runs out, with the game's `idleAction`. The step says nothing about how long that is. The engine's
 * whole part is here -- read the mark back off a flow state, and find every
 * step that carries it. The engine keeps no clock and never closes a step.
 */
import type { FlowNode } from './types.js';
import { walkFlowNodes } from './walk-flow-nodes.js';

/** The minimal flow-state shape {@link stepIsTimed} and {@link stepWatchSeconds} read. */
export interface TimedStepState {
  complete?: boolean;
  timed?: true;
  watchSeconds?: number;
}

/**
 * Whether a timed step is open, read structurally from a flow state that may
 * have crossed a `structuredClone`/RPC boundary -- the same way `dueSeats` and
 * `flowBoundaryKey` read theirs.
 */
export function stepIsTimed(flowState: TimedStepState | undefined | null): boolean {
  return !!flowState && !flowState.complete && flowState.timed === true;
}

/** The seconds of watching the open timed step started with (#1831), or `undefined` when it has none. */
export function stepWatchSeconds(flowState: TimedStepState | undefined | null): number | undefined {
  return stepIsTimed(flowState) ? flowState!.watchSeconds : undefined;
}

/**
 * The name of every timed step in these flows, and of those declaring
 * `watchSeconds` (#1831), each once, in the order first found. An unnamed step
 * is reported by its node type.
 */
export function timedStepNames(roots: readonly FlowNode[]): { timed: string[]; watching: string[] } {
  const timed = new Set<string>();
  const watching = new Set<string>();
  for (const root of roots) {
    for (const node of walkFlowNodes(root)) {
      if (node.type !== 'action-step' && node.type !== 'simultaneous-action-step') continue;
      const timing = node.config.timed;
      if (timing === undefined) continue;
      const name = node.config.name ?? node.type;
      timed.add(name);
      if (timing !== true) watching.add(name);
    }
  }
  return { timed: [...timed], watching: [...watching] };
}
