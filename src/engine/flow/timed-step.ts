/**
 * A STEP THE HOST TIMES (#300, #1830), in one place.
 *
 * An `actionStep` or `simultaneousActionStep` may be declared `timed: true`,
 * or `timed: { watchSeconds }` to open on watch time (#1831): the host closes it
 * when the table's time per turn runs out, with the game's `idleAction`. The step says nothing about how long that is. The engine's
 * whole part is here -- read the mark back off a flow state, and find every
 * step that carries it. The engine keeps no clock and never closes a step.
 */
import type { FlowContext, FlowNode, StepTiming } from './types.js';
import type { Game } from '../element/game.js';
import { walkFlowNodes } from './walk-flow-nodes.js';

/** The minimal flow-state shape {@link timedStepFields} reads. */
export interface TimedStepState {
  complete?: boolean;
  timed?: true;
  watchSeconds?: number;
}

/**
 * What the turn boundary says about the open step's timing: `timed` while a
 * timed step is open, with the `watchSeconds` it opened with when it has any
 * (#1831), or nothing. Read structurally from a flow state that may have
 * crossed a `structuredClone`/RPC boundary -- the same way `dueSeats` and
 * `flowBoundaryKey` read theirs.
 */
export function timedStepFields(flowState: TimedStepState | undefined | null): { timed?: true; watchSeconds?: number } {
  if (!flowState || flowState.complete || flowState.timed !== true) return {};
  return flowState.watchSeconds === undefined ? { timed: true } : { timed: true, watchSeconds: flowState.watchSeconds };
}

/** A step's `watchSeconds`, resolved as it opens (#1831), refused unless it is a finite number of seconds, 0 or more. */
export function resolveWatchSeconds<G extends Game>(
  timing: Exclude<StepTiming<G>, true>,
  context: FlowContext<G>,
  stepName: string,
): number {
  const watchSeconds = timing.watchSeconds(context);
  if (Number.isFinite(watchSeconds) && watchSeconds >= 0) return watchSeconds;
  throw new Error(
    `Step '${stepName}' reported ${watchSeconds} seconds of watch time. ` +
      'watchSeconds must return a finite number of seconds, 0 or more.',
  );
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
      if (!timing) continue;
      const name = node.config.name ?? node.type;
      timed.add(name);
      if (timing !== true) watching.add(name);
    }
  }
  return { timed: [...timed], watching: [...watching] };
}
