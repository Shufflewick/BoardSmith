import { Player } from '../player/player.js';
import type { ElementClass } from './types.js';
import { PersistentMap } from './game.js';
import type { Game } from './game.js';

/**
 * Dev-only "volatile state" plumbing for {@link Game}.
 *
 * During development (NODE_ENV !== 'production') a game is scanned after
 * construction for state that would silently reset across Hot Module Replacement
 * (HMR). Native `Map`/`Set` properties produce actionable warnings, because
 * `toJSON` cannot serialize them, so their contents are lost on a hot reload (or
 * any snapshot/undo/network round-trip).
 *
 * Plain arrays are intentionally left untouched: they serialize cleanly through
 * {@link GameElement.toJSON} as ordinary attributes, which is the single source
 * of truth for persistence. We never rewrite a designer-declared property into a
 * Proxy at runtime — doing so would make a property's runtime identity (Array vs
 * Proxy) and a snapshot's shape depend on NODE_ENV, and would create a second,
 * dev-only copy of the same data in `game.settings`.
 *
 * This scan is orthogonal to a game's rules: it never affects production
 * behavior or the designer-facing API. It lives here, composed by Game, rather
 * than inflating the Game class with dev-only machinery.
 */

/**
 * Game-internal property names that should never trigger HMR warnings when
 * scanning for volatile state.
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
 * Warn about Map/Set properties that won't survive HMR (or any
 * toJSON-based round-trip). Runs after construction in development mode.
 *
 * Plain arrays are deliberately not flagged: they are persisted as ordinary
 * attributes by {@link GameElement.toJSON} and survive HMR through that single
 * serialization path.
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

      if (value instanceof Set) {
        warnings.push(
          `  ⚠️  player.${key} is a Set - will be reset on HMR.\n` +
          `      Consider using game.persistentMap() or element children.`
        );
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
