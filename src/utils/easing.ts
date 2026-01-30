/**
 * @module utils/easing
 *
 * Easing functions for animations in BoardSmith.
 * These functions transform linear progress (0-1) into eased progress.
 *
 * @example
 * ```typescript
 * import { easeOutCubic, easeInOutCubic } from 'boardsmith/utils';
 *
 * const progress = 0.5;
 * const eased = easeOutCubic(progress); // ~0.875
 * ```
 */

/**
 * Ease out cubic - starts fast, decelerates at end.
 * The most natural feeling for UI animations.
 *
 * @param t - Progress value from 0 to 1
 * @returns Eased value from 0 to 1
 *
 * @example
 * ```typescript
 * // In a requestAnimationFrame loop:
 * const rawProgress = elapsed / duration;
 * const easedProgress = easeOutCubic(Math.min(rawProgress, 1));
 * element.style.transform = `translateX(${easedProgress * distance}px)`;
 * ```
 */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Ease in cubic - starts slow, accelerates at end.
 *
 * @param t - Progress value from 0 to 1
 * @returns Eased value from 0 to 1
 */
export function easeInCubic(t: number): number {
  return t * t * t;
}

/**
 * Ease in-out cubic - slow at both ends, fast in middle.
 * Good for looping animations or emphasis.
 *
 * @param t - Progress value from 0 to 1
 * @returns Eased value from 0 to 1
 */
export function easeInOutCubic(t: number): number {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Linear - no easing, constant speed.
 *
 * @param t - Progress value from 0 to 1
 * @returns Same value (identity function)
 */
export function linear(t: number): number {
  return t;
}

/**
 * Ease out quad - lighter deceleration than cubic.
 *
 * @param t - Progress value from 0 to 1
 * @returns Eased value from 0 to 1
 */
export function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/**
 * Ease in quad - lighter acceleration than cubic.
 *
 * @param t - Progress value from 0 to 1
 * @returns Eased value from 0 to 1
 */
export function easeInQuad(t: number): number {
  return t * t;
}

/**
 * Type for easing functions.
 * Takes progress 0-1, returns eased value 0-1.
 */
export type EasingFunction = (t: number) => number;
