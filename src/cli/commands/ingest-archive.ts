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

/**
 * Lowercase phrases that mean "no edition was stated" — matched case-insensitively as a
 * substring of a caller-supplied `--edition` value. Found via the 2026-07-28 human gate
 * (`170-PROOF-RUN-2.md`, finding F-1): a free-text paraphrase (`none stated in the rulebook`)
 * displaced the machine-checkable `EDITION_UNKNOWN` sentinel within a single ingest run, and
 * Phase 171's PROV-01/PROV-03 both read this field — it must be machine-checkable before
 * anything reads it. Live in real project data: `seven` and `one-two-punch` both carry
 * non-canonical `Edition:` free text right now (171-CONTEXT.md decision 5).
 *
 * Deliberately ABSENT: the bare word `edition` and the bare word `unknown`. Both would fire on
 * legitimate editions — "First edition", "Unknown Armies 2nd printing" — and a check that fires
 * on correct work gets waived (the same rationale that shapes the presentation lexicon below).
 */
export const EDITION_EMPTY_LEXICON = Object.freeze([
  'not stated',
  'none stated',
  'no edition',
  'not specified',
  'unspecified',
  'none given',
  'unknown edition',
  'n/a',
]);

/**
 * The un-parsed field CONTEXT.md decision 2 calls for: "any human note goes in a separate
 * adjacent field that nothing parses." Deliberately NOT added to `HEADER_LABELS` — that tuple is
 * the parsed-header contract pinned by tests and by `scripts/ingest-harness/check.mjs`.
 */
export const EDITION_NOTE_LABEL = 'Edition note:';

/**
 * `--edition` normalization for finding F-1 (`170-PROOF-RUN-2.md`, 2026-07-28 human gate): a
 * free-text paraphrase ("none stated in the rulebook") displaced the machine-checkable
 * `EDITION_UNKNOWN` sentinel within a single ingest run, and Phase 171's PROV-01/PROV-03 both
 * read this field. Recognisably-empty free text collapses to the sentinel; a genuine edition
 * string is preserved verbatim (trimmed). Nothing else is transformed.
 */
export function normalizeEdition(raw: string | undefined): string {
  const trimmed = raw?.trim();
  if (!trimmed) return EDITION_UNKNOWN;
  const lower = trimmed.toLowerCase();
  if (EDITION_EMPTY_LEXICON.some((phrase) => lower.includes(phrase))) return EDITION_UNKNOWN;
  return trimmed;
}

/**
 * Fences delimiting the machine-owned body of `## Open Rules Gaps`.
 *
 * The section is written by `boardsmith ingest-gaps` and by nothing else. It is fenced rather
 * than merely documented because the 2026-07-28 human gate (`170-PROOF-RUN-2.md`) found an
 * ingest orchestrator that filled the section by hand with 2 entries while its own slices
 * carried 5 markers — a section that is wrong while looking entirely healthy. Prose could not
 * stop that; a fence makes hand-authoring detectable, and `ingest-check` makes it fatal.
 */
