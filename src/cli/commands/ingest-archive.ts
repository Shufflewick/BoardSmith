import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import chalk from 'chalk';

/**
 * `boardsmith ingest-archive <rulebook>` — the deterministic half of ingest Step 3.
 *
 * WHY THIS IS CODE AND NOT SKILL TEXT
 *
 * Archiving a file, hashing it, and emitting four exact header lines are mechanical operations
 * with one correct output. Nine successive attempts to get an ingest session to perform them from
 * skill-text instructions all failed against live runs — reworded instructions, a self-limiting
 * definition, an extracted contract file, a shipped template, a step reorder, a delegated
 * subagent, two re-read gates, and a dispatch handshake. Direct tool-call capture showed why: the
 * session reads its skill files at the start and then executes from recall, reproducing a
 * superseded version of the contract. Instructions placed in the drifting text drift with it.
 *
 * What the same traces showed working reliably, every single run, is Bash. So the mechanical
 * contract moves into a command the session invokes rather than prose it is asked to honour.
 * This function cannot forget a heading or skip a hash.
 *
 * The session still does the judgment work — transcription, term extraction, gap identification —
 * and fills the rows this command scaffolds. See `ingest/transcription-subagent.md`.
 */

export interface IngestArchiveOptions {
  /** Project directory to write into. Defaults to cwd. */
  project?: string;
  /** Edition string. Written verbatim; omitted value produces the explicit not-stated token. */
  edition?: string;
  /** Emit machine-readable JSON instead of human output. */
  json?: boolean;
}

