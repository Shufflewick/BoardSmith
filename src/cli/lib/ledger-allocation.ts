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
 * the files the branch changed. It refuses a branch that added a real number, so the only way a
 * number reaches `main` from a parallel branch is through this allocation.
 */
import { PROVISIONAL_NUMBER, blankComments, entryHeadingPattern, escapeRegExp } from './ledger-entries.js';
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

/** Every provisional id cited anywhere in `text`, of any kind, in order of first appearance. */
export function provisionalReferences(text: string): string[] {
  const kinds = [...new Set(NUMBERED_LEDGER_SPECS.map((s) => `${escapeRegExp(s.kind)}${s.sep}`))];
  const pattern = new RegExp(`\\b(?:${kinds.join('|')})${PROVISIONAL_NUMBER}\\b`, 'g');
  return [...new Set([...text.matchAll(pattern)].map((m) => m[0]))];
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
  const ids = Object.keys(mapping);
  if (ids.length === 0) return { files: { ...files }, mapping };
  const pattern = new RegExp(`\\b(?:${ids.map(escapeRegExp).join('|')})(?!\\.?\\d)`, 'g');
  const rewritten: Record<string, string> = {};
  for (const [path, text] of Object.entries(files)) {
    rewritten[path] = text.replace(pattern, (id) => mapping[id]);
  }
  return { files: rewritten, mapping };
}
