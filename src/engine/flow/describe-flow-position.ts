import type { FlowDebugInfo } from './types.js';
import type { Game } from '../element/game.js';
import type { FlowNode, FlowPosition, FlowState } from './types.js';
import { resolveFlowChild } from './flow-navigation.js';

/**
 * The most specific step `position` is at: the deepest node reached by
 * following `position.path` from `root`, named by `config.name` or, failing
 * that, by its `type`. Each segment is resolved with {@link resolveFlowChild},
 * the same rule `FlowEngine.restore()` rebuilds its stack with, so this names
 * the node the engine itself is at (#324). A path that no longer fits the
 * flow definition stops at the deepest node it reaches rather than throwing.
 */
function stepAt<G extends Game = Game>(root: FlowNode<G>, position: FlowPosition): string {
  let node = root;
  for (const [depth, index] of position.path.entries()) {
    const child = resolveFlowChild(node, index, position.frameData?.[`__frame_${depth}`]);
    if (!child) break;
    node = child;
  }
  return node.config.name ?? node.type;
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
export function describeFlowPosition<G extends Game = Game>(
  root: FlowNode<G>,
  position: FlowPosition,
  flowState: FlowState,
): FlowDebugInfo {
  const step = stepAt(root, position);
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
