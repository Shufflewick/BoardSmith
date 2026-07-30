import { promises as fs } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import chalk from 'chalk';
import {
  computeVerificationScope,
  parseVerifiedAgainst,
  resolveCitedSlices,
  SCOPE_FULL,
} from './chunk-provenance.js';
import { extractSection } from './build-manifest.js';
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
  '^Derived \\(p\\.\\d+\\) — diagram description(?: \\([^)]+\\))?:',
  '^Derived \\(p\\.\\d+\\) — art(?: \\([^)]+\\))?:',
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

export interface VerifyClassifyRecordResult {
  runId: string;
  record: ClassificationRecord;
  warnings: string[];
}

const RULE_DELTA_SET: ReadonlySet<string> = new Set(RULE_DELTA_KINDS);

/**
 * `boardsmith verify-classify-record` — append exactly ONE verdict for a pair through the SAME
 * atomic ledger write `verify-run-record` hardened (173-08/CR-01). `stale` and `provenance` are
 * NOT options on this command — both are derived here, never accepted from a caller (decision 3;
 * the options interface below deliberately carries no field for either, and `options.stale`/
 * `options.provenance` are never read anywhere in this module).
 *
 * A missing or out-of-enum `--label` is never thrown on — it is a subagent-fidelity failure, not
 * a caller bug (decision 8) — it silently normalizes to `unclassified` with a
 * `console.error(chalk.yellow(...))` warning naming what was received verbatim. `sharper`/
 * `contradictory` additionally REQUIRE both `--quoted-pass1` and `--quoted-pass2` non-empty
 * (decision 9); either missing (or whitespace-only) demotes the same way, naming which quote was
 * absent, never recording an evidence-free `sharper`/`contradictory`.
 */
export async function verifyClassifyRecordCommand(
  options: VerifyRunOptions & {
    runId?: string;
    pairId?: string;
    label?: string;
    evidence?: string;
    quotedPass1?: string;
    quotedPass2?: string;
  } = {},
): Promise<VerifyClassifyRecordResult> {
  const projectDir = resolve(options.project ?? process.cwd());
  if (!options.runId) throw new Error('verify-classify-record requires --run-id <id>.');
  const runId = await resolveRunId(projectDir, options.runId);
  if (!options.pairId) throw new Error('verify-classify-record requires --pair-id <id>.');

  const { pairs } = await computeRunPairs(projectDir, runId);
  const pair = pairs.find((p) => p.pairId === options.pairId);
  if (!pair) {
    throw new Error(
      `Unknown --pair-id "${options.pairId}" for run "${runId}".\n` +
        `Valid pair ids: ${pairs.map((p) => p.pairId).join(', ') || '(none)'}.\n` +
        `Run \`boardsmith verify-classify-pairs --run-id ${runId}\` to list them.`,
    );
  }

  const warnings: string[] = [];
  let ruleDelta: RuleDelta;
  if (options.label !== undefined && RULE_DELTA_SET.has(options.label)) {
    ruleDelta = options.label as RuleDelta;
  } else {
    ruleDelta = 'unclassified';
    const received = options.label === undefined ? '(missing)' : `"${options.label}"`;
    const warning =
      `--label ${received} is not one of ${RULE_DELTA_KINDS.join(', ')} — recording ` +
      `"unclassified" rather than guessing (decision 8: a malformed subagent return is never ` +
      `silently "cosmetic").`;
    warnings.push(warning);
    console.error(chalk.yellow(`⚠ ${warning}`));
  }

  const quotedPass1 = (options.quotedPass1 ?? '').trim();
  const quotedPass2 = (options.quotedPass2 ?? '').trim();
  if (ruleDelta === 'sharper' || ruleDelta === 'contradictory') {
    const missing: string[] = [];
    if (quotedPass1.length === 0) missing.push('quotedPass1');
    if (quotedPass2.length === 0) missing.push('quotedPass2');
    if (missing.length > 0) {
      const warning =
        `--label "${ruleDelta}" requires both --quoted-pass1 and --quoted-pass2 non-empty ` +
        `(decision 9) — ${missing.join(' and ')} was empty/whitespace-only. Recording ` +
        `"unclassified" rather than an evidence-free "${ruleDelta}".`;
      warnings.push(warning);
      console.error(chalk.yellow(`⚠ ${warning}`));
      ruleDelta = 'unclassified';
    }
  }

  const stale = deriveStale(ruleDelta);
  const provenanceResult = await resolveProvenance(projectDir, pair.liveSlices);

  const evidenceParts: string[] = [];
  if (options.evidence && options.evidence.trim().length > 0) evidenceParts.push(options.evidence.trim());
  if (quotedPass1.length > 0) evidenceParts.push(`Pass 1 quote: "${quotedPass1}"`);
  if (quotedPass2.length > 0) evidenceParts.push(`Pass 2 quote: "${quotedPass2}"`);

  const record: ClassificationRecord = {
    kind: 'classification',
    pairId: pair.pairId,
    // Assigned straight across from the pair, no collapsing step (decision 4/6 amended) — even
    // when this group is 1-live/N-staged or vice versa.
    units: pair.stagedUnits,
    liveSlices: pair.liveSlices,
    stagedSlices: pair.stagedSlices,
    provenance: provenanceResult.provenance,
    ruleDelta,
    stale,
    evidence: evidenceParts.join(' | '),
    recordedAt: new Date().toISOString(),
    ...(quotedPass1.length > 0 ? { quotedPass1 } : {}),
    ...(quotedPass2.length > 0 ? { quotedPass2 } : {}),
  };

  const ledgerFile = ledgerFilePath(projectDir, runId);
  const relLedgerPath = relative(projectDir, ledgerFile);
  const ledgerText = await readLedgerOrThrow(ledgerFile, runId, projectDir);
  const newText = appendLedgerLine(ledgerText, relLedgerPath, JSON.stringify(record));
  await atomicWriteFile(ledgerFile, newText);

  const result: VerifyClassifyRecordResult = { runId, record, warnings };
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
  console.log(
    chalk.green(`✓ Recorded classification for pair "${pair.pairId}": ${ruleDelta} (stale: ${stale})`),
  );
  return result;
}

