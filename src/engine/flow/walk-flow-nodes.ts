import type { FlowNode } from './types.js';

/**
 * Recursively walk a flow-node tree, yielding every node (the node itself,
 * then its children) in a pre-order traversal.
 *
 * Exhaustive over the current `FlowNode` union (src/engine/flow/types.ts):
 *   - `sequence` recurses into `config.steps` (array)
 *   - `loop` / `repeat` / `each-player` / `for-each` / `phase` recurse into
 *     `config.do` (single child)
 *   - `if` recurses into `config.then` and, if present, `config.else`
 *   - `switch` recurses into every value of `config.cases` and, if present,
 *     `config.default`
 *   - `action-step` / `simultaneous-action-step` / `execute` are leaves —
 *     they have no nested `FlowNode` children.
 *
 * Used by `Game#validateActionReachability()` (PIT-03) to statically
 * enumerate every `action-step` / `simultaneous-action-step` node in a
 * game's flow before it starts.
 */
export function* walkFlowNodes(node: FlowNode): Generator<FlowNode> {
  yield node;

  switch (node.type) {
    case 'sequence':
      for (const step of node.config.steps) {
        yield* walkFlowNodes(step);
      }
      break;
    case 'loop':
    case 'repeat':
    case 'each-player':
    case 'for-each':
    case 'phase':
      yield* walkFlowNodes(node.config.do);
      break;
    case 'if':
      yield* walkFlowNodes(node.config.then);
      if (node.config.else) {
        yield* walkFlowNodes(node.config.else);
      }
      break;
    case 'switch':
      for (const caseNode of Object.values(node.config.cases)) {
        yield* walkFlowNodes(caseNode);
      }
      if (node.config.default) {
        yield* walkFlowNodes(node.config.default);
      }
      break;
    case 'action-step':
    case 'simultaneous-action-step':
    case 'execute':
      // Leaves: no nested FlowNode children.
      break;
    default: {
      // Exhaustiveness guard: if a new FlowNode variant is added to the
      // union without updating this walker, this becomes a compile-time
      // error at the point the new variant is introduced, instead of a
      // silent runtime gap (an un-walked node whose nested action-step /
      // simultaneous-action-step would go un-validated by PIT-03).
      const _exhaustive: never = node;
      return _exhaustive;
    }
  }
}
