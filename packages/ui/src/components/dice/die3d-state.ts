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

// Global queue to serialize WebGL context creation
export interface QueuedRender {
  fn: () => void;
  cancelled: boolean;
  componentId: number;
}
export const pendingRenders: QueuedRender[] = [];
export let isRenderingGlobally = false;
export let nextComponentId = 0;

// Setter functions for mutable module-level variables
export function setIsRenderingGlobally(value: boolean) {
  isRenderingGlobally = value;
}

export function getNextComponentId(): number {
  return nextComponentId++;
}
