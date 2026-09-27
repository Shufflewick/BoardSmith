/**
 * Ledger numbers allocated at merge time (#294).
 *
 * Every numbered ledger entry is cited by its number ("per Ruling 138"), so two entries with one
 * number make every citation of it ambiguous. When chunks are built one at a time, "the next
 * number" is well defined. When two chunks are built at once on separate branches, it is not:
 * both branches read the same highest number and both take the next one, which is exactly how
 * sotf ended up with two Ruling 138s (Shufflewick/sotf#32).
 *
 * So a chunk built on a parallel branch never takes a real number. It writes a provisional id
 * scoped to its own slug, `Ruling @<slug>.<n>` (or `G@<slug>.<n>` in CONSTRAINTS.md), which no
 * other branch can write. `boardsmith chunk-merge` then allocates real numbers on the combined
 * tree, one merge at a time under a lock, and rewrites every citation of each provisional id in
 * the files the branch changed. An id a Markdown file only quotes, in a code span, a fenced block or
 * a comment, is not a citation (`citableText`, #437). `chunk-merge` refuses a branch that added a real number,
 * so the only way a number reaches `main` from a parallel branch is through this allocation.
 */
import { PROVISIONAL_NUMBER, blankComments, citableText, entryHeadingPattern, escapeRegExp } from './ledger-entries.js';
import { CONSTRAINTS_MD, DECISIONS_MD, FILINGS_MD, QUESTIONS_MD, RULINGS_MD } from './project-paths.js';

/** One kind of numbered entry: its ledger, its heading word, and what separates word and number. */
interface NumberedLedgerSpec {
  /** The ledger file, design-relative. */
  file: string;
  /** The heading word, e.g. `Ruling`, or the constraint letter `C` / `G`. */
  kind: string;
  /** `' '` for `Ruling 12`; `''` for `G12`, whose number follows the letter directly. */
  sep: string;
}

/** Every numbered entry kind a chunk can add. A kind missing here could collide across branches. */
export const NUMBERED_LEDGER_SPECS: readonly NumberedLedgerSpec[] = [
  { file: RULINGS_MD, kind: 'Ruling', sep: ' ' },
  { file: DECISIONS_MD, kind: 'Decision', sep: ' ' },
  { file: FILINGS_MD, kind: 'Filing', sep: ' ' },
  { file: QUESTIONS_MD, kind: 'Question', sep: ' ' },
  { file: CONSTRAINTS_MD, kind: 'C', sep: '' },
  { file: CONSTRAINTS_MD, kind: 'G', sep: '' },
];

function headingPattern(spec: NumberedLedgerSpec, id: string): RegExp {
  return entryHeadingPattern(spec.kind, spec.sep, id);
}

/** Real (allocated) numbers used as headings, in file order, template comments excluded. */
function plainNumbers(text: string, spec: NumberedLedgerSpec): number[] {
  return [...blankComments(text).matchAll(headingPattern(spec, '\\d+'))].map((m) => Number(m[1]));
}

/** Provisional ids used as headings, in file order, e.g. `Ruling @trading.1`. */
export function provisionalHeadings(text: string, spec: NumberedLedgerSpec): string[] {
  return [...blankComments(text).matchAll(headingPattern(spec, PROVISIONAL_NUMBER))].map(
    (m) => `${spec.kind}${spec.sep}${m[1]}`,
  );
}

/**
 * The citation grammar for entry ids in prose (#439). A citation names its kind, then its number:
 * `Ruling 12`, `Ruling @trading.1`, `G@world.2`. In a list the kind word is written once, often
 * plural, and every id after it takes that kind until another kind word:
 * `Rulings 8 and @ranged-units.1`, `Questions @a.14, @a.15 or 16`. A list continues across `,`,
 * `and`, `or` and `&`, and ends at anything else. A provisional id with no kind anywhere before it in
 * its list (`as settled in @a.1`) is still a provisional id: it is returned with no kind, so nothing
 * provisional can reach the main line unnoticed. `@` directly after a letter, digit or `.` is not an
 * id (`jt@example.com`, `pkg@1.2.3`).
 */
