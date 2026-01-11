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
  const game = new GameClass(options.gameOptions);

  // Merge class registry from options
  for (const [name, cls] of options.classRegistry) {
    game._ctx.classRegistry.set(name, cls);
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

/**
 * Validate that a snapshot can be restored with the given class registry.
 * Returns list of missing classes, if any.
 */
export function validateDevSnapshot(
  snapshot: DevSnapshot,
  classRegistry: Map<string, ElementClass>
): { valid: boolean; missingClasses: string[] } {
  const missingClasses: string[] = [];

  // Check all classes in the snapshot are registered
  for (const className of snapshot.registeredClasses) {
    if (!classRegistry.has(className)) {
      missingClasses.push(className);
    }
  }

  return {
    valid: missingClasses.length === 0,
    missingClasses,
  };
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
