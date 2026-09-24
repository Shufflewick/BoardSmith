/**
 * A STEP'S DECLARED TIME WINDOW (#300), in one place.
 *
 * An `actionStep` or `simultaneousActionStep` may declare `timeLimitMs`: how
 * long it stays open once entered. The engine's whole part in that is here --
 * check the declaration, resolve it once at step entry, read it back off a flow
 * state, and find every step that declares one. The engine keeps no clock and
 * never closes a step; the host does, with the game's `idleAction`.
 */
import type { Game } from '../element/game.js';
import type { FlowContext, FlowNode, StepTimeLimit } from './types.js';
import { walkFlowNodes } from './walk-flow-nodes.js';

/**
 * Refuse a limit that is not a positive whole number of milliseconds.
 *
 * `source` says where the value came from, so the message points at the code
 * to change: the step's own declaration, or the function it declared.
 */
function requireUsableLimit(value: unknown, stepName: string, source: 'declared' | 'returned'): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  const got = typeof value === 'number' ? String(value) : JSON.stringify(value) ?? String(value);
  const where = source === 'declared'
    ? `declares timeLimitMs: ${got}`
    : `has a timeLimitMs function that returned ${got}`;
  throw new Error(
    `Flow step '${stepName}' ${where}. A step's time limit is how long it stays open, in ` +
      'milliseconds, and must be a positive whole number, e.g. timeLimitMs: 120_000 for two ' +
      'minutes. Leave timeLimitMs out for a step that stays open until every seat has acted.',
  );
}

/**
 * Check a step's declaration when the flow is BUILT, so a bad number fails at
 * construction rather than when some game first reaches the step. A function is
 * checked when it is resolved, since only then does it have an answer.
 */
export function checkDeclaredTimeLimit<G extends Game>(limit: StepTimeLimit<G> | undefined, stepName: string): void {
  if (limit === undefined || typeof limit === 'function') return;
  requireUsableLimit(limit, stepName, 'declared');
}

/** The step's window in milliseconds, resolved against the context it is entered with. */
export function resolveTimeLimit<G extends Game>(
  limit: StepTimeLimit<G>,
  context: FlowContext<G>,
  stepName: string,
): number {
  if (typeof limit === 'function') return requireUsableLimit(limit(context), stepName, 'returned');
  return requireUsableLimit(limit, stepName, 'declared');
}

/** The minimal flow-state shape {@link stepTimeLimitMs} reads. */
export interface StepTimeLimitState {
  complete?: boolean;
  timeLimitMs?: number;
}

/**
 * The open step's window, read structurally from a flow state that may have
 * crossed a `structuredClone`/RPC boundary -- the same way `dueSeats` and
 * `flowBoundaryKey` read theirs. `undefined` when no timed step is open.
 */
export function stepTimeLimitMs(flowState: StepTimeLimitState | undefined | null): number | undefined {
  if (!flowState || flowState.complete) return undefined;
  return typeof flowState.timeLimitMs === 'number' ? flowState.timeLimitMs : undefined;
}

/**
 * The name of every step in these flows that declares a time limit, each once,
 * in the order first found. An unnamed step is reported by its node type.
 */
export function timedStepNames(roots: readonly FlowNode[]): string[] {
  const names = new Set<string>();
  for (const root of roots) {
    for (const node of walkFlowNodes(root)) {
      if (node.type !== 'action-step' && node.type !== 'simultaneous-action-step') continue;
      if (node.config.timeLimitMs === undefined) continue;
      names.add(node.config.name ?? node.type);
    }
  }
  return [...names];
}
