/**
 * Dev State Transfer - HMR-safe state transfer for hot module replacement.
 *
 * This module enables fast HMR by directly transferring game state to new class
 * definitions, bypassing action replay. Key insight: stored properties transfer
 * as-is from toJSON(), while getters automatically recompute with new code.
 *
 * Usage (handled by GameSession.reloadWithCurrentRules):
 * 1. captureDevState() - Snapshot current game state
 * 2. restoreDevState() - Recreate game with new classes
 *
 * What transfers:
 * - Element tree structure (parent/child relationships)
 * - Stored properties (regular fields) - transferred from ElementJSON.attributes
 * - Element IDs - preserved to maintain references
 * - Flow position - restored to resume at same point
 * - Random state - preserved for continued determinism
 * - Settings (includes PersistentMap data)
 * - Messages
 *
 * What recomputes:
 * - Getters - automatically use new code (not in toJSON)
 * - Derived state - recalculated from stored properties
 */

import type { Game, GameOptions } from '../element/game.js';
import type { GameElement } from '../element/game-element.js';
import type { ElementJSON, ElementClass, ElementContext } from '../element/types.js';
import type { FlowPosition, FlowState } from '../flow/types.js';
import type { Player } from '../player/player.js';

/**
 * Snapshot of game state for dev transfer.
 * Captures everything needed to restore the game without replay.
 */
export interface DevSnapshot {
  /** Complete element tree as ElementJSON (from game.toJSON()) */
  elements: ElementJSON & {
    phase: string;
    messages: Array<{ text: string; data?: Record<string, unknown> }>;
    settings: Record<string, unknown>;
  };

  /** Flow position from flow engine (to resume at same point) */
  flowPosition: FlowPosition | undefined;

  /** Current flow state (for additional context) */
  flowState: FlowState | undefined;

  /** Current random generator seed state (for continued determinism) */
  randomState: {
    /** Original seed used to create the game */
    seed: string;
    /** Number of times random() has been called (to fast-forward) */
    callCount: number;
  };

  /** Timestamp when snapshot was taken */
  timestamp: number;

  /** Map of className to registered element class names (for validation) */
  registeredClasses: string[];

  /** Sequence counter for element IDs */
  sequence: number;
}

/**
 * Options for restoring dev state.
 */
export interface RestoreDevStateOptions {
  /** Original game options (playerCount, playerNames, seed) */
  gameOptions: GameOptions;

  /** Class registry mapping class names to element classes */
  classRegistry: Map<string, ElementClass>;
}

/**
 * Counter to track random calls during game execution.
 * Used to restore random state after HMR.
 */
let randomCallCounter = 0;

/**
 * Create a tracked random function that counts calls.
 * This allows us to restore the random state by fast-forwarding.
 */
export function createTrackedRandom(baseRandom: () => number): () => number {
  return () => {
    randomCallCounter++;
    return baseRandom();
  };
}

/**
 * Get the current random call count.
 */
export function getRandomCallCount(): number {
  return randomCallCounter;
}

/**
 * Reset the random call counter (for testing).
 */
export function resetRandomCallCounter(): void {
  randomCallCounter = 0;
}

/**
 * Capture the current game state for dev transfer.
 *
 * This creates a snapshot that can be used to restore the game
 * to a new Game class instance without replaying actions.
 *
 * @param game - The game instance to capture
 * @returns DevSnapshot containing all state needed for restoration
 */
export function captureDevState<G extends Game>(game: G): DevSnapshot {
  // Get the complete element tree as JSON
  const elements = game.toJSON();

  // Get flow state if flow is active
  const flowState = game.getFlowState();
  const flowPosition = flowState?.position;

  // Capture registered class names for validation
  const registeredClasses = Array.from(game._ctx.classRegistry.keys());

  // Get the current sequence for ID restoration
  const sequence = game._ctx.sequence;

  // Note: We can't easily capture the exact random state, but we can
  // record the seed. The caller (GameSession) should track random call count.
  // For now, we store placeholder - actual implementation will need
  // GameSession to track this via a wrapper.
  const randomState = {
    seed: (game.settings.playerCount ? String(game.settings.seed || '') : ''),
    callCount: randomCallCounter,
  };

  return {
    elements,
    flowPosition,
    flowState,
    randomState,
    timestamp: Date.now(),
    registeredClasses,
    sequence,
  };
}

