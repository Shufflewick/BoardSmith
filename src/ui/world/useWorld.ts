import { inject, type InjectionKey } from 'vue';
import type { WorldHost } from './useWorldHost.js';

/**
 * WHAT A GAME'S WORLD UI IS HANDED (ShufflewickPub #128).
 *
 * The whole of the world, and the one verb. `WorldShell` provides it; any
 * component under it -- a room panel, a village map, a chat line -- injects it
 * rather than threading `view` and `act` down through every prop.
 *
 * The shell ALSO passes the same values as props to the UI it mounts, so a
 * one-component world UI never has to know this exists. Both are the same
 * refs; there is one source.
 */
export type WorldContext = Pick<
  WorldHost,
  'phase' | 'view' | 'seat' | 'commands' | 'notice' | 'worldName' | 'acting' | 'act'
>;

export const WORLD_CONTEXT_KEY: InjectionKey<WorldContext> = Symbol('boardsmith-world');

/**
 * The world this component is inside.
 *
 * Throws rather than answering `undefined`: a world UI rendered outside a
 * `WorldShell` has no world, and a silent `undefined` turns that into a blank
 * board somewhere far from the mistake.
 */
export function useWorld(): WorldContext {
  const world = inject(WORLD_CONTEXT_KEY, null);
  if (world === null) {
    throw new Error(
      'useWorld() was called outside a WorldShell. A world UI is mounted by ' +
        '<WorldShell :ui="..."/> from the bundle\'s world entry (world.html); ' +
        'nothing else provides a world.',
    );
  }
  return world;
}