// -------------------------------------------------------------------------------------------
// verify-classify-status + per-chunk verdict roll-up (174-CONTEXT.md decisions 11, 18)
// -------------------------------------------------------------------------------------------

/**
 * The one shared severity-order constant every MAX-severity roll-up in this module reads from —
 * never a duplicated if/else chain that can silently drift from decision 11's pair-level order.
 * `unclassified` ranks ABOVE `cosmetic` (decision 8: a pair/chunk the tool could not classify can
 * never be reported clean) but the exact ordering against `sharper` is not specified by any test;
 * placed just below `sharper` so `contradictory > sharper > unclassified > cosmetic` holds and
 * `unclassified` still always beats `cosmetic`.
 */
export const RULE_DELTA_SEVERITY: Record<RuleDelta, number> = Object.freeze({
  cosmetic: 0,
  unclassified: 1,
  sharper: 2,
  contradictory: 3,
});

export interface ChunkVerdict {
  slug: string;
  citedLiveSlices: string[];
  pairIds: string[];
  ruleDelta: RuleDelta;
  stale: boolean;
  attributions: Array<{
    pairId: string;
    liveSlice: string;
    rung: CitationAnchorRung;
    attributed: boolean;
    reason: string;
  }>;
}

// -------------------------------------------------------------------------------------------
// Per-citation attribution (174-CONTEXT.md decision 19) — a deterministic 3-rung ladder,
// modelled on 172-CONTEXT.md decision 3's resolution ladder, that narrows a delta's attribution
// from "the live SLICE a chunk cites" (decision 18) down to "the specific CITATION a chunk
// names" — its own `## Interpretation` claim-level quoted fragments and page references.
// -------------------------------------------------------------------------------------------

/**
 * The three deterministic rungs, in the order they are tried (174-CONTEXT.md decision 19). Never
 * a hand-written union — every caller narrows against this frozen array.
 */
export const CITATION_ANCHOR_RUNGS = Object.freeze([
  'quoted-fragment',
  'cited-page',
  'slice-fallback',
] as const);

export type CitationAnchorRung = (typeof CITATION_ANCHOR_RUNGS)[number];

/**
 * The three enumerated warning kinds `computeChunkVerdicts` can push. `unattributable-quote` and
 * `unreadable-live-slice` name the two 174-04 corrective conditions (pair-level blindness, which
 * outranks this ladder entirely — see `computeChunkVerdicts`'s doc comment). `unresolved-citation`
 * is new: it fires when the ladder itself falls all the way to `slice-fallback` for lack of any
 * claim-level anchor. Every warning string this module pushes for chunk attribution is prefixed
 * `[<kind>] ` — the 174-04 tests substring-match on `does not match verbatim` and
 * `could not be read`, which survive unchanged after the prefix.
 */
