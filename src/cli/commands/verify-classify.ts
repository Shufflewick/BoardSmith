import { promises as fs } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import chalk from 'chalk';
import {
  computeVerificationScope,
  parseVerifiedAgainst,
  resolveCitedSlices,
  SCOPE_FULL,
} from './chunk-provenance.js';
import {
  type ClassificationRecord,
  type VerifyRunOptions,
  RUN_ID_RE,
  appendLedgerLine,
  atomicWriteFile,
  ledgerFilePath,
  parseLedgerBody,
  readLedgerOrThrow,
  resolveLedgerState,
  stagingSlicesDir,
} from './verify-run.js';

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
 * A slice's page span, derived from its OWN content's `p.N` page citations — every occurrence of
 * the `p.N` shape anywhere in the text (a bare citation header like `p.1, Distribution of Cards:`,
 * a `Derived (p.N):`/`Named-but-undefined (p.N):`/`Visual (p.N):` line, or an inline aside like
 * `(p.2)` inside a sentence) — never from `INDEX.md` and never from the ledger's `rangeId`.
 * `one-two-punch`'s real `INDEX.md` has no `## Slices` table at all (174-RESEARCH.md Pattern 2),
 * so an INDEX-keyed implementation is blind on it; this function is not.
 *
 * This is the ONE content-derived span mechanism `pairSlices()` below applies to BOTH the live
 * side and the staged side (174-CONTEXT.md decision 4's second amendment) — the ledger `rangeId`
 * records which dispatch produced a staged unit, not which page(s) its content actually cites, so
 * it is retained on the record for traceability but is never the pairing key. Verified directly
 * against the real archived `seven` staged fixtures: `01-about-and-setup.md` carries only bare
 * `p.1,` headers, but its `Derived (p.1): ... the Solo Variant (p.2).` line's inline `(p.2)` aside
 * is what makes this function correctly report its span as `{first: 1, last: 2}` — a citation
 * that a header-only scan would miss entirely.
 *
 * Returns `undefined` when the slice carries no `p.N` citation at all (e.g. a non-rule visual
 * survey file) — the caller reports that rather than guessing a span.
 */
export function livePageSpan(sliceText: string): PageSpan | undefined {
  const pages: number[] = [];
  const citationRe = /p\.(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = citationRe.exec(sliceText)) !== null) {
    pages.push(Number(match[1]));
  }
  if (pages.length === 0) return undefined;
  return { first: Math.min(...pages), last: Math.max(...pages) };
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
 * Algorithm: BOTH sides' spans come from the SAME content-derived mechanism, `livePageSpan`
 * applied to that slice's own text (174-CONTEXT.md decision 4's second amendment) — **never
 * `INDEX.md`** (which `one-two-punch` does not carry a Slices table for at all) and **never the
 * ledger's `rangeId`** (which records which dispatch produced a staged unit, an engineering
 * artifact of transcription-pipeline granularity, not a content fact — both reference rulebooks
 * are 2-page books dispatched as a single range, so every staged unit shares the same `rangeId`
 * and a `rangeId`-keyed pairing collapses an entire game into one group). `rangeId` is retained on
 * each staged unit's input record for traceability, but it is never consulted here. Spans are
 * joined into connected groups via union-find over pairwise overlap (live-staged, live-live, and
 * staged-staged), so an m:n group — one live slice bridging several staged units, or several live
 * slices sharing one staged span — is a single group rather than an approximated 1:1 lookup.
 *
 * A group with files on only one side is `unpaired-slice`, naming which side is missing — never
 * silently dropped (decision 4's whole reason for existing: silent under-recording is the defect
 * class Phase 170 spent itself on). A group where BOTH sides' `ruleBearingLines()` counts are zero
 * is `presentation-only` — reported, never silently skipped, and excluded from the rule-bearing
 * denominator (decision 17). Everything else is `paired`, including a group whose two sides carry
 * different file counts — that asymmetry is NORMAL, not a finding.
 *
 * A staged unit with no derivable `p.N` span at all is reported, not dropped: it gets a singleton
 * group of its own, `kind: 'unpaired-slice'`, `missingSide: 'live-missing'`.
 *
 * A live slice with no page span at all (`livePageSpan` returned `undefined` — no `p.N`
 * citation anywhere in it, e.g. a non-rule visual-survey file) likewise gets a singleton group of
 * its own rather than being silently excluded from the result, `missingSide: 'staged-missing'`.
 */
