import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { normalizeEdition } from './ingest-archive.js';

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