export const CHUNK_ATTRIBUTION_WARNING_KINDS = Object.freeze([
  'unattributable-quote',
  'unreadable-live-slice',
  'unresolved-citation',
] as const);

export type ChunkAttributionWarningKind = (typeof CHUNK_ATTRIBUTION_WARNING_KINDS)[number];

/**
 * Long enough that a scrap like `"+1"` cannot match nearly every line in a live slice — measured
 * reality (174-CONTEXT.md decision 19's `<measured_reality>`) shows real quoted anchors are full
 * clauses or sentences, never single-token asides. Not a tuned threshold: it exists to reject
 * degenerate matches, not to move a measured percentage.
 */
export const MIN_FRAGMENT_CHARS = 12;

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Splits an `## Interpretation` section body into one text span per `^N. **` claim item, so a
 * multi-line claim's continuation lines stay attached to their own claim — the same claim shape
 * `parseInterpretationClaims` (`build-manifest.ts`) uses for numbering. */
function splitInterpretationClaims(body: string): string[] {
  const CLAIM_START = /^(\d+)\.\s+\*\*/gm;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = CLAIM_START.exec(body)) !== null) {
    starts.push(m.index);
  }
  const claims: string[] = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : body.length;
    claims.push(body.slice(start, end));
  }
  return claims;
}

export interface ClaimCitationAnchors {
  slices: string[];
  pages: number[];
  fragments: string[];
}

/**
 * The claim-level citation anchors a chunk's `## Interpretation` claims actually name — never
 * scanned from `chunkText` directly (that would also pick up the redteam/findings-ledger/HTML-
 * comment prose 174-CONTEXT.md's `decision-19-anchors-2` measured as noise). Reuses
 * `extractSection` (the `f73153a3`-safe by-line heading lookup) and `resolveCitedSlices` (the
 * shorthand-resolving citation parser) rather than inventing a second convention.
 *
 * HTML comments (`<!-- ... -->`) are stripped from the body before parsing — the template's own
 * guidance comment inside `## Interpretation` names example `rulebook/...` tokens (measured
 * against `second-action-resolution`'s carried-citations comment) and must not become an anchor.
 *
 * Fragments below `MIN_FRAGMENT_CHARS` are rejected (a degenerate scrap like `"+1"` would match
 * nearly every line). Anchors are unioned across all claims into one chunk-wide set — never bound
 * to a specific slice at parse time (measured reality: many real fragments carry no co-located
 * slice token); binding happens at attribution time, by asking whether the fragment occurs in a
 * given slice's own text.
 */
export function parseClaimCitationAnchors(
  chunkText: string,
  sliceFilenames: string[],
): ClaimCitationAnchors {
  const body = extractSection(chunkText, '## Interpretation');
  if (body === undefined) return { slices: [], pages: [], fragments: [] };

  const withoutComments = body.replace(/<!--[\s\S]*?-->/g, '');
  const claims = splitInterpretationClaims(withoutComments);

  const slices = new Set<string>();
  const pages = new Set<number>();
  const fragments = new Set<string>();

  const PAGE_RE = /\(p\.(\d+)\)/g;
  const STRAIGHT_QUOTE_RE = /"([^"]+)"/g;
  const CURLY_QUOTE_RE = /“([^”]+)”/g;

  for (const claimText of claims) {
    const { resolved } = resolveCitedSlices(claimText, sliceFilenames);
    for (const s of resolved) slices.add(s);

    let pm: RegExpExecArray | null;
    while ((pm = PAGE_RE.exec(claimText)) !== null) pages.add(Number(pm[1]));

    for (const re of [STRAIGHT_QUOTE_RE, CURLY_QUOTE_RE]) {
      let fm: RegExpExecArray | null;
      while ((fm = re.exec(claimText)) !== null) {
        const frag = fm[1].trim();
        if (frag.length >= MIN_FRAGMENT_CHARS) fragments.add(frag);
      }
    }
  }

  return {
    slices: [...slices].sort(),
    pages: [...pages].sort((a, b) => a - b),
    fragments: [...fragments],
  };
}

