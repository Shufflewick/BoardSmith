/**
 * `boardsmith parallel-check <slugs...>` (#294): may these chunks be built at the same time?
 *
 * Chunks built at once, each on its own branch, cannot see each other's work until they merge.
 * That is safe only when neither needs the other and they implement different rules. The sotf run
 * built auctions, quests and world evolution at once with nothing checking either, and all three
 * turned out to share venues. So the decision is made here, as code, from two facts the design
 * already records:
 *
 *   - the sketch's dependency graph: every chunk's `- Depends on:` must name only verified chunks,
 *     which also means none of the chunks being started depends on another of them;
 *   - rulebook citations: the sections of the rulebook slices each chunk cites must not overlap
 *     (#415). A chunk's citations are its sketch `Citations:` line plus its CHUNK.md
 *     `## Interpretation` (less the claims a later claim supersedes) and
 *     `## Newly Discovered Citations`. The unit is a SECTION of a slice (`slice-sections.ts`), not
 *     the slice: a designer-decisions page cited by most chunks for different rules would
 *     otherwise refuse every pair. A citation claims:
 *       - `rulebook/<file>.md §"<section>"`: that section (a heading: every section under it);
 *       - `rulebook/<file>.md:N-M`: the sections holding those lines;
 *       - `rulebook/<file>.md` alone, whatever prose follows it: every section of the slice.
 *     Every citation must name a real slice, section and lines, since one that resolves to
 *     nothing cannot be shown not to overlap.
 *
 * The core-loop and final-acceptance chunks always run alone. Whatever cannot be shown to be
 * independent is refused: building in order is always correct, so the safe answer is "no".
 * `boardsmith chunk-merge` re-applies the same pair rule to the chunks that really were built
 * alongside each other, so skipping this check does not get a branch merged.
 */
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { SKETCH_MD, chunkMdPath, designPath, designRulebookDir } from '../lib/project-paths.js';
import { assertBareName } from '../lib/user-name.js';
import { extractSection } from './build-manifest.js';
import { resolveCitedSlices } from './chunk-provenance.js';
import { interpretationTextInForce } from './claim-quotes.js';
import { LINE_LOCATION_HINT, fileLines, lineRangeProblem, splitLineLocation } from '../lib/line-location.js';
import { type SliceSection, sectionsHolding, sectionsNamed, sliceSections } from '../lib/slice-sections.js';
import { type SketchChunk, dependencyClosure, parseSketchChunks } from './sketch-chunks.js';

/** What one chunk cites of one slice: every section of it, or some of them. */
interface CitedSlice {
  /** Every section of the slice, in order. */
  sections: SliceSection[];
  /** The slice was cited without a section or lines, so every section is cited. */
  whole: boolean;
  /** The first line of each cited section, which identifies it. */
  cited: Set<number>;
}

/** One citation: the slice, all its sections, and the ones the citation claims. */
interface ResolvedCitation {
  slice: string;
  sections: SliceSection[];
  whole: boolean;
  cited: SliceSection[];
}

/** The slices, and the sections of each, one chunk cites; and every citation that located nothing. */
interface ChunkCitations {
  slug: string;
  slices: Map<string, CitedSlice>;
  /** One sentence per citation that names no slice, section or lines of it. */
  unreadable: string[];
}

