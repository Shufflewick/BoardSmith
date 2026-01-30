export { default as FlyingCardsOverlay } from './FlyingCardsOverlay.vue';
export { default as GameOverlay } from './GameOverlay.vue';
export { default as ZoomPreviewOverlay } from './ZoomPreviewOverlay.vue';
export { default as Button } from './Button.vue';

// Button types - defined here since TypeScript can't extract types from .vue files
export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'danger'
  | 'ghost'
  | 'icon';

export type ButtonSize = 'small' | 'default' | 'large';