/**
 * The single line of `sliceText` containing `quote` — whitespace-normalized comparison so a
 * re-wrapped quote still lands. First match; `undefined` when the quote appears nowhere.
 */
export function matchedLiveLine(sliceText: string, quote: string): string | undefined {
  const normalizedQuote = normalizeWhitespace(quote);
  if (!normalizedQuote) return undefined;
  for (const line of sliceText.split('\n')) {
    if (normalizeWhitespace(line).includes(normalizedQuote)) return line;
  }
  return undefined;
}

/**
 * The page a live line belongs to: a `p.N` on the line itself wins; otherwise the nearest
 * PRECEDING bare `p.N,` citation header (`CITATION_HEADER_RE`'s shape); otherwise `undefined`.
 */
export function citedPageForLine(sliceText: string, line: string): number | undefined {
  const inline = /p\.(\d+)/.exec(line);
  if (inline) return Number(inline[1]);

  const lines = sliceText.split('\n');
  const idx = lines.findIndex((l) => l === line);
  const start = (idx === -1 ? lines.length : idx) - 1;
  for (let i = start; i >= 0; i--) {
    const trimmed = lines[i].trim();
    const m = /^p\.(\d+),.*:$/.exec(trimmed);
    if (m) return Number(m[1]);
  }
  return undefined;
}

export interface CitationAttribution {
  attributed: boolean;
  rung: CitationAnchorRung;
  reason: string;
}

/**
 * The deterministic 3-rung ladder (174-CONTEXT.md decision 19), modelled on 172-CONTEXT.md
 * decision 3's ladder — no heuristics, no proximity guessing.
 *
 * - **`quoted-fragment`:** this slice's fragment set (this chunk's anchor fragments that occur
 *   verbatim, whitespace-normalized, in `liveSliceText`) DECIDES when non-empty — `attributed` iff
 *   some fragment overlaps `deltaLine` (containment either direction, whitespace-normalized). A
 *   non-empty, non-overlapping fragment set returns `attributed: false` — the narrowing decision
 *   19 asks for, and the `reason` is what makes a clean chunk's cleanliness nameable.
 * - **`cited-page`:** only tried when this slice's fragment set is empty — `attributed` iff
 *   `anchors.pages` is non-empty, `deltaLinePage` is known, and the page is among the cited pages.
 * - **`slice-fallback`:** neither anchor kind is usable for this slice → `attributed: true` always
 *   — a finer key has strictly more ways to fail to resolve, so the fallback must be exactly as
 *   conservative as decision 18's shipped slice-level answer, never more permissive.
 */
export function resolveCitationAttribution(input: {
  liveSlice: string;
  liveSliceText: string;
  deltaLine: string;
  deltaLinePage: number | undefined;
  anchors: ClaimCitationAnchors;
}): CitationAttribution {
  const { liveSliceText, deltaLine, deltaLinePage, anchors } = input;
  const normalizedDeltaLine = normalizeWhitespace(deltaLine);

  const sliceFragments = anchors.fragments.filter((f) => liveSliceText.includes(f));

  if (sliceFragments.length > 0) {
    const overlapping = sliceFragments.filter((f) => {
      const nf = normalizeWhitespace(f);
      return normalizedDeltaLine.includes(nf) || nf.includes(normalizedDeltaLine);
    });
    if (overlapping.length > 0) {
      return {
        attributed: true,
        rung: 'quoted-fragment',
        reason:
          `Attributed: this chunk's cited quoted fragment ("${overlapping[0]}") overlaps the ` +
          `changed line.`,
      };
    }
    return {
      attributed: false,
      rung: 'quoted-fragment',
      reason:
        `Not attributed: this chunk cites ${sliceFragments.length} quoted fragment(s) found in ` +
        `this live slice, but none overlaps the changed line ("${normalizedDeltaLine}").`,
    };
  }

  if (anchors.pages.length > 0 && deltaLinePage !== undefined) {
    const attributed = anchors.pages.includes(deltaLinePage);
    return {
      attributed,
      rung: 'cited-page',
      reason: attributed
        ? `Attributed: this chunk cites page ${deltaLinePage}, which matches the changed line's page.`
        : `Not attributed: this chunk cites page(s) ${anchors.pages.join(', ')}, which do not ` +
          `include the changed line's page (${deltaLinePage}).`,
    };
  }

  return {
    attributed: true,
    rung: 'slice-fallback',
    reason:
      'Attributed: no claim-level citation anchor (quoted fragment or page) could be resolved ' +
      'for this slice — decision 18\'s slice-level attribution stands (conservative fallback).',
  };
}

