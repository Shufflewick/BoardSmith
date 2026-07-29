
/**
 * `verify-classify.ts` — the mechanical, judgment-free half of VERIFY-03: enumerated codes, the
 * dual-schema presentation-exclusion filter, m:n page-overlap pairing, the staleness map, and
 * three-state provenance resolution.
 *
 * WHY THIS IS CODE AND NOT SKILL TEXT
 *
 * 174-CONTEXT.md's sort table places every piece here MECHANICAL — exactly one input maps to
 * exactly one output for each function below. The one genuinely judgment-shaped piece, the
 * `cosmetic`/`sharper`/`contradictory` rule-delta LABEL, is NOT in this file: it comes from a
 * per-pair classification subagent (a later plan). This module never opens a slice to form an
 * opinion about its content's rules — it only counts, spans, and derives.
 *
 * SCOPE FENCE: this module enumerates pairs and derives staleness/provenance. It records no
 * ledger line and registers no CLI command — that is plan 174-04.
 */

// -------------------------------------------------------------------------------------------
// Enumerated codes (174-CONTEXT.md decisions 2b, 6)
// -------------------------------------------------------------------------------------------

/**
 * The three-state provenance enum (174-CONTEXT.md decision 2b). `unknown` is NOT an edge case —
 * neither reference game (`seven`, `one-two-punch`) currently has a `Source hash:` line recorded
 * by any chunk, so a first-ever verify pass on either lands here. `unknown` is never collapsed
 * into `source-changed` or `source-unchanged`: reporting a verdict the tool cannot support is the
 * exact failure mode this milestone keeps catching (172 decision 10 / PROV-03's own `unknown`).
 */
export const PROVENANCE_KINDS = Object.freeze([
  'source-changed',
  'source-unchanged',
  'unknown',
] as const);

export type Provenance = (typeof PROVENANCE_KINDS)[number];

/** The rule-delta label enum a classification subagent (later plan) returns exactly one of. */
export const RULE_DELTA_KINDS = Object.freeze([
  'cosmetic',
  'sharper',
  'contradictory',
  'unclassified',
] as const);

export type RuleDelta = (typeof RULE_DELTA_KINDS)[number];

/**
 * Presentation-note detection, on EITHER schema (174-CONTEXT.md decision 12b) — a correctness
 * landmine, not a detail. `174-PROOF.md` section 1 measured the real archived fixtures directly:
 *
 *   - Zero `Visual (p.` lines exist on either reference game's LIVE side — both games' live
 *     slices predate Phase 170's `Derived`/`Visual` split entirely.
 *   - `one-two-punch`'s live side carries the pre-170 form instead: 5 `— diagram description`
 *     lines + 1 `— art` line out of 12 total `Derived (p.` lines. `seven`'s live side has 0 of
 *     either legacy qualifier out of 10 total `Derived (p.` lines.
 *   - The pass-2 (staged) side of BOTH games DOES carry real `Visual (p.N):` lines (10 in
 *     `seven`, 19 in `one-two-punch`) — confirming the two sides of every real pair are on
 *     DIFFERENT SCHEMAS.
 *   - A sweep for any third `— <qualifier>` form across all four fixture trees found only these
 *     two (`diagram description`, `art`) — no third legacy qualifier exists in the real data.
 *
 * A filter that knows only the new `Visual (p.N):` prefix reads the old side's diagram notes as
 * rule-bearing content, counts purely presentational differences as consequence differences, and
 * manufactures `sharper` verdicts from schema drift alone — landing directly on SC-2's 90%-
 * `cosmetic` bar as an apparent classifier failure when it is really this filter being wrong.
 *
 * Each entry is a regex SOURCE string (not a literal regex), driving `isPresentationLine` below
 * rather than being duplicated as an inline pattern at the call site.
 */
export const PRESENTATION_EXCLUSION_MARKERS = Object.freeze([
  '^Visual \\(p\\.\\d+\\):',
  '^Derived \\(p\\.\\d+\\) — diagram description:',
  '^Derived \\(p\\.\\d+\\) — art:',
] as const);

/**
 * True when `line` is a presentation note under EITHER schema (decision 12b). Driven entirely by
 * `PRESENTATION_EXCLUSION_MARKERS` — never a second, hand-written regex duplicating its shape.
 */
export function isPresentationLine(line: string): boolean {
  const trimmed = line.trim();
  return PRESENTATION_EXCLUSION_MARKERS.some((source) => new RegExp(source, 'i').test(trimmed));
}

/**
 * A bare `p.N, <label>:` citation header (e.g. `p.1, Title block:`) names WHICH page a quoted
 * passage or `Derived` line comes from — it carries no rule content of its own. The quoted
 * sentences and `Derived (p.N):` lines that follow it are the actual rule-bearing transcription.
 * Excluded from `ruleBearingLines()` for that reason, but still scanned by `livePageSpan()` below
 * (a citation header is exactly what carries the page-span signal).
 */
const CITATION_HEADER_RE = /^p\.\d+,.*:$/;

/**
 * Returns `sliceText`'s content lines with blank lines, markdown headings (`#`), bare `p.N,`
 * citation headers, and presentation notes (either schema, per `isPresentationLine`) removed —
 * the rule-bearing content a caller counts or compares. `Derived (p.N):` lines that carry no
 * presentation qualifier remain and ARE counted (decision 12: `Derived` lines are rule-bearing
 * and compared; only the presentation-qualified subset is excluded).
 *
 * Line-based, not paragraph-based: this repo's transcription contract writes one rule-bearing
 * statement (a quoted sentence or a `Derived (p.N):` line) per raw line on the LIVE side, which is
 * what makes a plain per-line filter track the measured presentation-marker inventory (174-
 * PROOF.md section 1) — verified directly against `174-FIXTURES/one-two-punch/live/*.md` in this
 * file's test.
 */
export function ruleBearingLines(sliceText: string): string[] {
  return sliceText
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith('#') &&
        !CITATION_HEADER_RE.test(line) &&
        !isPresentationLine(line),
    );
}

// -------------------------------------------------------------------------------------------
// Staleness (174-CONTEXT.md decision 3 / SC-4)
// -------------------------------------------------------------------------------------------

/**
 * Staleness is derived from the rule delta ALONE (decision 3 / SC-4). Provenance is never an
 * input to this map, even optionally: `source-changed` with a `cosmetic` delta is NOT stale, and
 * `source-unchanged` with a `sharper` delta IS stale. This is a structural gate, not a style
 * preference — `deriveStale`'s single-parameter arity (pinned by `staleness-2` below) makes the
 * wrong thing impossible to express rather than merely discouraged.
 */
const STALE_BY_RULE_DELTA: Record<RuleDelta, boolean> = {
  cosmetic: false,
  sharper: true,
  contradictory: true,
  unclassified: true,
};

/** Exactly one parameter — see the doc comment on `STALE_BY_RULE_DELTA` above. */
export function deriveStale(ruleDelta: RuleDelta): boolean {
  return STALE_BY_RULE_DELTA[ruleDelta];
}
