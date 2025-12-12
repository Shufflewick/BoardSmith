/**
 * Auto-UI Components
 *
 * Automatic game UI generation from game state.
 * No custom components needed - just plug in your game state!
 */

export { default as AutoUI } from './AutoUI.vue';
export { default as AutoGameBoard } from './AutoGameBoard.vue';
export { default as AutoElement } from './AutoElement.vue';
export { default as ActionPanel } from './ActionPanel.vue';

// Re-export types from shared types file
export type {
  GameElement,
  Selection,
  ActionMetadata,
  Player,
} from '../../types.js';
