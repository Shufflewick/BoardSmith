/**
 * Pure helper functions for useActionController.
 *
 * These are stateless utility functions extracted to reduce the main composable size.
 * They handle development warnings and value display extraction.
 */

// ============================================
// Development Mode Detection
// ============================================

/**
 * Check if running in development mode.
 * Works in both browser (Vite) and Node.js environments.
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

// ============================================
// Development Warnings
// ============================================

const shownWarnings = new Set<string>();

/**
 * Show a warning once per unique key (development mode only).
 * Prevents spam when warnings would otherwise fire repeatedly.
 *
 * @param key - Unique key to deduplicate warnings
 * @param message - Warning message to display
 */
export function devWarn(key: string, message: string): void {
  if (!isDevMode()) return;
  if (shownWarnings.has(key)) return;
  shownWarnings.add(key);
  console.warn(`[BoardSmith] ${message}`);
}

// ============================================
// Value Display Extraction
// ============================================

/**
 * Extract a display string from a value.
 * Handles objects with display/name properties (e.g., followUp context args).
 *
 * Priority:
 * 1. `display` property (explicit display text)
 * 2. `name` property (common for elements/entities)
 * 3. `value` property if primitive
 * 4. String conversion fallback
 *
 * @param value - Any value to extract display from
 * @returns Display string for the value
 */
export function getDisplayFromValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return String(value);

  const obj = value as Record<string, unknown>;
  // Priority 1: display property
  if (typeof obj.display === 'string') return obj.display;
  // Priority 2: name property (common for elements/entities)
  if (typeof obj.name === 'string') return obj.name;
  // Priority 3: primitive value property
  if (obj.value !== undefined && typeof obj.value !== 'object') return String(obj.value);
  // Fallback
  return String(value);
}
