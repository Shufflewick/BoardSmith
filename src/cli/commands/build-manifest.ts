/**
 * `build-manifest.ts` — the single shared parser module for `## Build Manifest`,
 * `## Interpretation`, `## Verified Commit Hash`, and `RULINGS.md`, plus the locked
 * `FINDING_KINDS` enum (172-CONTEXT.md decision 7).
 *
 * WHY THIS IS ONE MODULE, NOT THREE
 *
 * 172-CONTEXT.md decision 1 requires "one parser, one authority" — the Build Manifest is the
 * claim-numbering authority for CHECK-03 and the file list for CHECK-05, so it must be parsed in
 * exactly one place. `trace-check.ts` (172-02) and `drift-check.ts` (172-03) both import from
 * here rather than each re-deriving their own heading-location logic.
 *
 * This is a `commands/`-directory module with NO commander action of its own — the same
 * convention as `chunk-provenance.ts` exporting `resolveCitedSlices` for reuse.
 */

/** The locked finding-kind enum from 172-CONTEXT.md decision 7. Never a hand-written union. */
export const FINDING_KINDS = Object.freeze([
  'claim-untested',
  'ruling-untested',
  'test-unlinked',
  'unassociated-test',
  'ambiguous-claim-ref',
  'unresolved-claim-ref',
  'manifest-file-missing',
  'chunk-code-drifted',
  'drift-unknown',
] as const);

export type FindingKind = (typeof FINDING_KINDS)[number];

/** Machine fields are `kind`/`chunk`/`subject`; `detail` is prose nothing parses. */
export interface Finding {
  kind: FindingKind;
  chunk: string;
  subject: string;
  detail: string;
}

/**
 * Escapes a string for literal use inside a `RegExp`. `heading` values passed to
 * `findHeadingIndex`/`extractSection` are markdown heading text (`## Build Manifest`), not
 * user-supplied regex source — this exists so a heading containing regex-special characters
 * (none of this phase's headings do, but a future caller's might) cannot corrupt the anchor.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The single heading-location primitive this module exports. Line-anchored (`^...[ \t]*$` with
 * the `m` flag), never a substring search.
 *
 * Carries commit `f73153a3`'s lesson directly: `chunkText.indexOf(heading)` also matches a
 * heading NAME appearing in prose elsewhere in the file (CHUNK.template.md's own required-
 * headings comment names every section heading, ~130 lines above the real sections) — that
 * silently truncated a scan and dropped every citation it should have found. No caller in this
 * phase should ever write `text.indexOf('## ...')`; this is the only heading-location primitive
 * the module exports, and `extractSection` is built directly on top of it.
 *
 * Returns the index of the heading LINE (matching `.exec(text).index`), or -1 if absent.
 */
export function findHeadingIndex(text: string, heading: string): number {
  const re = new RegExp(`^${escapeRegExp(heading)}[ \\t]*$`, 'm');
  const match = re.exec(text);
  return match ? match.index : -1;
}

/**
 * The body from just after the heading LINE to the next `^## ` line (or EOF). Bounded on `^## `
 * specifically, never `^#+ ` — a `## Interpretation` section legitimately contains
 * `### Corrections from Redteam Round N` subheadings, and bounding on any `#` would truncate the
 * body before those corrections, silently dropping every claim inside them.
 *
 * Returns `undefined` if the heading is absent — never a partial body.
 */
export function extractSection(text: string, heading: string): string | undefined {
  const headingIdx = findHeadingIndex(text, heading);
  if (headingIdx === -1) return undefined;

  const headingLineEnd = text.indexOf('\n', headingIdx);
  const bodyStart = headingLineEnd === -1 ? text.length : headingLineEnd + 1;
  const bodyText = text.slice(bodyStart);

  const nextHeadingMatch = /^## /m.exec(bodyText);
  const bodyEnd = nextHeadingMatch ? nextHeadingMatch.index : bodyText.length;

  return bodyText.slice(0, bodyEnd);
}

// ---------------------------------------------------------------------------------------------
// parseBuildManifest
// ---------------------------------------------------------------------------------------------

export interface ManifestEntry {
  path: string;
  /** Raw status-cell prose, verbatim. */
  status: string;
  /** true when the status cell marks this file NEW/written rather than edited/extended/rewritten/tightened. */
  authoring: boolean;
}

export interface ParsedManifest {
  /** false when the `## Build Manifest` section exists but has no `| File | Status |` table at all. */
  tabular: boolean;
  entries: ManifestEntry[];
  /** 1-based indexes of table rows whose first cell yielded zero path tokens. */
  pathlessRowIndexes: number[];
}

