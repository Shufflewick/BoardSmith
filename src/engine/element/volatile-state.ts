import { GameElement } from './game-element.js';
import { Player } from '../player/player.js';
import type { ElementClass } from './types.js';
import { PersistentMap } from './game.js';
import type { Game } from './game.js';

/**
 * Dev-only "volatile state" plumbing for {@link Game}.
 *
 * During development (NODE_ENV !== 'production') a game is scanned after
 * construction for state that would silently reset across Hot Module Replacement
 * (HMR). Native `Map`/`Set` properties produce actionable warnings, while plain
 * arrays are transparently wrapped in a syncing Proxy so their contents survive a
 * hot reload by mirroring into `game.settings`.
 *
 * This is orthogonal to a game's rules: it never affects production behavior or
 * the designer-facing API. It lives here, composed by Game, rather than inflating
 * the Game class with several hundred lines of dev-only machinery.
 */

/**
 * Game-internal property names that should never trigger HMR warnings or
 * auto-sync wrapping when scanning for volatile state.
 */
const SAFE_PROPERTIES: ReadonlySet<string> = new Set([
  // Base GameElement properties
  '_t', '_ctx', 'game', 'name', 'player',
  // Game internal properties
  'pile', 'phase', 'random', 'messages', 'settings',
  'commandHistory', '_actions', '_actionExecutor', '_flowDefinition',
  '_flowEngine', '_debugRegistry', '_persistentMaps',
  '_animationEvents', '_animationEventSeq', '_constructorOptions',
]);

/**
 * Check for Map/Set properties that won't survive HMR and auto-sync arrays.
 * Runs after construction in development mode.
 */
export function checkForVolatileState(game: Game): void {
  const warnings: string[] = [];

  for (const key of Object.keys(game)) {
    // Skip safe/internal properties
    if (SAFE_PROPERTIES.has(key)) continue;
    if (key.startsWith('_')) continue; // Private by convention

    const value = (game as unknown as Record<string, unknown>)[key];

    // Check for native Map (not PersistentMap)
    if (value instanceof Map && !(value instanceof PersistentMap)) {
      warnings.push(
        `  ⚠️  game.${key} is a Map - will be reset on HMR.\n` +
        `      Use: ${key} = this.persistentMap('${key}') for persistent state,\n` +
        `      or store data as element children.`
      );
    }

    // Check for native Set
    if (value instanceof Set) {
      warnings.push(
        `  ⚠️  game.${key} is a Set - will be reset on HMR.\n` +
        `      Consider using a PersistentMap or element children instead.`
      );
    }

    // Auto-sync arrays to settings (instead of warning)
    if (Array.isArray(value) && key !== 'messages') {
      autoSyncArrayOnTarget(game, game, key, value, `game.${key}`, `__autoSync_${key}`);
    }
  }

  // Also check Player instances
  for (const player of game.all(Player as unknown as ElementClass<Player>)) {
    for (const key of Object.keys(player)) {
      if (key.startsWith('_')) continue;
      if (['seat', 'name', 'game', 'score'].includes(key)) continue;

      const value = (player as unknown as Record<string, unknown>)[key];

      if (value instanceof Map) {
        warnings.push(
          `  ⚠️  player.${key} is a Map - will be reset on HMR.\n` +
          `      Consider using game.persistentMap() or element children.`
        );
      }

      // Auto-sync player arrays
      if (Array.isArray(value)) {
        const settingsKey = `__player_${player.seat}_${key}`;
        autoSyncArrayOnTarget(game, player, key, value, `player.${key}`, settingsKey);
      }
    }
  }

  if (warnings.length > 0) {
    console.warn(
      '\n🔥 BoardSmith HMR Warning: Detected volatile state that won\'t survive hot reload:\n\n' +
      warnings.join('\n\n') +
      '\n\n  Learn more: https://boardsmith.dev/docs/hmr-state\n'
    );
  }
}

/**
 * Auto-sync an array property on any target object to game settings.
 * Uses Object.defineProperty to intercept both reads and assignments.
 */
