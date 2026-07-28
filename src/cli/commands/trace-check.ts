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

import { promises as fs } from 'node:fs';
import { join, relative, resolve as pathResolve, sep } from 'node:path';
import {
  FINDING_KINDS,
  type Finding,
  type FindingKind,
  parseBuildManifest,
  parseInterpretationClaims,
  parseRulings,
} from './build-manifest.js';

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

// -------------------------------------------------------------------------------------------
// traceCheckCommand
// -------------------------------------------------------------------------------------------

export interface TraceCheckResult {
  findings: Finding[];
  counts: Record<FindingKind, number>;
  totals: {
    chunks: number;
    claims: number;
    rulings: number;
    testFiles: number;
    claimCitations: number;
    rulingCitations: number;
  };
  /** Supersede-verb sentences whose chain could not be parsed — reported, never assumed. */
  unparsedSupersessions: Array<{ ruling: number; sentence: string }>;
}

function emptyCounts(): Record<FindingKind, number> {
  const counts = {} as Record<FindingKind, number>;
  for (const kind of FINDING_KINDS) counts[kind] = 0;
  return counts;
}

function pushFinding(findings: Finding[], counts: Record<FindingKind, number>, f: Finding): void {
  findings.push(f);
  counts[f.kind]++;
}

/** Recursively collects every `*.test.ts` file under `dir`, returning absolute paths. */
async function walkTestFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string): Promise<void> {
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith('.test.ts')) out.push(full);
    }
  }
  await walk(dir);
  return out;
}

/** POSIX-style path relative to `projectDir`, for stable comparison against manifest paths. */
function relPosix(projectDir: string, absPath: string): string {
  return relative(projectDir, absPath).split(sep).join('/');
}

/** Resolves a manifest-supplied relative path against `projectDir`, rejecting any escape. */
function resolveManifestPath(projectDir: string, relPathStr: string): string | 'escapes' {
  const resolved = pathResolve(projectDir, relPathStr);
  const rel = relative(projectDir, resolved);
  if (rel === '..' || rel.startsWith(`..${sep}`)) return 'escapes';
  return resolved;
}

/**
 * `boardsmith trace-check [--json]` — enumerates `chunks/*␣/CHUNK.md`, parses each one's live
 * `## Interpretation` claim list and `## Build Manifest`, scans every test file for `claim`/
 * `Ruling` citations, resolves each citation through the three-rung ladder above, and emits the
 * locked `FINDING_KINDS` records.
 *
 * Tool failure (no `chunks/` directory) throws a one-line actionable `Error`; `cli.ts`'s top-level
 * catch prints only `err.message`, never a stack trace or internal path (CLAUDE.md, T-172-05).
 * A FINDING never sets `process.exitCode` — findings exit 0 (172-CONTEXT.md decision 6).
 *
 * `--json`: `console.log(JSON.stringify(result, null, 2))` as the last thing computed, then
 * returns the result — the exact convention `chunk-provenance.ts:794-797` establishes. This is
 * the contract Phase 173's `/bs-verify-game` consumes (decision 8: CLI computes, skill formats).
 * Otherwise: a grouped, count-first human report (`printHumanReport` below).
 */