export const GAPS_BEGIN = '<!-- boardsmith:gaps:begin -->';
export const GAPS_END = '<!-- boardsmith:gaps:end -->';

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
  const normalizedEdition = normalizeEdition(edition);
  const originalEdition = edition?.trim();
  const editionNoteLine =
    originalEdition && normalizedEdition === EDITION_UNKNOWN && originalEdition !== EDITION_UNKNOWN
      ? `\n${EDITION_NOTE_LABEL} ${originalEdition}`
      : '';
  return `# Rulebook Index — ${gameName}

Edition: ${normalizedEdition}${editionNoteLine}
Source: ${archivedPath}
Source hash: ${sourceHash}
Transcribed: ${transcribed}

<!-- The four header lines above are written by \`boardsmith ingest-archive\` and are the
     provenance record a later verify pass reads. Do not edit them by hand.

     The two TABLE sections below are scaffolding for this ingest session to FILL. Keep every
     heading exactly as written — downstream tooling parses these strings. Add rows; do not
     rename, reword, reorder, or "improve" the headings.

     "## Open Rules Gaps" is NOT yours to fill — see the fence inside it. -->

${INDEX_HEADINGS[0]}

<!-- MACHINE-OWNED. Do not write between the fences below, and do not move or delete them.

     \`boardsmith ingest-gaps\` fills this section by sweeping every
     \`Named-but-undefined (p.N): <rule name>\` marker out of the slice files. It runs
     automatically from the pre-commit hook \`boardsmith init\` installs, and from
     \`boardsmith ingest-check\`. Anything you write here is overwritten on the next run.

     Why this is fenced rather than requested politely: on 2026-07-28 an ingest session filled
     this section by hand with 2 entries while its own slices carried 5 markers. Three real gaps
     vanished, and the result looked perfectly healthy — both entries were correctly worded. A
     hand-authored section cannot be distinguished from a swept one by reading it, so it is made
     structurally impossible instead. \`boardsmith ingest-check\` fails if the fences are gone.

     Do NOT deduplicate these entries anywhere downstream, and note that the sweep does not
     either: a rule named in two slices and defined in neither is two entries, and that
     recurrence is signal.

     This section reports what transcription MARKED as named-but-undefined. It does not claim to
     be an exhaustive list of the rulebook's gaps. -->

${GAPS_BEGIN}
${GAPS_EMPTY}
${GAPS_END}

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
  options: { project?: string; json?: boolean; skipRelabel?: boolean; quiet?: boolean } = {},
): Promise<{ gapsWritten: number; slicesScanned: number; changed: boolean }> {
  const projectDir = resolve(options.project ?? process.cwd());

  // Relabel FIRST, as part of this command rather than as a second one the session must
  // remember. Both were separate commands for one run: the archive landed (it is forced by an
  // init flag) and the gaps sweep landed, but `ingest-relabel` was simply never invoked --
  // the same way every other newly-introduced step in this pipeline has been skipped. Reducing
  // synthesis to a single command removes the thing that gets forgotten.
  //
  // Ordering matters: relabelling moves presentation lines off the Derived prefix, and the gaps
  // sweep below reads final slice content.
  let relabelled = 0;
  if (!options.skipRelabel) {
    relabelled = (
      await ingestRelabelCommand({ project: projectDir, json: false, quiet: options.quiet })
    ).relabelled;
  }
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
  if (index.indexOf(heading) === -1) {
    throw new Error(
      `rulebook/INDEX.md has no "${heading}" heading. It may have been hand-edited — restore it by re-running ingest-archive.`,
    );
  }

  // Write strictly between the machine-owned fences. Replacing "heading to next heading" was the
  // old behaviour and it silently tolerated a hand-authored section: whatever the orchestrator
  // wrote simply got overwritten on the next run, so nothing ever reported that it had happened.
  // Bounding the write to the fences means their absence is a hard, nameable error instead.
  const begin = index.indexOf(GAPS_BEGIN);
  const end = index.indexOf(GAPS_END);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(
      `rulebook/INDEX.md's "${heading}" section is missing its machine-owned fences.\n` +
        `Expected ${GAPS_BEGIN} ... ${GAPS_END}.\n` +
        `This section is written by \`boardsmith ingest-gaps\`, never by hand. Restore the fences by\n` +
        `re-running \`boardsmith ingest-archive <rulebook>\`, then re-run this command.`,
    );
  }

  const before = index.slice(begin + GAPS_BEGIN.length, end);
  const body = entries.length
    ? `\n${entries.join('\n')}\n`
    : `\n${GAPS_EMPTY}\n`;
  const changed = before !== body || relabelled > 0;

  await fs.writeFile(
    indexPath,
    index.slice(0, begin + GAPS_BEGIN.length) + body + index.slice(end),
  );

  const result = { gapsWritten: entries.length, slicesScanned: names.length, changed };
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
  if (!options.quiet) {
    console.log(
      chalk.green(
        `✓ Filled ${heading} — ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} from ${names.length} slice${names.length === 1 ? '' : 's'}`,
      ),
    );
  }
  return result;
}

/**
 * Presentation-only vocabulary: terms describing how a page LOOKS, which cannot carry a
 * statement about legality, scoring, or sequencing.
 *
 * MUST stay in sync with PRESENTATION_LEXICON in scripts/ingest-harness/check.mjs — a test pins
 * the two together. Referential terms ('depicted', 'illustration', 'shown') are deliberately
 * ABSENT: a rule inferred from a diagram legitimately mentions the diagram, and that is the
 * contract's own canonical Derived example. Flagging those produced false positives on real
 * output, and a check that fires on correct work gets waived.
 */