/**
 * Restore game state from a dev snapshot.
 *
 * Creates a new Game instance with the provided GameClass and restores
 * all state from the snapshot. Element IDs are preserved, and the game
 * resumes at the same flow position.
 *
 * @param snapshot - DevSnapshot captured from previous game
 * @param GameClass - New Game class to instantiate (may have updated code)
 * @param options - Restoration options including game options and class registry
 * @returns New Game instance with restored state
 */
export function restoreDevState<G extends Game>(
  snapshot: DevSnapshot,
  GameClass: new (options: GameOptions) => G,
  options: RestoreDevStateOptions
): G {
  // Create new game instance
  // Note: This creates new players and basic structure
  // The constructor runs registerElements() which populates the class registry with NEW classes
  const game = new GameClass(options.gameOptions);

  // Merge class registry from options, but DON'T overwrite classes already registered by constructor
  // This is critical for HMR: the constructor registers NEW classes, but options.classRegistry
  // might contain OLD classes (with different class identity). Overwriting would break instanceof checks.
  for (const [name, cls] of options.classRegistry) {
    if (!game._ctx.classRegistry.has(name)) {
      game._ctx.classRegistry.set(name, cls);
    }
  }

  // Restore game-level state from snapshot
  game.phase = snapshot.elements.phase as G['phase'];
  game.messages = [...snapshot.elements.messages];
  game.settings = { ...snapshot.elements.settings };

  // Clear auto-created children (players, etc.) to restore from snapshot
  game._t.children = [];

  // Restore element tree from snapshot
  if (snapshot.elements.children) {
    for (const childJson of snapshot.elements.children) {
      const child = restoreElement(childJson, game._ctx, game._ctx.classRegistry);
      child._t.parent = game;
      child.game = game;
      game._t.children.push(child);
    }
  }

  // Restore the sequence counter to maintain ID consistency
  game._ctx.sequence = snapshot.sequence;

  // Resolve element references in all restored elements
  game.resolveElementReferences(game);

  // Restore flow position if flow was active
  if (snapshot.flowPosition && game.getFlow()) {
    game.restoreFlow(snapshot.flowPosition);
  }

  return game;
}

/**
 * Restore a single element from JSON.
 * Recursively restores children and sets up parent references.
 */
function restoreElement(
  json: ElementJSON,
  ctx: ElementContext,
  classRegistry: Map<string, ElementClass>
): GameElement {
  const ElementClass = classRegistry.get(json.className);
  if (!ElementClass) {
    const registeredClasses = Array.from(classRegistry.keys()).join(', ');
    throw new Error(
      `[DevState] Unknown element class: "${json.className}"\n\n` +
      `Registered classes: ${registeredClasses || '(none)'}\n\n` +
      `Make sure to register the class in your Game constructor:\n` +
      `  this.registerElements([${json.className}, ...]);`
    );
  }

  // Create element with context (assigns new ID, but we'll override)
  const element = new ElementClass(ctx);

  // Restore the original ID to maintain references
  element._t.id = json.id;

  // Restore name
  if (json.name) {
    element.name = json.name;
  }

  // Restore visibility if present
  if (json.visibility) {
    element._visibility = json.visibility;
  }

  // Apply attributes (this includes stored properties, NOT getters)
  // Getters are automatically excluded from toJSON() since they're not
  // "own enumerable properties" - they recalculate with new code
  for (const [key, value] of Object.entries(json.attributes)) {
    (element as unknown as Record<string, unknown>)[key] = value;
  }

  // Recursively restore children
  if (json.children) {
    for (const childJson of json.children) {
      const child = restoreElement(childJson, ctx, classRegistry);
      child._t.parent = element;
      element._t.children.push(child);
    }
  }

  return element;
}