export async function traceCheckCommand(
  options: { project?: string; json?: boolean } = {},
): Promise<TraceCheckResult> {
  const projectDir = pathResolve(options.project ?? process.cwd());
  const chunksDir = join(projectDir, 'chunks');

  let chunkDirEntries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    chunkDirEntries = await fs.readdir(chunksDir, { withFileTypes: true });
  } catch {
    throw new Error(
      `No chunks/ directory in ${projectDir}.\n` +
        `This command looks for chunks/<slug>/CHUNK.md files — run it from a BoardSmith game\n` +
        `project directory, or pass --project <dir>.`,
    );
  }
  const slugs = chunkDirEntries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const findings: Finding[] = [];
  const counts = emptyCounts();

  const liveClaims: Record<string, number[]> = {};
  /** file (posix-relative) -> chunk -> authoring, built from every chunk's Build Manifest. */
  const fileOwners: Record<string, Record<string, boolean>> = {};
  const claimCoverage: Record<string, Set<number>> = {};

  for (const slug of slugs) {
    let chunkText: string;
    try {
      chunkText = await fs.readFile(join(chunksDir, slug, 'CHUNK.md'), 'utf-8');
    } catch {
      continue; // a chunks/<slug> dir with no CHUNK.md is not this command's problem to report
    }

    liveClaims[slug] = parseInterpretationClaims(chunkText);
    claimCoverage[slug] = new Set();

    const manifest = parseBuildManifest(chunkText);
    if (!manifest.tabular) {
      pushFinding(findings, counts, {
        kind: 'manifest-file-missing',
        chunk: slug,
        subject: 'Build Manifest',
        detail: 'manifest is not table-shaped',
      });
    }
    for (const rowIndex of manifest.pathlessRowIndexes) {
      pushFinding(findings, counts, {
        kind: 'manifest-file-missing',
        chunk: slug,
        subject: `row ${rowIndex}`,
        detail: `row ${rowIndex} has no path token`,
      });
    }
    for (const entry of manifest.entries) {
      const byChunk = (fileOwners[entry.path] ??= {});
      byChunk[slug] = (byChunk[slug] ?? false) || entry.authoring;
    }
  }

  // --- Test-file discovery: tests/**/*.test.ts, plus manifest-listed paths ending .test.ts. ---
  const testsDir = join(projectDir, 'tests');
  const walked = await walkTestFiles(testsDir);
  const discovered = new Map<string, string>(); // relPosix path -> absolute path
  for (const abs of walked) discovered.set(relPosix(projectDir, abs), abs);

  for (const filePath of Object.keys(fileOwners)) {
    if (!filePath.endsWith('.test.ts')) continue;
    if (discovered.has(filePath)) continue;
    const resolved = resolveManifestPath(projectDir, filePath);
    if (resolved === 'escapes') {
      const owningChunks = Object.keys(fileOwners[filePath]);
      pushFinding(findings, counts, {
        kind: 'manifest-file-missing',
        chunk: owningChunks[0] ?? '',
        subject: filePath,
        detail: `manifest path escapes the project root: ${filePath}`,
      });
      continue;
    }
    discovered.set(filePath, resolved);
  }

  let claimCitationTotal = 0;
  let rulingCitationTotal = 0;
  const citedRulings = new Set<number>();

  for (const [relPath, absPath] of [...discovered.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    let sourceText: string;
    try {
      sourceText = await fs.readFile(absPath, 'utf-8');
    } catch {
      continue; // a manifest-listed test file absent on disk is not this command's problem
    }

    const { claims, rulings, importsRules } = scanTestCitations(sourceText);
    claimCitationTotal += claims.length;
    rulingCitationTotal += rulings.length;
    for (const r of rulings) citedRulings.add(r);

    const owners = Object.keys(fileOwners[relPath] ?? {}).sort();

    if (owners.length === 0) {
      pushFinding(findings, counts, {
        kind: 'unassociated-test',
        chunk: '',
        subject: relPath,
        detail: "no chunk's Build Manifest lists this test file",
      });
      for (const claimNumber of claims) {
        pushFinding(findings, counts, {
          kind: 'unresolved-claim-ref',
          chunk: '',
          subject: `claim ${claimNumber}`,
          detail: `${relPath} cites claim ${claimNumber}, but the file is unassociated (no owning chunk)`,
        });
      }
      continue;
    }

    if (claims.length === 0 && rulings.length === 0 && importsRules) {
      pushFinding(findings, counts, {
        kind: 'test-unlinked',
        chunk: owners.join(', '),
        subject: relPath,
        detail: `${relPath} imports src/rules/ but cites neither a claim nor a ruling`,
      });
    }

    const authoringForFile: Record<string, boolean> = {};
    for (const chunk of owners) authoringForFile[chunk] = fileOwners[relPath][chunk];

    for (const claimNumber of claims) {
      const resolution = resolveClaimCitation(claimNumber, owners, liveClaims, authoringForFile);
      if (resolution.status === 'resolved') {
        claimCoverage[resolution.chunk]?.add(claimNumber);
      } else if (resolution.status === 'ambiguous') {
        pushFinding(findings, counts, {
          kind: 'ambiguous-claim-ref',
          chunk: resolution.candidates.join(', '),
          subject: `claim ${claimNumber} in ${relPath}`,
          detail: `candidates: ${resolution.candidates.join(', ')}`,
        });
      } else {
        // reason === 'no-live-claim' — 'no-owner' cannot occur here since owners.length > 0.
        pushFinding(findings, counts, {
          kind: 'unresolved-claim-ref',
          chunk: owners.join(', '),
          subject: `claim ${claimNumber}`,
          detail: `${relPath} cites claim ${claimNumber}; owners checked: ${owners.join(', ')}; none has a live claim ${claimNumber}`,
        });
      }
    }
  }

  // --- claim-untested: a live claim resolved to by no citation. ---
  for (const slug of slugs) {
    for (const claimNumber of liveClaims[slug] ?? []) {
      if (!claimCoverage[slug]?.has(claimNumber)) {
        pushFinding(findings, counts, {
          kind: 'claim-untested',
          chunk: slug,
          subject: `claim ${claimNumber}`,
          detail: `Interpretation claim ${claimNumber} has no resolved citing test`,
        });
      }
    }
  }

  // --- RULINGS.md: ruling-untested + unparsed supersessions. Missing file -> zero findings. ---
  let parsedRulings: ReturnType<typeof parseRulings> = [];
  try {
    const rulingsText = await fs.readFile(join(projectDir, 'RULINGS.md'), 'utf-8');
    parsedRulings = parseRulings(rulingsText);
  } catch {
    parsedRulings = [];
  }

  for (const ruling of parsedRulings) {
    if (ruling.supersededBy !== undefined) continue; // superseded rulings are not demanded a test
    if (!citedRulings.has(ruling.number)) {
      pushFinding(findings, counts, {
        kind: 'ruling-untested',
        chunk: '',
        subject: `Ruling ${ruling.number}`,
        detail: `no test file cites Ruling ${ruling.number}`,
      });
    }
  }

  const unparsedSupersessions: Array<{ ruling: number; sentence: string }> = [];
  for (const ruling of parsedRulings) {
    for (const sentence of ruling.unparsedSupersession) {
      unparsedSupersessions.push({ ruling: ruling.number, sentence });
    }
  }

  const totals = {
    chunks: slugs.length,
    claims: Object.values(liveClaims).reduce((sum, arr) => sum + arr.length, 0),
    rulings: parsedRulings.length,
    testFiles: discovered.size,
    claimCitations: claimCitationTotal,
    rulingCitations: rulingCitationTotal,
  };

  const result: TraceCheckResult = { findings, counts, totals, unparsedSupersessions };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  printHumanReport(result);
  return result;
}

