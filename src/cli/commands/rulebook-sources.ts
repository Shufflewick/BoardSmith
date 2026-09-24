import { designRulebookDir } from '../lib/project-paths.js';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import chalk from 'chalk';

/**
 * Which documents a project's rules come from, and which one each slice was transcribed from.
 *
 * `rulebook/INDEX.md` records the documents: the primary in its `Source:`/`Source hash:` header,
 * any others in the machine-owned `## Additional Sources` table (#305). Each slice records its own
 * document in a `Source: rulebook/source/<file>` line directly under its title (#311), written by
 * the transcription contract (`ingest/transcription-subagent.md`). The slice's `p.N` citations are
 * pages of THAT document, so a companion's `p.3` and the rulebook's `p.3` never mean the same page.
 *
 * With both records, the verify pass narrows to the document that moved: a chunk whose slices all
 * came from an unchanged document keeps its full scope when a companion changes, a verify run
 * re-transcribes every archived document (`verify-run-init`'s per-source manifest), and live and
 * staged slices are paired only within one document.
 */

/**
 * `## Additional Sources` — a project with more than one source document (doom-machine:
 * `rules.pdf` + `cards.pdf`) records each further document here with its own SHA-256.
 *
 * DELIBERATELY A SEPARATE SECTION, NEVER A SECOND `Source:`/`Source hash:` PAIR: the header's
 * labels are the PRIMARY provenance record `computeVerificationScope()` reads (its regexes match
 * the FIRST `^Source:`/`^Source hash:` line). A distinct section leaves every single-source
 * project's `INDEX.md` byte output untouched — it is present ONLY when a project genuinely has
 * more than one source.
 */
export const ADDITIONAL_SOURCES_HEADING = '## Additional Sources';
export const ADDITIONAL_SOURCES_BEGIN = '<!-- boardsmith:additional-sources:begin -->';
export const ADDITIONAL_SOURCES_END = '<!-- boardsmith:additional-sources:end -->';

export interface AdditionalSourceRecord {
  /** Relative to the design directory, e.g. `rulebook/source/cards.pdf`. */
  path: string;
  sourceHash: string;
}

/**
 * Parses the `## Additional Sources` table, if present. Pure — never touches disk. Returns `[]`
 * when the section is absent: an absent machine-owned section is "nothing recorded yet", not an
 * error.
 */
export function parseAdditionalSources(indexText: string): AdditionalSourceRecord[] {
  const begin = indexText.indexOf(ADDITIONAL_SOURCES_BEGIN);
  const end = indexText.indexOf(ADDITIONAL_SOURCES_END);
  if (begin === -1 || end === -1 || end < begin) return [];
  const body = indexText.slice(begin + ADDITIONAL_SOURCES_BEGIN.length, end);
  const records: AdditionalSourceRecord[] = [];
  for (const row of body.matchAll(/^\|\s*([^|]+?)\s*\|\s*([0-9a-f]{64})\s*\|\s*$/gm)) {
    records.push({ path: row[1].trim(), sourceHash: row[2].trim() });
  }
  return records;
}

/** Every archived document lives here, relative to the design directory. */
const ARCHIVE_PREFIX = 'rulebook/source/';

/**
 * Every archived document `INDEX.md` records: the primary `Source:` first, then each
 * `## Additional Sources` row. `[]` for a project with nothing archived — the interview path
 * (`Source: not applicable — ...`) or a pre-provenance project — where no slice has a document to
 * name.
 */
export function recordedSourcePaths(indexText: string): string[] {
  const primary = /^Source:\s*(.*)$/m.exec(indexText)?.[1].trim();
  const paths = primary?.startsWith(ARCHIVE_PREFIX) ? [primary] : [];
  for (const row of parseAdditionalSources(indexText)) paths.push(row.path);
  return paths;
}

/** Files in `rulebook/` that are not a slice of one document, so carry no `Source:` line. */
export const NON_SLICE_FILES = Object.freeze(['INDEX.md', '00-visual-survey.md']);

const SLICE_SOURCE_LINE_RE = /^Source:[ \t]+(\S.*?)[ \t]*$/;

/** Index of the line a slice's `Source:` line belongs on: after its `# ` title, if it has one. */
function sourceLineIndex(lines: string[]): number {
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i < lines.length && lines[i].startsWith('# ')) {
    i++;
    while (i < lines.length && lines[i].trim() === '') i++;
  }
  return i;
}

