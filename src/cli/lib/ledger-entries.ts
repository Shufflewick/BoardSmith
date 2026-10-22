/**
 * The one reader of a design ledger's numbered entries (`### Ruling N`, `### Decision N`,
 * `### Filing N`, `### Dispatch N`), and the one definition of an entry heading.
 *
 * `parseRulings` (`build-manifest.ts`), `ledger-check` and the merge-time allocation
 * (`ledger-allocation.ts`) all read headings through this, so there is exactly one heading grammar
 * and one supersession grammar for every ledger. A second, slightly different regex is how two
 * tools come to disagree about what a ledger says: before #436 this reader knew only real numbers,
 * so it read a chunk branch's provisional entry as part of the numbered entry above it.
 */
import { escapeRegExp } from '../../utils/regexp.js';

const SLUG = '[A-Za-z0-9_-]+';
/** A provisional entry number, `@<slug>.<n>`, written on a parallel chunk branch until merge (#294). */
export const PROVISIONAL_NUMBER = `@${SLUG}\\.\\d+`;
/** The number part of an entry id, real or provisional: `12`, or `@trading.1`. */
export const ENTRY_NUMBER = `(?:\\d+|${PROVISIONAL_NUMBER})`;

/**
 * The heading line of a `<kind>` entry whose number matches `number` (a regex source, captured as
 * group 1). `sep` is what separates word and number: `' '` for `Ruling 12`, `''` for `G12`.
 */
export function entryHeadingPattern(kind: string, sep: string, number: string): RegExp {
  return new RegExp(`^### ${escapeRegExp(kind)}${sep}(${number})[ \\t]*$`, 'gm');
}

/**
 * The real number of entry `id` of `kind`. For a reader that runs on a merged game (the verify
 * commands): every entry there has a real number, and a provisional id (`@<slug>.<n>`) exists only
 * on a chunk branch until `chunk-merge` allocates it one (#294), so one here is refused.
 */
export function allocatedNumber(kind: string, id: string): number {
  if (/^\d+$/.test(id)) return Number(id);
  throw new Error(
    `${kind} ${id} is a provisional id, which only a chunk branch holds until \`boardsmith chunk-merge\` ` +
      `gives it a real number. Run this on the game's main checkout after the chunk is merged with ` +
      `\`boardsmith chunk-merge\`.`,
  );
}

export interface LedgerEntry {
  /** The entry's number as written in its heading: `12`, or provisional `@trading.1`. */
  id: string;
  /** 1-based line number of the `### <Kind> N` heading. */
  line: number;
  /** 1-based line number of the first body line (the line after the heading). */
  bodyLine: number;
  /**
   * Everything after the heading line up to the next heading of the same kind, real or
   * provisional, or end of file.
   */
  body: string;
}

/**
 * Replaces every HTML comment with blanks of the same shape, so the template's illustrative
 * examples (which live inside `<!-- -->`) are never read as entries, and every line number still
 * points at the real line in the file.
 */
export function blankComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '));
}

const blank = (quoted: string): string => quoted.replace(/[^\n]/g, ' ');

const QUOTES = String.raw`(?: {0,3}>[ \t]?)*`;
const ATX_HEADING = String.raw`${QUOTES} {0,3}#{1,6}(?![^ \t\r\n])`;
// shortcut: an unquoted = line lazily continuing a quote or list paragraph is text, not an underline; it ends the span here too.
const SETEXT_UNDERLINE = String.raw`${QUOTES} {0,3}=+[ \t\r]*(?![^\n])`;
// A line that starts a block ends the paragraph before it, and so any code span open in it (#1393, #1396, #1397).
const BLOCK_START = String.raw`(?: {0,3}>)*[ \t\r]*\n|${ATX_HEADING}|${SETEXT_UNDERLINE}`;
// A heading is one line, so a span cannot run past its end either.
const CODE_SPAN = new RegExp(
  String.raw`(?<!\`)(\`+)(?!\`)(?:(?!\n(?:${BLOCK_START})|\n(?<=^${ATX_HEADING}[^\n]*\n))[\s\S])+?(?<!\`)\1(?!\`)`,
  'gm',
);

/**
 * The citation grammar (#437): in a Markdown file, an entry id inside an HTML comment, a fenced
 * code block or an inline code span is QUOTED, never cited. A filing that reproduces a ledger bug
 * writes `### Filing @x.1` as an example, and a skill writes `Ruling @<slug>.<n>` as a form; neither
 * names an entry. Returns `text` with every quoted region blanked to the same shape, so offsets and
 * line numbers still point into the real file. Outside Markdown (source code) backticks are not
 * quoting, so the text is returned unchanged: `// Ruling @a.1` in a `.ts` file is a citation.
 */
export function citableText(path: string, text: string): string {
  if (!path.endsWith('.md')) return text;
  return blankComments(text)
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[`~]*[ \t]*$|(?![\s\S]))/gm, blank)
    // A fence in a blockquote ends at its closing fence or where the quote ends (#1396).
    .replace(/^(?: {0,3}>[ \t]?)+ {0,3}(`{3,}|~{3,})[^\n]*(?:\n {0,3}>[^\n]*)*?(?:\n(?: {0,3}>[ \t]?)+ {0,3}\1[`~]*[ \t]*$|(?=\n(?! {0,3}>))|(?![\s\S]))/gm, blank)
    .replace(CODE_SPAN, blank);
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** One `- <Field>: <value>` line of an entry's body, and the file line it is on. */
export interface EntryField {
  value: string;
  line: number;
}

/** The first `- <field>: <value>` line in `entry`'s body, or undefined when it has none. */
export function entryField(entry: LedgerEntry, field: string): EntryField | undefined {
  const lines = entry.body.split('\n');
  const pattern = new RegExp(`^\\s*-\\s*${escapeRegExp(field)}:[ \\t]*(.*?)\\s*$`);
  for (let i = 0; i < lines.length; i++) {
    const match = pattern.exec(lines[i]);
    if (match) return { value: match[1], line: entry.bodyLine + i };
  }
  return undefined;
}

/**
 * Every `### <kind> N` and `### <kind> @<slug>.<n>` entry in file order. Duplicated ids are KEPT
 * as separate entries, so a caller can see an id that was used twice instead of having one
 * silently replace the other.
 */
export function parseLedgerEntries(text: string, kind: string): LedgerEntry[] {
  const visible = blankComments(text);
  const found: Array<{ id: string; index: number; bodyStart: number }> = [];
  for (const match of visible.matchAll(entryHeadingPattern(kind, ' ', ENTRY_NUMBER))) {
    const lineEnd = visible.indexOf('\n', match.index);
    found.push({
      id: match[1],
      index: match.index,
      bodyStart: lineEnd === -1 ? visible.length : lineEnd + 1,
    });
  }
  return found.map((h, i) => {
    const line = lineOf(visible, h.index);
    return {
      id: h.id,
      line,
      bodyLine: line + 1,
      body: visible.slice(h.bodyStart, i + 1 < found.length ? found[i + 1].index : visible.length),
    };
  });
}

/**
 * The only two supersession shapes read as a chain, for one ledger kind:
 *
 * M and N are entry ids, real or provisional.
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
    supersededBy: new RegExp(`supersede[sd]?\\s+by:?\\s+${kind}\\s+(${ENTRY_NUMBER})`, 'i'),
    supersedes: new RegExp(`\\bsupersedes\\s+${kind}\\s+(${ENTRY_NUMBER})`, 'i'),
  };
}
