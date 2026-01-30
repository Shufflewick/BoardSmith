/**
 * @module utils/dev
 *
 * Development utilities for BoardSmith.
 * Provides environment detection and one-time warning functionality.
 *
 * @example
 * ```typescript
 * import { isDevMode, devWarn } from 'boardsmith/utils';
 *
 * if (isDevMode()) {
 *   devWarn('my-feature', 'This feature is experimental');
 * }
 * ```
 */

/**
 * Check if running in development mode.
 * Works in both browser (Vite) and Node.js environments.
 *
 * @returns true if in development mode, false in production
 *
 * @example
 * ```typescript
 * if (isDevMode()) {
 *   console.log('Debug info:', data);
 * }
 * ```
 */
export function isDevMode(): boolean {
  // Browser (Vite) - check import.meta.env first
  if (typeof import.meta !== 'undefined' && (import.meta as any).env) {
    const env = (import.meta as any).env;
    return env.DEV === true || env.MODE !== 'production';
  }
  // Node.js fallback
  return typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
}

/**
 * Set of warning keys that have already been shown (to avoid spam)
 */
const shownWarnings = new Set<string>();

/**
 * Show a warning once per unique key (development mode only).
 * Prevents spam when warnings would otherwise fire repeatedly.
 *
 * @param key - Unique key to deduplicate warnings
 * @param message - Warning message to display
 *
 * @example
 * ```typescript
 * // This will only log once, no matter how many times it's called
 * devWarn('deprecated-api', 'The foo() method is deprecated, use bar() instead');
 * ```
 */
export function devWarn(key: string, message: string): void {
  if (!isDevMode()) return;
  if (shownWarnings.has(key)) return;
  shownWarnings.add(key);
  console.warn(`[BoardSmith] ${message}`);
}

/**
 * Clear all shown warnings (useful for testing).
 * @internal
 */
export function _clearShownWarnings(): void {
  shownWarnings.clear();
}
