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
 *   - rulebook citations: the slices each chunk cites (its sketch `Citations:` line plus its
 *     CHUNK.md `## Interpretation` and `## Newly Discovered Citations`, the set `/bs-insert-chunk`
 *     compares) must not overlap, and every citation must name a real slice, since a citation
 *     that resolves to nothing cannot be shown not to overlap.
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
import { type SketchChunk, dependencyClosure, parseSketchChunks } from './sketch-chunks.js';

/** The rulebook slices one chunk cites, and any citation that named no slice. */
interface ChunkCitations {
  slug: string;
  slices: string[];
  unresolved: string[];
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

/** The slices a chunk cites: its sketch line plus what its CHUNK.md interpreted and discovered. */
export async function chunkCitations(projectDir: string, chunk: SketchChunk): Promise<ChunkCitations> {
  const chunkText = (await readOptional(chunkMdPath(projectDir, chunk.slug))) ?? '';
  const text = [
    chunk.citations ?? '',
    extractSection(chunkText, '## Interpretation') ?? '',
    extractSection(chunkText, '## Newly Discovered Citations') ?? '',
  ].join('\n');
  const { resolved, unresolved } = resolveCitedSlices(text, await sliceFilenames(projectDir));
  return { slug: chunk.slug, slices: resolved, unresolved };
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

/** The rulebook slices `a` and `b` both cite, each as a reason they cannot be built together. */
function overlapProblems(a: ChunkCitations, b: ChunkCitations): string[] {
  return a.slices
    .filter((s) => b.slices.includes(s))
    .map(
      (slice) =>
        `${a.slug} and ${b.slug} both cite ${slice}, so they implement overlapping rules and would each ` +
        `interpret them without seeing the other. Build them one after the other.`,
    );
}

/**
 * Why chunks `a` and `b` cannot be built alongside each other: one depends on the other, directly
 * or through another chunk, or they cite a rulebook slice in common. `[]` means they are
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
  const problems = c.unresolved.map(
    (u) =>
      `${c.slug} cites ${u}, which names no single file in design/rulebook/, so its overlap with ` +
      `other chunks cannot be ruled out. Correct the citation to the slice file it means.`,
  );
  if (c.slices.length === 0 && c.unresolved.length === 0) {
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
