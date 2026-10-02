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
 *
 * Shorthand and ranges (#446): a `.N` directly after a provisional id in the same list, or after
 * another such `.N`, is that slug's id N (`Decisions @a.1, .2`). `to` and `through` join a range
 * (`Rulings @a.1 to .3`), and so does a dash (`@a.1-.3`, `@a.1–@a.3`), but only right before a
 * provisional or shorthand id: a range of real numbers needs no rewriting.
 */
const WORD_KINDS = NUMBERED_LEDGER_SPECS.filter((s) => s.sep === ' ').map((s) => escapeRegExp(s.kind));
const LETTER_KINDS = NUMBERED_LEDGER_SPECS.filter((s) => s.sep === '').map((s) => escapeRegExp(s.kind));
/**
 * Whitespace that may wrap onto the next line, never across a blank line. The next line may open
 * with a comment or quote marker (` * `, `// `, `# `, `> `), since prose is wrapped inside those too.
 */
const GAP = '[ \\t]*(?:\\n[ \\t]*(?:(?:\\*|//|#|>)[ \\t]*)?)?';
const SHORTHAND = '\\.\\d+';
/** A kind word or letter, then an id; the groups are named only where one item is read at a time. */
const listItem = (named: boolean, first: boolean): string => {
  const group = (name: string) => (named ? `?<${name}>` : '?:');
  const kind = `(?:\\b(${group('word')}${WORD_KINDS.join('|')})s?(?=\\s)${GAP}|\\b(${group('letter')}${LETTER_KINDS.join('|')}))`;
  const id = `${kind}${first ? '' : '?'}(${group('number')}\\d+|${PROVISIONAL_NUMBER})`;
  return `(?:${first ? id : `${id}|(${group('short')}${SHORTHAND})`})(?!\\d)`;
};
const LIST_JOIN = `${GAP}(?:,${GAP}(?:(?:and|or)(?=\\s)${GAP})?|(?:and|or|&)(?=\\s)${GAP})`;
/** A range joiner, only ever before a provisional or shorthand id: `Ruling @a.1 to 3 players` is no range. */
const rangeJoin = (named: boolean) =>
  `(?:${GAP}(${named ? '?<range>' : '?:'}to|through)(?=\\s)${GAP}|[ \\t]*(${named ? '?<dash>' : '?:'}[-–])[ \\t]*)(?=@|${SHORTHAND})`;
const CITATION_LIST = new RegExp(`${listItem(false, true)}(?:(?:${rangeJoin(false)}|${LIST_JOIN})${listItem(false, false)})*`, 'g');
const FIRST_ITEM = new RegExp(listItem(true, true), 'y');
const NEXT_ITEM = new RegExp(`(?:${rangeJoin(true)}|${LIST_JOIN})${listItem(true, false)}`, 'y');
const BARE_PROVISIONAL = new RegExp(`(?<![\\w@.])${PROVISIONAL_NUMBER}(?!\\d)`, 'g');

/** One id in a citation list: a real number, or a provisional one (a shorthand `.N` read as its full id). */
interface ListItem {
  /** Offset of the number as written (`12`, `@a.1`, `.3`) in the file. */
  index: number;
  /** The number as written. */
  written: string;
  /** The kind the list gives it, `Ruling ` or `G`; `''` when nothing before it names one. */
  kind: string;
  /** The full provisional number (`@a.3` for a written `.3`), or `undefined` for a real number. */
  provisional: string | undefined;
}

interface ProvisionalCitation {
  /** Offset of the number as written in the file. */
  index: number;
  /** The number as written: `@a.1`, or the shorthand `.3`. */
  written: string;
  /** The full id with its kind, e.g. `Ruling @a.1`, or `undefined` when no kind precedes it. */
  id: string | undefined;
}

/** A range in a citation list (`Rulings @a.1 to .3`) with a provisional id at either end. */
interface ProvisionalRange {
  from: ListItem;
  to: ListItem;
  /** The list, from its first kind word to the range's end, as written. */
  written: string;
}

/** Reads one citation list matched at `at` in `citable`, item by item. */
function readList(citable: string, at: number, length: number): { items: ListItem[]; ranges: ProvisionalRange[] } {
  const items: ListItem[] = [];
  const ranges: ProvisionalRange[] = [];
  const end = at + length;
  let kind = '';
  let slug: string | undefined;
  let pattern = FIRST_ITEM;
  let pos = at;
  while (pos < end) {
    pattern.lastIndex = pos;
    const m = pattern.exec(citable);
    if (!m || m.index + m[0].length > end) break;
    pos = m.index + m[0].length;
    pattern = NEXT_ITEM;
    const { word, letter, number, short, range, dash } = m.groups!;
    if (word !== undefined) kind = `${word} `;
    else if (letter !== undefined) kind = letter;
    const written = number ?? short!;
    let provisional: string | undefined;
    if (number?.startsWith('@')) {
      provisional = number;
      slug = /^@(.*)\.\d+$/.exec(number)![1];
    } else if (short !== undefined && slug !== undefined) {
      provisional = `@${slug}${short}`;
    } else {
      // A real number, or a `.N` with no provisional id before it: no shorthand follows from it.
      slug = undefined;
      if (short !== undefined) continue;
    }
    const item: ListItem = { index: pos - written.length, written, kind, provisional };
    const previous = items[items.length - 1];
    if ((range ?? dash) !== undefined && previous && (previous.provisional ?? provisional) !== undefined) {
      ranges.push({ from: previous, to: item, written: citable.slice(at, pos) });
    }
    items.push(item);
  }
  return { items, ranges };
}

/** Every provisional id cited in file `path`, in file order, and every range one ends. */
function provisionalCitations(path: string, text: string): { citations: ProvisionalCitation[]; ranges: ProvisionalRange[] } {
  const citable = citableText(path, text);
  const citations: ProvisionalCitation[] = [];
  const ranges: ProvisionalRange[] = [];
  const attributed = new Set<number>();
  for (const list of citable.matchAll(CITATION_LIST)) {
    const read = readList(citable, list.index, list[0].length);
    ranges.push(...read.ranges);
    for (const item of read.items) {
      if (item.provisional === undefined) continue;
      attributed.add(item.index);
      citations.push({ index: item.index, written: item.written, id: `${item.kind}${item.provisional}` });
    }
  }
  for (const m of citable.matchAll(BARE_PROVISIONAL)) {
    if (!attributed.has(m.index)) citations.push({ index: m.index, written: m[0], id: undefined });
  }
  return { citations: citations.sort((a, b) => a.index - b.index), ranges };
}

/**
 * Every provisional id cited in file `path`, of any kind, in order of first appearance: `Ruling @a.1`
 * with its kind (a shorthand `.3` after it as `Ruling @a.3`), or the bare `@a.1` when the text gives
 * it none. An id the file only quotes (`citableText`) is not cited.
 */
export function provisionalReferences(path: string, text: string): string[] {
  return [...new Set(provisionalCitations(path, text).citations.map((c) => c.id ?? c.written))];
}

/** Real numbers present as headings in `tip` but not in `base`, e.g. `['Ruling 139']`. */
export function plainNumbersAdded(base: string, tip: string, spec: NumberedLedgerSpec): string[] {
  const before = new Set(plainNumbers(base, spec));
  return plainNumbers(tip, spec)
    .filter((n) => !before.has(n))
    .map((n) => `${spec.kind}${spec.sep}${n}`);
}

/** A range of citations the merge cannot rewrite one to one, in file `path`, and why. */
export interface AllocationProblem {
  path: string;
  /** The provisional ids at the range's ends, which the merge leaves as written. */
  ids: string[];
  /** What is wrong and what to write instead, as a sentence after the file's name. */
  detail: string;
}

const numberOf = (id: string): number => Number(/\d+$/.exec(id)![0]);
const plural = (kind: string): string => (kind.endsWith(' ') ? `${kind.trimEnd()}s ` : kind);
const listed = (parts: string[]): string =>
  parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

/**
 * Why `range` cannot be rewritten one to one under `mapping`, or `undefined` when it can (its ends
 * are one slug's ids, in order, and every id between them became the next number) or when the
 * merge allocated neither end, so the check after allocation names them.
 */
function rangeProblem(range: ProvisionalRange, mapping: Record<string, string>): string | undefined {
  const { from, to } = range;
  const full = (item: ListItem) => `${item.kind}${item.provisional}`;
  if (!(from.provisional !== undefined && full(from) in mapping) && !(to.provisional !== undefined && full(to) in mapping)) {
    return undefined;
  }
  const quoted = `cites the range "${range.written}"`;
  const fix = (kind: string, ids: string[]) =>
    `Write each id out as a list on the branch (for example "${plural(kind)}${listed(ids)}"), and merge again.`;
  if (from.provisional === undefined || to.provisional === undefined) {
    return `${quoted}, which runs from a real number to a provisional id, so no allocated number can stand for its end. ${fix(to.kind, [from.provisional ?? from.written, to.provisional ?? to.written])}`;
  }
  const slugOf = (p: string) => p.slice(0, p.lastIndexOf('.'));
  const lo = numberOf(from.provisional);
  const hi = numberOf(to.provisional);
  if (slugOf(from.provisional) !== slugOf(to.provisional) || from.kind !== to.kind || hi <= lo) {
    return `${quoted}, which is not a run of one chunk's ids of one kind, in order. ${fix(to.kind, [from.provisional, to.provisional])}`;
  }
  const ids = Array.from({ length: hi - lo + 1 }, (_, i) => `${slugOf(from.provisional!)}.${lo + i}`);
  const missing = ids.filter((id) => !(`${from.kind}${id}` in mapping));
  if (missing.length) {
    return `${quoted}, but no entry is headed ${listed(missing.map((id) => `${from.kind}${id}`))}. ${fix(from.kind, ids)}`;
  }
  const became = ids.map((id) => numberOf(mapping[`${from.kind}${id}`]));
  if (became.some((n, i) => n !== became[0] + i)) {
    return `${quoted}, but those ids became ${plural(from.kind)}${listed(became.map(String))}, which are not one unbroken run of numbers. ${fix(from.kind, ids)}`;
  }
  return undefined;
}

/**
 * `text` with each provisional id `mapping` allocated replaced by its real number, and every range
 * that cannot be rewritten one to one, left as written. Found on the citable text, spliced into the
 * real one: a quoted id stays as written.
 */
function rewriteCitations(
  path: string,
  text: string,
  mapping: Record<string, string>,
): { text: string; problems: AllocationProblem[] } {
  const { citations, ranges } = provisionalCitations(path, text);
  const problems: AllocationProblem[] = [];
  const kept = new Set<number>();
  for (const range of ranges) {
    const detail = rangeProblem(range, mapping);
    if (detail === undefined) continue;
    const ends = [range.from, range.to].filter((item) => item.provisional !== undefined);
    for (const item of ends) kept.add(item.index);
    problems.push({ path, ids: ends.map((item) => `${item.kind}${item.provisional}`), detail });
  }
  let out = '';
  let from = 0;
  for (const { index, written, id } of citations) {
    if (id === undefined || !(id in mapping) || kept.has(index)) continue;
    out += text.slice(from, index) + numberOf(mapping[id]);
    from = index + written.length;
  }
  return { text: out + text.slice(from), problems };
}

interface AllocationResult {
  /** Every file handed in, with provisional ids replaced by their allocated numbers. */
  files: Record<string, string>;
  /** Each provisional id and the real id it became, e.g. `{ 'Ruling @a.1': 'Ruling 139' }`. */
  mapping: Record<string, string>;
  /** Every range of ids that could not be rewritten one to one, left as written (#446). */
  problems: AllocationProblem[];
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
  if (Object.keys(mapping).length === 0) return { files: { ...files }, mapping, problems: [] };
  const rewritten: Record<string, string> = {};
  const problems: AllocationProblem[] = [];
  for (const [path, text] of Object.entries(files)) {
    const result = rewriteCitations(path, text, mapping);
    rewritten[path] = result.text;
    problems.push(...result.problems);
  }
  return { files: rewritten, mapping, problems };
}