/**
 * Chunk staleness narrows through THREE successive decisions, applied in order, each one level
 * finer than the last:
 *
 *   1. **Decision 11** — a pair/group verdict rolls up to MAX severity over its line-level deltas.
 *   2. **Decision 18 — the most goal-critical decision in the phase up to this point.** Chunk
 *      staleness is derived from the LINE-LEVEL deltas attributable to a chunk's OWN cited
 *      content, never from the group/pair verdict wholesale. Why: pairing groups by page-overlap
 *      (decision 4, amended), and real rulebooks measurably collapse to very few groups — genuine
 *      cross-page prose bridges page spans through the overlap join, so both real reference games
 *      pair into exactly ONE group each (174-03-SUMMARY.md's corrective follow-up). If chunk
 *      staleness keyed off the GROUP verdict, one `sharper` line anywhere in the rulebook would
 *      mark the game's only group `sharper`, and therefore mark EVERY chunk citing anything in
 *      that group stale. The fix: a classification record's `quotedPass1` (decision 9's mandatory
 *      verbatim live-side quote) is used to find WHICH of the pair's own `liveSlices` actually
 *      contains that quoted line — only chunks citing THAT specific live slice inherit the delta.
 *   3. **Decision 19** — narrows one level further, from "the live SLICE a chunk cites" to "the
 *      specific CITATION a chunk names" (its own `## Interpretation` claim's quoted fragment or
 *      page reference). Two chunks citing the SAME live slice can land on DIFFERENT verdicts when
 *      one's claim quotes the changed line and the other's claim quotes something else in that
 *      slice entirely — a distinction decision 18 alone cannot express.
 *
 * `cosmetic` never contributes (nothing to attribute). A record with NO quote at all — an
 * `unclassified` verdict demoted for a missing quote, or a malformed-label `unclassified` the
 * subagent never quoted anything for — cannot be narrowed, so conservatively every one of the
 * pair's live slices the chunk cites is treated as affected (decision 8: never silently clean
 * where the tool is blind). An `unpaired-slice` group (nothing was ever compared for it) always
 * contributes `unclassified` to any chunk citing its live slice(s); `presentation-only` groups
 * contribute nothing, matching decision 17's treatment of presentation content as outside the
 * rule-bearing comparison entirely.
 *
 * **Corrective follow-up (174-04 FALSE-CLEAN fix), and why it OUTRANKS decision 19's ladder:**
 * narrowing to "does this chunk's OWN cited live slice contain the quote" is only correct once you
 * already know the quote lands SOMEWHERE in the pair. The pair-level check is NOT a single
 * situation — it conflates two:
 *   (a) the quote matches some OTHER live slice in the pair, one this chunk does not cite —
 *       genuinely not this chunk's problem, the narrowing working exactly as designed; or
 *   (b) the quote matches NO live slice in the pair AT ALL — a paraphrase instead of a verbatim
 *       quote, a re-wrapped line, drifted whitespace/punctuation, or a live slice that could not
 *       even be read. This is not proof the chunk is unaffected; it is the tool being blind, and
 *       the delta must not evaporate silently.
 * Distinguishing them requires checking the quote against the PAIR's whole `liveSlices` set, not
 * just this chunk's citations, and this check runs BEFORE decision 19's per-citation ladder ever
 * does — never inside it. A citation-level "not attributed" answer computed from a quote that
 * matches nothing in the pair would be a FABRICATED EXEMPTION: it would silently re-open exactly
 * the false-clean 174-04 closed, while looking like an improvement because the stale count would
 * drop. Case (b) — the UNATTRIBUTABLE quote — broadens conservatively to every one of this chunk's
 * own cited live slices (the same fallback the no-quote branch already uses) and is additionally
 * surfaced in the returned `warnings`, never silently absorbed. A live slice that cannot be read is
 * treated the same way: it is never silently cached as `''` (which would make it match no quote by
 * construction and feed straight back into the same false-clean), it is surfaced and the affected
 * chunk conservatively broadened. Only case (a) — the quote genuinely lands somewhere in the pair —
 * reaches decision 19's ladder, per live slice this chunk cites that the quote actually matches.
 */