export function pairSlices(input: PairSlicesInput): SlicePair[] {
  const liveCount = input.liveSlices.length;
  const stagedCount = input.stagedUnits.length;
  const total = liveCount + stagedCount;

  const spans: (PageSpan | undefined)[] = [
    ...input.liveSlices.map((s) => livePageSpan(s.text)),
    ...input.stagedUnits.map((u) => livePageSpan(u.text)),
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
// -------------------------------------------------------------------------------------------
// Provenance resolution (174-CONTEXT.md decisions 2, 2b)
// -------------------------------------------------------------------------------------------

export interface ProvenanceResult {
  provenance: Provenance;
  /** The current archived source's hash. Omitted when no archive is available at all. */
  currentHash?: string;
  /** Every recorded `Source hash:` value found across chunks citing this pair's live slices. */
  recordedHashes: string[];
  /** A short, enumerated, machine-stable phrase — never free prose a human report re-derives. */
  reason: string;
}

/** Strips a leading `rulebook/` prefix, if present, for comparing citation names uniformly. */
function bareSliceName(path: string): string {
  return path.startsWith('rulebook/') ? path.slice('rulebook/'.length) : path;
}

/**
 * Provenance is mechanical CLI, hash-only — never the classification subagent's opinion (decision
 * 2). This function takes exactly two parameters and has no `label`/`ruleDelta` parameter through
 * which a subagent's judgment could influence it.
 *
 * Resolution ladder (decision 2b), enumerated:
 *
 *  1. The CURRENT archived-source hash, via `computeVerificationScope()` — never a re-implemented
 *     sha256-of-archive, which risks disagreeing with the source-resolution step that already ran
 *     there. No archive at all (any non-`full` scope) → `unknown`, naming the scope reason.
 *  2. Every CHUNK.md in the project is scanned via `resolveCitedSlices()` for whether it cites any
 *     of this pair's live slices; for each that does, `parseVerifiedAgainst()` reads its recorded
 *     `Source hash:` (if any). All found hashes are collected.
 *  3. No recorded hash found at all → `unknown` (decision 2b: a first-ever verify pass of a
 *     pre-provenance project — the actual current state of both reference games — has no prior
 *     hash, and both populated states would be claims the tool cannot support). Any recorded hash
 *     differing from current → `source-changed` (any disagreement is a change the designer must
 *     see). Otherwise (at least one recorded hash, all equal to current) → `source-unchanged`.
 *
 * No branch of this function can return `source-unchanged` when `recordedHashes` is empty —
 * pinned directly by `provenance-3`.
 */
export async function resolveProvenance(
  projectDir: string,
  liveSlices: string[],
): Promise<ProvenanceResult> {
  const dir = resolve(projectDir);
  const scope = await computeVerificationScope(dir);

  if (scope.scope !== SCOPE_FULL) {
    return {
      provenance: 'unknown',
      recordedHashes: [],
      reason:
        `no archived source available to compare against ` +
        `(${scope.reason ?? 'verification scope is not full'}) — cannot compute a provenance verdict`,
    };
  }

  const currentHash = scope.sourceHash;

  const wantedNames = new Set(
    liveSlices.map((p) => {
      const rel = relative(dir, resolve(dir, p.startsWith('rulebook/') ? p : join('rulebook', p)));
      if (rel.startsWith('..') || isAbsolute(rel)) {
        throw new Error(
          `Live slice path "${p}" resolves outside ${dir}.\nPass a path relative to the project.`,
        );
      }
      return bareSliceName(p);
    }),
  );

  const chunksDir = join(dir, 'chunks');
  let slugs: string[] = [];
  try {
    const entries = await fs.readdir(chunksDir, { withFileTypes: true });
    slugs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    slugs = [];
  }

  const rulebookDir = join(dir, 'rulebook');
  let sliceFilenames: string[] = [];
  try {
    const entries = await fs.readdir(rulebookDir, { withFileTypes: true });
    sliceFilenames = entries
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => e.name);
  } catch {
    sliceFilenames = [];
  }

  const recordedHashes = new Set<string>();
  for (const slug of slugs) {
    let chunkText: string;
    try {
      chunkText = await fs.readFile(join(chunksDir, slug, 'CHUNK.md'), 'utf-8');
    } catch {
      continue;
    }
    const { resolved } = resolveCitedSlices(chunkText, sliceFilenames);
    const citesThisPair = resolved.some((r) => wantedNames.has(bareSliceName(r)));
    if (!citesThisPair) continue;
    const parsed = parseVerifiedAgainst(chunkText);
    if (parsed.sourceHash) recordedHashes.add(parsed.sourceHash);
  }

  if (recordedHashes.size === 0) {
    return {
      provenance: 'unknown',
      currentHash,
      recordedHashes: [],
      reason:
        'no chunk citing these live slices records a Source hash — a first-ever verify pass, ' +
        'not a claim this tool can support',
    };
  }

  const recordedHashesArr = [...recordedHashes].sort();
  const allMatchCurrent = recordedHashesArr.every((h) => h === currentHash);
  if (allMatchCurrent) {
    return {
      provenance: 'source-unchanged',
      currentHash,
      recordedHashes: recordedHashesArr,
      reason: 'every citing chunk\'s recorded Source hash matches the current archived source',
    };
  }

  return {
    provenance: 'source-changed',
    currentHash,
    recordedHashes: recordedHashesArr,
    reason:
      'at least one citing chunk\'s recorded Source hash differs from the current archived ' +
      'source — any disagreement is a change the designer must see',
  };
}

// -------------------------------------------------------------------------------------------
// Run-scoped commands (174-CONTEXT.md decision 5): verify-classify-pairs, -record, -status.
// -------------------------------------------------------------------------------------------

/** All run-ids present under this project's `rulebook/.verify/`, sorted (empty if none). */
async function listRunIds(projectDir: string): Promise<string[]> {
  const verifyRoot = join(projectDir, 'rulebook', '.verify');
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await fs.readdir(verifyRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && RUN_ID_RE.test(e.name))
    .map((e) => e.name)
    .sort();
}

/**
 * Mirrors `verifyRunStatusCommand`'s "most recent run" resolution — never a second lookup style.
 * An explicit `--run-id` naming a run that does not exist on disk is an actionable tool failure
 * naming the run and listing the runs that DO exist (174-PLAN.md pairs-5), never a bare "not
 * found" with no way forward.
 */
async function resolveRunId(projectDir: string, runId?: string): Promise<string> {
  if (runId) {
    if (!RUN_ID_RE.test(runId)) {
      throw new Error(
        `Invalid --run-id "${runId}".\n` +
          `Expected the shape YYYY-MM-DDTHH-MM-SSZ (UTC, colons replaced by "-"), e.g.\n` +
          `2026-07-28T22-18-00Z — the exact value \`boardsmith verify-run-init\` printed.`,
      );
    }
    const existing = await listRunIds(projectDir);
    if (!existing.includes(runId)) {
      throw new Error(
        `No verify run "${runId}" found in ${projectDir}.\n` +
          (existing.length > 0
            ? `Runs that do exist: ${existing.join(', ')}.`
            : `No verify runs exist yet — run \`boardsmith verify-run-init\` first.`),
      );
    }
    return runId;
  }
  const runIds = await listRunIds(projectDir);
  if (runIds.length === 0) {
    throw new Error(
      `No verify runs found under rulebook/.verify/ in ${projectDir}.\n` +
        `Run \`boardsmith verify-run-init\` first.`,
    );
  }
  return runIds[runIds.length - 1];
}

/**
 * Reads the run's ledger and the live rulebook tree, then computes the pair set once — the shared
 * path both `verifyClassifyPairsCommand` and `verifyClassifyRecordCommand`/`verifyClassifyStatusCommand`
 * build on (174-PLAN.md Task 2's "resolve the run and its pair set by calling the pairing path from
 * Task 1"). **The staged side is the ledger's recorded units, never a directory scan** —
 * `staging-dispatch.md`'s discipline, restated for classification.
 */
async function computeRunPairs(
  projectDir: string,
  runId: string,
): Promise<{ pairs: SlicePair[]; provenance: Record<string, ProvenanceResult>; warnings: string[] }> {
  const warnings: string[] = [];

  const rulebookDir = join(projectDir, 'rulebook');
  let ruleFileNames: string[] = [];
  try {
    const entries = await fs.readdir(rulebookDir, { withFileTypes: true });
    ruleFileNames = entries
      .filter(
        // ingest-archive.ts's own exclusion: 00-visual-survey.md is presentation-by-design (the
        // UI-ask handoff artifact), never a rule slice a classifier compares. INDEX.md is the
        // archive manifest, not a slice either.
        (e) =>
          e.isFile() &&
          e.name.endsWith('.md') &&
          e.name !== 'INDEX.md' &&
          e.name !== '00-visual-survey.md',
      )
      .map((e) => e.name)
      .sort();
  } catch {
    throw new Error(
      `No rulebook/ directory in ${projectDir}.\n` +
        `A verify pass compares against an existing rulebook — nothing to pair here.`,
    );
  }
  const liveSlices = await Promise.all(
    ruleFileNames.map(async (name) => ({
      path: `rulebook/${name}`,
      text: await fs.readFile(join(rulebookDir, name), 'utf-8'),
    })),
  );

  const stagingDir = stagingSlicesDir(projectDir, runId);
  const ledgerFile = ledgerFilePath(projectDir, runId);
  const relLedgerPath = relative(projectDir, ledgerFile);
  const ledgerText = await readLedgerOrThrow(ledgerFile, runId, projectDir);
  const { lines } = parseLedgerBody(ledgerText, relLedgerPath);
  const { recorded } = resolveLedgerState(lines);

  const stagedUnits: { unit: string; slicePath: string; rangeId?: string; text: string }[] = [];
  for (const rec of recorded) {
    const abs = resolve(stagingDir, rec.slicePath);
    let text: string;
    try {
      text = await fs.readFile(abs, 'utf-8');
    } catch {
      // Recorded in the ledger but missing on disk: reported, never silently dropped from the
      // pair set (174-PLAN.md pairs-2). An empty text has no derivable p.N span, so pairSlices()
      // reports it as its own unpaired-slice group rather than pretending it does not exist.
      warnings.push(
        `unit "${rec.unitId}"'s recorded slice ${rec.slicePath} was not found on disk — ` +
          `reporting it as an unpaired finding rather than silently dropping it`,
      );
      text = '';
    }
    stagedUnits.push({
      unit: rec.unitId,
      slicePath: rec.slicePath,
      ...(rec.rangeId ? { rangeId: rec.rangeId } : {}),
      text,
    });
  }

  const pairs = pairSlices({ liveSlices, stagedUnits });

  const provenanceEntries = await Promise.all(
    pairs.map(async (p) => [p.pairId, await resolveProvenance(projectDir, p.liveSlices)] as const),
  );
  const provenance: Record<string, ProvenanceResult> = Object.fromEntries(provenanceEntries);

  return { pairs, provenance, warnings };
}

export interface VerifyClassifyPairsResult {
  runId: string;
  pairs: SlicePair[];
  /** Keyed by `pairId` — provenance is deliberately NOT a field on `SlicePair` itself (see doc). */
  provenance: Record<string, ProvenanceResult>;
  warnings: string[];
  summary: { paired: number; presentationOnly: number; unpaired: number; ruleBearingPairs: number };
}

/**
 * `boardsmith verify-classify-pairs` — enumerate a run's live↔staged pair GROUPS, with provenance
 * (a sibling map, never embedded in `SlicePair` — `pairSlices()` stays pure/no-I/O) and rule-bearing
 * line counts. Read-only; findings (unpaired slices, presentation-only groups, a missing staged
 * file) exit 0 (decision 7) — only a tool failure (unknown run, no rulebook/) is non-zero.
 */
export async function verifyClassifyPairsCommand(
  options: VerifyRunOptions & { runId?: string; liveSlice?: string } = {},
): Promise<VerifyClassifyPairsResult> {
  const projectDir = resolve(options.project ?? process.cwd());

  // T-174-14: --live-slice must resolve inside this project's rulebook dir, validated before any
  // read. Mirrors verify-run.ts:756-763's path-escape guard verbatim.
  if (options.liveSlice !== undefined) {
    const rulebookDir = join(projectDir, 'rulebook');
    const abs = resolve(rulebookDir, options.liveSlice);
    const rel = relative(rulebookDir, abs);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(
        `--live-slice "${options.liveSlice}" resolves outside ${relative(projectDir, rulebookDir)}.\n` +
          `Pass a path relative to the project's rulebook directory.`,
      );
    }
  }

  const runId = await resolveRunId(projectDir, options.runId);
  const { pairs: allPairs, provenance: allProvenance, warnings } = await computeRunPairs(projectDir, runId);

  const pairs = options.liveSlice
    ? allPairs.filter((p) =>
        p.liveSlices.some((s) => s === `rulebook/${options.liveSlice}` || s === options.liveSlice),
      )
    : allPairs;
  const provenance: Record<string, ProvenanceResult> = Object.fromEntries(
    pairs.map((p) => [p.pairId, allProvenance[p.pairId]]),
  );

  const summary = {
    paired: pairs.filter((p) => p.kind === 'paired').length,
    presentationOnly: pairs.filter((p) => p.kind === 'presentation-only').length,
    unpaired: pairs.filter((p) => p.kind === 'unpaired-slice').length,
    ruleBearingPairs: pairs.filter(
      (p) => p.kind === 'paired' && (p.liveRuleBearingLines > 0 || p.stagedRuleBearingLines > 0),
    ).length,
  };

  const result: VerifyClassifyPairsResult = { runId, pairs, provenance, warnings, summary };

  for (const w of warnings) console.error(chalk.yellow(`⚠ ${w}`));

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  console.log(chalk.green(`✓ Verify-classify pairs — run ${runId}`));
  console.log(
    `  ${chalk.gray('paired:')} ${summary.paired}  ${chalk.gray('presentation-only:')} ` +
      `${summary.presentationOnly}  ${chalk.gray('unpaired:')} ${summary.unpaired}`,
  );
  // Report volume, not emptiness (172's finding): one line per pair, grouped by kind, never a
  // per-line body dump.
  for (const kind of PAIR_KINDS) {
    const group = pairs.filter((p) => p.kind === kind);
    if (group.length === 0) continue;
    console.log(`  ${chalk.gray(`${kind}:`)} ${group.length} group(s)`);
    for (const p of group) {
      console.log(
        `    - ${p.pairId} (live:${p.liveSlices.length} staged:${p.stagedSlices.length}` +
          `${p.missingSide ? `, missing:${p.missingSide}` : ''})`,
      );
    }
  }
  return result;
}
