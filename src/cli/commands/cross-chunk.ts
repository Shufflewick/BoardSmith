/**
 * References between chunks built at the same time (#294), and the ledger the audit rules on.
 *
 * A chunk built on its own branch never saw what the main line gained while it was away. In
 * sotf, auctions and quests referenced venues that world evolution could destroy, and the three
 * were built at once. No check can decide whether two such pieces of code conflict, but code can
 * list every place they meet, so a reviewer looks at each one instead of hoping to notice it:
 *
 *   - every source file both sides changed;
 *   - every name both sides' changed lines touch, when one side defines it (a declaration, a
 *     property or key) or quotes it as an id (a string literal). Names nobody defines, like
 *     keywords, parameters and property reads, are left out: they are noise, not references.
 *
 * Changed lines include removed ones, since destroying something is how a reference breaks.
 * Tests and design documents are left out; they describe the code rather than being it.
 *
 * `boardsmith chunk-merge` writes each merge's list to `design/CROSS-CHUNK.md` with
 * `- Verdict: pending`, and `boardsmith ledger-check` fails while any verdict is pending, so the
 * next close and the next merge both stop until the audit's cross-chunk lens has ruled.
 */

const SOURCE_EXTENSIONS = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|vue|json)$/;
const NOT_SOURCE = /(?:^|\/)(?:design|tests?|__tests__|node_modules|dist)\/|\.(?:test|spec)\.[a-z]+$|(?:^|\/)package(?:-lock)?\.json$/;

const KEYWORDS = new Set(
  (
    'abstract any as async await boolean break case catch class const continue debugger declare default delete do ' +
    'else enum export extends false finally for from function get if implements import in instanceof interface ' +
    'keyof let module namespace never new null number object of private protected public readonly require return ' +
    'satisfies set static string super switch symbol this throw true try type typeof undefined unknown var void ' +
    'while with yield'
  ).split(' '),
);