async function computeChunkVerdicts(
  projectDir: string,
  pairs: SlicePair[],
  classifications: ClassificationRecord[],
): Promise<{ verdicts: ChunkVerdict[]; warnings: string[] }> {
  const chunksDir = join(projectDir, 'chunks');
  let slugs: string[] = [];
  try {
    const entries = await fs.readdir(chunksDir, { withFileTypes: true });
    slugs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    slugs = [];
  }

  const rulebookDir = join(projectDir, 'rulebook');
  let sliceFilenames: string[] = [];
  try {
    const entries = await fs.readdir(rulebookDir, { withFileTypes: true });
    sliceFilenames = entries.filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name);
  } catch {
    sliceFilenames = [];
  }

  // `null` means "could not be read" — NEVER collapsed to `''`. A live slice cached as `''` on a
  // read failure would match no quote by construction, which is indistinguishable from "read fine,
  // genuinely doesn't contain this quote" — precisely the false-clean this fix closes. Callers
  // below must handle `null` as its own, surfaced condition.
  const liveTextCache = new Map<string, string | null>();
  async function liveText(bareName: string): Promise<string | null> {
    if (!liveTextCache.has(bareName)) {
      try {
        liveTextCache.set(bareName, await fs.readFile(join(rulebookDir, bareName), 'utf-8'));
      } catch {
        liveTextCache.set(bareName, null);
      }
    }
    return liveTextCache.get(bareName)!;
  }

  const classificationsByPairId = new Map(classifications.map((c) => [c.pairId, c]));
  const warningSet = new Set<string>();

  const results: ChunkVerdict[] = [];
  for (const slug of slugs) {
    let chunkText: string;
    try {
      chunkText = await fs.readFile(join(chunksDir, slug, 'CHUNK.md'), 'utf-8');
    } catch {
      continue;
    }
    const { resolved } = resolveCitedSlices(chunkText, sliceFilenames);
    if (resolved.length === 0) continue;
    const citedBare = new Set(resolved.map((r) => bareSliceName(r)));
    const anchors = parseClaimCitationAnchors(chunkText, sliceFilenames);

    let ruleDelta: RuleDelta = 'cosmetic';
    const pairIds = new Set<string>();
    const attributions: ChunkVerdict['attributions'] = [];

    for (const pair of pairs) {
      const pairCitedLiveSlices = pair.liveSlices.filter((s) => citedBare.has(bareSliceName(s)));
      if (pairCitedLiveSlices.length === 0) continue;

      if (pair.kind === 'presentation-only') continue; // decision 17: never a stale contribution

      if (pair.kind === 'unpaired-slice') {
        // Nothing was ever compared for this content — never silently clean (decision 8).
        pairIds.add(pair.pairId);
        if (RULE_DELTA_SEVERITY.unclassified > RULE_DELTA_SEVERITY[ruleDelta]) {
          ruleDelta = 'unclassified';
        }
        continue;
      }

      const record = classificationsByPairId.get(pair.pairId);
      if (!record) continue; // not yet classified — pendingPairs, not this chunk's problem yet

      if (record.ruleDelta === 'cosmetic') {
        // Cosmetic carries no quote to narrow by — it is reported as "nothing changed here" for
        // every citing chunk uniformly, never severity-bumped, but still a classified pair this
        // chunk's verdict was actually evaluated against.
        pairIds.add(pair.pairId);
        continue;
      }

      // Decision 18: narrow to only the live slice(s) whose OWN text contains the recorded quote —
      // never broaden the whole group's citing chunks by default. But before narrowing, check
      // whether the quote lands ANYWHERE in the pair's live slices at all — that single check is
      // what tells case (a) (matches elsewhere in the pair) apart from case (b) (matches nothing —
      // unattributable).
      const quote = record.quotedPass1?.trim();
      let affected: string[];
      if (quote && quote.length > 0) {
        let matchedAnywhereInPair = false;
        const unreadableInPair: string[] = [];
        for (const liveSlice of pair.liveSlices) {
          const text = await liveText(bareSliceName(liveSlice));
          if (text === null) {
            unreadableInPair.push(liveSlice);
            continue;
          }
          if (text.includes(quote)) matchedAnywhereInPair = true;
        }

        if (unreadableInPair.length > 0) {
          // PAIR-LEVEL BLINDNESS — checked BEFORE decision 19's ladder, never inside it. An
          // unreadable/missing live slice can never rule itself out as the one that would have
          // matched — surface it and broaden conservatively rather than guess it read empty.
          affected = pairCitedLiveSlices;
          warningSet.add(
            `[unreadable-live-slice] Pair "${pair.pairId}": ${unreadableInPair.length} live ` +
              `slice(s) could not be read (${unreadableInPair.join(', ')}) while attributing a ` +
              `"${record.ruleDelta}" delta — broadened to every cited live slice for chunk ` +
              `"${slug}" rather than reported clean.`,
          );
        } else if (!matchedAnywhereInPair) {
          // PAIR-LEVEL BLINDNESS, case (b) — checked BEFORE decision 19's ladder, never inside it.
          // The recorded quote is UNATTRIBUTABLE — it matches no live slice in this pair at all
          // (paraphrase, re-wrap, or drift). Broaden conservatively and surface it; a citation-level
          // "not attributed" answer computed from this quote would be a fabricated exemption.
          affected = pairCitedLiveSlices;
          warningSet.add(
            `[unattributable-quote] Pair "${pair.pairId}": the recorded quote for a ` +
              `"${record.ruleDelta}" delta does not match verbatim in any live slice of this pair ` +
              `(paraphrase or drift) — broadened to every cited live slice for chunk "${slug}" ` +
              `rather than reported clean.`,
          );
        } else {
          // Case (a): the quote lands somewhere in the pair. ONLY here does decision 19's
          // per-citation ladder run — one evaluation per cited live slice the quote actually lands
          // on, never per slice the quote does not touch (that slice is genuinely not this chunk's
          // problem, exactly as decision 18 already established).
          affected = [];
          for (const liveSlice of pairCitedLiveSlices) {
            const text = await liveText(bareSliceName(liveSlice));
            if (text === null || !text.includes(quote)) continue;

            const line = matchedLiveLine(text, quote) ?? quote;
            const page = citedPageForLine(text, line);
            const attribution = resolveCitationAttribution({
              liveSlice,
              liveSliceText: text,
              deltaLine: line,
              deltaLinePage: page,
              anchors,
            });
            attributions.push({
              pairId: pair.pairId,
              liveSlice,
              rung: attribution.rung,
              attributed: attribution.attributed,
              reason: attribution.reason,
            });
            if (attribution.rung === 'slice-fallback') {
              warningSet.add(
                `[unresolved-citation] Chunk "${slug}" cites live slice "${liveSlice}" in pair ` +
                  `"${pair.pairId}", but no claim-level citation anchor (quoted fragment or page) ` +
                  `could be resolved — broadened to decision 18's slice-level attribution rather ` +
                  `than reported clean.`,
              );
            }
            if (attribution.attributed) affected.push(liveSlice);
          }
        }
      } else {
        // No quote recorded at all — cannot be narrowed, so conservatively treat every one of this
        // chunk's cited live slices in the pair as affected (decision 8).
        affected = pairCitedLiveSlices;
      }
      // Only reachable via case (a): the quote matched elsewhere in the pair, not on any live slice
      // this chunk itself cites — genuinely not this chunk's problem — OR every one of this
      // chunk's cited live slices resolved to `attributed: false` at rung `quoted-fragment`.
      if (affected.length === 0) continue;

      pairIds.add(pair.pairId);
      if (RULE_DELTA_SEVERITY[record.ruleDelta] > RULE_DELTA_SEVERITY[ruleDelta]) {
        ruleDelta = record.ruleDelta;
      }
    }

    results.push({
      slug,
      citedLiveSlices: resolved,
      pairIds: [...pairIds].sort(),
      ruleDelta,
      stale: ruleDelta !== 'cosmetic',
      attributions,
    });
  }
  return { verdicts: results, warnings: [...warningSet] };
}

