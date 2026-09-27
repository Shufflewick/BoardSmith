import {
  chunkMdPath,
  designChunksDir,
  designDir,
  designRulebookDir,
  relChunkMdPath,
  DESIGN_DIR,
} from '../lib/project-paths.js';
import { assertBareName } from '../lib/user-name.js';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import chalk from 'chalk';
import { normalizeEdition } from './ingest-archive.js';
import {
  NON_SLICE_FILES,
  parseAdditionalSources,
  parseSliceSource,
  readRecordedSourcePaths,
  sliceDocuments,
} from './rulebook-sources.js';
import { ENGINE_REVISION } from '../../contract/index.js';
import { hashSkillsTree } from '../lib/skills-tree-hash.js';
import { findHeadingIndex } from './build-manifest.js';
import { type SharedEdit, assessSignoffs, checkSignoff } from './chunk-signoff.js';

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
 * The eight reasons a verification's scope is reduced from `full`. Each fires from ONE specific
 * disk state, and the precedence order below (checked top to bottom, first match wins) is part
 * of the contract:
 *
 *  1. `no-rulebook-project`    — no `rulebook/` directory at all. Nothing to verify against.
 *  2. `index-missing`          — `rulebook/` exists but has no `INDEX.md`.
 *  3. `pre-provenance-project` — `INDEX.md` exists but has no `Source hash:` line at all. This
 *     project predates Phase 170's ingest contract entirely (no `rulebook/source/`, no recorded
 *     hash) — DISTINCT from `source-missing` on purpose. Conflating "never had provenance" with
 *     "had it and lost it" would report every pre-170 project as damaged rather than simply older
 *     (171-CONTEXT.md decision 10).
 *  4. `source-missing`         — `INDEX.md` records a `Source:` path and a `Source hash:`, but no
 *     file exists at that path. Provenance was recorded and the archive is now gone.
 *  5. `source-hash-mismatch`   — the archived file exists, but its SHA-256 does not match the
 *     recorded `Source hash:`. The archive was recorded and then silently changed.
 *  6. `additional-source-missing` — a row of `INDEX.md`'s `## Additional Sources` names a file
 *     that no longer exists (#305).
 *  7. `additional-source-hash-mismatch` — a row's archived file exists but its SHA-256 no longer
 *     matches the recorded one (#305).
 *  8. `slice-source-unrecorded` — a slice names, as the document it was transcribed from, a file
 *     `INDEX.md` does not record (#311). Only `scopeForDocuments` returns it: the project as a
 *     whole cannot have it, since the project-level check reads no slice.
 *
 * `computeVerificationScope` is the PROJECT's scope: every recorded document exists and matches.
 * A chunk's scope is narrower (#311): each slice names the document it came from
 * (`rulebook-sources.ts`), so `scopeForDocuments` reduces a chunk only for a failure in a document
 * its own slices came from. A changed companion document no longer reduces a chunk built on the
 * rulebook alone.
 */
export const SCOPE_REASONS = Object.freeze([
  'source-missing',
  'source-hash-mismatch',
  'index-missing',
  'no-rulebook-project',
  'pre-provenance-project',
  'additional-source-missing',
  'additional-source-hash-mismatch',
  'slice-source-unrecorded',
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
  /**
   * `INDEX.md`'s `## Additional Sources` rows that this function itself confirmed: the archived
   * file at `path` exists and its SHA-256 matches the recorded `sourceHash`. Only confirmed rows
   * are listed here, so a caller reading this array can never mistake a failed one for a verified
   * one. Always present (possibly `[]`) once `rulebook/INDEX.md` could be read.
   */
  additionalSources?: Array<{ sourcePath: string; sourceHash: string }>;
  /**
   * The rows that FAILED that check, each naming why (#305). Any entry here reduces the project's
   * `scope`, and the scope of every chunk whose slices came from that document
   * (`scopeForDocuments`); the list is what lets a report say which document moved. Always present (possibly `[]`) alongside
   * `additionalSources`.
   */
  failedAdditionalSources?: Array<{
    sourcePath: string;
    sourceHash: string;
    reason: 'additional-source-missing' | 'additional-source-hash-mismatch';
  }>;
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
  const rulebookDir = designRulebookDir(dir);

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

  // A project's ADDITIONAL sources (`## Additional Sources`, `ingest-archive.ts`) are checked the
  // same way as the primary (archived file exists AND its SHA-256 matches), and reported whatever
  // the primary's outcome, so a report can name every document that moved.
  const { additionalSources, failedAdditionalSources } = await verifyAdditionalSources(dir, index);
  const additional = { additionalSources, failedAdditionalSources };

  const editionMatch = /^Edition:\s*(.*)$/m.exec(index);
  const edition = editionMatch ? normalizeEdition(editionMatch[1]) : undefined;

  const hashMatch = /^Source hash:\s*(.*)$/m.exec(index);
  if (!hashMatch) {
    return { scope: SCOPE_CODE_ONLY, reason: 'pre-provenance-project', edition, ...additional };
  }
  const sourceHash = hashMatch[1].trim();

  const sourceMatch = /^Source:\s*(.*)$/m.exec(index);
  const sourcePath = sourceMatch ? sourceMatch[1].trim() : undefined;

  // `Source:` in INDEX.md is written the way every citation is written — relative to `design/`
  // (`rulebook/source/rules.pdf`), not to the project root. Resolving it anywhere else silently
  // reports `source-missing` on a project whose source is right there.
  const archivedFullPath = sourcePath ? join(designDir(dir), sourcePath) : undefined;
  let archivedBuf: Buffer | undefined;
  if (archivedFullPath) {
    try {
      archivedBuf = await fs.readFile(archivedFullPath);
    } catch {
      archivedBuf = undefined;
    }
  }
  if (!archivedBuf) {
    return {
      scope: SCOPE_CODE_ONLY,
      reason: 'source-missing',
      edition,
      sourcePath,
      sourceHash,
      ...additional,
    };
  }

  if (sha256(archivedBuf) !== sourceHash) {
    return {
      scope: SCOPE_CODE_ONLY,
      reason: 'source-hash-mismatch',
      edition,
      sourcePath,
      sourceHash,
      ...additional,
    };
  }

  // Precedence mirrors the primary checks: a missing file before a changed one.
  const firstFailure =
    failedAdditionalSources.find((f) => f.reason === 'additional-source-missing') ??
    failedAdditionalSources[0];
  if (firstFailure) {
    return {
      scope: SCOPE_CODE_ONLY,
      reason: firstFailure.reason,
      edition,
      sourcePath,
      sourceHash,
      ...additional,
    };
  }

  return { scope: SCOPE_FULL, edition, sourcePath, sourceHash, ...additional };
}

/** The reasons that describe the project rather than one document, so no narrowing escapes them. */
const PROJECT_WIDE_REASONS: ReadonlySet<ScopeReason> = new Set([
  'no-rulebook-project',
  'index-missing',
  'pre-provenance-project',
]);

/** Which of two per-document failures a narrowed scope reports: the same order as the project's. */
const DOCUMENT_REASON_PRECEDENCE: readonly ScopeReason[] = [
  'source-missing',
  'source-hash-mismatch',
  'additional-source-missing',
  'additional-source-hash-mismatch',
  'slice-source-unrecorded',
];

/**
 * Why `document` cannot be verified against, or `undefined` when it can: it is a document
 * `INDEX.md` records, its archived copy exists, and its SHA-256 matches. Read from `scope`, which
 * `computeVerificationScope` computed from disk — this re-reads nothing.
 */
export function documentFailure(scope: VerificationScope, document: string): ScopeReason | undefined {
  if (scope.reason && PROJECT_WIDE_REASONS.has(scope.reason)) return scope.reason;
  if (document === scope.sourcePath) {
    return scope.reason === 'source-missing' || scope.reason === 'source-hash-mismatch'
      ? scope.reason
      : undefined;
  }
  const failed = scope.failedAdditionalSources?.find((f) => f.sourcePath === document);
  if (failed) return failed.reason;
  if (scope.additionalSources?.some((a) => a.sourcePath === document)) return undefined;
  return 'slice-source-unrecorded';
}

/**
 * The scope of a verification against `documents` only — the documents a chunk's cited slices
 * came from (`rulebook-sources.ts`'s `sliceDocuments`). `full` when every one of them is verified,
 * whatever has happened to the project's other documents; otherwise reduced with the reason of the
 * first failure, in the project's own precedence order. With no documents to narrow to (a chunk
 * citing no slice) the project's scope applies unchanged.
 *
 * Like `computeVerificationScope`, this takes no caller-declared scope: `scope` must be that
 * function's result, and `documents` are read from the slices, never supplied by a session.
 */
export function scopeForDocuments(scope: VerificationScope, documents: readonly string[]): VerificationScope {
  if (documents.length === 0) return scope;
  if (scope.reason && PROJECT_WIDE_REASONS.has(scope.reason)) return scope;
  const failures = new Set(documents.map((d) => documentFailure(scope, d)).filter((r) => r !== undefined));
  const reason = DOCUMENT_REASON_PRECEDENCE.find((r) => failures.has(r));
  if (reason) return { ...scope, scope: SCOPE_CODE_ONLY, reason };
  const full: VerificationScope = { ...scope, scope: SCOPE_FULL };
  delete full.reason;
  return full;
}

/**
 * Checks every `## Additional Sources` row the same way the primary source is checked: the
 * archived file at `path` (relative to `design/`) must exist AND its SHA-256 must match the
 * recorded `sourceHash`. Splits the rows into the confirmed and the failed, each failure naming
 * its reason.
 */
async function verifyAdditionalSources(
  dir: string,
  index: string,
): Promise<Required<Pick<VerificationScope, 'additionalSources' | 'failedAdditionalSources'>>> {
  const additionalSources: Array<{ sourcePath: string; sourceHash: string }> = [];
  const failedAdditionalSources: NonNullable<VerificationScope['failedAdditionalSources']> = [];
  for (const record of parseAdditionalSources(index)) {
    const row = { sourcePath: record.path, sourceHash: record.sourceHash };
    let buf: Buffer;
    try {
      buf = await fs.readFile(join(designDir(dir), record.path));
    } catch {
      failedAdditionalSources.push({ ...row, reason: 'additional-source-missing' });
      continue;
    }
    if (sha256(buf) === record.sourceHash) {
      additionalSources.push(row);
    } else {
      failedAdditionalSources.push({ ...row, reason: 'additional-source-hash-mismatch' });
    }
  }
  return { additionalSources, failedAdditionalSources };
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
 * Each cited slice's hash, and the documents the slices came from (`rulebook-sources.ts`'s
 * `sliceDocuments`): what a chunk's `## Verified Against` block records, and what its scope
 * narrows to.
 */
async function readCitedSlices(
  projectDir: string,
  resolved: string[],
): Promise<{ citedSlices: Array<{ path: string; hash: string }>; documents: string[] }> {
  const recorded = await readRecordedSourcePaths(projectDir);
  const citedSlices: Array<{ path: string; hash: string }> = [];
  const documents = new Set<string>();
  for (const rel of resolved) {
    const bytes = await fs.readFile(join(designDir(projectDir), rel));
    citedSlices.push({ path: rel, hash: sha256(bytes) });
    const sliceSource = NON_SLICE_FILES.includes(basename(rel)) ? undefined : parseSliceSource(bytes.toString('utf-8'));
    for (const d of sliceDocuments(sliceSource, recorded)) documents.add(d);
  }
  return { citedSlices, documents: [...documents] };
}

/**
 * `boardsmith chunk-check <slug>` — PROV-01's deliverable. Writes or repairs a fenced,
 * machine-owned `## Verified Against` block into `chunks/<slug>/CHUNK.md`, and exits non-zero
 * when it had to. `ingestCheckCommand` (`ingest-check.ts`) is the precedent copied line for
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
  'Engine revision:',
  'Skills tree hash:',
  'Cited slices:',
  'Unresolved citations:',
  'Re-verified (no code change):',
  'Additional source hash:',
] as const);

const [
  LABEL_SCOPE,
  LABEL_REASON,
  LABEL_EDITION,
  LABEL_SOURCE_HASH,
  LABEL_ENGINE,
  LABEL_SKILLS_HASH,
  LABEL_CITED,
  LABEL_UNRESOLVED,
  LABEL_REVERIFIED,
  LABEL_ADDITIONAL_SOURCE,
] = VERIFIED_AGAINST_LABELS;

/**
 * One `Additional source hash: <sha256> <path>` line per `## Additional Sources` row the chunk was
 * verified against (#305), rendered right after `Rulebook source hash:`. Hash first because it is
 * fixed-width, so a path containing spaces still parses. Absent for a single-source project, so
 * those blocks are byte-identical to before; a block without the line records no additional
 * source, which `resolveProvenance` reads as "not verified against the current one".
 */
/**
 * The engine line of a block written before #440. It recorded package.json's version, `0.0.1` for
 * every engine there has been, so it names no engine: such a block is "engine unknown", and
 * `chunk-check` records the installed engine in it without making the chunk stale.
 */
const PRE_ENGINE_LINE_RE = /^BoardSmith version:.*$/m;
const ENGINE_LINE_RE = new RegExp(`^${LABEL_ENGINE} (\\d+)$`, 'm');

const ADDITIONAL_SOURCE_LINE_RE = new RegExp(
  `^${LABEL_ADDITIONAL_SOURCE}\\s+([0-9a-f]{64})\\s+(\\S.*)$`,
  'gm',
);

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
  /** The hash-verified `## Additional Sources` rows, anchoring the rest of the rules (#305). */
  additionalSources?: Array<{ sourcePath: string; sourceHash: string }>;
  /**
   * The engine contract revision (`ENGINE_REVISION`, #440) the chunk was verified against. It moves
   * whenever the engine's contract does, and a change makes the block stale.
   */
  engineRevision: number;
  /** Provenance only (#438): the skills that governed the verification. Never makes it stale. */
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
  for (const additional of record.additionalSources ?? []) {
    lines.push(`${LABEL_ADDITIONAL_SOURCE} ${additional.sourceHash} ${additional.sourcePath}`);
  }
  lines.push(`${LABEL_ENGINE} ${record.engineRevision}`);
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
     edition anchor, the installed engine's contract revision, and the verification scope
     \`computeVerificationScope()\` derives from disk. Any of those changing makes the block stale.
     The skills-tree content hash is provenance only: it records which skill text governed the
     verification, and a later skills reinstall leaves the block current. It runs from \`close\`
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
 * The result of `recordVerifiedAgainst` — the reusable fenced writer both `chunkCheckCommand` and
 * a verify Close (`verify-close-record.ts`, 179-03) call. Sets no exit code and prints nothing:
 * exit codes and output are command-level concerns, and a reusable writer that mutates
 * `process.exitCode` could never be called from a Close that must exit 0 (179-CONTEXT.md decision
 * 4/measured_reality #2).
 */
export interface VerifiedAgainstWriteResult {
  slug: string;
  scope: typeof SCOPE_FULL | typeof SCOPE_CODE_ONLY;
  reason?: ScopeReason;
  /** True when the fenced body differed from what was already on disk and the file was written. */
  changed: boolean;
  citedSlices: string[];
  unresolved: string[];
  /**
   * The same cited slices, paired with the hash recorded for each — `chunkCheckCommand` uses this
   * (rather than `citedSlices` above) to compose its "cited-slice hashes rewritten" human bullet,
   * which needs the hash, not just the path. Kept as a distinct field so the plain `citedSlices:
   * string[]` shape callers already depend on (the `--json` output, pinned by an existing test)
   * never changes shape.
   */
  citedSliceHashes: Array<{ path: string; hash: string }>;
  /**
   * Present when the installed skills differ from the ones the block records and nothing else
   * changed: information for the reader, never staleness (#438).
   */
  skillsTreeChanged?: { recorded: string; installed: string };
  /**
   * Present when the block was written before it recorded the engine (#440) and nothing else
   * changed: the engine revision now recorded in it. The chunk is not stale; the file changed.
   */
  engineRecorded?: number;
  /**
   * `undefined` when the block was freshly created (no prior body to compare bullets against);
   * present when a repair ran. `chunkCheckCommand` uses this to compose its own human bullets —
   * see that function's `previousBody === undefined` branch below.
   */
  previousBody?: string;
}

/**
 * The extracted, reusable fenced writer behind BOTH `boardsmith chunk-check <slug>` (the BUILD
 * pipeline's repair-then-fail command below) and a verify Close's durable provenance write
 * (`verify-close-record.ts`, 179-03). Computes `## Verified Against` from disk state exactly as
 * `chunkCheckCommand` always has — the line-anchored heading match, the fence-bounded splice, the
 * `changed` comparison against `previousBody` — and writes the file only when `changed` is true.
 *
 * Returns, never throws, for the ordinary outcomes (created / repaired / already current). The
 * TWO existing throws are preserved exactly as they were in `chunkCheckCommand` — no-such-chunk
 * and fence-refusal — because both mean the file was never touched and the caller needs a loud,
 * actionable failure, not a silent skip.
 *
 * Sets no exit code, prints nothing. See `VerifiedAgainstWriteResult`'s doc comment for why.
 */
export async function recordVerifiedAgainst(
  slug: string,
  options: VerifiedAgainstOptions = {},
): Promise<VerifiedAgainstWriteResult> {
  const { result, chunkPath, updated } = await planVerifiedAgainst(slug, options);
  if (result.changed || result.engineRecorded !== undefined) await fs.writeFile(chunkPath, updated);
  return result;
}

/**
 * Whether `chunk-check` would find the chunk's `## Verified Against` block current, without
 * writing anything: `changed` is true when it would have to repair it. `chunk-merge` asks this of
 * each chunk whose file it vouches for on the combined tree (#403).
 */
export async function verifiedAgainstIsCurrent(projectDir: string, slug: string): Promise<boolean> {
  return !(await planVerifiedAgainst(slug, { project: projectDir })).result.changed;
}

interface VerifiedAgainstOptions {
  project?: string;
  /**
   * 175-CONTEXT.md decision 11's stamp value — the drift comparison evidence justifying a
   * "re-verified, no code change" claim (e.g. `<hash>..<head> — 0 manifest files changed`).
   * When supplied, writes the `Re-verified (no code change):` label; omitted otherwise.
   */
  reverifiedNoCodeChange?: string;
}

/** Computes the `## Verified Against` block and the CHUNK.md it belongs in. Writes nothing. */
async function planVerifiedAgainst(
  slug: string,
  options: VerifiedAgainstOptions,
): Promise<{ result: VerifiedAgainstWriteResult; chunkPath: string; updated: string }> {
  const projectDir = resolve(options.project ?? process.cwd());
  const chunkPath = chunkMdPath(projectDir, slug);
  const relChunkPath = relChunkMdPath(slug);

  let chunkText: string;
  try {
    chunkText = await fs.readFile(chunkPath, 'utf-8');
  } catch {
    throw new Error(
      `No chunk found at ${relChunkPath} in ${projectDir}.\n` +
        `Check the slug, or run \`boardsmith chunk-provenance-status\` to list known chunks.`,
    );
  }

  const projectScope = await computeVerificationScope(projectDir);

  const rulebookDir = designRulebookDir(projectDir);
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
  const { citedSlices, documents } = await readCitedSlices(projectDir, resolved);
  // The chunk is verified against the documents its slices came from, not the whole project (#311).
  const scope = scopeForDocuments(projectScope, documents);

  const record: VerifiedAgainstRecord = {
    scope: scope.scope,
    reason: scope.reason,
    edition: scope.edition,
    sourceHash: scope.sourceHash,
    additionalSources: scope.additionalSources ?? [],
    engineRevision: ENGINE_REVISION,
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

  // The skills hash is provenance, not an input (#438): it records which skill text governed the
  // verification. A later reinstall leaves the block current and keeps the recorded hash; only a
  // change to what the chunk was verified against (scope, rules, cited slices, engine revision)
  // makes it stale, and that rewrite records the skills installed now.
  const recordedSkills =
    previousBody === undefined ? undefined : new RegExp(`^${LABEL_SKILLS_HASH} (.*)$`, 'm').exec(previousBody)?.[1];
  const asRecorded =
    recordedSkills === undefined ? newBody : renderVerifiedAgainst({ ...record, skillsTreeHash: recordedSkills });
  // A block from before #440 names no engine. It is compared as if it named the installed one, so
  // recording the engine never makes a chunk stale; anything else that changed still does.
  const engineUnknown =
    previousBody !== undefined && !ENGINE_LINE_RE.test(previousBody) && PRE_ENGINE_LINE_RE.test(previousBody);
  const compared = engineUnknown
    ? previousBody!.replace(PRE_ENGINE_LINE_RE, `${LABEL_ENGINE} ${record.engineRevision}`)
    : previousBody;
  const changed = compared === undefined || compared !== asRecorded;
  const skillsTreeChanged =
    !changed && recordedSkills !== undefined && recordedSkills !== record.skillsTreeHash
      ? { recorded: recordedSkills, installed: record.skillsTreeHash }
      : undefined;
  const engineRecorded = !changed && engineUnknown ? record.engineRevision : undefined;
  if (engineRecorded !== undefined) updated = chunkText.replace(previousBody!, compared!);

  const result: VerifiedAgainstWriteResult = {
    slug,
    scope: record.scope,
    reason: record.reason,
    changed,
    citedSlices: citedSlices.map((c) => c.path),
    citedSliceHashes: citedSlices,
    unresolved,
    ...(previousBody !== undefined ? { previousBody } : {}),
    ...(skillsTreeChanged ? { skillsTreeChanged } : {}),
    ...(engineRecorded !== undefined ? { engineRecorded } : {}),
  };
  return { result, chunkPath, updated };
}

/** `chunk-check`'s human line for a current block, and the skills reinstall as information (#438). */
function reportUpToDate(
  slug: string,
  record: { scope: string; reason?: string },
  skillsTreeChanged: VerifiedAgainstWriteResult['skillsTreeChanged'],
  engineRecorded: number | undefined,
): void {
  console.log(
    chalk.green(
      `✓ ${relChunkMdPath(slug)} — Verified Against up to date (${record.scope}${record.reason ? `, ${record.reason}` : ''})`,
    ),
  );
  if (skillsTreeChanged) {
    console.log(
      `  The bs skills have been reinstalled since ${slug} was verified (skills tree hash ` +
        `${skillsTreeChanged.recorded} then, ${skillsTreeChanged.installed} now). That is recorded ` +
        `as provenance only and does not make the chunk stale; nothing to do.`,
    );
  }
  if (engineRecorded !== undefined) {
    console.log(
      `  ${slug} was verified before its Verified Against block recorded the engine. It now records ` +
        `engine revision ${engineRecorded}, the one installed; that does not make the chunk stale. ` +
        `Commit ${DESIGN_DIR}/${relChunkMdPath(slug)}.`,
    );
  }
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
 *
 * THIN CALLER (179-03 extraction): all computation and the write itself now live in
 * `recordVerifiedAgainst` above. This function applies ONLY its own command-level contract on
 * top — the JSON shape, the human bullets, and `process.exitCode = 1` when `changed` — unchanged
 * from before the extraction, so the build pipeline (`build/close.md`) sees no behavioural change.
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
  // `<slug>` NAMES a chunk, it does not LOCATE one (#240). Refused before it is
  // joined into a path, so a path-shaped slug cannot write a provenance block
  // into another project's CHUNK.md under a slug that is a path.
  assertBareName(
    '<slug>',
    slug,
    'Pass the slug of a chunk in this project, which is the name of a directory under ' +
      'design/chunks/ holding a CHUNK.md.\n' +
      '`boardsmith chunk-provenance-status` lists them; `--project <dir>` picks a different ' +
      'project.',
  );

  const relChunkPath = relChunkMdPath(slug);

  const {
    scope: recordScope,
    reason: recordReason,
    changed,
    citedSlices,
    citedSliceHashes,
    unresolved,
    previousBody,
    skillsTreeChanged,
    engineRecorded,
  } = await recordVerifiedAgainst(slug, {
    project: options.project,
    reverifiedNoCodeChange: options.reverifiedNoCodeChange,
  });
  const record = { scope: recordScope, reason: recordReason };

  // #291: a verified Status must be backed by a recorded sign-off. Nothing here can be repaired:
  // only the designer can sign a chunk off, so this fails without writing anything.
  const signoffProblems = await checkSignoff(resolve(options.project ?? process.cwd()), slug);

  const result = {
    slug,
    scope: record.scope,
    reason: record.reason,
    changed,
    citedSlices,
    unresolved,
    signoffProblems,
    ...(skillsTreeChanged ? { skillsTreeChanged } : {}),
    ...(engineRecorded !== undefined ? { engineRecorded } : {}),
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  }

  if (signoffProblems.length) {
    if (!options.json) {
      console.error(chalk.red(`${relChunkPath}'s verified status is not backed by a valid sign-off:`));
      for (const p of signoffProblems) console.error(`  • ${p}`);
      console.error('');
    }
    process.exitCode = 1;
  }

  if (!changed) {
    if (!options.json && !signoffProblems.length) reportUpToDate(slug, record, skillsTreeChanged, engineRecorded);
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
      if (citedSliceHashes.some((s) => !previousBody!.includes(`| ${s.path} | ${s.hash} |`))) {
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
  /** Each `Additional source hash:` line (#305); `[]` when the block records none. */
  additionalSources: Array<{ sourcePath: string; sourceHash: string }>;
  /** `undefined` when the block names no engine: none at all, or one written before #440. */
  engineRevision?: number;
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
  return {
    state: PROVENANCE_UNKNOWN,
    additionalSources: [],
    citedSlices: [],
    unresolved: [],
    blockMalformed,
  };
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
  const engineRaw = ENGINE_LINE_RE.exec(body)?.[1];
  const skillsHashRaw = readLabel(LABEL_SKILLS_HASH);
  // Absence is valid — an eight-label block predates decision 11's append and is not malformed.
  const reverifiedNoCodeChangeRaw = readLabel(LABEL_REVERIFIED);

  if (
    (scopeRaw !== SCOPE_FULL && scopeRaw !== SCOPE_CODE_ONLY) ||
    editionRaw === undefined ||
    sourceHashRaw === undefined ||
    (engineRaw === undefined && !PRE_ENGINE_LINE_RE.test(body)) ||
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
    additionalSources: [...body.matchAll(ADDITIONAL_SOURCE_LINE_RE)].map((m) => ({
      sourcePath: m[2].trim(),
      sourceHash: m[1],
    })),
    ...(engineRaw !== undefined ? { engineRevision: Number(engineRaw) } : {}),
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
  /** `undefined` for a block written before #440, which names no engine. */
  engineRevision?: number;
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
  /** Keyed by engine revision; `unknown` holds blocks written before #440. */
  byEngineRevision: Record<string, string[]>;
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
   * #291: chunks whose Status claims verification that no valid sign-off backs, with the reasons
   * `checkSignoff` gives. Unlike `verifiedWithoutProvenance` this has no "older project" excuse: a
   * verified status is derived from a sign-off, so every entry here is a status set by hand, a
   * waiver stretched past the chunks it names, or a playtest item nobody observed.
   */
  verifiedWithoutSignoff: Array<{ slug: string; problems: string[] }>;
  /**
   * #396: verified chunks whose files were edited after their sign-off by another chunk, where
   * that chunk's later sign-off saw the edit or that chunk is being built. Information for a
   * reviewer, not a fault: chunks that add to shared files edit them in the normal course of a
   * build, and the sign-off still stands.
   */
  signoffSharedEdits: Array<{ slug: string; edits: SharedEdit[] }>;
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
  const chunksDir = designChunksDir(projectDir);

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
  const byEngineRevision: Record<string, string[]> = {};
  const verifiedWithoutProvenance: string[] = [];
  const verifiedWithoutSignoff: Array<{ slug: string; problems: string[] }> = [];
  const signoffSharedEdits: Array<{ slug: string; edits: SharedEdit[] }> = [];
  const signoffs = await assessSignoffs(projectDir);
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
    if (parsed.state !== PROVENANCE_UNKNOWN) (byEngineRevision[String(parsed.engineRevision ?? 'unknown')] ??= []).push(slug);

    if (status.startsWith('verified') && parsed.state === PROVENANCE_UNKNOWN) {
      verifiedWithoutProvenance.push(slug);
    }

    const signoff = signoffs.get(slug);
    if (signoff?.problems.length) verifiedWithoutSignoff.push({ slug, problems: signoff.problems });
    if (signoff?.sharedEdits.length) signoffSharedEdits.push({ slug, edits: signoff.sharedEdits });

    chunks.push({
      slug,
      status,
      state: parsed.state,
      reason: parsed.reason,
      edition: parsed.edition,
      skillsTreeHash: parsed.skillsTreeHash,
      engineRevision: parsed.engineRevision,
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
    byEngineRevision,
    verifiedWithoutProvenance,
    verifiedWithoutSignoff,
    signoffSharedEdits,
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
  const engineKeys = Object.keys(byEngineRevision);
  if (editionKeys.length > 1 || skillsHashKeys.length > 1 || engineKeys.length > 1) {
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
    if (engineKeys.length > 1) {
      for (const key of engineKeys) {
        const note = key === 'unknown' ? ' (verified before the block recorded the engine; chunk-check records it)' : '';
        console.log(`  engine revision ${key}: ${byEngineRevision[key].join(', ')}${note}`);
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

  if (verifiedWithoutSignoff.length) {
    console.log('');
    console.log(
      chalk.red(
        `VERIFIED WITHOUT SIGN-OFF: these chunks' Status claims verification that no valid ` +
          `designer sign-off backs. Set each back to built and have the designer sign it off ` +
          `with \`boardsmith chunk-signoff <slug>\`:`,
      ),
    );
    for (const { slug, problems } of verifiedWithoutSignoff) {
      console.log(`  • ${slug}`);
      for (const p of problems) console.log(`      ${p}`);
    }
  }

  if (signoffSharedEdits.length) {
    console.log('');
    console.log(
      `Shared files edited since sign-off (for information; each sign-off still stands, because ` +
        `the chunk named signed off the edit or is building it):`,
    );
    for (const { slug, edits } of signoffSharedEdits) {
      const described = edits.map((e) =>
        `${e.path} (${e.how === 'signed-off' ? 'signed off with' : 'being built by'} ${e.coveredBy})`,
      );
      console.log(`  • ${slug}: ${described.join(', ')}`);
    }
  }

  return result;
}
