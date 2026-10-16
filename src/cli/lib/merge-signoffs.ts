import { promises as fs } from 'node:fs';
import { MERGE_SIGNOFFS_MD, designPath } from './project-paths.js';
import type { FocusedVerificationScope } from './authored-tests.js';

/**
 * `design/MERGE-SIGNOFFS.md` (#403): what `boardsmith chunk-merge` vouched for when the merged
 * tree has a source file in a form no designer signed off: two chunks built at the same time both
 * edited it, the merge rewrote its provisional ledger citations to real numbers (#435), or it is a
 * test-runner config edited since a verified chunk signed it off (#479). The
 * merge re-runs the own checks (tests, chunk-check and claim-quote-check) of the chunks whose
 * Build Manifest names it and records each such file here, with its content hash, the chunks it
 * vouched for, and the merge. The sign-off check (`checkSignoff`) then accounts for that file's
 * edit the way it accounts for one a later sign-off saw.
 *
 * Written only by `chunk-merge`, on the main line; a branch that writes it is refused. A merge
 * commit cannot contain its own hash, so an entry names the merge by its two parents, the
 * branch tip and the main line it was merged into.
 */

export interface MergeSignoff {
  /** The source file, project-relative, as the Build Manifests name it. */
  path: string;
  /** SHA-256 of the file as the merge combined it. */
  content: string;
  /** The chunks whose own checks passed on the combined file, sorted. */
  chunks: string[];
  /** `<branch> <branch tip> into <main line commit>`: the merge commit's two parents. */
  merge: string;
  /** When the merge recorded it. */
  when: string;
  /** Historical authored-test evidence, independent of the project's current ticket selection. */
  scope?: FocusedVerificationScope;
}

/** The checks a merge runs for each chunk before it records an entry. */
const MERGE_CHECKS = 'tests, chunk-check, claim-quote-check';

const HEADER = `# Merge Sign-offs

<!-- MACHINE-OWNED. Written by \`boardsmith chunk-merge\` and by nothing else. Each entry is a
     source file the merge changed after its chunks signed it off (two chunks built at the same
     time both edited it, the merge renumbered its ledger citations, or only its vitest test
     collection changed since a chunk signed it off), as the merge left it.
     Each entry records the checks the merge ran on the combined file and any deferred checks.
     The sign-off check accepts that edit for each chunk whose sign-off names the file. -->
`;

function field(body: string, label: string): string | undefined {
  return new RegExp(`^- ${label}:[ \\t]*(.+?)[ \\t]*$`, 'm').exec(body)?.[1];
}

function parseEntry(path: string, body: string): MergeSignoff {
  const content = field(body, 'Content');
  const chunks = field(body, 'Chunks');
  const merge = field(body, 'Merge');
  const when = field(body, 'When');
  if (!content || !chunks || !merge || !when) {
    throw new Error(
      `design/${MERGE_SIGNOFFS_MD}'s entry for ${path} is missing a Content, Chunks, Merge or When ` +
        `line, so what the merge vouched for cannot be read. Restore the file from git; it is ` +
        `written only by \`boardsmith chunk-merge\`.`,
    );
  }
  const scopeLine = field(body, 'Scope');
  let scope: FocusedVerificationScope | undefined;
  if (scopeLine !== undefined) {
    const hash = /^focused ([a-f0-9]{64})$/.exec(scopeLine)?.[1];
    let selection: unknown;
    try { selection = JSON.parse(field(body, 'Selection') ?? 'null'); } catch { selection = undefined; }
    if (!hash || !validSelection(selection, hash)) {
      throw new Error(`design/${MERGE_SIGNOFFS_MD}'s entry for ${path} has invalid focused verification evidence. Restore the file from git; it is written only by \`boardsmith chunk-merge\`.`);
    }
    scope = { kind: 'focused', selection };
  }
  return { path, content, chunks: chunks.split(',').map((c) => c.trim()), merge, when, ...(scope === undefined ? {} : { scope }) };
}

function validSelection(value: unknown, hash: string): value is FocusedVerificationScope['selection'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const selection = value as Record<string, unknown>;
  const path = (value: unknown): value is string => typeof value === 'string' && value !== '' &&
    !value.startsWith('/') && !value.includes('\\') && value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
  return selection.hash === hash && path(selection.path) &&
    typeof selection.ticket === 'string' && /^[\w.-]+\/[\w.-]+#[1-9]\d*$/.test(selection.ticket) &&
    typeof selection.base === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(selection.base) &&
    Array.isArray(selection.tests) && selection.tests.length > 0 && selection.tests.every((test: unknown) => {
      if (!test || typeof test !== 'object' || Array.isArray(test)) return false;
      const entry = test as Record<string, unknown>;
      return path(entry.file) && Array.isArray(entry.names) && entry.names.length > 0 &&
        entry.names.every((name: unknown) => typeof name === 'string' && name.trim() !== '') &&
        new Set(entry.names).size === entry.names.length;
    });
}

/** Every entry, oldest first; `[]` when no merge has recorded one. */
export async function readMergeSignoffs(projectDir: string): Promise<MergeSignoff[]> {
  const text = await fs.readFile(designPath(projectDir, MERGE_SIGNOFFS_MD), 'utf-8').catch(() => undefined);
  if (text === undefined) return [];
  const parts = text.split(/^### (.+?)[ \t]*$/m);
  const entries: MergeSignoff[] = [];
  for (let i = 1; i < parts.length; i += 2) entries.push(parseEntry(parts[i], parts[i + 1] ?? ''));
  return entries;
}

function renderEntry(entry: MergeSignoff): string {
  return [
    `### ${entry.path}`,
    `- Content: ${entry.content}`,
    `- Chunks: ${entry.chunks.join(', ')}`,
    `- Merge: ${entry.merge}`,
    `- When: ${entry.when}`,
    ...(entry.scope === undefined ? [`- Checks: ${MERGE_CHECKS}`] : [
      `- Scope: focused ${entry.scope.selection.hash}`,
      `- Selection: ${JSON.stringify(entry.scope.selection)}`,
      '- Checks: authored tests, chunk-check, claim-quote-check',
      '- Deferred: measurement tests, other chunk tests, full suite and mutation checks',
    ]),
    '',
  ].join('\n');
}

/** The ledger with `entries` appended after whatever it already holds. */
export function appendMergeSignoffs(existing: string | undefined, entries: MergeSignoff[]): string {
  const base = existing?.replace(/^# Merge Sign-offs\n\n<!-- MACHINE-OWNED\.[\s\S]*?-->\n/, HEADER) ?? HEADER;
  return [base.endsWith('\n') ? base : `${base}\n`, ...entries.map(renderEntry)].join('\n');
}
