/**
 * @module utils
 *
 * Shared utilities for BoardSmith.
 *
 * ```typescript
 * import { isDevMode, devWarn, SeededRandom, easeOutCubic } from 'boardsmith/utils';
 * ```
 */

export { isDevMode, devWarn, _clearShownWarnings } from './dev.js';
export { SeededRandom, createSeededRandom } from './random.js';
export {
  easeOutCubic,
  easeInCubic,
  easeInOutCubic,
  linear,
  easeOutQuad,
  easeInQuad,
  type EasingFunction,
} from './easing.js';