export interface VerifyClassifyStatusResult {
  runId: string;
  pendingPairs: string[];
  classified: ClassificationRecord[];
  warnings: string[];
  summary: {
    pairs: number;
    paired: number;
    presentationOnly: number;
    unpaired: number;
    classified: number;
    cosmetic: number;
    sharper: number;
    contradictory: number;
    unclassified: number;
    stale: number;
    cosmeticPct: number;
  };
  chunkVerdicts: ChunkVerdict[];
}

/**
 * `boardsmith verify-classify-status` — which pairs still need classifying (the resume decision),
 * summary counts, and the per-chunk verdict roll-up (VERIFY-01's remaining half). Read-only; a
 * pure function of the ledger (`status-5`) — never a directory scan.
 *
 * `pendingPairs` covers only `paired`-kind groups — there is nothing to classify in an
 * `unpaired-slice`/`presentation-only` group, but both are still reported in `summary` rather than
 * dropped (decision 4/17). `cosmeticPct` is computed over classified verdicts on `paired`,
 * rule-bearing pairs ONLY — `presentation-only` groups never enter numerator or denominator
 * (decision 17).
 */
export async function verifyClassifyStatusCommand(
  options: VerifyRunOptions & { runId?: string } = {},
): Promise<VerifyClassifyStatusResult> {
  const projectDir = resolve(options.project ?? process.cwd());
  const runId = await resolveRunId(projectDir, options.runId);
  const { pairs, warnings: pairingWarnings } = await computeRunPairs(projectDir, runId);

  const ledgerFile = ledgerFilePath(projectDir, runId);
  const relLedgerPath = relative(projectDir, ledgerFile);
  const ledgerText = await readLedgerOrThrow(ledgerFile, runId, projectDir);
  const { lines } = parseLedgerBody(ledgerText, relLedgerPath);
  const { classifications } = resolveLedgerState(lines);
  const classifiedByPairId = new Map(classifications.map((c) => [c.pairId, c]));

  const pairedPairs = pairs.filter((p) => p.kind === 'paired');
  const pendingPairs = pairedPairs
    .filter((p) => !classifiedByPairId.has(p.pairId))
    .map((p) => p.pairId);

  const cosmetic = classifications.filter((c) => c.ruleDelta === 'cosmetic').length;
  const sharper = classifications.filter((c) => c.ruleDelta === 'sharper').length;
  const contradictory = classifications.filter((c) => c.ruleDelta === 'contradictory').length;
  const unclassified = classifications.filter((c) => c.ruleDelta === 'unclassified').length;
  const stale = classifications.filter((c) => c.stale).length;

  const pairedRuleBearingClassified = classifications.filter(
    (c) => pairs.find((p) => p.pairId === c.pairId)?.kind === 'paired',
  );
  const cosmeticOverRuleBearing = pairedRuleBearingClassified.filter(
    (c) => c.ruleDelta === 'cosmetic',
  ).length;
  const cosmeticPct =
    pairedRuleBearingClassified.length > 0
      ? Math.round((cosmeticOverRuleBearing / pairedRuleBearingClassified.length) * 1000) / 10
      : 0;

  const summary = {
    pairs: pairs.length,
    paired: pairedPairs.length,
    presentationOnly: pairs.filter((p) => p.kind === 'presentation-only').length,
    unpaired: pairs.filter((p) => p.kind === 'unpaired-slice').length,
    classified: classifications.length,
    cosmetic,
    sharper,
    contradictory,
    unclassified,
    stale,
    cosmeticPct,
  };

  const { verdicts: chunkVerdicts, warnings: chunkWarnings } = await computeChunkVerdicts(
    projectDir,
    pairs,
    classifications,
  );
  const warnings = [...pairingWarnings, ...chunkWarnings];

  const result: VerifyClassifyStatusResult = {
    runId,
    pendingPairs,
    classified: classifications,
    warnings,
    summary,
    chunkVerdicts,
  };

  for (const w of warnings) console.error(chalk.yellow(`⚠ ${w}`));

  if (options.quiet) return result;

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  console.log(chalk.green(`✓ Verify-classify status — run ${runId}`));
  console.log(
    `  ${chalk.gray('classified:')} ${summary.classified}/${summary.paired} paired group(s) — ` +
      `${summary.cosmetic} cosmetic, ${summary.sharper} sharper, ${summary.contradictory} contradictory, ` +
      `${summary.unclassified} unclassified (cosmeticPct: ${summary.cosmeticPct}%)`,
  );
  if (pendingPairs.length > 0) {
    console.log(`  ${chalk.yellow('pending:')} ${pendingPairs.join(', ')}`);
  }
  const staleChunks = chunkVerdicts.filter((c) => c.stale);
  if (staleChunks.length > 0) {
    console.log(`  ${chalk.yellow('stale chunks:')} ${staleChunks.map((c) => c.slug).join(', ')}`);
  }
  return result;
}