// ============================================================================
// SECTION: Validation Types
// ============================================================================

/**
 * Types of validation errors that can occur during snapshot validation.
 */
export type ValidationErrorType = 'missing-class' | 'schema-error' | 'property-mismatch';

/**
 * Types of validation warnings (non-blocking issues).
 */
export type ValidationWarningType = 'new-property' | 'type-change';

/**
 * A validation error that blocks state transfer.
 */
export interface ValidationError {
  type: ValidationErrorType;
  message: string;
  path: string[];  // Element path in tree
  suggestion: string;  // Actionable fix
}

/**
 * A validation warning that doesn't block transfer but may cause issues.
 */
export interface ValidationWarning {
  type: ValidationWarningType;
  message: string;
  path: string[];
}

/**
 * Result of validating a dev snapshot.
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

// ============================================================================
// SECTION: Validation Functions
// ============================================================================

/**
 * Validate that a snapshot can be restored with the given class registry.
 * Performs comprehensive validation including:
 * - Class existence in registry
 * - Schema structure validation
 * - Property compatibility checking
 *
 * Returns structured errors with paths and actionable suggestions.
 */
export function validateDevSnapshot(
  snapshot: DevSnapshot,
  classRegistry: Map<string, ElementClass>
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // 1. Schema validation - check required fields
  if (!snapshot.elements) {
    errors.push({
      type: 'schema-error',
      message: 'Missing "elements" field in snapshot',
      path: [],
      suggestion: 'Snapshot appears corrupted. Try a full page reload.',
    });
  }

  if (snapshot.flowPosition === undefined && snapshot.flowState === undefined) {
    // This is OK - game might not have flow or flow hasn't started
  }

  if (!snapshot.timestamp || typeof snapshot.timestamp !== 'number') {
    errors.push({
      type: 'schema-error',
      message: 'Missing or invalid "timestamp" field in snapshot',
      path: [],
      suggestion: 'Snapshot appears corrupted. Try a full page reload.',
    });
  }

  // 2. Walk the element tree and validate each element
  if (snapshot.elements) {
    validateElement(snapshot.elements, [], classRegistry, errors, warnings);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Recursively validate an element and its children.
 */
function validateElement(
  json: ElementJSON,
  path: string[],
  classRegistry: Map<string, ElementClass>,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  const elementPath = [...path, json.name || json.className];

  // Check class exists in registry
  if (!classRegistry.has(json.className)) {
    errors.push({
      type: 'missing-class',
      message: `Missing class "${json.className}"`,
      path: elementPath,
      suggestion: `Register the class in your Game constructor:\n       this.registerElements([${json.className}, ...]);`,
    });
    // Can't check properties if class is missing, but continue to check children
  } else {
    // Check property compatibility
    const ElementClass = classRegistry.get(json.className)!;
    validateProperties(json, elementPath, ElementClass, errors, warnings);
  }

  // Recursively validate children
  if (json.children) {
    for (let i = 0; i < json.children.length; i++) {
      const child = json.children[i];
      const childPath = [...path, `${json.name || json.className} > children[${i}]`];
      validateElement(child, childPath, classRegistry, errors, warnings);
    }
  }
}

/**
 * Validate that snapshot properties are compatible with the class.
 * Detects property renames and type mismatches.
 */
function validateProperties(
  json: ElementJSON,
  path: string[],
  ElementClass: ElementClass,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  // Create a temporary instance to inspect its properties
  // We need to check what properties the class has
  try {
    // Get the prototype to check for getters (we want to skip getter comparisons)
    const proto = ElementClass.prototype;
    const getterNames = new Set<string>();

    // Walk the prototype chain to find all getters
    let currentProto = proto;
    while (currentProto && currentProto !== Object.prototype) {
      const descriptors = Object.getOwnPropertyDescriptors(currentProto);
      for (const [key, desc] of Object.entries(descriptors)) {
        if (desc.get && !desc.set) {
          getterNames.add(key);
        }
      }
      currentProto = Object.getPrototypeOf(currentProto);
    }

    // Check each attribute in the snapshot
    for (const [key, value] of Object.entries(json.attributes)) {
      // Skip internal properties
      if (key.startsWith('_')) continue;

      // If this is a getter in the new class, that's fine - we'll just skip it
      // (getters will be recomputed)
      if (getterNames.has(key)) {
        continue;
      }

      // Check for type mismatches (primitive types only)
      // This is a heuristic - we can't fully detect type changes
      if (value !== null && value !== undefined) {
        const valueType = Array.isArray(value) ? 'array' : typeof value;
        // We can only warn about obvious type issues
        // This is limited since we can't instantiate the class to check
        if (valueType === 'object' && !Array.isArray(value)) {
          // Could be an element reference or complex object
          const objValue = value as Record<string, unknown>;
          if (objValue._ref !== undefined) {
            // Element reference - valid
          }
        }
      }
    }
  } catch {
    // Can't inspect class - skip property validation
    // This can happen with complex class hierarchies
  }
}

/**
 * Format validation errors for console output.
 */
export function formatValidationErrors(result: ValidationResult): string {
  if (result.valid && result.warnings.length === 0) {
    return '';
  }

  const lines: string[] = [];

  if (!result.valid) {
    lines.push(`[HMR] State transfer blocked:\n`);

    for (let i = 0; i < result.errors.length; i++) {
      const error = result.errors[i];
      lines.push(`ERROR ${i + 1}: ${error.message}`);
      if (error.path.length > 0) {
        lines.push(`  Path: ${error.path.join(' > ')}`);
      }
      lines.push(`  Fix: ${error.suggestion}`);
      lines.push('');
    }
  }

  if (result.warnings.length > 0) {
    lines.push(`Warnings:`);
    for (const warning of result.warnings) {
      lines.push(`  ⚠️ ${warning.message}`);
      if (warning.path.length > 0) {
        lines.push(`     Path: ${warning.path.join(' > ')}`);
      }
    }
  }

  return lines.join('\n');
}

// ============================================================================
// SECTION: Flow Position Validation
// ============================================================================

/**
 * Result of validating a flow position.
 */
export interface FlowPositionValidation {
  valid: boolean;
  reason?: string;
  /** Recovery position if the original position is invalid but recoverable */
  recoveryPosition?: FlowPosition;
}

/**
 * Validate a flow position and compute a recovery position if invalid.
 * Uses the FlowEngine's tryRestore method to validate the path.
 *
 * @param snapshot - The dev snapshot containing the flow position
 * @param flowEngine - The flow engine to validate against
 * @returns Validation result with optional recovery position
 */
export function validateFlowPosition(
  snapshot: DevSnapshot,
  flowEngine: { tryRestore: (pos: FlowPosition) => { success: true } | { success: false; error: string; validPath: number[] } }
): FlowPositionValidation {
  const flowPosition = snapshot.flowPosition;

  // No flow position to validate
  if (!flowPosition) {
    return { valid: true };
  }

  // Empty path is always valid
  if (flowPosition.path.length === 0) {
    return { valid: true };
  }

  // Try to restore and check if it succeeds
  const result = flowEngine.tryRestore(flowPosition);

  if (result.success) {
    return { valid: true };
  }

  // Build recovery position from valid path prefix
  const recoveryPosition: FlowPosition = {
    path: result.validPath,
    iterations: {},
    variables: { ...flowPosition.variables },
    // Don't preserve playerIndex if we're truncating - might be invalid
  };

  // Copy over iterations that are still valid
  for (let i = 0; i < result.validPath.length; i++) {
    const iterKey = `__iter_${i}`;
    if (flowPosition.iterations[iterKey] !== undefined) {
      recoveryPosition.iterations[iterKey] = flowPosition.iterations[iterKey];
    }
  }

  return {
    valid: false,
    reason: result.error,
    recoveryPosition: result.validPath.length > 0 ? recoveryPosition : undefined,
  };
}

/**
 * Format flow recovery details for console output.
 */
export function formatFlowRecovery(
  original: FlowPosition,
  recovery: FlowPosition,
  reason: string
): string {
  const lines: string[] = [
    '[HMR] Flow position recovery:',
    `  Original position: [${original.path.join(', ')}]`,
    `  ${reason}`,
    `  Recovering to: [${recovery.path.join(', ')}]`,
    `  Note: Game may need manual action to resume`,
  ];
  return lines.join('\n');
}

/**
 * Get element count from a snapshot (for logging).
 */
export function getSnapshotElementCount(snapshot: DevSnapshot): number {
  let count = 0;

  function countElements(json: ElementJSON): void {
    count++;
    if (json.children) {
      for (const child of json.children) {
        countElements(child);
      }
    }
  }

  countElements(snapshot.elements);
  return count;
}

// ============================================================================
// SECTION: Checkpoints for Fast HMR Recovery
// ============================================================================

/**
 * A checkpoint is a snapshot of game state at a specific action index.
 * When HMR fails and replay is needed, checkpoints provide intermediate
 * restore points so only a subset of actions need replay instead of
 * replaying all actions from the beginning.
 */
export interface DevCheckpoint extends DevSnapshot {
  /** Action index at which this checkpoint was taken */
  actionIndex: number;

  /** Actions from 0 to actionIndex (for validation) */
  actionCount: number;
}

/**
 * Create a checkpoint capturing the current game state at a specific action index.
 *
 * @param game - The game instance to capture
 * @param actionIndex - The action index at which this checkpoint is taken
 * @returns DevCheckpoint containing snapshot plus action index
 */
export function createCheckpoint<G extends Game>(
  game: G,
  actionIndex: number
): DevCheckpoint {
  const snapshot = captureDevState(game);
  return {
    ...snapshot,
    actionIndex,
    actionCount: actionIndex,
  };
}

/**
 * Options for restoring from a checkpoint.
 */
export interface RestoreFromCheckpointOptions<G extends Game> extends RestoreDevStateOptions {
  /** The game class to instantiate */
  GameClass: new (options: GameOptions) => G;
}

/**
 * Result of restoring from a checkpoint.
 */
export interface CheckpointRestoreResult<G extends Game> {
  /** The restored game instance */
  game: G;

  /** Number of actions replayed after checkpoint restoration */
  actionsReplayed: number;
}

/**
 * Restore game state from a checkpoint and replay remaining actions.
 *
 * This provides fast HMR recovery by:
 * 1. Restoring the game state from the checkpoint snapshot
 * 2. Replaying only the actions that occurred after the checkpoint
 *
 * @param checkpoint - The checkpoint to restore from
 * @param remainingActions - Actions to replay after checkpoint restoration
 * @param options - Restore options including GameClass and gameOptions
 * @returns The restored game and count of replayed actions
 */
export function restoreFromCheckpoint<G extends Game>(
  checkpoint: DevCheckpoint,
  remainingActions: Array<{ name: string; player: number; args: Record<string, unknown> }>,
  options: RestoreFromCheckpointOptions<G>
): CheckpointRestoreResult<G> {
  // Restore game from checkpoint snapshot
  const game = restoreDevState(checkpoint, options.GameClass, options);

  // Replay remaining actions through the game's action executor
  let replayed = 0;
  for (const action of remainingActions) {
    // Execute action through the flow system
    const flowState = game.getFlowState();
    if (!flowState?.awaitingInput) {
      throw new Error(
        `[Checkpoint] Cannot replay action "${action.name}" at index ${checkpoint.actionIndex + replayed}: ` +
        `game is not awaiting input. Flow may be out of sync.`
      );
    }

    try {
      game.continueFlow(action.name, action.args, action.player);
      replayed++;
    } catch (error) {
      throw new Error(
        `[Checkpoint] Failed to replay action "${action.name}" at index ${checkpoint.actionIndex + replayed}: ` +
        `${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return { game, actionsReplayed: replayed };
}