/**
 * The document a slice records it was transcribed from: its `Source: rulebook/source/<file>` line,
 * which is the first line under the slice's `# ` title (or its first line, with no title).
 * `undefined` when the slice records none. A `Source:` line anywhere else is slice content, not
 * the record, so a quoted sentence that happens to start with "Source:" is never read as one.
 */
export function parseSliceSource(sliceText: string): string | undefined {
  const lines = sliceText.split(/\r?\n/);
  return SLICE_SOURCE_LINE_RE.exec(lines[sourceLineIndex(lines)] ?? '')?.[1];
}

/** `sliceText` with its `Source:` line set to `source`: replaced if present, inserted if not. */
export function withSliceSource(sliceText: string, source: string): string {
  const lines = sliceText.split('\n');
  const at = sourceLineIndex(lines);
  const line = `Source: ${source}`;
  if (SLICE_SOURCE_LINE_RE.test((lines[at] ?? '').replace(/\r$/, ''))) {
    lines[at] = line;
  } else if (at > 0 && lines[0].startsWith('# ')) {
    // Directly under the title, separated from the body by a blank line.
    lines.splice(1, at - 1, '', line, '');
  } else {
    lines.splice(0, 0, line, '');
  }
  return lines.join('\n');
}

/**
 * The documents a slice may have been transcribed from. A slice that names its document came from
 * that one. A slice that names none (written before #311, or not a slice of one document, like
 * `00-visual-survey.md`) may have come from any recorded document, so every one of them applies —
 * which is exactly the whole-project answer the verify pass gave before slices recorded a source.
 */
export function sliceDocuments(sliceSource: string | undefined, recorded: readonly string[]): string[] {
  return sliceSource ? [sliceSource] : [...recorded];
}

/**
 * Each slice in `rulebook/` and the document it records, keyed by file name (`01-setup.md`).
 * `NON_SLICE_FILES` are left out. Empty when the project has no `rulebook/`.
 */
