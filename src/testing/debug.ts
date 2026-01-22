/**
 * Debug utilities for BoardSmith game development.
 *
 * These tools help diagnose issues with game state, actions, and flow.
 * Use during development to understand what's happening in your game.
 *
 * @module
 */

import { Player, type Game, type GameElement, type FlowEngine, type FlowNode, type Action, type ActionContext } from '../engine/index.js';

/**
 * Options for {@link toDebugString}.
 */
export interface DebugStringOptions {
  /** Include element IDs (default: true) */
  showIds?: boolean;
  /** Maximum depth of element tree to show (default: 3) */
  maxDepth?: number;
  /** Include hidden information (default: false) */
  showHidden?: boolean;
  /** Include element attributes (default: true) */
  showAttributes?: boolean;
}

/**
 * Generate a human-readable debug string of the game state.
 *
 * Shows game info, player summaries with attributes, and element tree.
 *
 * @param game - The game instance to debug
 * @param options - Display options for the debug output
 * @returns A multi-line string with game state information
 *
 * @example
 * ```typescript
 * console.log(toDebugString(game));
 * // Game: MyGame
 * // Phase: playing
 * // Current Player: Player 1 (position 0)
 * //
 * // Players:
 * //   [0] Player 1: hand(5 cards), score=10
 * //   [1] Player 2: hand(4 cards), score=15
 * //
 * // Board:
 * //   Deck (id=1): 32 cards
 * //   DiscardPile (id=2): 10 cards
 * ```
 */
export function toDebugString(game: Game, options: DebugStringOptions = {}): string {
  const { showIds = true, maxDepth = 3, showAttributes = true } = options;

  const lines: string[] = [];

  // Game header
  lines.push(`Game: ${game.constructor.name}`);
  if ((game as any).phase) {
    lines.push(`Phase: ${(game as any).phase}`);
  }
  if (game.currentPlayer) {
    lines.push(`Current Player: ${game.currentPlayer.name} (position ${game.currentPlayer.position})`);
  }
  lines.push('');

  // Players summary
  lines.push('Players:');
  for (const player of game.all(Player)) {
    const attrs: string[] = [];
    const playerAny = player as any;

    // Common attributes
    if (typeof playerAny.score === 'number') attrs.push(`score=${playerAny.score}`);
    if (typeof playerAny.actionsRemaining === 'number') attrs.push(`actions=${playerAny.actionsRemaining}`);
    if (playerAny.eliminated) attrs.push('ELIMINATED');

    // Count elements in player spaces
    const handCount = playerAny.hand?.all?.()?.length;
    const boardCount = playerAny.board?.all?.()?.length;
    if (handCount) attrs.push(`hand(${handCount})`);
    if (boardCount) attrs.push(`board(${boardCount})`);

    lines.push(`  [${player.seat}] ${player.name}: ${attrs.join(', ') || '(no attributes)'}`);
  }
  lines.push('');

  // Element tree
  lines.push('Elements:');
  printElementTree(game, lines, 1, maxDepth, showIds, showAttributes);

  return lines.join('\n');
}

function printElementTree(
  element: GameElement,
  lines: string[],
  depth: number,
  maxDepth: number,
  showIds: boolean,
  showAttributes: boolean
): void {
  if (depth > maxDepth) {
    const childCount = element.all?.().length || 0;
    if (childCount > 0) {
      lines.push(`${'  '.repeat(depth)}... (${childCount} more elements)`);
    }
    return;
  }

  const children = element.all?.() || [];
  for (const child of children) {
    const idStr = showIds ? ` (id=${(child as any).id || (child as any)._t?.id || '?'})` : '';
    const name = (child as any).name || child.constructor.name;
    const count = child.all?.().length || 0;

    let attrStr = '';
    if (showAttributes) {
      const attrs: string[] = [];
      const childAny = child as any;
      // Common game element attributes
      if (typeof childAny.value !== 'undefined') attrs.push(`value=${childAny.value}`);
      if (typeof childAny.suit !== 'undefined') attrs.push(`suit=${childAny.suit}`);
      if (typeof childAny.rank !== 'undefined') attrs.push(`rank=${childAny.rank}`);
      if (childAny.isDead) attrs.push('DEAD');
      if (attrs.length > 0) attrStr = ` [${attrs.join(', ')}]`;
    }

    const countStr = count > 0 ? `: ${count} children` : '';
    lines.push(`${'  '.repeat(depth)}${name}${idStr}${attrStr}${countStr}`);

    printElementTree(child, lines, depth + 1, maxDepth, showIds, showAttributes);
  }
}

