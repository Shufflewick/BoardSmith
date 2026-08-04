/**
 * Auto-UI Components
 *
 * Automatic game UI generation from game state.
 * No custom components needed - just plug in your game state!
 */

// Default export = the auto UI itself, so `boardsmith/ui/auto-ui` can be handed
// straight to a registry loader: `devUI(() => import('boardsmith/ui/auto-ui'))`.
// Without it the loader resolves to this barrel's namespace object, which has no
// `default` and fails the GameUILoader contract.
export { default } from './AutoUI.vue';
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
