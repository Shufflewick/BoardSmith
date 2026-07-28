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
 * Verb classification for a manifest row's status cell.
 *
 * Both tests run against the cell's LEADING VERB ONLY (`leadingVerb()`), never the whole cell.
 * Real status cells are `<verb> — <free prose>` or `<verb> (<note>) — <free prose>`, and that
 * prose routinely contains "new"/"written" while describing something the chunk did NOT author
 * ("updated — new coverage added…", "touched — depends on the new helper written in game.ts").
 * Matching anywhere in the cell classified those as authoring — the dangerous direction, because
 * rung 3 of the CONTEXT.md decision-3 ladder narrows TO the authoring chunk, so a false authoring
 * silently attributes a claim citation to a chunk that merely touched the file. Found by
 * `172-PROOF.md`'s hand-walk of the ladder.
 *
 * Anchoring to the leading verb makes this a strict allow-list: authoring is asserted ONLY by a
 * leading `new`/`written`, and every other verb — `edited`, `extended`, `rewritten`, `tightened`,
 * `unchanged`, `updated`, or anything future authors invent — is non-authoring by default. No
 * companion editing-verb blocklist is needed (a leading verb cannot be in both), and a blocklist
 * would be the wrong shape anyway: it must be exhaustive to be correct, and the live data already
 * contains verbs it would have missed. "edited, then NEW again" resolves to `edited` and stays
 * non-authoring for the same reason.
 */
const AUTHORING_VERBS = /^(new|written)$/i;

/**
 * The status cell's leading verb: the first word, stripped of trailing punctuation. Returns '' for
 * an empty cell, which classifies as neither editing nor authoring.
 */
function leadingVerb(status: string): string {
  return status.trimStart().split(/[\s,(—-]/, 1)[0] ?? '';
}

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
    const isAuthoring = AUTHORING_VERBS.test(leadingVerb(status));

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

// ---------------------------------------------------------------------------------------------
// parseRulings
// ---------------------------------------------------------------------------------------------

export interface ParsedRuling {
  number: number;
  /** Set only for the explicit supersede verbs, direction-resolved. */
  supersededBy?: number;
  /** Supersede-verb sentences whose target number or direction could not be resolved. */
  unparsedSupersession: string[];
}

/**
 * ONLY these two explicit supersede-verb shapes are read as a chain. RESEARCH.md enumerated all
 * 62 rulings across both reference games: exactly 3 occurrences are real supersession, and every
 * other cross-ruling verb ("reconciles", "extends", "UPHOLDS", "resolves OQ-N", "overrides
 * DECISIONS.md Decision N") is a citation to a live, non-obsoleted ruling. Broadening this verb
 * list is the single highest-yield way to make this check fire on correct work, which is how a
 * check gets waived — do not "helpfully" widen it later.
 */
const SUPERSEDED_BY = /supersede[sd]?\s+by\s+ruling\s+(\d+)/i;
const SUPERSEDES_RULING = /\bsupersedes\s+ruling\s+(\d+)/i;
/** Any other supersede-verb occurrence — recorded verbatim in `unparsedSupersession`. */
const SUPERSEDE_VERB = /supersede[sd]?/i;

/** Splits an entry body into individual sentences, for verbatim reporting of unparsed shapes. */
function sentences(body: string): string[] {
  return body
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parses `RULINGS.md`'s `### Ruling N` entries with narrow, direction-aware supersession per
 * 172-CONTEXT.md decision (specifics section) and RESEARCH.md's measured verb shapes:
 *
 * - `supersedes Ruling M` on entry N's own body means M is superseded by N (the sentence names
 *   the superseded target; the entry names the superseder).
 * - `superseded by Ruling M` on entry N's own body means N is superseded by M (the reversed
 *   direction — a parser assuming "the number after 'Ruling' is the superseder" gets this
 *   backwards).
 * - A supersede verb whose object is not a resolvable `Ruling M` (e.g. "supersedes the RATIONALE
 *   of Ruling 3" — the object is a sub-part, not the ruling itself) is recorded verbatim in
 *   `unparsedSupersession`, never assumed as a chain.
 */
export function parseRulings(rulingsText: string): ParsedRuling[] {
  const HEADING = /^### Ruling (\d+)[ \t]*$/gm;
  const headings: Array<{ number: number; index: number; bodyStart: number }> = [];
  for (const match of rulingsText.matchAll(HEADING)) {
    const lineEnd = rulingsText.indexOf('\n', match.index);
    headings.push({
      number: Number(match[1]),
      index: match.index,
      bodyStart: lineEnd === -1 ? rulingsText.length : lineEnd,
    });
  }

  const byNumber = new Map<number, ParsedRuling>();
  for (const h of headings) {
    byNumber.set(h.number, { number: h.number, unparsedSupersession: [] });
  }

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const bodyEnd = i + 1 < headings.length ? headings[i + 1].index : rulingsText.length;
    const body = rulingsText.slice(h.bodyStart, bodyEnd);
    const entry = byNumber.get(h.number)!;

    for (const sentence of sentences(body)) {
      if (!SUPERSEDE_VERB.test(sentence)) continue;

      const backward = SUPERSEDED_BY.exec(sentence);
      if (backward) {
        // "superseded by Ruling M" on entry N's own body -> N is superseded by M.
        entry.supersededBy = Number(backward[1]);
        continue;
      }

      const forward = SUPERSEDES_RULING.exec(sentence);
      if (forward) {
        // "supersedes Ruling M" on entry N's own body -> M is superseded by N, IF the sentence
        // names the ruling directly (not a sub-part like "the RATIONALE of Ruling M").
        const targetNumber = Number(forward[1]);
        const target = byNumber.get(targetNumber);
        if (target) {
          target.supersededBy = h.number;
          continue;
        }
      }

      // Supersede verb present, but neither shape resolved cleanly (e.g. the object is a
      // sub-part like "the RATIONALE of Ruling N", or no ruling number is present at all).
      entry.unparsedSupersession.push(sentence);
    }
  }

  return headings.map((h) => byNumber.get(h.number)!);
}
