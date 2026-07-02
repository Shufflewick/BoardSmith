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
 * Check whether the animation composables' fail-loud `throw new Error(...)`
 * paths (missing anchor attribute / missing fly target / missing action
 * animation destination) are enabled.
 *
 * Unlike {@link isDevMode}, which defaults to "dev" unless an environment is
 * *positively and exactly* labeled `'production'` (safe for non-fatal
 * `devWarn`/`console.warn` calls), this predicate inverts that default: it
 * requires a *positive* dev/test signal before allowing a genuine throw.
 * An unset/unlabeled/custom-named environment (a common real-world
 * misconfiguration) falls through to `false` here, so a live game degrades
 * to `console.error` + skip instead of crashing on a missing anchor —
 * per CONTEXT.md's ANIM-03 requirement that animation failures are cosmetic
 * and must never crash a live game.
 *
 * Used ONLY by the four animation composables' fail-loud throw sites
 * (`useFLIP`, `useFlyingElements`, `useElementAnimation`, `useActionAnimations`).
 * Do NOT use this for `devWarn`/non-fatal diagnostics — those should keep
 * using {@link isDevMode}'s broader "not positively production" semantics.
 *
 * @returns true only when the environment is positively labeled dev/test
 *
 * @example
 * ```typescript
 * if (isDevThrowEnabled()) {
 *   throw new Error(message);
 * } else {
 *   console.error(message);
 * }
 * ```
 */
/**
 * Pure decision logic for {@link isDevThrowEnabled}, separated from live
 * environment access so it can be unit-tested deterministically (bundler/test
 * runner quirks around `import.meta.env`'s mutability and evaluation timing
 * make asserting against the live global unreliable — see dev.test.ts).
 *
 * @internal exported for tests only — not part of the public API.
 */
export function _resolveDevThrowEnabled(source: {
  /** Vite's `import.meta.env`, when running in a Vite-processed module. */
  viteEnv?: { DEV?: boolean; MODE?: string };
  /** `process.env.NODE_ENV`, when running in a plain Node.js context. */
  nodeEnv?: string;
}): boolean {
  if (source.viteEnv) {
    return (
      source.viteEnv.DEV === true ||
      source.viteEnv.MODE === 'development' ||
      source.viteEnv.MODE === 'test'
    );
  }
  return source.nodeEnv === 'development' || source.nodeEnv === 'test';
}

export function isDevThrowEnabled(): boolean {
  // Browser (Vite) - a genuine dev server run, or an explicit dev/test mode label.
  if (typeof import.meta !== 'undefined' && (import.meta as any).env) {
    return _resolveDevThrowEnabled({ viteEnv: (import.meta as any).env });
  }
  // Node.js - require an explicit, positive NODE_ENV label.
  return _resolveDevThrowEnabled({
    nodeEnv: typeof process !== 'undefined' ? process.env?.NODE_ENV : undefined,
  });
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