const WORD_KINDS = NUMBERED_LEDGER_SPECS.filter((s) => s.sep === ' ').map((s) => escapeRegExp(s.kind));
const LETTER_KINDS = NUMBERED_LEDGER_SPECS.filter((s) => s.sep === '').map((s) => escapeRegExp(s.kind));
/** Whitespace that may wrap onto the next line, but never across a blank line. */
const GAP = '[ \\t]*\\n?[ \\t]*';
/** A kind word or letter, then an id; the groups are named only where one item is read at a time. */
const listItem = (named: boolean, kindRequired: boolean): string => {
  const group = (name: string) => (named ? `?<${name}>` : '?:');
  const kind = `(?:\\b(${group('word')}${WORD_KINDS.join('|')})s?(?=\\s)${GAP}|\\b(${group('letter')}${LETTER_KINDS.join('|')}))`;
  return `${kind}${kindRequired ? '' : '?'}(${group('number')}\\d+|${PROVISIONAL_NUMBER})(?!\\d)`;
};
const LIST_JOIN = `${GAP}(?:,${GAP}(?:(?:and|or)(?=\\s)${GAP})?|(?:and|or|&)(?=\\s)${GAP})`;
const CITATION_LIST = new RegExp(`${listItem(false, true)}(?:${LIST_JOIN}${listItem(false, false)})*`, 'g');
const LIST_ITEMS = new RegExp(listItem(true, false), 'g');
const BARE_PROVISIONAL = new RegExp(`(?<![\\w@.])${PROVISIONAL_NUMBER}(?!\\d)`, 'g');

interface ProvisionalCitation {
  /** Offset of the provisional number (`@a.1`) in the file. */
  index: number;
  /** The provisional number as written, e.g. `@a.1`. */
  number: string;
  /** The full id with its kind, e.g. `Ruling @a.1`, or `undefined` when no kind precedes it. */
  id: string | undefined;
}

/** Every provisional id cited in file `path`, in file order. An id the file only quotes (`citableText`) is not cited. */
function provisionalCitations(path: string, text: string): ProvisionalCitation[] {
  const citable = citableText(path, text);
  const found: ProvisionalCitation[] = [];
  const attributed = new Set<number>();
  for (const list of citable.matchAll(CITATION_LIST)) {
    let kind = '';
    for (const item of list[0].matchAll(LIST_ITEMS)) {
      const { word, letter, number } = item.groups!;
      if (word !== undefined) kind = `${word} `;
      else if (letter !== undefined) kind = letter;
      if (!number.startsWith('@')) continue;
      const index = list.index + item.index + item[0].length - number.length;
      attributed.add(index);
      found.push({ index, number, id: `${kind}${number}` });
    }
  }
  for (const m of citable.matchAll(BARE_PROVISIONAL)) {
    if (!attributed.has(m.index)) found.push({ index: m.index, number: m[0], id: undefined });
  }
  return found.sort((a, b) => a.index - b.index);
}

/**
 * Every provisional id cited in file `path`, of any kind, in order of first appearance: `Ruling @a.1`
 * with its kind, or the bare `@a.1` when the text gives it none. An id the file only quotes
 * (`citableText`) is not cited.
 */
export function provisionalReferences(path: string, text: string): string[] {
  return [...new Set(provisionalCitations(path, text).map((c) => c.id ?? c.number))];
}

/** Real numbers present as headings in `tip` but not in `base`, e.g. `['Ruling 139']`. */
export function plainNumbersAdded(base: string, tip: string, spec: NumberedLedgerSpec): string[] {
  const before = new Set(plainNumbers(base, spec));
  return plainNumbers(tip, spec)
    .filter((n) => !before.has(n))
    .map((n) => `${spec.kind}${spec.sep}${n}`);
}

interface AllocationResult {
  /** Every file handed in, with provisional ids replaced by their allocated numbers. */
  files: Record<string, string>;
  /** Each provisional id and the real id it became, e.g. `{ 'Ruling @a.1': 'Ruling 139' }`. */
  mapping: Record<string, string>;
}

/**
 * Allocates a real number to every provisional heading in each ledger, after the highest real
 * number already there, in file order, and rewrites every citation of those ids in `files`.
 * `ledgers` names which of `files` are ledgers and what kind of entry each holds. Pure: the
 * caller reads and writes the files.
 */
export function allocateProvisional(
  files: Record<string, string>,
  ledgers: ReadonlyArray<{ spec: NumberedLedgerSpec; path: string }>,
): AllocationResult {
  const mapping: Record<string, string> = {};
  for (const { spec, path } of ledgers) {
    const text = files[path];
    if (text === undefined) continue;
    let next = Math.max(0, ...plainNumbers(text, spec)) + 1;
    for (const id of provisionalHeadings(text, spec)) {
      if (!(id in mapping)) mapping[id] = `${spec.kind}${spec.sep}${next++}`;
    }
  }
  if (Object.keys(mapping).length === 0) return { files: { ...files }, mapping };
  const rewritten: Record<string, string> = {};
  for (const [path, text] of Object.entries(files)) {
    // Found on the citable text, spliced into the real one: a quoted id stays as written.
    let out = '';
    let from = 0;
    for (const { index, number, id } of provisionalCitations(path, text)) {
      if (id === undefined || !(id in mapping)) continue;
      out += text.slice(from, index) + /\d+$/.exec(mapping[id])![0];
      from = index + number.length;
    }
    rewritten[path] = out + text.slice(from);
  }
  return { files: rewritten, mapping };
}