/** Path-shaped tokens: a run of path characters ending in a dot-extension. */
const PATH_TOKEN = /[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/g;

/**
 * Editing verbs checked BEFORE the NEW/written test — a status cell naming both (real shape:
 * "edited, then NEW again") is conservatively treated as NOT authoring, since rung 3 of the
 * CONTEXT.md decision-3 resolution ladder narrows TO the authoring chunk and a false-authoring
 * classification is the more dangerous direction to be wrong in.
 */
const EDITING_VERBS = /\b(edited|extended|rewritten|tightened)\b/i;
const AUTHORING_VERBS = /\b(new|written)\b/i;

/**
 * Parses the `## Build Manifest` section per 172-CONTEXT.md decision 11.
 *
 * Table rows are lines starting with `|` that are not the header row (`| File | Status |`) or the
 * separator row (`|---|---|`). If zero table rows are found but the section body has non-
 * whitespace content, the manifest is reported `tabular: false` — a bulleted prose list, distinct
 * from a table whose body is legitimately empty (`tabular: true`, zero entries). Callers must be
 * able to tell "could not parse" from "parsed, and there are none".
 */
export function parseBuildManifest(chunkText: string): ParsedManifest {
  const body = extractSection(chunkText, '## Build Manifest');
  if (body === undefined) {
    return { tabular: false, entries: [], pathlessRowIndexes: [] };
  }

  const lines = body.split('\n');
  const isSeparatorRow = (trimmed: string) => /^[|\-:\s]+$/.test(trimmed) && trimmed.includes('-');
  const isHeaderRow = (trimmed: string) => /^file$/i.test(trimmed.split('|')[1]?.trim() ?? '');

  // Table STRUCTURE is present if a header row or a separator row (`|---|---|`) exists anywhere
  // in the body, independent of whether any DATA row follows — this is what distinguishes a real
  // table with a legitimately empty body from a bulleted prose list, which has neither shape.
  const hasTableStructure = lines.some((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith('|') && (isSeparatorRow(trimmed) || isHeaderRow(trimmed));
  });

  const rowLines = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) return false;
    if (isSeparatorRow(trimmed)) return false;
    if (isHeaderRow(trimmed)) return false;
    return true;
  });

  if (rowLines.length === 0) {
    if (hasTableStructure) {
      return { tabular: true, entries: [], pathlessRowIndexes: [] };
    }
    const hasContent = body.trim().length > 0;
    return { tabular: !hasContent, entries: [], pathlessRowIndexes: [] };
  }

  const entries: ManifestEntry[] = [];
  const pathlessRowIndexes: number[] = [];

  rowLines.forEach((line, i) => {
    const cells = line.trim().split('|');
    // cells[0] is '' (before the leading |), cells[1] is the first content cell.
    const firstCell = cells[1] ?? '';
    const statusCell = cells[2] ?? '';

    const paths = [...firstCell.matchAll(PATH_TOKEN)].map((m) => m[0]);
    if (paths.length === 0) {
      pathlessRowIndexes.push(i + 1);
      return;
    }

    const status = statusCell.trim();
    const isEditing = EDITING_VERBS.test(status);
    const isAuthoring = !isEditing && AUTHORING_VERBS.test(status);

    for (const path of paths) {
      entries.push({ path, status, authoring: isAuthoring });
    }
  });

  return { tabular: true, entries, pathlessRowIndexes };
}

// ---------------------------------------------------------------------------------------------
// parseInterpretationClaims
// ---------------------------------------------------------------------------------------------

/**
 * The LIVE claim set: the integers that actually appear as `^N. **` items inside the
 * `## Interpretation` body only. A numbered list in another section (e.g.
 * `## Playtest Test Script`'s own `6. **Regression ...**` step) contributes nothing — this
 * function never scans `chunkText` directly, only the section body `extractSection` returns.
 *
 * Non-contiguous starts are preserved verbatim, never normalised to `1..max`.
 */
export function parseInterpretationClaims(chunkText: string): number[] {
  const body = extractSection(chunkText, '## Interpretation');
  if (body === undefined) return [];

  const claims = new Set<number>();
  const CLAIM_ITEM = /^(\d+)\.\s+\*\*/gm;
  for (const match of body.matchAll(CLAIM_ITEM)) {
    claims.add(Number(match[1]));
  }
  return [...claims].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------------------------
// extractVerifiedCommitHash
// ---------------------------------------------------------------------------------------------

const HASH_TOKEN = /`?([0-9a-f]{7,40})`?/;

/**
 * Extracts the `## Verified Commit Hash` section's hash, per RESEARCH.md's five measured real
 * formats: bare/backtick-wrapped, 7-char/40-char, and prose-prefixed (the hash is not the first
 * line — two sentences may precede it). When a section contains two hashes, the FIRST match after
 * the heading is returned, deterministically.
 */
export function extractVerifiedCommitHash(chunkText: string): string | undefined {
  const body = extractSection(chunkText, '## Verified Commit Hash');
  if (body === undefined) return undefined;
  const match = HASH_TOKEN.exec(body);
  return match?.[1];
}

