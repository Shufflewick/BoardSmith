import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import chalk from 'chalk';
import { normalizeEdition } from './ingest-archive.js';
import { readBoardsmithVersion } from '../lib/boardsmith-version.js';
import { hashSkillsTree } from '../lib/skills-tree-hash.js';

/**
 * `computeVerificationScope()` / `resolveCitedSlices()` — the two pure computations behind
 * PROV-02 and PROV-01.
 *
 * WHY THIS IS CODE AND NOT SKILL TEXT
 *
 * 171-CONTEXT.md's sort table places all three PROV requirements MECHANICAL: whether source was
 * re-readable is a file-existence-plus-hash comparison, and the slices a chunk cites are already
 * written down in its own prose, waiting to be scanned. Phase 170 spent twelve mechanisms proving
 * that mechanical work handed to a session as prose instructions does not survive a live run — it
 * reads its skill files once and then executes from recall, reproducing a superseded contract.
 * Both functions here have one correct output for a given input, so they belong in code that
 * cannot forget a reason code or guess at an ambiguous citation.
 */

/** The two scopes a verification can honestly report. Never a caller-supplied value. */
export const SCOPE_FULL = 'full';
export const SCOPE_CODE_ONLY = 'code-conformance-only';

/**
 * The five reasons a verification's scope is reduced from `full`. Each fires from ONE specific
 * disk state, and the precedence order below (checked top to bottom, first match wins) is part
 * of the contract:
 *
 *  1. `no-rulebook-project`    — no `rulebook/` directory at all. Nothing to verify against.
 *  2. `index-missing`          — `rulebook/` exists but has no `INDEX.md`.
 *  3. `pre-provenance-project` — `INDEX.md` exists but has no `Source hash:` line at all. This
 *     project predates Phase 170's ingest contract entirely (no `rulebook/source/`, no recorded
 *     hash) — DISTINCT from `source-missing` on purpose. Conflating "never had provenance" with
 *     "had it and lost it" would report every pre-170 project as damaged rather than simply older
 *     (171-CONTEXT.md decision 10). Both reference games (`seven`, `one-two-punch`) are real,
 *     live examples of this state as of 2026-07-28.
 *  4. `source-missing`         — `INDEX.md` records a `Source:` path and a `Source hash:`, but no
 *     file exists at that path. Provenance was recorded and the archive is now gone.
 *  5. `source-hash-mismatch`   — the archived file exists, but its SHA-256 does not match the
 *     recorded `Source hash:`. The archive was recorded and then silently changed.
 *
 * `full` is everything past all five checks: the archived file exists AND its hash matches.
 */
export const SCOPE_REASONS = Object.freeze([
  'source-missing',
  'source-hash-mismatch',
  'index-missing',
  'no-rulebook-project',
  'pre-provenance-project',
] as const);

export type ScopeReason = (typeof SCOPE_REASONS)[number];

