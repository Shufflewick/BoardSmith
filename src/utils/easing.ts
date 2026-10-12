/**
 * @module utils/easing
 *
 * The easing curve the flying-element animation uses: it turns linear
 * progress (0-1) into eased progress.
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
