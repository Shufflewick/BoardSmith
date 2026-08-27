/**
 * Display formatting for the debug panel (#41).
 *
 * Everything here is a pure function of its arguments: no Vue, no refs, no host
 * bridge. `DebugPanel.vue` had two copies of `formatValue`, `getTypeColor` and
 * `isExpandable` — one in its `TreeNode` render function and one in its setup
 * block — which had already started to drift. There is one copy now, and it can
 * be tested without mounting anything.
 *
 * @module
 */

/** CSS custom property naming the colour a value of this type is drawn in. */
export function getTypeColor(value: unknown): string {
  if (value === null) return 'var(--bsg-danger)';
  if (value === undefined) return 'var(--bsg-away)';
  if (typeof value === 'string') return 'var(--bsg-ok)';
  if (typeof value === 'number') return 'var(--bsg-accent)';
  if (typeof value === 'boolean') return 'var(--bsg-warn)';
  if (Array.isArray(value)) return 'var(--bsg-ink-2)';
  if (typeof value === 'object') return 'var(--bsg-accent-2)';
  return 'var(--bsg-ink)';
}

/** One-line summary of a value for a collapsed tree row. */
export function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (typeof value === 'object') return `{${Object.keys(value as object).length} keys}`;
  return String(value);
}

/** Can this value be opened into child rows? */
export function isExpandable(value: unknown): boolean {
  return value !== null && typeof value === 'object';
}

/** Render one condition operand from an action trace. */
export function formatConditionValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'boolean') return value.toString();
  if (typeof value === 'number') return value.toString();
  if (typeof value === 'string') return `"${value}"`;
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** `playCard` reads as `Play Card` in the History tab. */
export function formatActionName(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, s => s.toUpperCase());
}

/**
 * Render an action's arguments for the History tab. Element references are
 * shown by their notation or id rather than dumped as JSON, and arguments that
 * were never supplied are left out entirely.
 */
export function formatActionArgs(args: Record<string, unknown>): string {
  if (!args || Object.keys(args).length === 0) return '';

  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      if (obj.__elementRef) {
        parts.push(`${key}: ${obj.__elementRef}`);
      } else if (obj.__elementId) {
        parts.push(`${key}: #${obj.__elementId}`);
      } else {
        parts.push(`${key}: ${JSON.stringify(value)}`);
      }
    } else {
      parts.push(`${key}: ${value}`);
    }
  }
  return parts.join(', ');
}

/** Local wall-clock time for a recorded action, or nothing if it carries none. */
export function formatTimestamp(timestamp?: number): string {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleTimeString();
}

/** Pretty-print a game state for the raw view, saying why if it cannot. */
export function formatState(state: unknown): string {
  if (!state) return 'No state available';
  try {
    return JSON.stringify(state, null, 2);
  } catch {
    return 'Error formatting state';
  }
}
