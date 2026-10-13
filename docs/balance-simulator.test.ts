/**
 * docs/balance-simulator.md is run, not just read (#556).
 *
 * The page grows one game through four stages. Every code block it marks with
 * `<!-- doc-test: file <path> -->` is written, in page order, into a project
 * `boardsmith init --sim` scaffolded, and every block marked
 * `<!-- doc-test: run -->` is run there at that point: `rm`, `boardsmith
 * simulate` (with a small `--games`, a fixed `--seed`, one worker and `--json`)
 * and `boardsmith add-ui`, after which the project must type-check and pass its
 * own tests. So a code block that stops compiling, a metric that stops being
 * reported, or a stage that stops finishing fails here.
 *
 * Everything runs while the file is collected, where no test timeout applies
 * (#363): each simulate bundles the rules.
 */
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { smokeProject } from '../src/cli/commands/smoke-project.test-helper.js';
import { spawnCli } from '../src/cli/spawn-cli.test-helper.js';
import { writeFiles } from '../src/cli/lib/verify-result.test-helper.js';
import { balanceSimulatorSteps } from './balance-simulator-steps.js';

const DOC = readFileSync(join(import.meta.dirname, 'balance-simulator.md'), 'utf-8');
const steps = balanceSimulatorSteps();

interface SimulateRun {
  command: string;
  code: number | null;
  stderr: string;
  // The `--json` output: a report per player count, or one per variant with `--compare`.
  json: { games?: unknown[]; report?: Report[] | null; variants?: { games: unknown[]; report: Report[] | null }[] };
}
interface Report {
  players: number;
  scores: Record<string, unknown>;
  elements: Record<string, Record<string, number | null>>;
}

const project = await smokeProject(false, {}, { sim: true });
const simulates: SimulateRun[] = [];
let addUi: Awaited<ReturnType<typeof spawnCli>> | undefined;
let typecheck: Awaited<ReturnType<typeof spawnCli>> | undefined;
let projectTests: Awaited<ReturnType<typeof spawnCli>> | undefined;

for (const step of steps) {
  if (step.kind === 'file') {
    await writeFiles(project, { [step.path]: step.body });
    continue;
  }
  for (const line of step.lines) {
    const [command, ...args] = line.trim().split(/\s+/);
    if (command === 'rm' && args.length === 1) {
      rmSync(join(project, args[0]));
    } else if (command === 'boardsmith' && args[0] === 'simulate') {
      const games = args.indexOf('--games');
      if (games !== -1) args.splice(games, 2);
      const ran = await spawnCli([...args, '--games', '30', '--seed', 'doc', '--jobs', '1', '--json'], project);
      simulates.push({ command: line, code: ran.code, stderr: ran.stderr, json: ran.code === 0 ? JSON.parse(ran.stdout) : {} });
    } else if (command === 'boardsmith' && args.join(' ') === 'add-ui') {
      addUi = await spawnCli(['add-ui'], project);
      // The a11y example runs axe-core, which this checkout does not install (see smokeProject).
      rmSync(join(project, 'tests/a11y.example.test.ts'), { force: true });
      typecheck = await spawnCli(['typecheck'], project);
      projectTests = await spawnCli(['test'], project);
    } else {
      throw new Error(`docs/balance-simulator.md runs "${line}", which this test does not know how to run.`);
    }
  }
}

/** Every report a run printed: one per player count, per variant. */
const reportsOf = (run: SimulateRun): Report[] =>
  run.json.variants ? run.json.variants.flatMap((variant) => variant.report ?? []) : (run.json.report ?? []);

const ELEMENT_METRICS = ['offered', 'picked', 'pickRate'];

describe('docs/balance-simulator.md, run block by block (#556)', () => {
  it('starts from boardsmith init --sim, which the project here was scaffolded with', () => {
    expect(DOC).toMatch(/npx boardsmith init bazaar --sim/);
  });

  it('runs every stage: five simulations, then add-ui', () => {
    expect(simulates.map((run) => run.command)).toHaveLength(5);
    expect(addUi).toBeDefined();
  });

  it.each([0, 1, 2, 3, 4])('finishes every game of simulation %i and reports the metrics declared at that stage', (at) => {
    const run = simulates[at];
    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    const unfinished = run.json.variants ? run.json.variants.flatMap((variant) => variant.games) : run.json.games;
    expect(unfinished).toEqual([]);
    const reports = reportsOf(run);
    expect(reports.length).toBeGreaterThan(0);
    const expected = at === 4 ? [...ELEMENT_METRICS, 'caravanBrought'] : ELEMENT_METRICS;
    for (const report of reports) {
      expect(Object.keys(report.scores)).toEqual(['score']);
      expect(Object.keys(report.elements.Vanilla)).toEqual(expected);
    }
  });

  it('compares two variants in each --compare run', () => {
    expect(simulates[1].json.variants).toHaveLength(2);
    expect(simulates[2].json.variants).toHaveLength(2);
  });

  it('makes the Merchant kept more often once it scores, as the page says', () => {
    const merchantRate = (run: SimulateRun) =>
      reportsOf(run).find((report) => report.players === 4)?.elements.Merchant.pickRate ?? 0;
    expect(merchantRate(simulates[3])).toBeGreaterThan(merchantRate(simulates[0]) + 0.1);
  });

  it('becomes a playable game with add-ui, unchanged rules type-checking and passing their tests', () => {
    expect(addUi?.stderr).toBe('');
    expect(addUi?.code).toBe(0);
    expect(typecheck?.stdout + '' + typecheck?.stderr).not.toMatch(/error TS/);
    expect(typecheck?.code).toBe(0);
    expect(projectTests?.code).toBe(0);
  });
});
