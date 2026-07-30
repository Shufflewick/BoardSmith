import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import chalk from 'chalk';
import { normalizeEdition } from './ingest-archive.js';
import { readBoardsmithVersion } from '../lib/boardsmith-version.js';
import { hashSkillsTree } from '../lib/skills-tree-hash.js';
import { findHeadingIndex } from './build-manifest.js';

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
/**
 * The ninth label, appended (175-CONTEXT.md decision 11), is a genuinely NEW concept — not a
 * reuse of `SCOPE_REASONS` above. Research measured that `## Verified Against` today has NO
 * timestamp and NO signal for "this run found no code change", and that `SCOPE_REASONS` encodes
 * something else entirely: WHY a verification's SCOPE was reduced (source unreadable/missing/
 * mismatched), never WHETHER a chunk's code moved. The stamp's value embeds its own evidence
 * (`<recorded-verified-hash>..<head> — 0 manifest files changed`) rather than asserting a bare
 * boolean (T-175-07), because the block itself carries no timestamp — a human reading CHUNK.md
 * cannot otherwise tell how fresh the claim is without a `git blame`.
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
  'Re-verified (no code change):',
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
  LABEL_REVERIFIED,
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
  /**
   * 175-CONTEXT.md decision 11's re-verification stamp — present ONLY when this run re-verified a
   * chunk whose code did NOT move. The value names its own evidence (the drift comparison that
   * justifies the claim), formatted `<recorded-verified-hash>..<head> — 0 manifest files changed`,
   * rather than asserting a bare boolean. Omitted entirely (never rendered as an empty line) when
   * absent — this run either did not re-verify, or found code that DID change (decision 12: goes
   * to `built` instead, no stamp).
   */
  reverifiedNoCodeChange?: string;
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
  if (record.reverifiedNoCodeChange) {
    lines.push(`${LABEL_REVERIFIED} ${record.reverifiedNoCodeChange}`);
  }
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
  options: {
    project?: string;
    json?: boolean;
    /**
     * 175-CONTEXT.md decision 11's stamp value — the drift comparison evidence justifying a
     * "re-verified, no code change" claim (e.g. `<hash>..<head> — 0 manifest files changed`).
     * When supplied, writes the `Re-verified (no code change):` label; omitted otherwise. The
     * `--reverified-no-code-change <range>` CLI flag itself is registered by plan 175-04 in
     * `cli.ts`, to keep that file in one plan's `files_modified` — this option is exposed here
     * only, ready for that registration to pass through.
     */
    reverifiedNoCodeChange?: string;
  } = {},
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
  //
  // Anchored to a LINE, not to the first substring occurrence. `indexOf(VERIFIED_AGAINST_HEADING)`
  // also matched prose, and CHUNK.template.md:18 legitimately names "## Verified Against" inside
  // its required-headings comment — 130 lines above the real section. That made `citableText`
  // truncate at line 18, before `## Interpretation`, so EVERY citation was silently dropped and
  // every chunk scaffolded from the template recorded provenance citing nothing. Silent
  // under-recording is the exact defect class this phase exists to prevent, so the heading is
  // located structurally rather than by substring.
  const headingMatch = /^## Verified Against[ \t]*$/m.exec(chunkText);
  const headingIdx = headingMatch ? headingMatch.index : -1;

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
    ...(options.reverifiedNoCodeChange
      ? { reverifiedNoCodeChange: options.reverifiedNoCodeChange }
      : {}),
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

/**
 * `boardsmith chunk-provenance-status` — PROV-03's deliverable. A read-only aggregation of every
 * chunk's `## Verified Against` block, backing `/bs-check-status` (which formats this, per
 * 171-CONTEXT.md, rather than computing it itself).
 *
 * THE THREE STATES, NEVER TWO (171-CONTEXT.md "specifics" item 3, and the single most important
 * property of this file): `full`, `code-conformance-only`, and `unknown`. A chunk verified BEFORE
 * this phase existed carries no block at all — that is not drift, and reporting it as
 * `code-conformance-only` would assert a scope determination that was never made. All 29 existing
 * chunks across both reference games are `unknown` today (verified 2026-07-28); conflating that
 * with `code-conformance-only` would report every one of them as damaged rather than simply older.
 * `PROVENANCE_UNKNOWN` exists as its own sentinel, distinct from `SCOPE_FULL`/`SCOPE_CODE_ONLY`,
 * for exactly this reason.
 */
