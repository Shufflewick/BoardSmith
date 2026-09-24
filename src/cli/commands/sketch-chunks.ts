/**
 * The entries of SKETCH.md's `## Ordered Chunk List`, as the parallel-dispatch rules read them
 * (#294): each chunk's slug, its citations, what it depends on, its milestone and its status.
 *
 * `- Depends on:` is the sketch's dependency graph. `none` means the chunk needs nothing but
 * what the list order already guarantees for the core loop; otherwise it names the chunks whose
 * work this one builds on. An entry with no `Depends on:` line has an unknown graph, so it is
 * read as depending on every chunk before it: order-only, never safe to build alongside another.
 */
import { blankComments } from '../lib/ledger-entries.js';
import { extractSection } from './build-manifest.js';

export interface SketchChunk {
  slug: string;
  /** The `- Citations:` value, or undefined for an entry without one (a sketch-level tail entry). */
  citations: string | undefined;
  /** The chunks named by `- Depends on:` (`[]` for `none`), or undefined when the line is absent. */
  dependsOn: string[] | undefined;
  milestone: string | undefined;
  /** The Status value, from either the derived form or the sketch-level tail form. */
  status: string | undefined;
}

const ORDERED_CHUNK_LIST = '## Ordered Chunk List';

function field(entry: string, pattern: RegExp): string | undefined {
  return pattern.exec(entry)?.[1].trim();
}

function readDependsOn(entry: string): string[] | undefined {
  const value = field(entry, /^- Depends on:[ \t]*(.*)$/m);
  if (value === undefined) return undefined;
  if (value === '' || value.toLowerCase() === 'none') return [];
  return value
    .split(',')
    .map((s) => s.replace(/`/g, '').trim())
    .filter(Boolean);
}

/** Every chunk entry in the Ordered Chunk List, in list order. Template comments are ignored. */
export function parseSketchChunks(sketch: string): SketchChunk[] {
  const list = blankComments(extractSection(sketch, ORDERED_CHUNK_LIST) ?? '');
  const headings = [...list.matchAll(/^### (\S+)[ \t]*$/gm)];
  return headings.map((match, i) => {
    const entry = list.slice(match.index, i + 1 < headings.length ? headings[i + 1].index : list.length);
    return {
      slug: match[1],
      citations: field(entry, /^- Citations:[ \t]*(.*)$/m),
      dependsOn: readDependsOn(entry),
      milestone: field(entry, /^- Milestone:[ \t]*(.*)$/m),
      status: field(entry, /^- Status(?: \(derived from [^)]*\))?:[ \t]*(.*)$/m),
    };
  });
}

/**
 * Every chunk `slug` depends on, directly or through another chunk. A chunk with no
 * `Depends on:` line depends on every chunk listed before it.
 */
export function dependencyClosure(chunks: readonly SketchChunk[], slug: string): Set<string> {
  const bySlug = new Map(chunks.map((c, i) => [c.slug, { chunk: c, index: i }]));
  const direct = (s: string): string[] => {
    const found = bySlug.get(s);
    if (!found) return [];
    return found.chunk.dependsOn ?? chunks.slice(0, found.index).map((c) => c.slug);
  };
  const seen = new Set<string>();
  const pending = direct(slug);
  while (pending.length > 0) {
    const next = pending.pop() as string;
    if (seen.has(next) || next === slug) continue;
    seen.add(next);
    pending.push(...direct(next));
  }
  return seen;
}