export async function readSliceSources(projectDir: string): Promise<Map<string, string | undefined>> {
  const rulebookDir = designRulebookDir(resolve(projectDir));
  let names: string[];
  try {
    names = (await fs.readdir(rulebookDir, { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.endsWith('.md') && !NON_SLICE_FILES.includes(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    return new Map();
  }
  const sources = new Map<string, string | undefined>();
  for (const name of names) {
    sources.set(name, parseSliceSource(await fs.readFile(join(rulebookDir, name), 'utf-8')));
  }
  return sources;
}

/** The documents `rulebook/INDEX.md` records; `[]` when there is no INDEX.md. */
export async function readRecordedSourcePaths(projectDir: string): Promise<string[]> {
  try {
    return recordedSourcePaths(
      await fs.readFile(join(designRulebookDir(resolve(projectDir)), 'INDEX.md'), 'utf-8'),
    );
  } catch {
    return [];
  }
}

interface SliceSourceCheck {
  /** The documents `INDEX.md` records. */
  recorded: string[];
  /** Slices with no `Source:` line. */
  unattributed: string[];
  /** Slices whose `Source:` line names a document `INDEX.md` does not record. */
  unrecorded: Array<{ slice: string; source: string }>;
}

/**
 * Checks that every slice names the document it came from, and that the document is one
 * `INDEX.md` records. A project with nothing archived (the interview path) has no document to
 * name, so nothing is checked there.
 */
export async function checkSliceSources(projectDir: string): Promise<SliceSourceCheck> {
  const recorded = await readRecordedSourcePaths(projectDir);
  const result: SliceSourceCheck = { recorded, unattributed: [], unrecorded: [] };
  if (recorded.length === 0) return result;
  for (const [slice, source] of await readSliceSources(projectDir)) {
    if (!source) result.unattributed.push(slice);
    else if (!recorded.includes(source)) result.unrecorded.push({ slice, source });
  }
  return result;
}

/** Human-readable lines explaining a failed `checkSliceSources`, with the command that fixes it. */
export function describeSliceSourceProblems(check: SliceSourceCheck): string[] {
  const lines: string[] = [];
  const documents = check.recorded.join(', ');
  if (check.unattributed.length > 0) {
    lines.push(
      `${check.unattributed.length} slice${check.unattributed.length === 1 ? ' does' : 's do'} not say which document ${check.unattributed.length === 1 ? 'it was' : 'they were'} transcribed from:`,
      ...check.unattributed.map((s) => `  rulebook/${s}`),
    );
  }
  if (check.unrecorded.length > 0) {
    lines.push(
      `${check.unrecorded.length} slice${check.unrecorded.length === 1 ? ' names' : 's name'} a document rulebook/INDEX.md does not record:`,
      ...check.unrecorded.map((u) => `  rulebook/${u.slice} → ${u.source}`),
    );
  }
  lines.push(
    `A slice's first line under its title must be "Source: <document>", naming one of: ${documents}.`,
    `Its p.N citations are pages of that document. Record the document with:`,
    check.recorded.length === 1
      ? `  npx boardsmith ingest-slice-source ${check.recorded[0]} ${[...check.unattributed, ...check.unrecorded.map((u) => u.slice)].join(' ')}`
      : `  npx boardsmith ingest-slice-source <document> <slice...>   (once per document)`,
  );
  return lines;
}

/**
 * `boardsmith ingest-slice-source <document> <slices...>` — records, in each named slice, the
 * document it was transcribed from. The document must be one `rulebook/INDEX.md` records, so a
 * slice can never name a file the verify pass does not check. Rewrites only the `Source:` line;
 * the slice's content is untouched.
 *
 * This is how a project transcribed before #311 adopts per-slice sources. Deciding which document
 * a slice came from is the designer's call, not something this command guesses.
 */
export async function ingestSliceSourceCommand(
  document: string,
  slices: string[],
  options: { project?: string; json?: boolean } = {},
): Promise<{ document: string; written: string[]; unchanged: string[] }> {
  const projectDir = resolve(options.project ?? process.cwd());
  await assertRecordedDocument(projectDir, document);
  const texts = await readNamedSlices(projectDir, slices);

  const rulebookDir = designRulebookDir(projectDir);
  const written: string[] = [];
  const unchanged: string[] = [];
  for (const [name, text] of texts) {
    const updated = withSliceSource(text, document);
    if (updated === text) {
      unchanged.push(name);
      continue;
    }
    await fs.writeFile(join(rulebookDir, name), updated);
    written.push(name);
  }

  const result = { document, written, unchanged };
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(chalk.green(`✓ ${written.length} slice${written.length === 1 ? ' now names' : 's now name'} ${document}`));
    if (unchanged.length > 0) console.log(chalk.gray(`  already recorded: ${unchanged.join(', ')}`));
  }
  return result;
}

/** Throws unless `document` is one `rulebook/INDEX.md` records, listing the ones it does. */
async function assertRecordedDocument(projectDir: string, document: string): Promise<void> {
  const recorded = await readRecordedSourcePaths(projectDir);
  if (recorded.includes(document)) return;
  throw new Error(
    `"${document}" is not a document rulebook/INDEX.md records.\n` +
      (recorded.length > 0
        ? `Recorded documents: ${recorded.join(', ')}.\n`
        : `This project records no archived document, so its slices have none to name.\n`) +
      `Archive a further document first with \`npx boardsmith ingest-archive <rulebook> --additional-source <path>\`.`,
  );
}

/**
 * Each named slice's text, keyed by file name. Reads every one before anything is written, so a
 * wrong name leaves every slice untouched. Accepts `01-setup.md` or `rulebook/01-setup.md`.
 */
async function readNamedSlices(projectDir: string, slices: string[]): Promise<Map<string, string>> {
  if (slices.length === 0) {
    throw new Error('Name at least one slice, e.g. `npx boardsmith ingest-slice-source <document> 01-setup.md`.');
  }
  const rulebookDir = designRulebookDir(projectDir);
  const texts = new Map<string, string>();
  for (const raw of slices) {
    const name = raw.startsWith('rulebook/') ? raw.slice('rulebook/'.length) : raw;
    if (name.includes('/') || !name.endsWith('.md') || NON_SLICE_FILES.includes(name)) {
      throw new Error(
        `"${raw}" is not a slice. Name a slice file in rulebook/, e.g. 01-setup.md ` +
          `(${NON_SLICE_FILES.join(' and ')} are not slices of one document).`,
      );
    }
    try {
      texts.set(name, await fs.readFile(join(rulebookDir, name), 'utf-8'));
    } catch {
      throw new Error(`No slice rulebook/${name} in ${projectDir}. Nothing was written.`);
    }
  }
  return texts;
}
