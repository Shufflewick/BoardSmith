/**
 * Shared state for Die3D components.
 * This module is loaded once and shared across all Die3D instances.
 * Critical for tracking which dice have been animated.
 */

import type { InjectionKey } from 'vue';

// Animation context type - allows per-UI-tree tracking
export interface DieAnimationContext {
  animatedRollCounts: Map<string | number, number>;
}

// Injection key for animation context
export const DIE_ANIMATION_CONTEXT_KEY: InjectionKey<DieAnimationContext> = Symbol('dieAnimationContext');

// Factory to create a new animation context (for each UI tree)
export function createDieAnimationContext(): DieAnimationContext {
  return {
    animatedRollCounts: new Map(),
  };
}

// Browsers cap live WebGL contexts (Chrome at 16) and the page may hold its own; dice draw at most this many at once.
export const MAX_LIVE_DIE_CONTEXTS = 4;

// Global queue of dice waiting for a WebGL context
export interface QueuedRender {
  fn: () => void;
  cancelled: boolean;
  componentId: number;
}
export const pendingRenders: QueuedRender[] = [];
export let liveDieContexts = 0;
export let nextComponentId = 0;

// Setter functions for mutable module-level variables
export function countDieContext(change: 1 | -1) {
  liveDieContexts += change;
}

export function getNextComponentId(): number {
  return nextComponentId++;
}