const ALONE: Record<string, string> = {
  'core-loop': 'is the core-loop chunk, which every other chunk builds on',
  'final-acceptance': 'is the final-acceptance chunk, which plays the whole finished game',
};

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await fs.readFile(path, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

async function sliceFilenames(projectDir: string): Promise<string[]> {
  try {
    return (await fs.readdir(designRulebookDir(projectDir))).filter((n) => n.endsWith('.md'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export async function readSketchChunks(projectDir: string): Promise<SketchChunk[]> {
  const sketch = await readOptional(designPath(projectDir, SKETCH_MD));
  if (sketch === undefined) {
    throw new Error(`No ${SKETCH_MD} in this project's design/ folder. Run this from the game project, or pass --project <dir>.`);
  }
  return parseSketchChunks(sketch);
}

const CITATION = /rulebook\/[A-Za-z0-9._-]+/g;
/** What may follow a cited slice's path: a line location, or one or more `§"<section>"`. */
const LINE_AFTER_PATH = /^`?:(\d+(?:-\d+|:\d+)?)/;
const SECTIONS_AFTER_PATH = /^`?((?:\s*§\s*"[^"]+")+)/;

function sectionNames(sections: readonly SliceSection[]): string {
  return [...new Set(sections.map((s) => s.name).filter((n) => n !== ''))].map((n) => `"${n}"`).join(', ');
}

/**
 * The sections one citation claims (see the header), or why it locates nothing. `after` is the text
 * that follows the slice's path.
 */
function citedSections(
  slug: string,
  slice: string,
  sections: SliceSection[],
  lineCount: number,
  after: string,
): { whole: boolean; cited: SliceSection[] } | { problem: string } {
  const lines = LINE_AFTER_PATH.exec(after);
  if (lines) {
    const range = splitLineLocation(`${slice}:${lines[1]}`).lines!;
    const shown = `${slice}:${lines[1]}`;
    switch (lineRangeProblem(range, lineCount)) {
      case 'invalid':
        return { problem: `${slug} cites ${shown}, which is not a line range. ${LINE_LOCATION_HINT}` };
      case 'past-end':
        return {
          problem:
            `${slug} cites ${shown}, but that slice has ${lineCount} lines, so its overlap with other ` +
            `chunks cannot be ruled out. Correct the line range.`,
        };
    }
    return { whole: false, cited: sectionsHolding(sections, range[0], range[1]) };
  }
  const named = SECTIONS_AFTER_PATH.exec(after);
  if (!named) return { whole: true, cited: sections };
  const cited: SliceSection[] = [];
  for (const [, name] of named[1].matchAll(/§\s*"([^"]+)"/g)) {
    const found = sectionsNamed(sections, name);
    if (found.length === 0) {
      return {
        problem:
          `${slug} cites ${slice} §"${name}", which names no section of it, so its overlap with other ` +
          `chunks cannot be ruled out. Its sections are: ${sectionNames(sections)}. Cite one of them, ` +
          `or the lines it means (${slice}:N-M).`,
      };
    }
    cited.push(...found);
  }
  return { whole: false, cited };
}

/**
 * What a chunk cites: its sketch line plus what its CHUNK.md interpreted (the claims in force) and
 * discovered, each citation resolved to the sections of a slice it claims.
 */
export async function chunkCitations(projectDir: string, chunk: SketchChunk): Promise<ChunkCitations> {
  const text = await citingText(projectDir, chunk);
  const filenames = await sliceFilenames(projectDir);
  const result: ChunkCitations = { slug: chunk.slug, slices: new Map(), unreadable: [] };
  for (const match of text.matchAll(CITATION)) {
    const after = text.slice(match.index + match[0].length);
    const claim = await resolveCitation(projectDir, chunk.slug, match[0], after, filenames);
    if (!('problem' in claim)) addCited(result.slices, claim);
    else if (!result.unreadable.includes(claim.problem)) result.unreadable.push(claim.problem);
  }
  return result;
}

/** The text a chunk's citations are read from: its sketch line, claims in force and discoveries. */
async function citingText(projectDir: string, chunk: SketchChunk): Promise<string> {
  const chunkText = (await readOptional(chunkMdPath(projectDir, chunk.slug))) ?? '';
  return [
    chunk.citations ?? '',
    interpretationTextInForce(chunkText) ?? '',
    extractSection(chunkText, '## Newly Discovered Citations') ?? '',
  ].join('\n');
}

function addCited(slices: Map<string, CitedSlice>, claim: ResolvedCitation): void {
  const entry = slices.get(claim.slice) ?? { sections: claim.sections, whole: false, cited: new Set<number>() };
  entry.whole ||= claim.whole;
  for (const section of claim.cited) entry.cited.add(section.from);
  slices.set(claim.slice, entry);
}

/** One `rulebook/...` token, and the text after it, resolved to its slice and the sections it claims. */
async function resolveCitation(
  projectDir: string,
  slug: string,
  token: string,
  after: string,
  filenames: string[],
): Promise<ResolvedCitation | { problem: string }> {
  const { resolved, unresolved } = resolveCitedSlices(token, filenames);
  if (unresolved.length > 0) {
    return {
      problem:
        `${slug} cites ${unresolved[0]}, which names no single file in design/rulebook/, so its ` +
        `overlap with other chunks cannot be ruled out. Correct the citation to the slice file it means.`,
    };
  }
  const slice = resolved[0];
  const sliceText = await fs.readFile(designPath(projectDir, slice), 'utf-8');
  const sections = sliceSections(sliceText);
  const claim = citedSections(slug, slice, sections, fileLines(sliceText).length, after);
  return 'problem' in claim ? claim : { slice, sections, ...claim };
}

/** Why `a` and `b` cannot be built alongside each other by the sketch's dependency graph. */
function dependencyProblems(chunks: readonly SketchChunk[], a: string, b: string): string[] {
  return [
    [a, b],
    [b, a],
  ]
    .filter(([x, y]) => dependencyClosure(chunks, x).has(y))
    .map(([x, y]) => `${x} depends on ${y} in ${SKETCH_MD}, so it must be built after ${y} is verified, not beside it.`);
}

function shownSections(sections: readonly SliceSection[]): string {
  return sections
    .map((s) => `${s.name === '' ? 'the top of the page' : `§"${s.name}"`} (lines ${s.from}-${s.to})`)
    .join(', ');
}

/** Why `a` and `b` cannot be built together over one slice they both cite, or `undefined`. */
function sliceOverlap(slice: string, a: ChunkCitations, b: ChunkCitations): string | undefined {
  const ca = a.slices.get(slice);
  const cb = b.slices.get(slice);
  if (!ca || !cb) return undefined;
  const shared = ca.sections.filter((s) => ca.cited.has(s.from) && cb.cited.has(s.from));
  if (shared.length === 0) return undefined;
  return overlapSentence(slice, [a.slug, ca], [b.slug, cb], shared);
}

/**
 * The refusal for two chunks that cite `shared` sections of `slice`. It names those sections, and
 * says how to narrow a whole-page citation when the page has more than one section.
 */
function overlapSentence(
  slice: string,
  [a, ca]: [string, CitedSlice],
  [b, cb]: [string, CitedSlice],
  shared: SliceSection[],
): string {
  const why = 'so they implement overlapping rules and would each interpret them without seeing the other.';
  const narrow = (whose: string) =>
    ca.sections.length > 1 ? `, or narrow ${whose} to the sections it needs (${slice} §"<section>")` : '';
  if (ca.whole && cb.whole) {
    return `${a} and ${b} both cite ${slice} as a whole page, ${why} Build them one after the other${narrow('each citation')}.`;
  }
  if (!ca.whole && !cb.whole) {
    return `${a} and ${b} both cite ${slice} ${shownSections(shared)}, ${why} Build them one after the other.`;
  }
  const [whole, other] = ca.whole ? [a, b] : [b, a];
  return (
    `${whole} cites ${slice} as a whole page and ${other} cites its ${shownSections(shared)}, ${why} ` +
    `Build them one after the other${narrow(`${whole}'s citation`)}.`
  );
}

/** The rulebook sections `a` and `b` both cite, one reason per slice they cannot be built together. */
function overlapProblems(a: ChunkCitations, b: ChunkCitations): string[] {
  return [...a.slices.keys()].flatMap((slice) => sliceOverlap(slice, a, b) ?? []);
}

/**
 * Why chunks `a` and `b` cannot be built alongside each other: one depends on the other, directly
 * or through another chunk, or they cite a section of a rulebook slice in common. `[]` means they are
 * independent. `boardsmith chunk-merge` applies it to the chunks that really were built together.
 */
export function pairProblems(chunks: readonly SketchChunk[], a: ChunkCitations, b: ChunkCitations): string[] {
  return [...dependencyProblems(chunks, a.slug, b.slug), ...overlapProblems(a, b)];
}

/** Why a chunk cannot be started at all right now, whatever it would run beside. */
function lifecycleProblems(chunk: SketchChunk): string[] {
  const problems: string[] = [];
  const status = chunk.status ?? '';
  if (status.startsWith('verified')) problems.push(`${chunk.slug} is already verified; there is nothing to build.`);
  if (status.startsWith('stale')) problems.push(`${chunk.slug} is stale and must be re-derived before it is built.`);
  const alone = ALONE[chunk.milestone ?? ''];
  if (alone) problems.push(`${chunk.slug} ${alone}, so it is always built on its own.`);
  return problems;
}

/** Every chunk it depends on must be verified; that also rules out depending on a chunk beside it. */
function dependencyLineProblems(chunk: SketchChunk, bySlug: Map<string, SketchChunk>): string[] {
  if (chunk.dependsOn === undefined) {
    return [
      `${chunk.slug} has no "- Depends on:" line in ${SKETCH_MD}, so nothing shows what it needs. Add ` +
        `one (the chunks it builds on, or none) with /bs-insert-chunk before building it beside another.`,
    ];
  }
  return chunk.dependsOn.flatMap((dep) => {
    const depChunk = bySlug.get(dep);
    if (!depChunk) {
      return [`${chunk.slug} depends on "${dep}", which is not a chunk in ${SKETCH_MD}. Correct its "- Depends on:" line.`];
    }
    if ((depChunk.status ?? '').startsWith('verified')) return [];
    return [`${chunk.slug} depends on ${dep}, which is not verified yet, so ${chunk.slug} must wait for it.`];
  });
}

function citationProblems(c: ChunkCitations): string[] {
  const problems = [...c.unreadable];
  if (c.slices.size === 0 && c.unreadable.length === 0) {
    problems.push(
      `${c.slug} has no rulebook citations (rulebook/<file>.md), so its overlap with other chunks ` +
        `cannot be ruled out. Detail it first, or build it on its own.`,
    );
  }
  return problems;
}

/**
 * Every reason `slugs` may not be built at the same time; `[]` means they may. Read-only.
 */
export async function checkParallel(projectDir: string, slugs: readonly string[]): Promise<string[]> {
  const dir = resolve(projectDir);
  const unique = [...new Set(slugs)];
  if (unique.length < 2) return ['Name at least two chunks to build at the same time; one chunk is an ordinary dispatch.'];

  const chunks = await readSketchChunks(dir);
  const bySlug = new Map(chunks.map((c) => [c.slug, c]));
  const refusals: string[] = [];
  const cited: ChunkCitations[] = [];
  for (const slug of unique) {
    const chunk = bySlug.get(slug);
    if (!chunk) {
      refusals.push(`There is no chunk "${slug}" in ${SKETCH_MD}'s Ordered Chunk List.`);
      continue;
    }
    refusals.push(...lifecycleProblems(chunk), ...dependencyLineProblems(chunk, bySlug));
    const citations = await chunkCitations(dir, chunk);
    refusals.push(...citationProblems(citations));
    cited.push(citations);
  }
  for (let i = 0; i < cited.length; i++) {
    for (let j = i + 1; j < cited.length; j++) {
      // A dependency between two of them is already refused above: a dependency must be verified.
      refusals.push(...overlapProblems(cited[i], cited[j]));
    }
  }
  return refusals;
}

/**
 * The CLI entry. Exits non-zero when the chunks may not be built at the same time, so an
 * orchestrator that runs it before opening a worktree per chunk cannot miss the answer.
 */
export async function parallelCheckCommand(
  slugs: string[],
  options: { project?: string; json?: boolean } = {},
): Promise<void> {
  try {
    for (const slug of slugs) {
      assertBareName('<slugs...>', slug, 'Pass chunk slugs from SKETCH.md\'s Ordered Chunk List.');
    }
  } catch (error) {
    console.error(chalk.red((error as Error).message));
    process.exitCode = 1;
    return;
  }
  const refusals = await checkParallel(resolve(options.project ?? process.cwd()), slugs);
  if (refusals.length > 0) process.exitCode = 1;
  if (options.json) {
    console.log(JSON.stringify({ chunks: slugs, ok: refusals.length === 0, refusals }, null, 2));
    return;
  }
  if (refusals.length === 0) {
    console.log(chalk.green(`✓ ${slugs.join(', ')} may be built at the same time, each in its own worktree.`));
    return;
  }
  console.error(chalk.red(`These chunks may not be built at the same time. Build them one after the other, or fix:`));
  for (const refusal of refusals) console.error(`  • ${refusal}`);
}
