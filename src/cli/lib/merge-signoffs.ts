import { promises as fs } from 'node:fs';
import { MERGE_SIGNOFFS_MD, designPath } from './project-paths.js';

/**
 * `design/MERGE-SIGNOFFS.md` (#403): what `boardsmith chunk-merge` vouched for when two chunks
 * built at the same time both edited one source file. The combined file is code neither
 * designer signed off, so the merge re-runs both chunks' own checks (their tests, chunk-check and
 * claim-quote-check) on it and records each such file here, with its content hash, the chunks it
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
}

/** The checks a merge runs for each chunk before it records an entry. */
const MERGE_CHECKS = 'tests, chunk-check, claim-quote-check';

const HEADER = `# Merge Sign-offs

<!-- MACHINE-OWNED. Written by \`boardsmith chunk-merge\` and by nothing else. Each entry is a
     source file that two chunks built at the same time both edited, as the merge combined it.
     The merge re-ran every named chunk's own checks on the combined file and they passed, so the
     sign-off check accepts that edit for each chunk whose sign-off names the file. -->
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
  return { path, content, chunks: chunks.split(',').map((c) => c.trim()), merge, when };
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
    `- Checks: ${MERGE_CHECKS}`,
    '',
  ].join('\n');
}

/** The ledger with `entries` appended after whatever it already holds. */
export function appendMergeSignoffs(existing: string | undefined, entries: MergeSignoff[]): string {
  const base = existing ?? HEADER;
  return [base.endsWith('\n') ? base : `${base}\n`, ...entries.map(renderEntry)].join('\n');
}