export const PROVENANCE_UNKNOWN = 'unknown';

export interface ParsedVerifiedAgainst {
  state: typeof SCOPE_FULL | typeof SCOPE_CODE_ONLY | typeof PROVENANCE_UNKNOWN;
  /** Only present when `state` is `code-conformance-only`. */
  reason?: ScopeReason;
  /** The RAW recorded edition string (not yet normalised) — undefined when `state` is `unknown` or the block recorded no edition. */
  edition?: string;
  sourceHash?: string;
  boardsmithVersion?: string;
  skillsTreeHash?: string;
  citedSlices: string[];
  unresolved: string[];
  /**
   * 175-CONTEXT.md decision 11's re-verification stamp, round-tripped. `undefined` when the label
   * is ABSENT — an eight-label block predates this change and is not malformed (an old block
   * parsing as valid, not as damaged, is the whole point of appending rather than restructuring).
   */
  reverifiedNoCodeChange?: string;
  /**
   * true only when a "## Verified Against" HEADING exists but its body could not be parsed (a
   * fence missing, a required label removed). Distinct from the ordinary "no heading at all"
   * unknown case — that one means "verified before this phase existed," not "corrupted." Both
   * report `state: unknown`; this flag is how a caller tells them apart without conflating a
   * project's age with damage to its records.
   */
  blockMalformed: boolean;
}

function unparsed(blockMalformed: boolean): ParsedVerifiedAgainst {
  return { state: PROVENANCE_UNKNOWN, citedSlices: [], unresolved: [], blockMalformed };
}

/**
 * Pure. Parses a chunk's full CHUNK.md text for its `## Verified Against` block, using ONLY the
 * exported `VERIFIED_AGAINST_*` constants — never a second hand-copied label string.
 *
 * Strict by design: a missing fence, a missing required label, or the not-yet-recorded sentinel
 * body all yield `state: PROVENANCE_UNKNOWN`. A PARTIALLY parsed block is never returned as
 * valid — T-171-17's mitigation (chunk-provenance.ts threat register): a hand-forged or damaged
 * block must not be able to present as a real verification record.
 *
 * Line-anchored heading location via `findHeadingIndex` (`./build-manifest.js`), NOT a plain
 * substring search on the heading text — this is the `f73153a3` defect class recurring at this
 * call site. `CHUNK.template.md`'s own PARSE CONTRACT comment names
 * "## Verified Against" in prose ~130 lines above the real section, and this function's own
 * documented recovery path (`chunkCheckCommand`'s fence-refusal error) tells a user to delete the
 * entire real section — after which a substring search still finds the prose mention and
 * mislabels a never-recorded chunk as `blockMalformed: true` (172-CONTEXT.md decision 10's exact
 * state conflation: "older" reporting as "damaged").
 */