export const PRESENTATION_LEXICON = Object.freeze([
  'sans-serif',
  'serif',
  'typograph',
  'full-bleed',
  'palette',
  'wordmark',
  'italic',
  'font',
  'aspect ratio',
  'iconograph',
  'art style',
  'rotated',
  'bold white',
  // Added 2026-07-28 after the human gate (170-PROOF-RUN-2.md item (i)). The list above is
  // typography- and layout-weighted and let a whole-line card-art description through:
  //   "Card art depicted on this page uses flat, fully saturated color fields — red, green,
  //    blue, purple, and black — with a large white numeral centered on the face, small white
  //    pip-like dots along the card edges, and slightly rounded corners."
  // Terms below describe how a component is RENDERED and cannot carry legality, scoring, or
  // sequencing. Deliberately NOT added, despite appearing in that line: 'numeral', 'pip',
  // 'card face'. Each of those can legitimately name a rule-bearing property ("cards match on
  // the numeral", "count the pips"), and a check that fires on correct work gets waived.
  'card art',
  'color field',
  'colour field',
  'flat color',
  'flat colour',
  'saturated',
  'rounded corner',
  'background fill',
]);

/**
 * `boardsmith ingest-relabel` — move presentation descriptions off the `Derived (p.N):` prefix.
 *
 * INGEST-02 exists because rule-bearing inferences must be separable from presentation notes.
 * Twelve mechanisms were tried to get transcription to make that split at write time and the
 * live output is unchanged every run: zero `Visual (p.N):` lines, with layout, typography and
 * wordmark descriptions filed under `Derived (p.N):`, often beneath an invented
 * `## Visual notes` heading that appears in no skill file.
 *
 * Classification is genuine judgment and cannot be a command in general. But the unambiguous
 * cases are exactly what the harness's `derived-purity` heuristic already detects, so the same
 * signal can drive the correction: a `Derived (p.N):` line containing presentation-only
 * vocabulary is relabelled `Visual (p.N):`. Nothing is deleted and no text is rewritten — only
 * the prefix changes, which is the marker the contract cares about.
 *
 * Lines that need human judgment are left alone and reported, not guessed at.
 */
export async function ingestRelabelCommand(
  options: { project?: string; json?: boolean; dryRun?: boolean; quiet?: boolean } = {},
): Promise<{ relabelled: number; changes: Array<{ file: string; line: number; matched: string }> }> {
  const projectDir = resolve(options.project ?? process.cwd());
  const dir = join(projectDir, 'rulebook');
  const lexicon = new RegExp(`(${PRESENTATION_LEXICON.join('|')})`, 'i');

  let names: string[];
  try {
    names = (await fs.readdir(dir)).filter(
      // 00-visual-survey.md is presentation by design — it has no Derived lines to relabel.
      (f) => f.endsWith('.md') && f !== 'INDEX.md' && f !== '00-visual-survey.md',
    );
  } catch {
    throw new Error(`No rulebook/ directory in ${projectDir}. Run transcription first.`);
  }

  const changed: Array<{ file: string; line: number; matched: string }> = [];

  for (const name of names.sort()) {
    const full = join(dir, name);
    const lines = (await fs.readFile(full, 'utf-8')).split('\n');
    let touched = false;

    for (let i = 0; i < lines.length; i++) {
      const m = /^(\s*)Derived (\(p\.[^)]*\)):(.*)$/.exec(lines[i]);
      if (!m) continue;
      const hit = lexicon.exec(m[3]);
      if (!hit) continue;
      lines[i] = `${m[1]}Visual ${m[2]}:${m[3]}`;
      changed.push({ file: name, line: i + 1, matched: hit[1] });
      touched = true;
    }

    if (touched && !options.dryRun) await fs.writeFile(full, lines.join('\n'));
  }

  const result = { relabelled: changed.length, changes: changed };
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
  if (options.quiet) return result;
  if (!changed.length) {
    console.log(chalk.green('✓ No Derived (p. line carries presentation-only vocabulary'));
    return result;
  }
  console.log(
    chalk.green(
      `✓ Relabelled ${changed.length} line${changed.length === 1 ? '' : 's'} Derived → Visual${options.dryRun ? ' (dry run — nothing written)' : ''}`,
    ),
  );
  for (const c of changed) {
    console.log(`  ${chalk.gray(`${c.file}:${c.line}`)} matched "${c.matched}"`);
  }
  return result;
}

