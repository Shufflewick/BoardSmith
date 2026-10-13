/**
 * The steps of docs/balance-simulator.md, in page order (#556): each code block
 * marked `<!-- doc-test: file <path> -->` is a file to write, and each marked
 * `<!-- doc-test: run -->` is a list of commands to run. Read by
 * docs/balance-simulator.test.ts, which runs the page, and by
 * scripts/bench-sim/run.mjs, which times its final game.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type DocStep = { kind: 'file'; path: string; body: string } | { kind: 'run'; lines: string[] };

const MARKED_BLOCK = /<!-- doc-test: (file (\S+)|run) -->\n```\w*\n([\s\S]*?)```/g;

export function balanceSimulatorSteps(): DocStep[] {
  const doc = readFileSync(join(import.meta.dirname, 'balance-simulator.md'), 'utf-8');
  return [...doc.matchAll(MARKED_BLOCK)].map(([, , path, body]) =>
    path ? { kind: 'file', path, body } : { kind: 'run', lines: body.split('\n').filter((line) => line.trim() !== '') },
  );
}
