
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
// -------------------------------------------------------------------------------------------
// Page-span extraction and m:n pairing (174-CONTEXT.md decision 4, amended)
// -------------------------------------------------------------------------------------------

export interface PageSpan {
  first: number;
  last: number;
}

/**
 * True when two page spans share at least one page.
 */
function spansOverlap(a: PageSpan, b: PageSpan): boolean {
  return a.first <= b.last && b.first <= a.last;
}

/**
 * A live slice's page span, derived from its OWN content's `p.N,` citation-header lines (the
 * `^p\.(\d+),` shape measured on real live slices, e.g. `p.1, Distribution of Cards:`) — never
 * from `INDEX.md`. `one-two-punch`'s real `INDEX.md` has no `## Slices` table at all (174-
 * RESEARCH.md Pattern 2), so an INDEX-keyed implementation is blind on it; this function is not.
 *
 * Returns `undefined` when the slice carries no `p.N,` citation at all (e.g. a non-rule visual
 * survey file) — the caller reports that rather than guessing a span.
 */
export function livePageSpan(sliceText: string): PageSpan | undefined {
  const pages: number[] = [];
  for (const rawLine of sliceText.split('\n')) {
    const match = /^p\.(\d+),/.exec(rawLine.trim());
    if (match) pages.push(Number(match[1]));
  }
  if (pages.length === 0) return undefined;
  return { first: Math.min(...pages), last: Math.max(...pages) };
}

/**
 * Parses a ledger `rangeId`'s `"N-M"` shape (the same shape `verify-run.ts`'s `RANGE_ID_RE`
 * accepts for a page range, e.g. `"1-2"`) into a `PageSpan`. Throws an actionable error naming
 * the value on anything else — never a guessed or silently-dropped span.
 */
export function parseRangeId(rangeId: string): PageSpan {
  const match = /^(\d+)-(\d+)$/.exec(rangeId.trim());
  if (!match) {
    throw new Error(
      `Invalid rangeId "${rangeId}".\n` +
        `Expected the shape "N-M" (e.g. "1-2"), the same page-range shape ` +
        `\`boardsmith verify-run-record --range\` accepts.`,
    );
  }
  return { first: Number(match[1]), last: Number(match[2]) };
}

/** The three shapes a page-overlap GROUP can be (174-CONTEXT.md decision 4, amended). */
export const PAIR_KINDS = Object.freeze(['paired', 'presentation-only', 'unpaired-slice'] as const);

export type PairKind = (typeof PAIR_KINDS)[number];

/**
 * One page-overlap GROUP — the pairing unit is a group, not a 1:1 pair, because the split is m:n
 * (decision 4 amended: a real `seven` re-transcription produced 6 staged files against 3 live
 * rule slices). `liveSlices`/`stagedSlices`/`stagedUnits` are all ARRAYS, mirrored field-for-field
 * into `ClassificationRecord` (174-02) with no collapsing step.
 */
export interface SlicePair {
  pairId: string;
  kind: PairKind;
  span: PageSpan;
  liveSlices: string[];
  stagedSlices: string[];
  stagedUnits: string[];
  liveRuleBearingLines: number;
  stagedRuleBearingLines: number;
  /** Only present when `kind` is `unpaired-slice`. */
  missingSide?: 'live-missing' | 'staged-missing';
}

interface PairSlicesInput {
  liveSlices: { path: string; text: string }[];
  stagedUnits: { unit: string; slicePath: string; rangeId?: string; text: string }[];
}

/** Deterministic derivation for a group's `pairId` — stable across runs and input order. */
function derivePairId(span: PageSpan | undefined, fallback: string): string {
  if (span) return `pages-${span.first}-${span.last}`;
  return `unspanned-${fallback}`;
}

