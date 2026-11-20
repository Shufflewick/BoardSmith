import type { FlowNode } from './types.js';
import type { Game } from '../element/game.js';
import { flowChildren } from './flow-navigation.js';

/**
 * Recursively walk a flow-node tree, yielding every node (the node itself,
 * then its children in {@link flowChildren} order) in a pre-order traversal.
 *
 * Used by `Game#validateActionReachability()` (PIT-03) to statically
 * enumerate every `action-step` / `simultaneous-action-step` node in a
 * game's flow before it starts.
 */
export function* walkFlowNodes<G extends Game = Game>(node: FlowNode<G>): Generator<FlowNode<G>> {
  yield node;
  for (const child of flowChildren(node)) {
    yield* walkFlowNodes(child);
  }
}