export function parseVerifiedAgainst(chunkText: string): ParsedVerifiedAgainst {
  const headingIdx = findHeadingIndex(chunkText, VERIFIED_AGAINST_HEADING);
  if (headingIdx === -1) return unparsed(false); // never verified under this phase's contract

  const beginIdx = chunkText.indexOf(VERIFIED_AGAINST_BEGIN, headingIdx);
  const endIdx = chunkText.indexOf(VERIFIED_AGAINST_END, headingIdx);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) return unparsed(true); // structurally damaged

  const body = chunkText.slice(beginIdx + VERIFIED_AGAINST_BEGIN.length, endIdx).trim();
  if (body === VERIFIED_AGAINST_EMPTY) return unparsed(false); // freshly scaffolded, never run

  const readLabel = (label: string): string | undefined => {
    // Escape regex metacharacters (T-175-XX): `LABEL_REVERIFIED` is
    // 'Re-verified (no code change):' — the parentheses are literal text in the label, not a
    // regex capture group, and an unescaped label would silently fail to match.
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`^${escaped}\\s*(.*)$`, 'm').exec(body);
    return match ? match[1].trim() : undefined;
  };

  const scopeRaw = readLabel(LABEL_SCOPE);
  const editionRaw = readLabel(LABEL_EDITION);
  const sourceHashRaw = readLabel(LABEL_SOURCE_HASH);
  const versionRaw = readLabel(LABEL_VERSION);
  const skillsHashRaw = readLabel(LABEL_SKILLS_HASH);
  // Absence is valid — an eight-label block predates decision 11's append and is not malformed.
  const reverifiedNoCodeChangeRaw = readLabel(LABEL_REVERIFIED);

  if (
    (scopeRaw !== SCOPE_FULL && scopeRaw !== SCOPE_CODE_ONLY) ||
    editionRaw === undefined ||
    sourceHashRaw === undefined ||
    !versionRaw ||
    !skillsHashRaw ||
    !body.includes(LABEL_CITED)
  ) {
    return unparsed(true); // present but unparseable — never a partial record treated as valid
  }

  let reason: ScopeReason | undefined;
  if (scopeRaw === SCOPE_CODE_ONLY) {
    const reasonRaw = readLabel(LABEL_REASON);
    if (!reasonRaw || !(SCOPE_REASONS as readonly string[]).includes(reasonRaw)) {
      return unparsed(true);
    }
    reason = reasonRaw as ScopeReason;
  }

  const citedSlices: string[] = [];
  const citedSectionMatch = new RegExp(
    `${LABEL_CITED}\\s*\\n\\n([\\s\\S]*?)(?:\\n\\n${LABEL_UNRESOLVED}|$)`,
  ).exec(body);
  if (citedSectionMatch) {
    for (const row of citedSectionMatch[1].matchAll(/^\|\s*(rulebook\/[^\s|]+)\s*\|/gm)) {
      citedSlices.push(row[1]);
    }
  }

  const unresolved: string[] = [];
  const unresolvedSectionMatch = new RegExp(`${LABEL_UNRESOLVED}\\s*\\n\\n([\\s\\S]*)$`).exec(
    body,
  );
  if (unresolvedSectionMatch) {
    for (const bullet of unresolvedSectionMatch[1].matchAll(/^-\s*(.+)$/gm)) {
      unresolved.push(bullet[1].trim());
    }
  }

  return {
    state: scopeRaw,
    reason,
    edition: editionRaw === 'none recorded' ? undefined : editionRaw,
    sourceHash: sourceHashRaw === 'none recorded' ? undefined : sourceHashRaw,
    boardsmithVersion: versionRaw,
    skillsTreeHash: skillsHashRaw,
    citedSlices,
    unresolved,
    ...(reverifiedNoCodeChangeRaw !== undefined
      ? { reverifiedNoCodeChange: reverifiedNoCodeChangeRaw }
      : {}),
    blockMalformed: false,
  };
}

export interface ChunkProvenanceEntry {
  slug: string;
  /** The literal `Status:` line value, e.g. `verified`, `verified (user-waived)`, `built`. */
  status: string;
  state: typeof SCOPE_FULL | typeof SCOPE_CODE_ONLY | typeof PROVENANCE_UNKNOWN;
  reason?: ScopeReason;
  edition?: string;
  skillsTreeHash?: string;
  boardsmithVersion?: string;
  citedSliceCount: number;
  unresolvedCount: number;
  blockMalformed: boolean;
}

