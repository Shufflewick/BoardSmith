/**
 * In-process ring buffer capturing dev-host server-side log entries (ERR-04) so
 * a connected client can pull them via the `debug:logs` op instead of watching
 * the Node terminal.
 *
 * This module is confined to `src/cli/dev-host/` — the session layer must
 * NEVER import it (T-126-10). Session-layer error/health signals are surfaced
 * here only via callbacks the dev host itself supplies (e.g. the
 * `onPersistenceError` adapter built in bridge.ts's `createDevSession`).
 *
 * Deliberately a plain capped array behind two functions, not a class — no
 * circular-buffer machinery, no global console monkey-patching (RESEARCH
 * Pitfall 3 / 5).
 */

/**
 * Cap on retained log entries — mirrors the naming/comment convention of
 * `MAX_AI_MOVES` (snapshot-session-host.ts:9) / `MAX_DEMO_MOVES`
 * (snapshot-session-host.ts:105). Oldest entries are evicted FIFO once the
 * buffer is full (RESEARCH Open Question Q2).
 */
export const MAX_LOG_ENTRIES = 300;

/** A single captured log entry. Message is sanitized — never a stack trace or file path (T-126-11). */
export interface LogEntry {
  severity: 'error' | 'warning' | 'info';
  message: string;
  source: string;
  timestamp: number;
}

let entries: LogEntry[] = [];

/**
 * Record a log entry into the ring buffer. Evicts the oldest entry (FIFO)
 * once the buffer exceeds `MAX_LOG_ENTRIES`.
 */
export function record(severity: LogEntry['severity'], message: string, source: string): void {
  entries.push({ severity, message, source, timestamp: Date.now() });
  if (entries.length > MAX_LOG_ENTRIES) {
    entries.shift();
  }
}

/** Snapshot of all currently captured entries, oldest first. */
export function getEntries(): readonly LogEntry[] {
  return entries;
}

/** Test-only helper to reset the module-level buffer between test cases. */
export function clearEntries(): void {
  entries = [];
}