// -------------------------------------------------------------------------------------------
// Human report — count-first, grouped by kind (172-CONTEXT.md's "report text formatting" item).
// Both output modes go to stdout via console.log; console.error is reserved for a mutation
// notice this command never emits, since it mutates nothing (PATTERNS.md).
// -------------------------------------------------------------------------------------------

const MAX_ITEMS_PER_KIND = 10;

function printHumanReport(result: TraceCheckResult): void {
  const { totals, counts, findings, unparsedSupersessions } = result;

  console.log(
    `Traceability sweep — ${totals.chunks} chunks, ${totals.claims} claims, ${totals.rulings} rulings, ` +
      `${totals.testFiles} test files, ${totals.claimCitations} claim citations, ${totals.rulingCitations} ruling citations`,
  );
  console.log(FINDING_KINDS.map((kind) => `${kind}: ${counts[kind]}`).join('  '));

  for (const kind of FINDING_KINDS) {
    const kindFindings = findings.filter((f) => f.kind === kind);
    if (kindFindings.length === 0) continue;

    console.log(`\n${kind} (${kindFindings.length})`);
    const shown = kindFindings.slice(0, MAX_ITEMS_PER_KIND);
    for (const f of shown) {
      console.log(`  [${f.chunk || '-'}] ${f.subject}: ${f.detail}`);
    }
    const remaining = kindFindings.length - shown.length;
    if (remaining > 0) {
      console.log(`  +${remaining} more — run --json for the full list`);
    }
  }

  if (unparsedSupersessions.length > 0) {
    console.log(`\nunparsed supersessions (${unparsedSupersessions.length})`);
    for (const u of unparsedSupersessions) {
      console.log(`  Ruling ${u.ruling}: ${u.sentence}`);
    }
  }
}