export interface VerificationScope {
  scope: typeof SCOPE_FULL | typeof SCOPE_CODE_ONLY;
  /** Omitted (not a placeholder value) when `scope` is `full`. */
  reason?: ScopeReason;
  /** `INDEX.md`'s `Edition:` value, passed through `normalizeEdition`. Absent with no INDEX.md. */
  edition?: string;
  /** `INDEX.md`'s `Source:` value, relative to the project directory. */
  sourcePath?: string;
  /** `INDEX.md`'s `Source hash:` value — the edition anchor a verification is checked against. */
  sourceHash?: string;
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Computes what scope a verification honestly has, from disk state alone.
 *
 * This function takes exactly ONE parameter: the project directory. Do NOT add a `scope`,
 * `assume`, `force`, or `assumeFull` option — now or ever. 171-CONTEXT.md decision 1: a session
 * asked to declare its own verification scope is exactly how PROV-02 fails silently, and the
 * entire point of PROV-02 is that a partial verification must not be able to present as a full
 * one. `full` requires BOTH that the archived source file exists at the path `INDEX.md` records
 * AND that its SHA-256 matches `INDEX.md`'s `Source hash:` — neither alone is sufficient, and
 * this function performs that comparison itself rather than trusting a caller's claim.
 */
export async function computeVerificationScope(projectDir: string): Promise<VerificationScope> {
  const dir = resolve(projectDir);
  const rulebookDir = join(dir, 'rulebook');

  if (!(await exists(rulebookDir))) {
    return { scope: SCOPE_CODE_ONLY, reason: 'no-rulebook-project' };
  }

  const indexPath = join(rulebookDir, 'INDEX.md');
  let index: string;
  try {
    index = await fs.readFile(indexPath, 'utf-8');
  } catch {
    return { scope: SCOPE_CODE_ONLY, reason: 'index-missing' };
  }

  const editionMatch = /^Edition:\s*(.*)$/m.exec(index);
  const edition = editionMatch ? normalizeEdition(editionMatch[1]) : undefined;

  const hashMatch = /^Source hash:\s*(.*)$/m.exec(index);
  if (!hashMatch) {
    return { scope: SCOPE_CODE_ONLY, reason: 'pre-provenance-project', edition };
  }
  const sourceHash = hashMatch[1].trim();

  const sourceMatch = /^Source:\s*(.*)$/m.exec(index);
  const sourcePath = sourceMatch ? sourceMatch[1].trim() : undefined;

  const archivedFullPath = sourcePath ? join(dir, sourcePath) : undefined;
  let archivedBuf: Buffer | undefined;
  if (archivedFullPath) {
    try {
      archivedBuf = await fs.readFile(archivedFullPath);
    } catch {
      archivedBuf = undefined;
    }
  }
  if (!archivedBuf) {
    return { scope: SCOPE_CODE_ONLY, reason: 'source-missing', edition, sourcePath, sourceHash };
  }

  if (sha256(archivedBuf) !== sourceHash) {
    return {
      scope: SCOPE_CODE_ONLY,
      reason: 'source-hash-mismatch',
      edition,
      sourcePath,
      sourceHash,
    };
  }

  return { scope: SCOPE_FULL, edition, sourcePath, sourceHash };
}

/**
 * Recovers the set of rulebook slices a chunk cites, from its existing CHUNK.md prose — rather
 * than a new field a build session would have to remember to fill (171-CONTEXT.md decision 8,
 * rejecting exactly that: "it writes off every existing chunk and depends on a new skill-text
 * instruction, the exact mechanism Phase 170 disproved").
 *
 * UNRESOLVABLE CITATIONS ARE THEIR OWN OUTCOME. A citation this function cannot resolve — an
 * ambiguous shorthand prefix, or a name matching no file in `sliceFilenames` — is recorded
 * VERBATIM in `unresolved`, never silently dropped and never guessed at. Silent under-recording
 * is the PROV-01 analogue of the gap-dropping defect Phase 170 spent itself on: a wrong slice
 * under a confident label is worse than a visible gap.
 *
 * `sliceFilenames` is the `rulebook/` DIRECTORY LISTING, not `INDEX.md`'s `## Slices` table —
 * `one-two-punch`'s real `INDEX.md` has no such heading at all, while `seven`'s does. The
 * directory listing is the one resolution target present for both games.
 */
export function resolveCitedSlices(
  chunkText: string,
  sliceFilenames: string[],
): { resolved: string[]; unresolved: string[] } {
  const resolved = new Set<string>();
  const unresolved = new Set<string>();

  // `rulebook/` followed by a run of path-ish characters. Markdown emphasis (`**`), braces,
  // commas, and apostrophes are deliberately absent from the character class, so the match stops
  // there by construction and needs no separate stripping step. Only a trailing sentence period
  // is ambiguous (`.` is also the extension separator `.md` needs), so that alone is stripped
  // below.
  const CITATION = /rulebook\/[A-Za-z0-9._-]+/g;

  for (const match of chunkText.matchAll(CITATION)) {
    const raw = match[0];
    let token = raw;
    while (token.endsWith('.')) token = token.slice(0, -1);

    const name = token.slice('rulebook/'.length);
    if (!name) continue;

    if (name.endsWith('.md')) {
      if (sliceFilenames.includes(name)) {
        resolved.add(`rulebook/${name}`);
      } else {
        unresolved.add(token);
      }
      continue;
    }

    // Shorthand — no extension. Resolve against the unique filename with this prefix. Zero or
    // two-or-more candidates is unresolved: an ambiguous prefix (e.g. seven's two `01-` slices)
    // is recorded verbatim rather than guessed, per the decision-8 rule above.
    const candidates = sliceFilenames.filter((f) => f.startsWith(name));
    if (candidates.length === 1) {
      resolved.add(`rulebook/${candidates[0]}`);
    } else {
      unresolved.add(token);
    }
  }

  return { resolved: [...resolved].sort(), unresolved: [...unresolved].sort() };
}

/**
 * `boardsmith chunk-check <slug>` — PROV-01's deliverable. Writes or repairs a fenced,
 * machine-owned `## Verified Against` block into `chunks/<slug>/CHUNK.md`, and exits non-zero
 * when it had to. `ingestCheckCommand` (`ingest-archive.ts`) is the precedent copied line for
 * line — see `<copy_these_mechanisms_exactly>` in 171-04-PLAN.md.
 *
 * The heading text. A new sibling of `## Verified Commit Hash` in the CHUNK.md template.
 */
export const VERIFIED_AGAINST_HEADING = '## Verified Against';

/**
 * Fences delimiting the machine-owned body of `## Verified Against`. A DISTINCT fence pair from
 * `GAPS_BEGIN`/`GAPS_END` (171-CONTEXT.md decision 3): two unrelated machine-owned sections
 * sharing one fence pair is a data-corruption risk, not a convenience.
 */
export const VERIFIED_AGAINST_BEGIN = '<!-- boardsmith:verified-against:begin -->';
export const VERIFIED_AGAINST_END = '<!-- boardsmith:verified-against:end -->';

/**
 * The exact parsed label strings this block renders, in the order they are rendered. Plan 05's
 * aggregation parses these — they are exported so there is one source of truth and no second
 * copy. Changing one is a breaking change, mirroring `INDEX_HEADINGS`/`HEADER_LABELS` in
 * `ingest-archive.ts`.
 */
export const VERIFIED_AGAINST_LABELS = Object.freeze([
  'Scope:',
  'Reason:',
  'Rulebook edition:',
  'Rulebook source hash:',
  'BoardSmith version:',
  'Skills tree hash:',
  'Cited slices:',
  'Unresolved citations:',
] as const);

const [
  LABEL_SCOPE,
  LABEL_REASON,
  LABEL_EDITION,
  LABEL_SOURCE_HASH,
  LABEL_VERSION,
  LABEL_SKILLS_HASH,
  LABEL_CITED,
  LABEL_UNRESOLVED,
] = VERIFIED_AGAINST_LABELS;

/**
 * The placeholder body a freshly scaffolded CHUNK.md carries before its first `chunk-check` —
 * matching `GAPS_EMPTY`'s role for `## Open Rules Gaps`. Also used below when a chunk cites no
 * rulebook slices at all, so the "Cited slices:" section is never left visually empty.
 */
export const VERIFIED_AGAINST_EMPTY = '_Not yet recorded._';

export interface VerifiedAgainstRecord {
  scope: typeof SCOPE_FULL | typeof SCOPE_CODE_ONLY;
  /** Omitted (not rendered) unless `scope` is `code-conformance-only`. */
  reason?: ScopeReason;
  /** `none recorded` is written, never fabricated, when the project has no INDEX.md Edition. */
  edition?: string;
  /** The edition anchor (171-CONTEXT.md decision 4) — `INDEX.md`'s own `Source hash:` value. */
  sourceHash?: string;
  boardsmithVersion: string;
  skillsTreeHash: string;
  citedSlices: Array<{ path: string; hash: string }>;
  unresolved: string[];
}

/**
 * Pure — returns only the body that lives BETWEEN the fences. Omits `Reason:` entirely on `full`
 * scope; omits `Unresolved citations:` when there are none.
 */
export function renderVerifiedAgainst(record: VerifiedAgainstRecord): string {
  const lines: string[] = [];
  lines.push(`${LABEL_SCOPE} ${record.scope}`);
  if (record.scope === SCOPE_CODE_ONLY && record.reason) {
    lines.push(`${LABEL_REASON} ${record.reason}`);
  }
  lines.push(`${LABEL_EDITION} ${record.edition ?? 'none recorded'}`);
  lines.push(`${LABEL_SOURCE_HASH} ${record.sourceHash ?? 'none recorded'}`);
  lines.push(`${LABEL_VERSION} ${record.boardsmithVersion}`);
  lines.push(`${LABEL_SKILLS_HASH} ${record.skillsTreeHash}`);
  lines.push('');
  lines.push(LABEL_CITED);
  lines.push('');
  if (record.citedSlices.length) {
    lines.push('| slice | sha256 |');
    lines.push('|---|---|');
    for (const s of record.citedSlices) lines.push(`| ${s.path} | ${s.hash} |`);
  } else {
    lines.push(VERIFIED_AGAINST_EMPTY);
  }
  if (record.unresolved.length) {
    lines.push('');
    lines.push(LABEL_UNRESOLVED);
    lines.push('');
    for (const u of record.unresolved) lines.push(`- ${u}`);
  }
  return `\n${lines.join('\n')}\n`;
}

/** Heading + a machine-owned explanatory comment (`renderIndex`'s voice) + the two fences. */
function renderVerifiedAgainstSection(record: VerifiedAgainstRecord): string {
  return `${VERIFIED_AGAINST_HEADING}

<!-- MACHINE-OWNED. Do not write between the fences below, and do not move or delete them.

     \`boardsmith chunk-check <slug>\` computes this block from disk state: the SHA-256 of each
     rulebook slice this chunk cites, the rulebook index's own \`Source hash:\` line as the
     edition anchor, this project's installed BoardSmith version and skills-tree content hash, and
     the verification scope \`computeVerificationScope()\` derives from disk. It runs from \`close\`
     and repairs this block on every run. Anything you write here is overwritten on the next run.

     Why this is fenced rather than requested politely: 171-CONTEXT.md decision 3 traces this
     shape to the 2026-07-28 human gate (\`170-PROOF-RUN-2.md\`), where a session had a real
     motive to edit the sibling fenced \`## Open Rules Gaps\` section, recognised it was
     machine-owned, and declined to touch it. A hand-authored provenance block is indistinguishable
     from a correct one by reading it, so it is made structurally impossible instead —
     \`boardsmith chunk-check\` refuses to write, rather than silently re-fencing, when these
     markers are gone. -->

${VERIFIED_AGAINST_BEGIN}${renderVerifiedAgainst(record)}${VERIFIED_AGAINST_END}
`;
}

/**
 * `boardsmith chunk-check <slug>` — writes or repairs `chunks/<slug>/CHUNK.md`'s
 * `## Verified Against` block, and exits non-zero when it had to.
 *
 * Repair-then-fail, not fail-and-tell-you-to-fix: the repair lands on disk in this same call, so
 * an immediate re-run passes. Never throws on this path — `program.parse()` does not await action
 * handlers, so a rejection here would surface as an unhandled-rejection stack trace. The ONE path
 * that does throw is the fence-refusal structural error, because there the file is never touched
 * and the caller needs a loud, actionable failure, not a silent skip.
 *
 * HONEST LIMITATION: this command guarantees the block is correct WHENEVER IT RUNS. Whether a
 * live `close` session actually invokes it is skill text, and carries the same skip risk Phase
 * 170 found in fourteen live runs (171-VALIDATION.md "Known Unvalidated"). The compensating
 * control is plan 05's `chunk-provenance-status`'s `verifiedWithoutProvenance` flag, which
 * surfaces a chunk marked `verified` with no valid block, rather than letting a skipped
 * invocation pass silently.
 *
 * Expected on-disk shape between the fences (`<!-- boardsmith:verified-against:begin -->` ...
 * `<!-- boardsmith:verified-against:end -->`) is exactly what `renderVerifiedAgainstSection()`
 * emits above — see that function for the literal markers.
 */
export async function chunkCheckCommand(
  slug: string,
  options: { project?: string; json?: boolean } = {},
): Promise<void> {
  const projectDir = resolve(options.project ?? process.cwd());
  const chunkPath = join(projectDir, 'chunks', slug, 'CHUNK.md');
  const relChunkPath = join('chunks', slug, 'CHUNK.md');

  let chunkText: string;
  try {
    chunkText = await fs.readFile(chunkPath, 'utf-8');
  } catch {
    throw new Error(
      `No chunk found at ${relChunkPath} in ${projectDir}.\n` +
        `Check the slug, or run \`boardsmith chunk-provenance-status\` to list known chunks.`,
    );
  }

  const scope = await computeVerificationScope(projectDir);

  const rulebookDir = join(projectDir, 'rulebook');
  let sliceFilenames: string[] = [];
  try {
    sliceFilenames = (await fs.readdir(rulebookDir)).filter(
      (f) => f.endsWith('.md') && f !== 'INDEX.md',
    );
  } catch {
    sliceFilenames = []; // no rulebook/ at all — nothing to resolve against
  }

  // The heading position in the file AS READ, before this run writes anything. Computed once and
  // reused both for scanning citations and for locating where to write below.
  const headingIdx = chunkText.indexOf(VERIFIED_AGAINST_HEADING);

  // Scan only the content BEFORE any existing "## Verified Against" section. The block's own
  // explanatory comment text legitimately discusses the rulebook index in prose — scanning the
  // whole file (including a block this same command wrote) risks treating that prose as a
  // citation and never letting `changed` settle to false on a second identical run.
  const citableText = headingIdx === -1 ? chunkText : chunkText.slice(0, headingIdx);
  const { resolved, unresolved } = resolveCitedSlices(citableText, sliceFilenames);
  const citedSlices: Array<{ path: string; hash: string }> = [];
  for (const rel of resolved) {
    const bytes = await fs.readFile(join(projectDir, rel));
    citedSlices.push({ path: rel, hash: sha256(bytes) });
  }

  const record: VerifiedAgainstRecord = {
    scope: scope.scope,
    reason: scope.reason,
    edition: scope.edition,
    sourceHash: scope.sourceHash,
    boardsmithVersion: readBoardsmithVersion(),
    skillsTreeHash: await hashSkillsTree(projectDir),
    citedSlices,
    unresolved,
  };

  const newBody = renderVerifiedAgainst(record);

  let updated: string;
  let previousBody: string | undefined;

  if (headingIdx === -1) {
    const separator = chunkText.endsWith('\n\n') ? '' : chunkText.endsWith('\n') ? '\n' : '\n\n';
    updated = chunkText + separator + renderVerifiedAgainstSection(record);
  } else {
    // Write strictly between the machine-owned fences — never a heading-to-next-heading range,
    // for the same reason recorded at ingest-archive.ts:244-247: that range silently tolerates a
    // hand-authored section, since whatever the caller wrote just gets overwritten and nothing
    // ever reports it happened. Bounding to the fences means their absence is a hard, nameable
    // error instead of a silent guess.
    const begin = chunkText.indexOf(VERIFIED_AGAINST_BEGIN, headingIdx);
    const end = chunkText.indexOf(VERIFIED_AGAINST_END, headingIdx);
    if (begin === -1 || end === -1 || end < begin) {
      throw new Error(
        `${relChunkPath}'s "${VERIFIED_AGAINST_HEADING}" section is missing its machine-owned fences.\n` +
          `Expected ${VERIFIED_AGAINST_BEGIN} ... ${VERIFIED_AGAINST_END}.\n` +
          `This section is written by \`boardsmith chunk-check\`, never by hand. Restore it by\n` +
          `deleting the entire "${VERIFIED_AGAINST_HEADING}" section from ${relChunkPath},\n` +
          `then re-run \`boardsmith chunk-check ${slug}\`.`,
      );
    }
    previousBody = chunkText.slice(begin + VERIFIED_AGAINST_BEGIN.length, end);
    updated =
      chunkText.slice(0, begin + VERIFIED_AGAINST_BEGIN.length) + newBody + chunkText.slice(end);
  }

  const changed = previousBody === undefined || previousBody !== newBody;
  if (changed) {
    await fs.writeFile(chunkPath, updated);
  }

  const result = {
    slug,
    scope: record.scope,
    reason: record.reason,
    changed,
    citedSlices: citedSlices.map((c) => c.path),
    unresolved,
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  }

  if (!changed) {
    if (!options.json) {
      console.log(
        chalk.green(
          `✓ ${relChunkPath} — Verified Against up to date (${record.scope}${record.reason ? `, ${record.reason}` : ''})`,
        ),
      );
    }
    return;
  }

  if (!options.json) {
    const bullets: string[] = [];
    if (previousBody === undefined) {
      bullets.push('block created');
    } else {
      if (!previousBody.includes(`${LABEL_SCOPE} ${record.scope}`)) {
        bullets.push(`scope changed → ${record.scope}${record.reason ? ` (${record.reason})` : ''}`);
      }
      if (citedSlices.some((s) => !previousBody!.includes(`| ${s.path} | ${s.hash} |`))) {
        bullets.push('cited-slice hashes rewritten');
      }
      if (unresolved.length && !unresolved.every((u) => previousBody!.includes(u))) {
        bullets.push('unresolved citations changed');
      }
      if (!bullets.length) bullets.push('provenance fields refreshed');
    }

    console.error(chalk.yellow(`${relChunkPath}'s "${VERIFIED_AGAINST_HEADING}" was out of sync. It has been REPAIRED:`));
    for (const b of bullets) {
      console.error(`  • ${b}`);
    }
    console.error('');
    console.error(chalk.yellow(`Re-read ${relChunkPath} before continuing — the copy you have is stale.`));
    console.error(chalk.dim(`Then re-run \`boardsmith chunk-check ${slug}\`; it will pass.`));
  }

  // Set the exit code rather than throwing: `program.parse()` does not await action handlers, so
  // a rejection surfaces as an unhandled-rejection stack trace. The caller here is a build
  // session's `close` step, which needs the non-zero status and should never see this repo's
  // internal paths.
  process.exitCode = 1;
}