export interface ChunkProvenanceStatusResult {
  chunks: ChunkProvenanceEntry[];
  counts: { full: number; codeConformanceOnly: number; unknown: number };
  /** Keyed by `normalizeEdition()` output — pre-F-1 free text collapses to one bucket (RESEARCH.md Pitfall 3). */
  byEdition: Record<string, string[]>;
  bySkillsTreeHash: Record<string, string[]>;
  byBoardsmithVersion: Record<string, string[]>;
  /**
   * Slugs whose `Status:` starts with `verified` (covering both `verified` and
   * `verified (user-waived)` — a waived verification is still a claim) but whose `state` is
   * `unknown`. This is the compensating control for T-171-14/T-171-18: if a live `close` session
   * skips `chunk-check`, THIS is what surfaces it, rather than the skip passing silently.
   *
   * Composition with the `unknown` state: an `unknown` chunk on a pre-existing (pre-Phase-171)
   * project is ALSO flagged here if its Status already reads `verified` — that is correct, not a
   * false positive. The flag does not ask "is this project old?"; it asks "does this chunk's
   * Status claim a verification that no record backs?" A project that has never run
   * `chunk-check` at all will show every verified chunk flagged, honestly, and plan 07's
   * real-reference-game proof exercises exactly that case (all 29 chunks, both `unknown` AND
   * flagged, at once) — that is the phase's stated ready-made proof target, not a false alarm.
   */
  verifiedWithoutProvenance: string[];
  /**
   * Project-level classification, which is what makes `verifiedWithoutProvenance` usable.
   *
   * The flag's membership is correct but its SEVERITY is not uniform, and without this field a
   * consumer cannot tell the two cases apart:
   *
   * - `pre-provenance` — no chunk in the project carries a block at all. Every verified chunk is
   *   flagged, and that is expected, not alarming: the project simply predates Phase 171. Both
   *   reference games are in this state (12 and 17 chunks, 100% flagged).
   * - `partial` — the project demonstrably DOES record provenance, yet some verified chunk has no
   *   block. THIS is the suspicious case — the signature of a skipped `chunk-check`.
   * - `complete` — every verified chunk has a block.
   * - `empty` — no chunks yet.
   *
   * Why this exists: rendering 100%-flagged as an alert on every pre-existing project makes the
   * flag noise, and a check that fires on correct work gets waived rather than fixed (the same
   * rationale as the presentation-lexicon exclusions in `ingest-archive.ts`). Waiving it would
   * cost the phase its only enforcement half that does not depend on a live agent following a
   * skill-text instruction.
   */
  projectProvenanceState: 'pre-provenance' | 'partial' | 'complete' | 'empty';
}

/**
 * `boardsmith chunk-provenance-status [--json]` — enumerates `chunks/*␣/CHUNK.md`, parses each
 * one's `## Verified Against` block, and reports the three-state classification, edition/
 * skills-tree/version drift, and the `verifiedWithoutProvenance` flag.
 *
 * READ-ONLY. This is not incidental: it backs `check-status.md`, whose documented posture is
 * "This skill performs no writes of any kind." No `fs.writeFile` (or any other mutating fs call)
 * appears anywhere in this function's body — the read-only property is pinned directly by a
 * before/after whole-project byte-hash test (T-171-19).
 */