/**
 * Pairs live↔staged slices by PAGE-SPAN OVERLAP (decision 4, amended) — a pure function, no I/O,
 * following `resolveLedgerState`'s style (single input, single output, no ambient state).
 *
 * Algorithm: each live slice's span comes from its own content (`livePageSpan`); each staged
 * unit's span comes from the ledger's `rangeId` (`parseRangeId`) — **never `INDEX.md`**, which
 * `one-two-punch` does not carry a Slices table for at all. Spans are joined into connected
 * groups via union-find over pairwise overlap (live-staged, live-live, and staged-staged), so an
 * m:n group — one live slice bridging several staged units, or several live slices sharing one
 * staged range — is a single group rather than an approximated 1:1 lookup.
 *
 * A group with files on only one side is `unpaired-slice`, naming which side is missing — never
 * silently dropped (decision 4's whole reason for existing: silent under-recording is the defect
 * class Phase 170 spent itself on). A group where BOTH sides' `ruleBearingLines()` counts are zero
 * is `presentation-only` — reported, never silently skipped, and excluded from the rule-bearing
 * denominator (decision 17). Everything else is `paired`, including a group whose two sides carry
 * different file counts — that asymmetry is NORMAL, not a finding.
 *
 * A staged unit with no `rangeId` is reported, not dropped: it gets a singleton group of its own,
 * `kind: 'unpaired-slice'`, `missingSide: 'live-missing'`.
 *
 * A live slice with no page span at all (`livePageSpan` returned `undefined` — no `p.N,`
 * citation anywhere in it, e.g. a non-rule visual-survey file) likewise gets a singleton group of
 * its own rather than being silently excluded from the result, `missingSide: 'staged-missing'`.
 */
export function pairSlices(input: PairSlicesInput): SlicePair[] {
  const liveCount = input.liveSlices.length;
  const stagedCount = input.stagedUnits.length;
  const total = liveCount + stagedCount;

  const spans: (PageSpan | undefined)[] = [
    ...input.liveSlices.map((s) => livePageSpan(s.text)),
    ...input.stagedUnits.map((u) => (u.rangeId !== undefined ? parseRangeId(u.rangeId) : undefined)),
  ];

  const parent = Array.from({ length: total }, (_, i) => i);
  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  for (let i = 0; i < total; i++) {
    const spanI = spans[i];
    if (!spanI) continue;
    for (let j = i + 1; j < total; j++) {
      const spanJ = spans[j];
      if (!spanJ) continue;
      if (spansOverlap(spanI, spanJ)) union(i, j);
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < total; i++) {
    const root = find(i);
    const members = groups.get(root) ?? [];
    members.push(i);
    groups.set(root, members);
  }

  const results: SlicePair[] = [];
  for (const members of groups.values()) {
    const liveIdx = members.filter((i) => i < liveCount);
    const stagedIdx = members.filter((i) => i >= liveCount).map((i) => i - liveCount);

    const memberSpans = members.map((i) => spans[i]).filter((s): s is PageSpan => Boolean(s));
    const span: PageSpan | undefined =
      memberSpans.length > 0
        ? {
            first: Math.min(...memberSpans.map((s) => s.first)),
            last: Math.max(...memberSpans.map((s) => s.last)),
          }
        : undefined;

    const liveSlices = liveIdx.map((i) => input.liveSlices[i].path);
    const stagedSlices = stagedIdx.map((i) => input.stagedUnits[i].slicePath);
    const stagedUnits = stagedIdx.map((i) => input.stagedUnits[i].unit);

    const liveRuleBearingLines = liveIdx.reduce(
      (sum, i) => sum + ruleBearingLines(input.liveSlices[i].text).length,
      0,
    );
    const stagedRuleBearingLines = stagedIdx.reduce(
      (sum, i) => sum + ruleBearingLines(input.stagedUnits[i].text).length,
      0,
    );

    let kind: PairKind;
    let missingSide: 'live-missing' | 'staged-missing' | undefined;
    if (liveIdx.length === 0 && stagedIdx.length > 0) {
      kind = 'unpaired-slice';
      missingSide = 'live-missing';
    } else if (liveIdx.length > 0 && stagedIdx.length === 0) {
      kind = 'unpaired-slice';
      missingSide = 'staged-missing';
    } else if (liveRuleBearingLines === 0 && stagedRuleBearingLines === 0) {
      kind = 'presentation-only';
    } else {
      kind = 'paired';
    }

    const fallbackId =
      liveSlices[0] ?? stagedUnits[0] ?? `group-${results.length}`;
    results.push({
      pairId: derivePairId(span, fallbackId),
      kind,
      span: span ?? { first: 0, last: 0 },
      liveSlices,
      stagedSlices,
      stagedUnits,
      liveRuleBearingLines,
      stagedRuleBearingLines,
      ...(missingSide ? { missingSide } : {}),
    });
  }

  results.sort((a, b) => a.pairId.localeCompare(b.pairId));
  return results;
}
