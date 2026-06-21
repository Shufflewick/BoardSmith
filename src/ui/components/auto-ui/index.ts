/**
 * Auto-UI Components
 *
 * Automatic game UI generation from game state.
 * No custom components needed - just plug in your game state!
 */

export { default as AutoUI } from './AutoUI.vue';
export { default as AutoRenderer } from './AutoRenderer.vue';
export { default as ActionPanel } from './ActionPanel.vue';
export { registerRenderer, resolveRenderer } from './renderer-registry.js';

// Re-export types from shared types file
export type {
  GameElement,
  Pick,
  ActionMetadata,
  Player,
} from '../../types.js';