/**
 * `boardsmith ingest-check` — repair ingest synthesis, and FAIL if repair was needed.
 *
 * The gap this closes: `boardsmith init` installs a pre-commit hook that runs synthesis, and the
 * bs- build protocol commits at every chunk step — but `/bs-ingest-rules` itself never commits.
 * The 2026-07-28 human gate found the hook had therefore never run at the end of a real ingest:
 * `## Open Rules Gaps` held 2 of 5 gaps, and not one `Derived (p.N):` line had been separated
 * from presentation. `/bs-build-chunk` reads `rulebook/INDEX.md` during investigate, before it
 * commits anything, so chunk 1 gets planned against that broken index.
 *
 * It repairs first and fails second, on purpose. A check that only reports leaves the caller to
 * remember a follow-up command, and this pipeline's entire history is of follow-up commands not
 * being run. A check that repairs silently is worse: the session carries on holding the stale
 * `INDEX.md` it already read into its context. So the repair lands on disk AND the non-zero exit
 * forces a re-read — the one mechanism this phase proved survives contact with a live session.
 * Re-running immediately afterwards exits 0, so it can never wedge a project.
 */
export async function ingestCheckCommand(
  options: { project?: string; json?: boolean } = {},
): Promise<void> {
  const projectDir = resolve(options.project ?? process.cwd());
  const relabel = await ingestRelabelCommand({ project: projectDir, quiet: true });
  const gaps = await ingestGapsCommand({ project: projectDir, skipRelabel: true, quiet: true });
  const repaired = relabel.relabelled > 0 || gaps.changed;

  if (options.json) {
    console.log(
      JSON.stringify(
        { repaired, relabelled: relabel.relabelled, gapsWritten: gaps.gapsWritten }, null, 2),
    );
  }

  if (!repaired) {
    if (!options.json) {
      console.log(
        chalk.green(
          `✓ Ingest synthesis up to date — ${gaps.gapsWritten} open rules gap${gaps.gapsWritten === 1 ? '' : 's'}, no Derived/Visual misfiling`,
        ),
      );
    }
    return;
  }

  if (!options.json) {
    console.error(chalk.yellow('rulebook/ was out of sync with its slices. It has been REPAIRED:'));
    if (relabel.relabelled) {
      console.error(
        `  • relabelled ${relabel.relabelled} presentation line${relabel.relabelled === 1 ? '' : 's'} Derived → Visual`,
      );
      for (const c of relabel.changes) {
        console.error(`      ${chalk.gray(`${c.file}:${c.line}`)} matched "${c.matched}"`);
      }
    }
    if (gaps.changed) {
      console.error(
        `  • rewrote ## Open Rules Gaps from the slices — ${gaps.gapsWritten} entr${gaps.gapsWritten === 1 ? 'y' : 'ies'}`,
      );
    }
    console.error('');
    console.error(chalk.yellow('Re-read rulebook/INDEX.md before continuing — the copy you have is stale.'));
    console.error(chalk.dim('Then re-run `boardsmith ingest-check`; it will pass.'));
  }

  // Set the exit code rather than throwing: `program.parse()` does not await action handlers, so a
  // rejection surfaces as an unhandled-rejection stack trace. The caller here is a git hook or a
  // build session, both of which need the non-zero status and neither of which should be shown
  // this repo's internal paths.
  process.exitCode = 1;
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

  // Decide the branch BEFORE any try/catch that performs a write. Today's bug (T-173-01): the
  // existence probe and the real repair write shared one try, with a catch that overwrote a real
  // designer INDEX.md with a fresh scaffold on ANY throw raised while repairing — a read failure,
  // a transform error, a partial write. The scaffold branch below is now reached ONLY when
  // INDEX.md genuinely does not exist; a repair error propagates as a plain exception instead.
  let indexExists: boolean;
  try {
    await fs.access(indexPath);
    indexExists = true;
  } catch {
    indexExists = false;
  }

  let wroteIndex = false;
  let headerBroughtToContract = false;
  if (!indexExists) {
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
    headerBroughtToContract = true;
  } else {
    headerBroughtToContract = await repairExistingIndex(indexPath, {
      edition: options.edition,
      relArchivePath,
      sourceHash,
      transcribed,
    });
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
  // Only report the header as updated when it was actually brought to the four-line contract —
  // the unconditional "provenance header updated" message is what hid this defect (T-173-03).
  if (wroteIndex) {
    console.log(
      `  ${chalk.gray('index:')} rulebook/INDEX.md written with provenance header + section scaffolding`,
    );
  } else if (headerBroughtToContract) {
    console.log(
      `  ${chalk.gray('index:')} rulebook/INDEX.md provenance header updated (existing sections untouched)`,
    );
  } else {
    console.log(
      `  ${chalk.gray('index:')} rulebook/INDEX.md was NOT updated — its provenance header was already at contract`,
    );
  }
  console.log();
  console.log(chalk.gray('Fill the scaffolded sections from the transcription summaries.'));
  console.log(chalk.gray('Keep every heading exactly as written — downstream tooling parses them.'));
}

/** The line-bounds of one matched `^Label:` line (multiline-anchored), or `undefined` if absent. */
function findLabelLine(
  text: string,
  label: string,
): { start: number; end: number; value: string } | undefined {
  const re = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(.*)$`, 'm');
  const match = re.exec(text);
  if (!match) return undefined;
  return { start: match.index, end: match.index + match[0].length, value: match[1].trim() };
}

/**
 * The insertion point for a header sentinel line when its anchor label is entirely absent from
 * the document: immediately after the `# ` title line (and the blank line that follows it, if
 * present) — never offset 0 (WR-01: a sentinel prepended at offset 0 landed ABOVE the document's
 * own `# Rulebook Index — <name>` title). Falls back to offset 0 only when there is no title line
 * either, which should not occur for a real INDEX.md but is a harmless degrade if it ever did.
 */
function afterTitleInsertionPoint(text: string): number {
  const titleMatch = /^# .*\r?\n/m.exec(text);
  if (!titleMatch) return 0;
  let insertAt = titleMatch.index + titleMatch[0].length;
  // Skip the single blank line immediately following the title, if present, so the sentinel lands
  // below that separator rather than jammed directly under the title line.
  if (text.slice(insertAt, insertAt + 1) === '\n') {
    insertAt += 1;
  }
  return insertAt;
}

/**
 * Repairs an existing INDEX.md's provenance header in place, per CONTEXT.md decision 1b. Returns
 * whether the header was actually brought to the `HEADER_LABELS` contract (so the caller can stop
 * printing an unconditional success line).
 *
 * Root causes closed, in `HEADER_LABELS` order:
 *  - `Source hash:` / `Transcribed:` are INSERTED when absent, never blind-`.replace()`d (a
 *    no-match replace is a silent no-op — root cause (a)).
 *  - `Source:` is wrap-safe: an already-canonical bare path is left untouched (idempotence), a
 *    bare-path-with-trailing-heading is replaced in place, and WRAPPED prose is never truncated —
 *    only its `Source: ` label prefix is stripped, and a new canonical line is inserted above it
 *    (root cause (b)). `computeVerificationScope` reads the FIRST `^Source:` match and joins it
 *    to the project dir, so the canonical bare-path line must exist and must come first; the
 *    wrapped prose is the designer's own annotation and is not this command's to delete.
 *  - `Edition:` is left byte-identical when `--edition` is omitted and a real value already
 *    exists — never regressed to `EDITION_UNKNOWN` (root cause (c)).
 */
async function repairExistingIndex(
  indexPath: string,
  params: { edition: string | undefined; relArchivePath: string; sourceHash: string; transcribed: string },
): Promise<boolean> {
  const { edition, relArchivePath, sourceHash, transcribed } = params;
  const before = await fs.readFile(indexPath, 'utf-8');
  let text = before;

  // 1. Edition: — only touch it when the caller actually supplied a value. An omitted --edition
  //    must never clobber a real designer-authored Edition: line.
  const editionLine = findLabelLine(text, 'Edition:');
  const suppliedEdition = edition?.trim();
  if (suppliedEdition) {
    const normalizedEdition = normalizeEdition(suppliedEdition);
    const editionNoteLine =
      normalizedEdition === EDITION_UNKNOWN && suppliedEdition !== EDITION_UNKNOWN
        ? `${EDITION_NOTE_LABEL} ${suppliedEdition}`
        : undefined;
    // Strip any prior Edition note: line before rewriting, so a repeated run does not accumulate
    // duplicates — the same "replace, don't append" discipline as the Edition: line itself.
    text = text.replace(/^Edition note:.*\n?/m, '');
    const replacement = editionNoteLine
      ? `Edition: ${normalizedEdition}\n${editionNoteLine}`
      : `Edition: ${normalizedEdition}`;
    const at = findLabelLine(text, 'Edition:');
    if (at) {
      text = text.slice(0, at.start) + replacement + text.slice(at.end);
    } else {
      text = `Edition: ${normalizedEdition}${editionNoteLine ? `\n${editionNoteLine}` : ''}\n\n${text}`;
    }
  } else if (!editionLine) {
    // No --edition supplied AND no existing Edition: line — insert the sentinel so the header
    // still converges on the HEADER_LABELS contract. Below the title line (WR-01), never above it.
    const at = afterTitleInsertionPoint(text);
    text = text.slice(0, at) + `Edition: ${EDITION_UNKNOWN}\n\n` + text.slice(at);
  }
  // Else: a real Edition: line already exists and --edition was omitted — leave it byte-identical,
  // including any adjacent Edition note: line.

  // 2. Source: — wrap-safe classification. Re-locate after step 1 may have shifted offsets.
  const sourceLine = findLabelLine(text, 'Source:');
  if (!sourceLine) {
    // Absent — insert immediately after the Edition: line (or at the top of the header region if
    // Edition: is also absent, though step 1 guarantees an Edition: line exists by this point).
    const editionAt = findLabelLine(text, 'Edition:');
    if (editionAt) {
      const insertAt = text.indexOf('\n', editionAt.end);
      const at = insertAt === -1 ? text.length : insertAt + 1;
      text = text.slice(0, at) + `Source: ${relArchivePath}\n` + text.slice(at);
    } else {
      // Defensive fallback only — step 1 above always leaves an Edition: line in place, so this
      // branch should be unreachable in practice. Below the title line (WR-01) if it ever runs.
      const at = afterTitleInsertionPoint(text);
      text = text.slice(0, at) + `Source: ${relArchivePath}\n\n` + text.slice(at);
    }
  } else if (sourceLine.value === relArchivePath) {
    // Already canonical — leave untouched. Load-bearing for idempotence (B9/B11): after a first
    // repair the file reads "Source: <canonical>" followed by the designer's now-unlabeled prose
    // continuation line, which is non-blank and would otherwise look like wrapped prose again.
  } else {
    const lineEnd = text.indexOf('\n', sourceLine.end);
    const nextLine = lineEnd === -1 ? undefined : text.slice(lineEnd + 1).split('\n')[0];
    const isBarePath =
      !/\s/.test(sourceLine.value) &&
      (nextLine === undefined ||
        nextLine.trim() === '' ||
        nextLine.startsWith('## ') ||
        HEADER_LABELS.some((label) => nextLine.startsWith(label)));
    if (isBarePath) {
      // bare path (today's shape) — replace the line in place.
      text = text.slice(0, sourceLine.start) + `Source: ${relArchivePath}` + text.slice(sourceLine.end);
    } else {
      // wrapped prose — never truncate. Strip only the "Source: " label prefix from the first
      // physical line (leaving the prose intact via `text.slice(lineEnd)`, which preserves
      // everything after the label line, continuation included) and insert a new canonical
      // bare-path line immediately above it.
      text =
        text.slice(0, sourceLine.start) +
        `Source: ${relArchivePath}\n` +
        sourceLine.value +
        text.slice(lineEnd === -1 ? sourceLine.end : lineEnd);
    }
  }

  // 3. Source hash: — insert-if-absent, never blind-replace.
  const hashLine = findLabelLine(text, 'Source hash:');
  if (hashLine) {
    text = text.slice(0, hashLine.start) + `Source hash: ${sourceHash}` + text.slice(hashLine.end);
  } else {
    const at = findLabelLine(text, 'Source:');
    const insertAfter = at ? text.indexOf('\n', at.end) : -1;
    const pos = insertAfter === -1 ? text.length : insertAfter + 1;
    text = text.slice(0, pos) + `Source hash: ${sourceHash}\n` + text.slice(pos);
  }

  // 4. Transcribed: — insert-if-absent, immediately after Source hash:, never blind-replace.
  const transcribedLine = findLabelLine(text, 'Transcribed:');
  if (transcribedLine) {
    text =
      text.slice(0, transcribedLine.start) + `Transcribed: ${transcribed}` + text.slice(transcribedLine.end);
  } else {
    const at = findLabelLine(text, 'Source hash:');
    const insertAfter = at ? text.indexOf('\n', at.end) : -1;
    const pos = insertAfter === -1 ? text.length : insertAfter + 1;
    text = text.slice(0, pos) + `Transcribed: ${transcribed}\n` + text.slice(pos);
  }

  if (text === before) return false;
  await fs.writeFile(indexPath, text);
  return true;
}
