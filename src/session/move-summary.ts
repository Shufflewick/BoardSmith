/**
 * Human-readable, single-line summaries of a move's destination — shared by the
 * AI move-hint bubble and the AI-vs-AI demo narration so both read as prose
 * (e.g. "c5 → a3 (capture)") instead of dumping raw JSON or element ids.
 *
 * SAFETY (mirrors buildNarration's SAFE_DEST_ARGS rationale): only DESTINATION-like
 * args are read, and raw numeric element ids are never surfaced — so this can never
 * leak hidden information (e.g. a card's element id) on LAN/multiplayer sessions.
 * Open-information games (Checkers, Hex) carry their target as a notation string or
 * a `{ fromNotation, toNotation, isCapture }` object, which is exactly what we format.
 */

/** Destination-like arg keys that are safe to surface (an open board target). */
const DEST_KEYS = ['to', 'destination', 'target', 'square', 'cell', 'position'] as const;

/**
 * Derive a short destination description from a move's args, or `null` when none
 * can be derived from safe (non-id) args.
 *
 * Examples:
 *   { destination: { fromNotation: 'c5', toNotation: 'a3', isCapture: true } } → "c5 → a3 (capture)"
 *   { destination: { toNotation: 'f4' } }                                      → "f4"
 *   { to: 'e5' }                                                               → "e5"
 *   { piece: 93 }                                                              → null (id only)
 */
export function describeMoveDestination(args: Record<string, unknown>): string | null {
  for (const key of DEST_KEYS) {
    const v = args[key];
    if (v && typeof v === 'object') {
      const o = v as { fromNotation?: unknown; toNotation?: unknown; isCapture?: unknown };
      if (typeof o.toNotation === 'string') {
        const arrow =
          typeof o.fromNotation === 'string'
            ? `${o.fromNotation} → ${o.toNotation}`
            : o.toNotation;
        return `${arrow}${o.isCapture === true ? ' (capture)' : ''}`;
      }
    } else if (typeof v === 'string') {
      return v;
    }
    // numeric ids are intentionally skipped (not human-readable + avoids leaking).
  }
  return null;
}

/**
 * Full narration line for one move, e.g. "Player 1: move c5 → a3 (capture)".
 * Falls back to "Player N: <action>" when no readable destination is available.
 */
export function describeMoveForNarration(
  player: number,
  action: string,
  args: Record<string, unknown>,
): string {
  const dest = describeMoveDestination(args);
  return dest ? `Player ${player}: ${action} ${dest}` : `Player ${player}: ${action}`;
}

/**
 * Hint bubble text, e.g. "Suggested: c5 → a3 (capture)". Falls back to the generic
 * "Suggested move" when no readable destination is available (the board ring, when
 * present, still shows the target square).
 */
export function describeMoveForHint(args: Record<string, unknown>): string {
  const dest = describeMoveDestination(args);
  return dest ? `Suggested: ${dest}` : 'Suggested move';
}