/** The exact strings downstream tooling parses. Changing one is a breaking change. */
export const INDEX_HEADINGS = ['## Open Rules Gaps', '## Slices', '## Term → Slice'] as const;
export const HEADER_LABELS = ['Edition:', 'Source:', 'Source hash:', 'Transcribed:'] as const;
export const EDITION_UNKNOWN = 'not stated in the rulebook';
export const GAPS_EMPTY = '_None._';

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** ISO date (YYYY-MM-DD) in local time — the value written to `Transcribed:`. */
function isoDate(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function renderIndex(params: {
  gameName: string;
  edition: string | undefined;
  archivedPath: string;
  sourceHash: string;
  transcribed: string;
}): string {
  const { gameName, edition, archivedPath, sourceHash, transcribed } = params;
  return `# Rulebook Index — ${gameName}

Edition: ${edition && edition.trim() ? edition.trim() : EDITION_UNKNOWN}
Source: ${archivedPath}
Source hash: ${sourceHash}
Transcribed: ${transcribed}

<!-- The four header lines above are written by \`boardsmith ingest-archive\` and are the
     provenance record a later verify pass reads. Do not edit them by hand.

     The three sections below are scaffolding for this ingest session to FILL. Keep every
     heading exactly as written — downstream tooling parses these strings. Add rows; do not
     rename, reword, reorder, or "improve" the headings. -->

${INDEX_HEADINGS[0]}

<!-- Every \`Named-but-undefined (p.N): <rule name>\` marker the transcription produced, one per
     line, verbatim. Do NOT deduplicate: a rule named in two slices and defined in neither is
     two entries, and that recurrence is signal.

     This section reports what transcription MARKED as named-but-undefined. It does not claim to
     be an exhaustive list of the rulebook's gaps.

     If there are none, leave exactly the token below and delete this comment. -->

${GAPS_EMPTY}

${INDEX_HEADINGS[1]}

| slice | pages | covers |
|-------|-------|--------|

${INDEX_HEADINGS[2]}

| term | slice |
|------|-------|
`;
}

/**
 * `boardsmith ingest-gaps` — fill `## Open Rules Gaps` from the slice files.
 *
 * The section's content is a literal sweep of every `Named-but-undefined (p.N): <rule>` line the
 * transcription wrote. No judgment is involved, so it does not belong in skill text either — a
 * live session left the section empty while the slices carried four markers.
 *
 * This does NOT violate the Context-Economics Hard Rule. That rule stops the *orchestrator*
 * accumulating slice text in its context across a long session; a CLI process reading files costs
 * the session nothing.
 *
 * Entries are NOT deduplicated: a rule named in two slices and defined in neither is two
 * entries, and the recurrence is signal. The harness reconciles the section's entry count against
 * the slice-side marker count, so dedup here would make a working sweep look like a dropping one.
 */
export async function ingestGapsCommand(
  options: { project?: string; json?: boolean } = {},
): Promise<void> {
  const projectDir = resolve(options.project ?? process.cwd());
  const rulebookDir = join(projectDir, 'rulebook');
  const indexPath = join(rulebookDir, 'INDEX.md');

  let index: string;
  try {
    index = await fs.readFile(indexPath, 'utf-8');
  } catch {
    throw new Error(
      `No rulebook/INDEX.md in ${projectDir}.\n` +
        `Run \`boardsmith init <name> --rulebook <path>\` first, or \`boardsmith ingest-archive <path>\` in an existing project.`,
    );
  }

  const entries: string[] = [];
  const names = (await fs.readdir(rulebookDir)).filter(
    (f) => f.endsWith('.md') && f !== 'INDEX.md',
  );
  for (const name of names.sort()) {
    const text = await fs.readFile(join(rulebookDir, name), 'utf-8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('Named-but-undefined')) entries.push(trimmed);
    }
  }

  const heading = INDEX_HEADINGS[0];
  const headingAt = index.indexOf(heading);
  if (headingAt === -1) {
    throw new Error(
      `rulebook/INDEX.md has no "${heading}" heading. It may have been hand-edited — restore it by re-running ingest-archive.`,
    );
  }
  const bodyStart = headingAt + heading.length;
  // The section runs to the next heading, whatever that is.
  const nextHeading = index.indexOf('\n## ', bodyStart);
  const bodyEnd = nextHeading === -1 ? index.length : nextHeading;

  const body = entries.length
    ? `\n\n${entries.join('\n')}\n\nThis section reports what transcription MARKED as named-but-undefined. It does not claim to be\nan exhaustive list of the rulebook's gaps.\n`
    : `\n\n${GAPS_EMPTY}\n`;

  await fs.writeFile(indexPath, index.slice(0, bodyStart) + body + index.slice(bodyEnd));

  if (options.json) {
    console.log(JSON.stringify({ gapsWritten: entries.length, slicesScanned: names.length }, null, 2));
    return;
  }
  console.log(
    chalk.green(
      `✓ Filled ${heading} — ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} from ${names.length} slice${names.length === 1 ? '' : 's'}`,
    ),
  );
}

export async function ingestArchiveCommand(
  rulebook: string,
  options: IngestArchiveOptions = {},
): Promise<void> {
  const projectDir = resolve(options.project ?? process.cwd());
  const sourcePath = resolve(rulebook.replace(/^~(?=$|\/)/, process.env.HOME ?? '~'));

  let sourceBuf: Buffer;
  try {
    sourceBuf = await fs.readFile(sourcePath);
  } catch {
    // A supplied-but-unreadable path must fail loudly. Falling through would produce an INDEX.md
    // with a provenance block describing a file that was never archived.
    throw new Error(
      `Rulebook not found or unreadable: ${sourcePath}\n` +
        `Pass the path to the rulebook file (PDF, images, or text) as the first argument.`,
    );
  }

  const fileName = basename(sourcePath);
  const archiveDir = join(projectDir, 'rulebook', 'source');
  const archivePath = join(archiveDir, fileName);
  const relArchivePath = `rulebook/source/${fileName}`;

  // Never clobber. Ingest does not overwrite a designer's archived source.
  try {
    await fs.access(archivePath);
    const existing = await fs.readFile(archivePath);
    if (sha256(existing) !== sha256(sourceBuf)) {
      throw new Error(
        `An archived rulebook already exists at ${relArchivePath} and differs from the source.\n` +
          `Remove or rename it and re-run, or pass --project to target a different project.`,
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('An archived rulebook')) throw err;
    // Not present — the normal path.
  }

  await fs.mkdir(archiveDir, { recursive: true });
  // Copy, never move: the designer's original stays exactly where it is.
  await fs.writeFile(archivePath, sourceBuf);

  const archivedBuf = await fs.readFile(archivePath);
  const sourceHash = sha256(archivedBuf);
  if (sourceHash !== sha256(sourceBuf)) {
    throw new Error(`Archived copy at ${relArchivePath} does not match the source. Aborting.`);
  }

  const gameName = basename(projectDir);
  const transcribed = isoDate(new Date());
  const indexPath = join(projectDir, 'rulebook', 'INDEX.md');

  let wroteIndex = false;
  try {
    await fs.access(indexPath);
    // INDEX.md already exists — rewrite only the provenance header, leave filled sections alone.
    const existing = await fs.readFile(indexPath, 'utf-8');
    const withHeader = existing
      .replace(/^Edition:.*$/m, `Edition: ${options.edition?.trim() || EDITION_UNKNOWN}`)
      .replace(/^Source:.*$/m, `Source: ${relArchivePath}`)
      .replace(/^Source hash:.*$/m, `Source hash: ${sourceHash}`)
      .replace(/^Transcribed:.*$/m, `Transcribed: ${transcribed}`);
    await fs.writeFile(indexPath, withHeader);
  } catch {
    await fs.mkdir(dirname(indexPath), { recursive: true });
    await fs.writeFile(
      indexPath,
      renderIndex({
        gameName,
        edition: options.edition,
        archivedPath: relArchivePath,
        sourceHash,
        transcribed,
      }),
    );
    wroteIndex = true;
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        { archivedPath: relArchivePath, sourceHash, indexPath: 'rulebook/INDEX.md', wroteIndex },
        null,
        2,
      ),
    );
    return;
  }

  console.log(chalk.green('✓ Archived source rulebook'));
  console.log(`  ${chalk.gray('path:')} ${relArchivePath}`);
  console.log(`  ${chalk.gray('sha256:')} ${sourceHash}`);
  console.log(
    wroteIndex
      ? `  ${chalk.gray('index:')} rulebook/INDEX.md written with provenance header + section scaffolding`
      : `  ${chalk.gray('index:')} rulebook/INDEX.md provenance header updated (existing sections untouched)`,
  );
  console.log();
  console.log(chalk.gray('Fill the scaffolded sections from the transcription summaries.'));
  console.log(chalk.gray('Keep every heading exactly as written — downstream tooling parses them.'));
}
