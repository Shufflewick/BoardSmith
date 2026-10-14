/**
 * The steps of docs/balance-simulator.md, in page order (#556): each code block
 * marked `<!-- doc-test: file <path> -->` is a file to write, each marked
 * `<!-- doc-test: merge <path> -->` is a JSON object whose keys are set in that
 * JSON file (see {@link applyFileStep}), and each marked `<!-- doc-test: run -->`
 * is a list of commands to run. Read by docs/balance-simulator.test.ts, which
 * runs the page, and by scripts/bench-sim/run.mjs, which times its final game.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

type FileStep = { kind: 'file' | 'merge'; path: string; body: string };
export type DocStep = FileStep | { kind: 'run'; lines: string[] };

const MARKED_BLOCK = /<!-- doc-test: (?:(file|merge) (\S+)|run) -->\n```\w*\n([\s\S]*?)```/g;

export function balanceSimulatorSteps(): DocStep[] {
  const doc = readFileSync(join(import.meta.dirname, 'balance-simulator.md'), 'utf-8');
  return [...doc.matchAll(MARKED_BLOCK)].map(([, kind, path, body]) =>
    path
      ? { kind: kind as FileStep['kind'], path, body }
      : { kind: 'run', lines: body.split('\n').filter((line) => line.trim() !== '') },
  );
}

/** Writes a `file` step into the project in `dir`, or sets a `merge` step's keys in its JSON file. */
export function applyFileStep(dir: string, step: FileStep): void {
  const file = join(dir, step.path);
  mkdirSync(dirname(file), { recursive: true });
  const body =
    step.kind === 'file'
      ? step.body
      : `${JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf-8')), ...JSON.parse(step.body) }, null, 2)}\n`;
  writeFileSync(file, body);
}