const IDENTIFIER = /[A-Za-z_$][\w$]*/g;
const DECLARATION = /\b(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
const KEY = /^\s*(?:(?:public|private|protected|readonly|static)\s+)*["']?([A-Za-z_$][\w$-]*)["']?\s*[?!]?\s*[:=](?!=)/;
const LITERAL = /(['"`])([A-Za-z][\w-]{2,})\1/g;

/** What one side of a merge changed in source: files, and every name its changed lines touch. */
interface ChangedSide {
  files: Set<string>;
  /** Each name its changed lines mention, with the files it was mentioned in. */
  names: Map<string, Set<string>>;
  /** Names its changed lines define or quote as an id. */
  defined: Set<string>;
}

function isSource(path: string): boolean {
  return SOURCE_EXTENSIONS.test(path) && !NOT_SOURCE.test(path);
}

function recordLine(side: ChangedSide, file: string, line: string): void {
  for (const [name] of line.matchAll(IDENTIFIER)) {
    if (name.length < 3 || KEYWORDS.has(name)) continue;
    const files = side.names.get(name) ?? new Set<string>();
    files.add(file);
    side.names.set(name, files);
  }
  for (const m of line.matchAll(DECLARATION)) side.defined.add(m[1]);
  for (const m of line.matchAll(LITERAL)) side.defined.add(m[2]);
  const key = KEY.exec(line)?.[1];
  if (key) side.defined.add(key);
}

/** The file a `diff --git` header line names, when that file is source; undefined otherwise. */
function sourceFileOf(header: RegExpExecArray): string | undefined {
  return isSource(header[2]) ? header[2] : undefined;
}

/** A diff body line that adds or removes content, as opposed to a `+++`/`---` file header. */
function changedContent(line: string): string | undefined {
  if (line.startsWith('+++') || line.startsWith('---')) return undefined;
  return line.startsWith('+') || line.startsWith('-') ? line.slice(1) : undefined;
}

/** Reads `git diff --unified=0` output into what it changed in source files. */
export function changedSide(diff: string): ChangedSide {
  const side: ChangedSide = { files: new Set(), names: new Map(), defined: new Set() };
  let file: string | undefined;
  for (const line of diff.split('\n')) {
    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (header) {
      file = sourceFileOf(header);
      if (file) side.files.add(file);
      continue;
    }
    const content = file === undefined ? undefined : changedContent(line);
    if (file !== undefined && content !== undefined) recordLine(side, file, content);
  }
  return side;
}

interface SharedName {
  name: string;
  branchFiles: string[];
  mainFiles: string[];
}

interface CrossReferences {
  sharedFiles: string[];
  sharedNames: SharedName[];
}

/** Where the branch's changes and the main line's changes since the branch started meet. */
export function crossReferences(branch: ChangedSide, main: ChangedSide): CrossReferences {
  const sharedFiles = [...branch.files].filter((f) => main.files.has(f)).sort();
  const sharedNames = [...branch.names.keys()]
    .filter((name) => main.names.has(name) && (branch.defined.has(name) || main.defined.has(name)))
    .sort()
    .map((name) => ({
      name,
      branchFiles: [...(branch.names.get(name) as Set<string>)].sort(),
      mainFiles: [...(main.names.get(name) as Set<string>)].sort(),
    }));
  return { sharedFiles, sharedNames };
}

// ---------------------------------------------------------------------------------------------
// design/CROSS-CHUNK.md
// ---------------------------------------------------------------------------------------------

const HEADER = `# Cross-Chunk References

<!-- Written by \`boardsmith chunk-merge\` (#294), one entry per merge of a chunk that was built
     at the same time as other chunks. Each entry lists every place the merged chunk's changes
     meet what the main line gained while it was being built. The audit's cross-chunk lens
     (build/audit.md) reads the combined code at each one and replaces "pending" with a verdict:
       - Verdict: no conflict: <why these references are safe>
       - Verdict: conflict: <slug> reopened, <what breaks>   (after \`boardsmith chunk-reopen <slug>\`)
     \`boardsmith ledger-check\` fails while any verdict is pending, so no chunk closes and no
     further merge lands until every entry is ruled on. -->
`;

const NOTHING_SHARED = 'no conflict: nothing is shared between these chunks\' changes';

function renderRefs(refs: CrossReferences): string[] {
  const files = refs.sharedFiles.length ? refs.sharedFiles.map((f) => `  - ${f}`) : ['  - none'];
  const names = refs.sharedNames.length
    ? refs.sharedNames.map(
        (n) => `  - \`${n.name}\`: this chunk in ${n.branchFiles.join(', ')}; alongside in ${n.mainFiles.join(', ')}`,
      )
    : ['  - none'];
  return ['- Shared files:', ...files, '- Shared names:', ...names];
}

/** `text` (or a new ledger) with one more `### Merge N` entry for `chunk`, pending review. */
export function appendCrossChunkEntry(
  text: string | undefined,
  entry: { chunk: string; alongside: string[]; refs: CrossReferences },
): string {
  const base = text ?? HEADER;
  const numbers = [...base.matchAll(/^### Merge (\d+)[ \t]*$/gm)].map((m) => Number(m[1]));
  const n = Math.max(0, ...numbers) + 1;
  const shared = entry.refs.sharedFiles.length + entry.refs.sharedNames.length > 0;
  const lines = [
    `### Merge ${n}`,
    `- Chunk: ${entry.chunk}`,
    `- Built alongside: ${entry.alongside.join(', ')}`,
    ...renderRefs(entry.refs),
    `- Verdict: ${shared ? 'pending' : NOTHING_SHARED}`,
  ];
  return `${base.replace(/\s*$/, '\n')}\n${lines.join('\n')}\n`;
}

function verdictProblem(n: string, verdict: string | undefined, chunks: readonly string[]): string | undefined {
  const fix =
    'Run the audit\'s cross-chunk lens (build/audit.md) on the combined code and write its ruling as ' +
    '"- Verdict: no conflict: <why>" or, after `boardsmith chunk-reopen <slug>`, ' +
    '"- Verdict: conflict: <slug> reopened, <what breaks>".';
  if (verdict === undefined || verdict === 'pending') {
    return `Merge ${n} has references between chunks built at the same time that have not been reviewed. ${fix}`;
  }
  if (/^no conflict:\s*\S/.test(verdict)) return undefined;
  const conflict = /^conflict:\s*([A-Za-z0-9_-]+) reopened,\s*\S/.exec(verdict);
  if (!conflict) return `Merge ${n} has the verdict "${verdict}", which is not a ruling. ${fix}`;
  if (!chunks.includes(conflict[1])) {
    return `Merge ${n} says ${conflict[1]} was reopened, but there is no chunk ${conflict[1]}. Name the chunk that was reopened.`;
  }
  return undefined;
}

/** Every entry whose verdict is pending or is not a ruling. `chunks` is every chunk slug. */
export function checkCrossChunkLedger(
  text: string,
  chunks: readonly string[],
): Array<{ entry: string; detail: string }> {
  const visible = text.replace(/<!--[\s\S]*?-->/g, '');
  const entries = [...visible.matchAll(/^### Merge (\d+)[ \t]*$/gm)];
  return entries.flatMap((m, i) => {
    const body = visible.slice(m.index, i + 1 < entries.length ? entries[i + 1].index : visible.length);
    const verdict = /^- Verdict:[ \t]*(.*)$/m.exec(body)?.[1].trim();
    const problem = verdictProblem(m[1], verdict, chunks);
    return problem ? [{ entry: `Merge ${m[1]}`, detail: problem }] : [];
  });
}