export async function chunkProvenanceStatusCommand(
  options: { project?: string; json?: boolean; quiet?: boolean } = {},
): Promise<ChunkProvenanceStatusResult> {
  const projectDir = resolve(options.project ?? process.cwd());
  const chunksDir = join(projectDir, 'chunks');

  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await fs.readdir(chunksDir, { withFileTypes: true });
  } catch {
    throw new Error(
      `No chunks/ directory in ${projectDir}.\n` +
        `This command looks for chunks/<slug>/CHUNK.md files — run it from a BoardSmith game\n` +
        `project directory, or pass --project <dir>.`,
    );
  }
  const slugs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const chunks: ChunkProvenanceEntry[] = [];
  const byEdition: Record<string, string[]> = {};
  const bySkillsTreeHash: Record<string, string[]> = {};
  const byBoardsmithVersion: Record<string, string[]> = {};
  const verifiedWithoutProvenance: string[] = [];
  const counts = { full: 0, codeConformanceOnly: 0, unknown: 0 };

  for (const slug of slugs) {
    let chunkText: string;
    try {
      chunkText = await fs.readFile(join(chunksDir, slug, 'CHUNK.md'), 'utf-8');
    } catch {
      continue; // a chunks/<slug> dir with no CHUNK.md is not this command's problem to report
    }

    const statusMatch = /^Status:\s*(.*)$/m.exec(chunkText);
    const status = statusMatch ? statusMatch[1].trim() : 'unknown';

    const parsed = parseVerifiedAgainst(chunkText);

    if (parsed.state === SCOPE_FULL) counts.full++;
    else if (parsed.state === SCOPE_CODE_ONLY) counts.codeConformanceOnly++;
    else counts.unknown++;

    const editionKey = normalizeEdition(parsed.edition);
    (byEdition[editionKey] ??= []).push(slug);
    if (parsed.skillsTreeHash) (bySkillsTreeHash[parsed.skillsTreeHash] ??= []).push(slug);
    if (parsed.boardsmithVersion) (byBoardsmithVersion[parsed.boardsmithVersion] ??= []).push(slug);

    if (status.startsWith('verified') && parsed.state === PROVENANCE_UNKNOWN) {
      verifiedWithoutProvenance.push(slug);
    }

    chunks.push({
      slug,
      status,
      state: parsed.state,
      reason: parsed.reason,
      edition: parsed.edition,
      skillsTreeHash: parsed.skillsTreeHash,
      boardsmithVersion: parsed.boardsmithVersion,
      citedSliceCount: parsed.citedSlices.length,
      unresolvedCount: parsed.unresolved.length,
      blockMalformed: parsed.blockMalformed,
    });
  }

  const withBlocks = counts.full + counts.codeConformanceOnly;
  const projectProvenanceState: ChunkProvenanceStatusResult['projectProvenanceState'] =
    chunks.length === 0
      ? 'empty'
      : withBlocks === 0
        ? 'pre-provenance'
        : verifiedWithoutProvenance.length > 0
          ? 'partial'
          : 'complete';

  const result: ChunkProvenanceStatusResult = {
    chunks,
    counts,
    byEdition,
    bySkillsTreeHash,
    byBoardsmithVersion,
    verifiedWithoutProvenance,
    projectProvenanceState,
  };

  // `quiet` (176-06-discovered bug fix, mirroring ingest-archive.ts's established precedent):
  // suppresses BOTH print branches for an internal composing caller — `json: false` alone still
  // runs the human-report branch below.
  if (options.quiet) return result;

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  for (const c of chunks) {
    const label = c.blockMalformed ? `${c.state} (block malformed)` : c.state;
    const reasonSuffix = c.reason ? `, ${c.reason}` : '';
    console.log(`${c.slug} — ${c.status} — ${label}${reasonSuffix}`);
  }
  console.log('');
  console.log(
    `full: ${counts.full}  code-conformance-only: ${counts.codeConformanceOnly}  unknown: ${counts.unknown}`,
  );

  const editionKeys = Object.keys(byEdition);
  const skillsHashKeys = Object.keys(bySkillsTreeHash);
  const versionKeys = Object.keys(byBoardsmithVersion);
  if (editionKeys.length > 1 || skillsHashKeys.length > 1 || versionKeys.length > 1) {
    console.log('');
    console.log(chalk.yellow('Drift:'));
    if (editionKeys.length > 1) {
      for (const key of editionKeys) {
        console.log(`  edition ${key}: ${byEdition[key].join(', ')}`);
      }
    }
    if (skillsHashKeys.length > 1) {
      for (const key of skillsHashKeys) {
        console.log(`  skills-tree hash ${key}: ${bySkillsTreeHash[key].join(', ')}`);
      }
    }
    if (versionKeys.length > 1) {
      for (const key of versionKeys) {
        console.log(`  BoardSmith version ${key}: ${byBoardsmithVersion[key].join(', ')}`);
      }
    }
  }

  if (verifiedWithoutProvenance.length) {
    console.log('');
    // Severity follows projectProvenanceState, not the raw count. A pre-provenance project has
    // every verified chunk flagged BY DEFINITION; painting that red on every run trains the
    // reader to ignore the flag, and then `partial` — the case that actually indicates a skipped
    // `chunk-check` — goes unread too.
    if (projectProvenanceState === 'pre-provenance') {
      console.log(
        chalk.yellow(
          `NO RECORDED PROVENANCE YET — this project's verifications predate provenance ` +
            `recording, so all ${verifiedWithoutProvenance.length} verified chunk(s) lack a ` +
            `"${VERIFIED_AGAINST_HEADING}" block. This is expected for a project built before ` +
            `this phase, not a fault. Run \`boardsmith chunk-check <slug>\` per chunk to record ` +
            `provenance from here on.`,
        ),
      );
    } else {
      console.log(
        chalk.red(
          `VERIFIED WITHOUT PROVENANCE — this project DOES record provenance elsewhere, yet ` +
            `these chunks' Status claims verification with no valid ` +
            `"${VERIFIED_AGAINST_HEADING}" block behind it. That is the signature of a skipped ` +
            `\`chunk-check\` at close. Run \`boardsmith chunk-check <slug>\` on each:`,
        ),
      );
    }
    for (const slug of verifiedWithoutProvenance) {
      console.log(`  • ${slug}`);
    }
  }

  return result;
}
