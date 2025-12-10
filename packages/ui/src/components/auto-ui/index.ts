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

// Type definitions (mirrored from components for clean exports)
export interface GameElement {
  id: number;
  name?: string;
  className: string;
  attributes?: Record<string, unknown>;
  children?: GameElement[];
  childCount?: number;
  __hidden?: boolean;
}

export interface Selection {
  name: string;
  type: 'choice' | 'player' | 'element' | 'number' | 'text';
  prompt?: string;
  optional?: boolean;
  choices?: Array<{ value: unknown; display: string }>;
  min?: number;
  max?: number;
  integer?: boolean;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  elementClassName?: string;
}

export interface ActionMetadata {
  name: string;
  prompt?: string;
  selections: Selection[];
}

export interface Player {
  position: number;
  name: string;
}
