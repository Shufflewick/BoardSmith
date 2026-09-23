/**
 * The one reader of a design ledger's numbered entries (`### Ruling N`, `### Decision N`,
 * `### Filing N`, `### Dispatch N`).
 *
 * `parseRulings` (`build-manifest.ts`) and `ledger-check` both read entries through this, so
 * there is exactly one heading grammar and one supersession grammar for every ledger. A second,
 * slightly different regex is how two tools come to disagree about what a ledger says.
 */

export interface LedgerEntry {
  number: number;
  /** 1-based line number of the `### <Kind> N` heading. */
  line: number;
  /** 1-based line number of the first body line (the line after the heading). */
  bodyLine: number;
  /** Everything after the heading line up to the next heading of the same kind, or end of file. */
  body: string;
}

/**
 * Replaces every HTML comment with blanks of the same shape, so the template's illustrative
 * examples (which live inside `<!-- -->`) are never read as entries, and every line number still
 * points at the real line in the file.
 */
function blankComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '));
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/**
 * Every `### <kind> N` entry in file order. Duplicated numbers are KEPT as separate entries, so
 * a caller can see a number that was used twice instead of having one silently replace the other.
 */
export function parseLedgerEntries(text: string, kind: string): LedgerEntry[] {
  const visible = blankComments(text);
  const heading = new RegExp(`^### ${kind} (\\d+)[ \\t]*$`, 'gm');
  const found: Array<{ number: number; index: number; bodyStart: number }> = [];
  for (const match of visible.matchAll(heading)) {
    const lineEnd = visible.indexOf('\n', match.index);
    found.push({
      number: Number(match[1]),
      index: match.index,
      bodyStart: lineEnd === -1 ? visible.length : lineEnd + 1,
    });
  }
  return found.map((h, i) => {
    const line = lineOf(visible, h.index);
    return {
      number: h.number,
      line,
      bodyLine: line + 1,
      body: visible.slice(h.bodyStart, i + 1 < found.length ? found[i + 1].index : visible.length),
    };
  });
}

/**
 * The only two supersession shapes read as a chain, for one ledger kind:
 *
 * - `supersedes <Kind> M`, written on the NEW entry N: N replaces M.
 * - `superseded by <Kind> M`, the in-place pointer written on the OLD entry: it was replaced by M.
 *   The template spells it as a field, `- Superseded by: <Kind> M`, and the prose form without
 *   the colon reads the same.
 *
 * Every other cross-entry verb ("reconciles", "extends", "resolves") is a citation to a live
 * entry, not a replacement of it. Keep this list narrow: a check that fires on correct work is a
 * check that gets waived.
 */
export function supersessionPatterns(kind: string): { supersededBy: RegExp; supersedes: RegExp } {
  return {
    supersededBy: new RegExp(`supersede[sd]?\\s+by:?\\s+${kind}\\s+(\\d+)`, 'i'),
    supersedes: new RegExp(`\\bsupersedes\\s+${kind}\\s+(\\d+)`, 'i'),
  };
}
