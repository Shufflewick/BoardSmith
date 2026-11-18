/**
 * `boardsmith next-chunk` (#1660): which chunks may a `/bs-build-game` run build now?
 *
 * A chunk whose rules question waits on the designer is parked, not a reason to stop: the run
 * keeps building every chunk that does not build on it, and stops only when every remaining chunk
 * waits on the designer, directly or through what it depends on. The parked chunks are the ones
 * RUN.md's `Open Gate:` line names. A chunk may be built when it is not verified, is not parked,
 * and everything it depends on (`dependencyClosure`, so a chunk with no `Depends on:` line depends
 * on every chunk before it) is verified. The first such chunk, in list order, is the one to build.
 */
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { styleText } from 'node:util';
import { RUN_MD, SKETCH_MD, designPath } from '../lib/project-paths.js';
import { readIfExists } from '../lib/read-if-exists.js';
import { readSketchChunks } from './parallel-check.js';
import { dependencyClosure } from './sketch-chunks.js';
import { projectDirOption } from '../lib/user-path.js';

export interface NextChunks {
  /** The chunks that may be built now, in list order: the first is the one to build next. */
  buildable: string[];
  /** The chunks RUN.md's `Open Gate:` names, waiting on the designer. */
  waiting: string[];
  /** How many chunks are not verified yet. */
  remaining: number;
}

/**
 * The chunk slugs RUN.md's `Open Gate:` names: `none`, or `<slug> — <what>` entries split by "; ".
 * A slug is a bare name, so it ends at the first space or dash of any kind; quotes are dropped.
 */
async function waitingChunks(projectDir: string): Promise<string[]> {
  const run = await readIfExists(designPath(projectDir, RUN_MD), (p) => fs.readFile(p, 'utf-8'));
  if (run === undefined) return [];
  const value = /^Open Gate:[ \t]*(.*)$/m.exec(run)?.[1].trim() ?? '';
  if (value === '' || value.toLowerCase() === 'none' || value.startsWith('<!--')) return [];
  return value
    .split(';')
    .map((gate) => gate.replace(/[`"]/g, '').trim().split(/\s|[—–]/)[0])
    .filter(Boolean);
}

const isVerified = (status: string | undefined): boolean => (status ?? '').startsWith('verified');

export async function nextChunks(projectDir: string): Promise<NextChunks> {
  const dir = resolve(projectDir);
  const chunks = await readSketchChunks(dir);
  const waiting = await waitingChunks(dir);
  const verified = new Set(chunks.filter((c) => isVerified(c.status)).map((c) => c.slug));
  const remaining = chunks.filter((c) => !verified.has(c.slug));
  const buildable = remaining
    .filter((c) => !waiting.includes(c.slug))
    .filter((c) => [...dependencyClosure(chunks, c.slug)].every((dep) => verified.has(dep)))
    .map((c) => c.slug);
  return { buildable, waiting, remaining: remaining.length };
}

/**
 * The CLI entry. Exits non-zero when chunks remain but none may be built, so the run cannot miss
 * that it must stop and put its open gates to the designer.
 */
export async function nextChunkCommand(options: { project?: string; json?: boolean } = {}): Promise<void> {
  const next = await nextChunks(projectDirOption(options.project));
  const blocked = next.remaining > 0 && next.buildable.length === 0;
  if (blocked) process.exitCode = 1;
  if (options.json) {
    console.log(JSON.stringify(next, null, 2));
    return;
  }
  if (next.remaining === 0) {
    console.log(styleText('green', `✓ Every chunk in ${SKETCH_MD} is verified; there is nothing left to build.`));
    return;
  }
  if (blocked) {
    const message =
      next.waiting.length > 0
        ? `Every remaining chunk waits on the designer: the open gates in ${RUN_MD} (${next.waiting.join(', ')}) ` +
          `and the chunks built on them. Stop the run and put the open gates to the designer.`
        : `No remaining chunk can be built: each depends on a chunk that is not verified. Check the ` +
          `"- Depends on:" lines in ${SKETCH_MD}; a chunk may depend only on chunks listed before it.`;
    console.error(styleText('red', message));
    return;
  }
  const also = next.buildable.slice(1);
  console.log(`Build next: ${next.buildable[0]}.${also.length > 0 ? ` Also buildable now: ${also.join(', ')}.` : ''}`);
}