function autoSyncArrayOnTarget(
  game: Game,
  target: object,
  key: string,
  array: unknown[],
  displayPath: string,
  settingsKey: string
): void {
  // Check if we have stored data from a previous HMR cycle
  const storedData = game.settings[settingsKey] as unknown[] | undefined;

  // Validate existing array contents
  for (const item of array) {
    validateArrayValue(item, displayPath);
  }

  // Initialize the backing array - either from stored data or current array
  let backingArray: unknown[];
  if (storedData && Array.isArray(storedData)) {
    // Restore from HMR - use stored data
    backingArray = [...storedData];
  } else {
    // Fresh construction - use the initial array
    backingArray = [...array];
  }
  // Sync to settings immediately
  game.settings[settingsKey] = [...backingArray];

  // Create a function that wraps an array with a sync proxy
  const createSyncProxy = (arr: unknown[]): unknown[] => {
    return new Proxy(arr, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);

        // Wrap mutation methods to sync after mutation
        if (typeof prop === 'string') {
          const mutatingMethods = ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin'];
          if (mutatingMethods.includes(prop) && typeof value === 'function') {
            return function (this: unknown[], ...args: unknown[]) {
              // Validate any new values being added
              if (prop === 'push' || prop === 'unshift') {
                for (const arg of args) {
                  validateArrayValue(arg, displayPath);
                }
              } else if (prop === 'splice' && args.length > 2) {
                for (let i = 2; i < args.length; i++) {
                  validateArrayValue(args[i], displayPath);
                }
              } else if (prop === 'fill' && args.length > 0) {
                validateArrayValue(args[0], displayPath);
              }

              const result = (value as Function).apply(target, args);
              // Sync to settings after mutation
              game.settings[settingsKey] = [...target];
              return result;
            };
          }
        }

        return value;
      },

      set(target, prop, value, receiver) {
        // Handle index assignment and length changes
        if (typeof prop === 'string' || typeof prop === 'symbol') {
          const numProp = typeof prop === 'string' ? Number(prop) : NaN;

          // If setting an index, validate the value
          if (!isNaN(numProp)) {
            validateArrayValue(value, displayPath);
          }

          const result = Reflect.set(target, prop, value, receiver);

          // Sync to settings after any property change
          game.settings[settingsKey] = [...target];
          return result;
        }
        return Reflect.set(target, prop, value, receiver);
      },

      deleteProperty(target, prop) {
        const result = Reflect.deleteProperty(target, prop);
        game.settings[settingsKey] = [...target];
        return result;
      },
    });
  };

  // Create initial proxy
  let currentProxy = createSyncProxy(backingArray);

  // Use Object.defineProperty to intercept both reads AND assignments
  // This allows `game.items = [1,2,3]` to work correctly
  Object.defineProperty(target, key, {
    get() {
      return currentProxy;
    },
    set(newValue: unknown[]) {
      // Validate the new array is actually an array
      if (!Array.isArray(newValue)) {
        throw new Error(`Cannot assign non-array to ${displayPath}`);
      }

      // Validate all values in the new array
      for (const item of newValue) {
        validateArrayValue(item, displayPath);
      }

      // Create a new backing array with the new values
      backingArray = [...newValue];

      // Sync to settings
      game.settings[settingsKey] = [...backingArray];

      // Create a new proxy for the new backing array
      currentProxy = createSyncProxy(backingArray);
    },
    enumerable: true,
    configurable: true,
  });
}

/**
 * Validate that a value can be stored in an auto-synced array.
 * Throws if the value is a GameElement, function, undefined, Symbol, or has circular references.
 */
export function validateArrayValue(value: unknown, displayPath: string): void {
  // Check for GameElement (element arrays should use children instead)
  if (value instanceof GameElement) {
    throw new Error(
      `Element arrays cannot be auto-synced: ${displayPath} contains a GameElement.\n` +
      `Use element children instead:\n` +
      `  // Instead of: ${displayPath} = []\n` +
      `  // Use: dicePool = this.create(Space, 'dicePool')\n` +
      `  //      dicePool.create(Die, 'd6')\n` +
      `  //      Access via: this.dicePool.all(Die)`
    );
  }

  // Check for functions
  if (typeof value === 'function') {
    throw new Error(
      `Cannot store non-serializable value in ${displayPath}: functions are not JSON-serializable.`
    );
  }

  // Check for undefined
  if (value === undefined) {
    throw new Error(
      `Cannot store non-serializable value in ${displayPath}: undefined is not JSON-serializable. Use null instead.`
    );
  }

  // Check for Symbol
  if (typeof value === 'symbol') {
    throw new Error(
      `Cannot store non-serializable value in ${displayPath}: symbols are not JSON-serializable.`
    );
  }

  // Check for circular references by attempting JSON serialization
  if (value !== null && typeof value === 'object') {
    try {
      JSON.stringify(value);
    } catch {
      throw new Error(
        `Cannot store non-serializable value in ${displayPath}: circular reference or non-serializable object detected.`
      );
    }
  }
}
