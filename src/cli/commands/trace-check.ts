/**
 * `trace-check.ts` — CHECK-03: the source-free traceability sweep.
 *
 * Answers three questions in one run, purely by parsing artifacts already on disk:
 *   1. Does every live `## Interpretation` claim have a citing test?
 *   2. Does every test's `claim N` / `Ruling N` citation resolve to a real, live claim/ruling?
 *   3. Does every `RULINGS.md` ruling have a citing test?
 *
 * Zero rulebook or source access anywhere in this module (172-CONTEXT.md decision 4) — it never
 * runs `npm test`, never imports the engine, never reads `rulebook/`.
 *
 * READ-ONLY. No mutating `fs` call (`writeFile`/`rm`/`mkdir`) appears anywhere in this file's
 * body. Pinned directly by a before/after whole-project byte-hash test, the T-171-19 class
 * (`chunk-provenance.ts:706-714` is the precedent this doc comment mirrors).
 */

// -------------------------------------------------------------------------------------------
// scanTestCitations
// -------------------------------------------------------------------------------------------

export interface ScannedCitations {
  claims: number[];
  rulings: number[];
  importsRules: boolean;
}

/**
 * Scans forward from `start` for a comma/slash/`and`/whitespace-separated run of integers,
 * stopping the instant the next token is not a number — in particular, a `Ruling` token is never
 * a valid separator, so `claim 28 / Ruling 9/15` stops the claim list at `28` rather than
 * swallowing `9` and `15`.
 */
function scanNumberList(text: string, start: number): { numbers: number[]; end: number } {
  const numbers: number[] = [];
  let i = start;
  const SEP = /^(\s*,\s*|\s*\/\s*|\s+and\s+|\s+)/i;

  while (i < text.length) {
    const rest = text.slice(i);
    const sepMatch = SEP.exec(rest);
    let consumed = 0;
    let checkRest = rest;

    if (numbers.length > 0) {
      // Every number after the first REQUIRES a separator — no separator, no more numbers.
      if (!sepMatch) break;
      consumed = sepMatch[0].length;
      checkRest = rest.slice(consumed);
    } else if (sepMatch) {
      consumed = sepMatch[0].length;
      checkRest = rest.slice(consumed);
    }

    const numMatch = /^\d+/.exec(checkRest);
    if (!numMatch) break;

    numbers.push(Number(numMatch[0]));
    i += consumed + numMatch[0].length;
  }

  return { numbers, end: i };
}

const CLAIM_HEAD = /\bclaims?\b\s*/gi;
const RULING_HEAD = /\brulings?\b\s*/gi;
/** Any import/require whose string literal names a `rules/` path segment, relative or aliased. */
const IMPORT_PATH = /(?:from\s+|require\(\s*)['"]([^'"]+)['"]/g;

/**
 * `scanTestCitations(sourceText)` — the citation scanner. The bare `CHUNK.md claim N` prefix is
 * intentionally NOT special-cased: it names no chunk slug and resolves nothing (172-CONTEXT.md
 * decision 3's rejected-alternatives note), so it is treated identically to a bare `claim N`
 * simply by never requiring anything before the `claim` token.
 */
export function scanTestCitations(sourceText: string): ScannedCitations {
  const claims = new Set<number>();
  const rulings = new Set<number>();

  for (const m of sourceText.matchAll(CLAIM_HEAD)) {
    const { numbers } = scanNumberList(sourceText, m.index + m[0].length);
    numbers.forEach((n) => claims.add(n));
  }
  for (const m of sourceText.matchAll(RULING_HEAD)) {
    const { numbers } = scanNumberList(sourceText, m.index + m[0].length);
    numbers.forEach((n) => rulings.add(n));
  }

  let importsRules = false;
  for (const m of sourceText.matchAll(IMPORT_PATH)) {
    if (/rules\//i.test(m[1])) {
      importsRules = true;
      break;
    }
  }

  return {
    claims: [...claims].sort((a, b) => a - b),
    rulings: [...rulings].sort((a, b) => a - b),
    importsRules,
  };
}

// -------------------------------------------------------------------------------------------
// resolveClaimCitation — the locked three-rung resolution ladder (172-CONTEXT.md decision 3)
// -------------------------------------------------------------------------------------------

export type ClaimResolution =
  | { status: 'resolved'; chunk: string }
  | { status: 'ambiguous'; candidates: string[] }
  | { status: 'unresolved'; reason: 'no-owner' | 'no-live-claim' };

/**
 * The three-rung narrowing ladder, verbatim from 172-CONTEXT.md decision 3 (AMENDED 2026-07-28).
 * A bare `claim N` in a test resolves ONLY like this:
 *
 *   1. Candidate set = `owners` — every chunk whose Build Manifest lists the citing test file.
 *   2. Discard candidates that do not have a LIVE claim numbered `claimNumber` in their current
 *      `## Interpretation` list (`liveClaims`).
 *   3. If more than one candidate survives rung 2, keep only the AUTHORING chunk(s) — the ones
 *      whose manifest row for this file marks it `NEW`/`written` rather than
 *      `edited`/`extended`/`rewritten`/`tightened` (`authoring`).
 *
 * `ambiguous` is reported ONLY when more than one candidate survives ALL THREE rungs. Critically,
 * if rung 3 would empty a non-empty rung-2 set (no surviving candidate is the author), the rung-2
 * survivors REMAIN the candidates and the result is `ambiguous` — narrowing must never discard
 * every survivor and report nothing.
 *
 * Residual risk knowingly accepted at rung 3 (decision 3's own text): a claim ADDED by a later
 * editing chunk attributes to the authoring chunk. Rung 2 removes most of that exposure, since the
 * later chunk's claim number usually does not exist in the author's live list, discarding the
 * author before rung 3 ever runs. No proximity, filename-slug, or most-recent-chunk heuristic
 * exists anywhere in this function — those are explicitly rejected alternatives.
 */
export function resolveClaimCitation(
  claimNumber: number,
  owners: string[],
  liveClaims: Record<string, number[]>,
  authoring: Record<string, boolean>,
): ClaimResolution {
  // Rung 1.
  if (owners.length === 0) return { status: 'unresolved', reason: 'no-owner' };

  // Rung 2.
  const validCandidates = owners.filter((chunk) => (liveClaims[chunk] ?? []).includes(claimNumber));
  if (validCandidates.length === 0) return { status: 'unresolved', reason: 'no-live-claim' };
  if (validCandidates.length === 1) return { status: 'resolved', chunk: validCandidates[0] };

  // Rung 3.
  const authoringCandidates = validCandidates.filter((chunk) => authoring[chunk]);
  const survivors = authoringCandidates.length > 0 ? authoringCandidates : validCandidates;
  if (survivors.length === 1) return { status: 'resolved', chunk: survivors[0] };
  return { status: 'ambiguous', candidates: survivors };
}