/**
 * Result from tracing an action's availability.
 */
export interface ActionTraceResult {
  actionName: string;
  available: boolean;
  reason: string;
  details: ActionTraceDetail[];
}

/**
 * Detail of a single step in action tracing.
 */
export interface ActionTraceDetail {
  step: string;
  passed: boolean;
  info: string;
}

/**
 * Trace why an action is or isn't available.
 *
 * Walks through each check (condition, selections) and reports whether it passed.
 * Useful for debugging why a player can't perform an action.
 *
 * @param game - The game instance
 * @param actionName - The name of the action to trace
 * @param player - The player to check (defaults to current player)
 * @returns Trace result with availability, reason, and step-by-step details
 *
 * @example
 * ```typescript
 * const trace = traceAction(game, 'move', player);
 * console.log(trace.reason); // "Action available" or "No valid elements for selection 'destination'"
 * for (const detail of trace.details) {
 *   console.log(`${detail.step}: ${detail.passed ? '✓' : '✗'} ${detail.info}`);
 * }
 * ```
 */
export function traceAction(
  game: Game,
  actionName: string,
  player?: Player
): ActionTraceResult {
  const details: ActionTraceDetail[] = [];
  const currentPlayer = player || game.currentPlayer;

  // Find the action
  const actions = (game as any).actions || {};
  const action = actions[actionName];

  if (!action) {
    return {
      actionName,
      available: false,
      reason: `Action '${actionName}' not found in game.actions`,
      details: [{ step: 'Lookup', passed: false, info: `No action named '${actionName}' exists` }],
    };
  }

  details.push({ step: 'Lookup', passed: true, info: `Found action '${actionName}'` });

  // Check if action has a condition
  if (action.condition) {
    try {
      const ctx: Partial<ActionContext> = {
        game,
        player: currentPlayer,
        args: {},
      };
      const conditionResult = action.condition(ctx);
      details.push({
        step: 'Condition',
        passed: conditionResult,
        info: conditionResult ? 'Condition returned true' : 'Condition returned false',
      });

      if (!conditionResult) {
        return {
          actionName,
          available: false,
          reason: 'Action condition returned false',
          details,
        };
      }
    } catch (error) {
      details.push({
        step: 'Condition',
        passed: false,
        info: `Condition threw error: ${error instanceof Error ? error.message : String(error)}`,
      });
      return {
        actionName,
        available: false,
        reason: `Action condition threw error: ${error instanceof Error ? error.message : String(error)}`,
        details,
      };
    }
  } else {
    details.push({ step: 'Condition', passed: true, info: 'No condition (always allowed)' });
  }

  // Check selections
  const selections = action.selections || [];
  for (let i = 0; i < selections.length; i++) {
    const selection = selections[i];
    const selName = selection.name || `selection${i}`;
    const selType = selection.type || 'unknown';

    if (selType === 'element') {
      try {
        const ctx: Partial<ActionContext> = {
          game,
          player: currentPlayer,
          args: {},
        };
        const elements = selection.getElements?.(ctx) || [];
        const filtered = selection.filter
          ? elements.filter((e: any) => selection.filter(e, ctx))
          : elements;

        details.push({
          step: `Selection '${selName}'`,
          passed: filtered.length > 0,
          info: `${filtered.length} valid elements (${elements.length} before filter)`,
        });

        if (filtered.length === 0) {
          return {
            actionName,
            available: false,
            reason: `No valid elements for selection '${selName}'`,
            details,
          };
        }
      } catch (error) {
        details.push({
          step: `Selection '${selName}'`,
          passed: false,
          info: `Error evaluating: ${error instanceof Error ? error.message : String(error)}`,
        });
        return {
          actionName,
          available: false,
          reason: `Error in selection '${selName}'`,
          details,
        };
      }
    } else if (selType === 'choice') {
      try {
        const ctx: Partial<ActionContext> = {
          game,
          player: currentPlayer,
          args: {},
        };
        const choices = selection.getChoices?.(ctx) || [];
        details.push({
          step: `Selection '${selName}'`,
          passed: choices.length > 0,
          info: `${choices.length} choices available`,
        });

        if (choices.length === 0) {
          return {
            actionName,
            available: false,
            reason: `No choices available for selection '${selName}'`,
            details,
          };
        }
      } catch (error) {
        details.push({
          step: `Selection '${selName}'`,
          passed: false,
          info: `Error evaluating: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    } else {
      details.push({
        step: `Selection '${selName}'`,
        passed: true,
        info: `Type '${selType}' (assumed available)`,
      });
    }
  }

  return {
    actionName,
    available: true,
    reason: 'Action available',
    details,
  };
}

/**
 * Generate a visual representation of the flow structure.
 *
 * Creates an ASCII tree showing the flow hierarchy with node types and names.
 *
 * @param flow - The flow node to visualize
 * @param indent - Internal parameter for indentation (do not pass)
 * @returns A multi-line string with the flow tree
 *
 * @example
 * ```typescript
 * console.log(visualizeFlow(gameDefinition.flow));
 * // sequence "main"
 * //   ├─ phase "setup"
 * //   │  └─ simultaneousActionStep
 * //   ├─ loop (while: game.deck.count() > 0)
 * //   │  ├─ eachPlayer
 * //   │  │  └─ actionStep [play, draw, pass]
 * //   │  └─ execute (cleanup)
 * //   └─ execute (endGame)
 * ```
 */
export function visualizeFlow(flow: FlowNode, indent: string = ''): string {
  const lines: string[] = [];
  const nodeType = flow.type || 'unknown';
  const config = (flow as any).config || {};

  // Build node description
  let desc = nodeType;
  if (config.name) desc += ` "${config.name}"`;
  if (nodeType === 'action-step' && config.actions) {
    desc += ` [${Array.isArray(config.actions) ? config.actions.join(', ') : 'dynamic'}]`;
  }
  if (nodeType === 'loop' && config.while) {
    desc += ' (while: ...)';
  }
  if (nodeType === 'switch') {
    desc += ' (cases)';
  }

  lines.push(`${indent}${desc}`);

  // Handle children
  const children: FlowNode[] = [];
  if (config.do) {
    if (Array.isArray(config.do)) {
      children.push(...config.do);
    } else {
      children.push(config.do);
    }
  }
  if (config.steps) {
    children.push(...config.steps);
  }
  if (config.cases) {
    for (const [key, caseNode] of Object.entries(config.cases)) {
      lines.push(`${indent}  case "${key}":`);
      lines.push(visualizeFlow(caseNode as FlowNode, indent + '    '));
    }
  }

  const childIndent = indent + '  ';
  for (let i = 0; i < children.length; i++) {
    const isLast = i === children.length - 1;
    const prefix = isLast ? '└─ ' : '├─ ';
    const childLines = visualizeFlow(children[i], childIndent + (isLast ? '   ' : '│  ')).split('\n');
    lines.push(`${childIndent.slice(0, -2)}${prefix}${childLines[0].trim()}`);
    lines.push(...childLines.slice(1));
  }

  return lines.join('\n');
}

/**
 * Generate a summary of available actions for a player.
 *
 * Shows each action with whether it's available and why.
 *
 * @param game - The game instance
 * @param player - The player to check (defaults to current player)
 * @returns A multi-line string summarizing action availability
 *
 * @example
 * ```typescript
 * console.log(logAvailableActions(game));
 * // Available actions for Player 1:
 * //   ✓ move - 3 valid moves
 * //   ✓ attack - 2 valid targets
 * //   ✗ heal - No healing targets available
 * //   ✗ rest - Condition: must have < 3 actions
 * ```
 */
export function logAvailableActions(game: Game, player?: Player): string {
  const currentPlayer = player || game.currentPlayer;
  const lines: string[] = [`Available actions for ${currentPlayer?.name || 'current player'}:`];

  const actions = (game as any).actions || {};
  for (const actionName of Object.keys(actions)) {
    const trace = traceAction(game, actionName, currentPlayer);
    const icon = trace.available ? '✓' : '✗';
    lines.push(`  ${icon} ${actionName} - ${trace.reason}`);
  }

  return lines.join('\n');
}

/**
 * Result from debugging flow state.
 */
export interface FlowStateDebug {
  /** Current phase/step name */
  currentPhase: string;
  /** Stack of flow nodes (path to current position) */
  nodeStack: string[];
  /** Current player position (if applicable) */
  currentPlayer?: number;
  /** Available actions at this point */
  availableActions: string[];
  /** Whether the flow is waiting for input */
  awaitingInput: boolean;
  /** Human-readable description of current state */
  description: string;
}

/**
 * Get a debug view of the current flow state.
 *
 * Shows where in the flow the game currently is and what's happening.
 *
 * @param testGame - The test game instance
 * @returns Debug info including phase, node stack, and human-readable description
 *
 * @example
 * ```typescript
 * const flowState = debugFlowState(testGame);
 * console.log(flowState.description);
 * // "In phase 'playing', waiting for Player 1 to choose: [ask]"
 * console.log(flowState.nodeStack);
 * // ["sequence 'main'", "loop 'rounds'", "eachPlayer", "actionStep"]
 * ```
 */
export function debugFlowState(testGame: any): FlowStateDebug {
  const runner = testGame.runner;
  const game = testGame.game;

  // Get the flow state from the runner
  const flowState = runner?.getFlowState?.() || {};

  const result: FlowStateDebug = {
    currentPhase: flowState.phase || 'unknown',
    nodeStack: [],
    availableActions: flowState.availableActions || [],
    awaitingInput: flowState.awaitingInput || false,
    description: '',
  };

  if (typeof flowState.currentPlayer === 'number') {
    result.currentPlayer = flowState.currentPlayer;
  }

  // Try to extract the node stack from flow engine internal state
  const flowEngine = runner?.flowEngine || (runner as any)?._flow;
  if (flowEngine) {
    const stack = extractNodeStack(flowEngine);
    result.nodeStack = stack;
  }

  // Build human-readable description
  const parts: string[] = [];

  if (result.currentPhase && result.currentPhase !== 'unknown') {
    parts.push(`In phase '${result.currentPhase}'`);
  }

  if (result.awaitingInput) {
    const playerName = result.currentPlayer !== undefined
      ? `Player ${result.currentPlayer}`
      : 'a player';

    if (result.availableActions.length > 0) {
      parts.push(`waiting for ${playerName} to choose: [${result.availableActions.join(', ')}]`);
    } else {
      parts.push(`waiting for ${playerName}`);
    }
  } else {
    parts.push('processing');
  }

  result.description = parts.join(', ');

  return result;
}

/**
 * Extract the stack of flow nodes from the flow engine.
 * @internal
 */
function extractNodeStack(flowEngine: any): string[] {
  const stack: string[] = [];

  // Try to access internal state
  const frames = flowEngine?.frames || flowEngine?._frames || [];
  for (const frame of frames) {
    const nodeType = frame.node?.type || frame.type || 'node';
    const nodeName = frame.node?.config?.name || frame.name || '';
    stack.push(nodeName ? `${nodeType} '${nodeName}'` : nodeType);
  }

  // If no frames, try to get current node info
  if (stack.length === 0 && flowEngine?.currentNode) {
    const node = flowEngine.currentNode;
    const nodeType = node.type || 'node';
    const nodeName = node.config?.name || '';
    stack.push(nodeName ? `${nodeType} '${nodeName}'` : nodeType);
  }

  return stack;
}

/**
 * Visualize the flow with the current position highlighted.
 *
 * Like {@link visualizeFlow} but marks where execution currently is.
 *
 * @param flow - The flow node to visualize
 * @param testGame - Optional test game to highlight current position
 * @returns A multi-line string with the flow tree and position marker
 *
 * @example
 * ```typescript
 * console.log(visualizeFlowWithPosition(gameDefinition.flow, testGame));
 * // sequence "main"
 * //   ├─ phase "setup" ✓
 * //   ├─ loop "rounds"
 * //   │  ├─ eachPlayer
 * //   │  │  └─ actionStep [play, draw, pass] ← CURRENT
 * //   │  └─ execute (cleanup)
 * //   └─ execute (endGame)
 * ```
 */
export function visualizeFlowWithPosition(flow: FlowNode, testGame?: any): string {
  const currentInfo = testGame ? debugFlowState(testGame) : null;
  const currentNodeNames = new Set(
    currentInfo?.nodeStack.map(s => {
      const match = s.match(/'([^']+)'/);
      return match ? match[1] : '';
    }).filter(Boolean) || []
  );

  return visualizeFlowWithHighlight(flow, '', currentNodeNames, currentInfo?.currentPhase || '');
}

function visualizeFlowWithHighlight(
  flow: FlowNode,
  indent: string,
  currentNames: Set<string>,
  currentPhase: string
): string {
  const lines: string[] = [];
  const nodeType = flow.type || 'unknown';
  const config = (flow as any).config || {};
  const nodeName = config.name || '';

  // Build node description
  let desc = nodeType;
  if (nodeName) desc += ` "${nodeName}"`;
  if (nodeType === 'action-step' && config.actions) {
    desc += ` [${Array.isArray(config.actions) ? config.actions.join(', ') : 'dynamic'}]`;
  }
  if (nodeType === 'loop' && config.while) {
    desc += ' (while: ...)';
  }

  // Add marker if this is the current node
  const isCurrent = (nodeName && currentNames.has(nodeName)) || (nodeType === 'phase' && nodeName === currentPhase);
  if (isCurrent) {
    desc += ' ← CURRENT';
  }

  lines.push(`${indent}${desc}`);

  // Handle children
  const children: FlowNode[] = [];
  if (config.do) {
    if (Array.isArray(config.do)) {
      children.push(...config.do);
    } else {
      children.push(config.do);
    }
  }
  if (config.steps) {
    children.push(...config.steps);
  }
  if (config.cases) {
    for (const [key, caseNode] of Object.entries(config.cases)) {
      lines.push(`${indent}  case "${key}":`);
      lines.push(visualizeFlowWithHighlight(caseNode as FlowNode, indent + '    ', currentNames, currentPhase));
    }
  }

  const childIndent = indent + '  ';
  for (let i = 0; i < children.length; i++) {
    const isLast = i === children.length - 1;
    const prefix = isLast ? '└─ ' : '├─ ';
    const childLines = visualizeFlowWithHighlight(
      children[i],
      childIndent + (isLast ? '   ' : '│  '),
      currentNames,
      currentPhase
    ).split('\n');
    lines.push(`${childIndent.slice(0, -2)}${prefix}${childLines[0].trim()}`);
    lines.push(...childLines.slice(1));
  }

  return lines.join('\n');
}

/**
 * Print game state diff between two snapshots.
 *
 * Compares two JSON-serialized game snapshots and shows what changed.
 * Useful for debugging what changed after an action.
 *
 * @param before - JSON string of state before the change
 * @param after - JSON string of state after the change
 * @returns A string describing the differences, or "No changes detected"
 *
 * @example
 * ```typescript
 * const before = JSON.stringify(testGame.getSnapshot());
 * testGame.doAction(0, 'move', { destination: cell });
 * const after = JSON.stringify(testGame.getSnapshot());
 * console.log(diffSnapshots(before, after));
 * // Changes:
 * //   piece.position: "A1" → "B2"
 * //   player.actionsRemaining: 2 → 1
 * ```
 */
export function diffSnapshots(before: string, after: string): string {
  const beforeObj = JSON.parse(before);
  const afterObj = JSON.parse(after);

  const diffs: string[] = [];
  findDiffs(beforeObj, afterObj, '', diffs);

  if (diffs.length === 0) {
    return 'No changes detected';
  }

  return `Changes:\n${diffs.map(d => `  ${d}`).join('\n')}`;
}

function findDiffs(before: any, after: any, path: string, diffs: string[]): void {
  if (typeof before !== typeof after) {
    diffs.push(`${path}: type changed from ${typeof before} to ${typeof after}`);
    return;
  }

  if (typeof before !== 'object' || before === null) {
    if (before !== after) {
      diffs.push(`${path}: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    }
    return;
  }

  if (Array.isArray(before)) {
    if (!Array.isArray(after)) {
      diffs.push(`${path}: array → non-array`);
      return;
    }
    if (before.length !== after.length) {
      diffs.push(`${path}: length ${before.length} → ${after.length}`);
    }
    const maxLen = Math.max(before.length, after.length);
    for (let i = 0; i < maxLen; i++) {
      findDiffs(before[i], after[i], `${path}[${i}]`, diffs);
    }
    return;
  }

  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of allKeys) {
    const subPath = path ? `${path}.${key}` : key;
    if (!(key in before)) {
      diffs.push(`${subPath}: added (${JSON.stringify(after[key])})`);
    } else if (!(key in after)) {
      diffs.push(`${subPath}: removed (was ${JSON.stringify(before[key])})`);
    } else {
      findDiffs(before[key], after[key], subPath, diffs);
    }
  }
}
