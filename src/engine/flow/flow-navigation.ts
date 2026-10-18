import type { Game } from '../element/game.js';
import type { FlowNode, SwitchConfig } from './types.js';

/**
 * The one rule for "which child of this flow node does a serialized frame
 * point at" (#324). `FlowEngine.restore()` / `validatePath()` use it to
 * rebuild the stack from a `FlowPosition`, and `describeFlowPosition()` uses
 * it to name the step that position is at. Keeping a second copy is how the
 * debug description came to name the wrong step, so anything that resolves a
 * `FlowPosition.path` to nodes must go through {@link resolveFlowChild}.
 *
 * A frame's `index` does not mean the same thing on every node type:
 * - `sequence`: `executeSequence` pushes child k and THEN increments, so a
 *   live frame's index points ONE PAST the child in progress.
 * - `loop` / `repeat` / `each-player` / `for-each` / `phase`: the index is the
 *   iteration count; the only child is `config.do`.
 * - `if` / `switch`: the index stays 0; the branch taken is on the frame's
 *   data, as `branchIndex` for an `if` and as `branchKey` (the case's key, or
 *   `'__default'`) for a switch, so a switch whose cases were reordered or
 *   removed resolves the case the save was in, or none (#966).
 */

/**
 * The children of `node`, in navigation-index order: a sequence's steps, an
 * iterating node's one `do`, an `if`'s then/else, a switch's cases in
 * declaration order followed by its default. Leaves have none.
 */
function flowChildren<G extends Game>(node: FlowNode<G>): FlowNode<G>[] {
  switch (node.type) {
    case 'sequence':
      return node.config.steps;
    case 'if':
      return node.config.else ? [node.config.then, node.config.else] : [node.config.then];
    case 'switch': {
      const cases = Object.values(node.config.cases);
      return node.config.default ? [...cases, node.config.default] : cases;
    }
    case 'action-step':
    case 'simultaneous-action-step':
    case 'execute':
      return [];
    default:
      // loop / repeat / each-player / for-each / phase. A new node type
      // without a `do` fails to compile here until it is given a case.
      return [node.config.do];
  }
}

/** How many children `node` has, in navigation-index order. */
export function flowChildCount<G extends Game>(node: FlowNode<G>): number {
  return flowChildren(node).length;
}

/** The case a switch frame took, by its saved key; -1 when the rules no longer have it. */
function switchBranchIndex<G extends Game>(config: SwitchConfig<G>, branchKey: unknown): number {
  const caseKeys = Object.keys(config.cases);
  if (branchKey === '__default') {
    return config.default ? caseKeys.length : -1;
  }
  return typeof branchKey === 'string' ? caseKeys.indexOf(branchKey) : -1;
}

/** The branch an `if` frame took: 0 for then, 1 for else. */
function ifBranchIndex(frameData: Record<string, unknown> | undefined, frameIndex: number): number {
  return typeof frameData?.branchIndex === 'number' ? frameData.branchIndex : frameIndex;
}

function navigationIndex<G extends Game>(
  node: FlowNode<G>,
  frameIndex: number,
  frameData: Record<string, unknown> | undefined,
): number {
  switch (node.type) {
    case 'sequence':
      return Math.max(0, frameIndex - 1);
    case 'if':
      return ifBranchIndex(frameData, frameIndex);
    case 'switch':
      return switchBranchIndex(node.config, frameData?.branchKey);
    case 'action-step':
    case 'simultaneous-action-step':
    case 'execute':
      return frameIndex;
    default:
      // Iterating nodes: the frame index is the iteration count.
      return 0;
  }
}

/**
 * The child of `node` that a serialized frame (`frameIndex` from
 * `position.path`, `frameData` from `position.frameData['__frame_<depth>']`)
 * points at, or `undefined` when it points at none: a leaf, or an index out
 * of range for the current flow definition.
 */
export function resolveFlowChild<G extends Game>(
  node: FlowNode<G>,
  frameIndex: number,
  frameData: Record<string, unknown> | undefined,
): FlowNode<G> | undefined {
  const index = navigationIndex(node, frameIndex, frameData);
  return index >= 0 ? flowChildren(node)[index] : undefined;
}
