import type { FlowDebugInfo } from './types.js';
import type { FlowNode, FlowPosition, FlowState } from './types.js';

/**
 * Walk `root` following `position.path` as an index stack, collecting the
 * most-specific named node encountered along the way (falling back to the
 * node's `type` when `config.name` is absent). Degrades gracefully on an
 * invalid/partial path — stops at the deepest reachable node rather than
 * throwing.
 *
 * Uses the SAME `switch (node.type)` child-selection rules as
 * `FlowEngine.getChildNode()` (src/engine/flow/engine.ts) so that a given
 * `FlowPosition.path` resolves to the exact node the engine itself would
 * navigate to:
 *   - `sequence` -> `config.steps[idx]`
 *   - `loop` / `repeat` / `each-player` / `for-each` / `phase` -> `config.do`
 *   - `if` -> `config.then` (idx 0) or `config.else` (idx 1)
 *   - `switch` -> `Object.values(config.cases)[idx]`, falling back to
 *     `config.default` when `idx` is out of range for `cases`
 *   - `action-step` / `simultaneous-action-step` / `execute` -> leaves, no children
 */
function walkPath(root: FlowNode, path: number[]): { node: FlowNode; step?: string } {
  let node = root;
  let step: string | undefined = root.config.name ?? root.type;

  for (const idx of path) {
    const child = getChildNode(node, idx);
    if (!child) {
      // Out-of-range / invalid path segment: stop here, degrade gracefully.
      break;
    }
    node = child;
    step = node.config.name ?? node.type;
  }

  return { node, step };
}

function getChildNode(node: FlowNode, index: number): FlowNode | undefined {
  switch (node.type) {
    case 'sequence':
      return node.config.steps[index];
    case 'loop':
    case 'repeat':
    case 'each-player':
    case 'for-each':
    case 'phase':
      return node.config.do;
    case 'if':
      return index === 0 ? node.config.then : node.config.else;
    case 'switch': {
      const cases = Object.values(node.config.cases);
      return cases[index] ?? node.config.default;
    }
    case 'action-step':
    case 'simultaneous-action-step':
    case 'execute':
      // Leaves: no nested FlowNode children.
      return undefined;
    default: {
      // Exhaustiveness guard: if a new FlowNode variant is added to the
      // union without updating this function, this becomes a compile-time
      // error instead of a silent runtime gap.
      const _exhaustive: never = node;
      return _exhaustive;
    }
  }
}

function formatDescribe(phase: string | undefined, step: string | undefined, flowState: FlowState): string {
  const parts: string[] = [];

  if (phase) {
    parts.push(`phase *${phase}*`);
  }

  if (step) {
    parts.push(parts.length > 0 ? `-> step *${step}*` : `step *${step}*`);
  }

  let waiting = '';
  if (typeof flowState.currentPlayer === 'number') {
    waiting = `, waiting on seat ${flowState.currentPlayer}`;
  } else if (flowState.awaitingPlayers && flowState.awaitingPlayers.length > 0) {
    const seats = flowState.awaitingPlayers.map(p => p.playerIndex).join(', ');
    waiting = `, waiting on seat${flowState.awaitingPlayers.length > 1 ? 's' : ''} ${seats}`;
  }

  if (parts.length === 0) {
    return waiting ? `no active flow position${waiting}` : 'no active flow position';
  }

  return `${parts.join(' ')}${waiting}`;
}

/**
 * Build a structured, human- and machine-readable description of "where in
 * the flow are we right now" for a given `FlowPosition`.
 *
 * The `phase` field is read DIRECTLY from `flowState.currentPhase` — it is
 * never re-derived from `position.path` (the engine already tracks phase
 * entry/exit as a side effect of executing `phase` nodes; recomputing it from
 * the path alone would diverge from that bookkeeping on `each-player`/
 * `for-each` re-entry). The `step` field is the most-specific named node
 * reached by following `position.path` through `root`, falling back to that
 * node's `type` string when it has no `config.name`.
 *
 * @example
 * ```typescript
 * const info = describeFlowPosition(root, position, flowState);
 * console.log(info.describe());
 * // "phase *pegging* -> step *player-turn*, waiting on seat 2"
 * ```
 */
export function describeFlowPosition(
  root: FlowNode,
  position: FlowPosition,
  flowState: FlowState,
): FlowDebugInfo {
  const { step } = walkPath(root, position.path);
  const phase = flowState.currentPhase;

  return {
    phase,
    step,
    path: position.path,
    awaiting: {
      currentPlayer: flowState.currentPlayer,
      awaitingPlayers: flowState.awaitingPlayers?.map(p => p.playerIndex),
    },
    describe(): string {
      return formatDescribe(phase, step, flowState);
    },
  };
}
