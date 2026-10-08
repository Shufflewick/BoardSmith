/**
 * The complexity ceiling `.fallowrc.json` advertises must be the ceiling the
 * gate actually enforces (#277).
 *
 * ## What was wrong
 *
 * `boardsmith audit` runs `fallow audit`, and `fallow audit` is handed no
 * Istanbul data. `.fallowrc.json` had no `health` block at all, so it took
 * fallow's defaults — `maxCyclomatic: 20`, `maxCrap: 30` — and fallow filled the
 * coverage term of `CRAP = CC^2 * (1 - cov/100)^3 + CC` from the MODULE GRAPH
 * rather than from any test run: 85% for an export a test file names by hand,
 * 40% for anything reachable only through such an export, 0% for anything no
 * test root reaches. Measured over this repository, implied coverage landed on
 * exactly those three values and nowhere else.
 *
 * So `maxCrap` was a cyclomatic rule wearing a coverage rule's name, and it was
 * three rules at once: a ceiling of 29 at the 85% tier, of 9 at the 40% tier
 * (212 of the 225 scored functions here), and of 4 at the 0% tier — while the
 * config said 20. Worse, all 225 arrived carrying fallow's `add-tests` action,
 * which for the bottom two tiers cannot be acted on: no test moves an estimate
 * that was never measured from a test. A gate whose advice cannot be followed
 * is a gate people learn to route around.
 *
 * ## Why the fix is the config and not a coverage report
 *
 * Measured, not assumed: `fallow audit` 2.48.0 has no `--coverage` flag, there
 * is no `health.coverage` key in `fallow config-schema`, and it ignores
 * `FALLOW_COVERAGE` — pointed at a real Istanbul report it returns identical
 * CRAP scores. Only `fallow health` reads coverage, and health has no dead-code
 * or duplication verdict, so it cannot be what the gate runs. A partial report
 * is worse than none: an unmatched function scores 0%.
 *
 * So `maxCrap` is parked out of reach — fallow's only way to switch CRAP off —
 * and `maxCyclomatic` carries the rule at the number the estimate was already
 * enforcing on the tier this codebase is mostly made of.
 *
 * ## What this file holds
 *
 * That the number in `.fallowrc.json` is the number fallow acts on, proven by
 * running fallow rather than by re-deriving the formula here — a formula this
 * file owned a copy of would agree with itself forever while fallow changed
 * underneath it. The fixtures are generated FROM the config, so moving the
 * threshold re-aims the test instead of stranding it.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempTree } from '../src/testing/temp-tree.test-helper.ts';
import { toolCommand } from '../src/cli/lib/run-tool.ts';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The `health` block `boardsmith audit` grades against. */
const HEALTH = JSON.parse(readFileSync(path.join(PROJECT_ROOT, '.fallowrc.json'), 'utf8')).health;

/**
 * A function whose cyclomatic complexity is exactly `cc` and whose COGNITIVE
 * complexity is 1 whatever `cc` is.
 *
 * A chain of `||` over one operator is a single cognitive step by SonarSource's
 * rule while each operand is its own decision point for McCabe. That is what
 * lets this file move one metric without dragging the other over `maxCognitive`
 * and failing an assertion for a reason it is not about.
 */
function functionOfComplexity(name, cc) {
  const operands = Array.from({ length: cc }, (_, i) => `n === ${i}`).join(' || ');
  return `export function ${name}(n: number): boolean {\n  return ${operands};\n}\n`;
}

/**
 * `fallow health` over a throwaway project carrying this repo's health block.
 *
 * The project has one source file, no test file and no `node_modules`, so every
 * function in it sits in the coverage estimator's WORST tier — the 0% one,
 * where the old CRAP rule bottomed out at cyclomatic 4. Anything silent here is
 * silent everywhere.
 */
function healthFindings(source) {
  const dir = tempTree('fallow-gate-honesty-');
  writeFileSync(
    path.join(dir, '.fallowrc.json'),
    JSON.stringify({ entry: ['src/main.ts'], health: HEALTH }),
  );
  mkdirSync(path.join(dir, 'src'));
  writeFileSync(path.join(dir, 'src', 'main.ts'), source);

  const { command, commandArgs } = toolCommand('fallow', ['health', '--complexity', '--format', 'json'], dir);
  const run = spawnSync(command, commandArgs, {
    cwd: dir,
    encoding: 'utf8',
  });
  const start = run.error ? -1 : run.stdout.indexOf('{');
  if (start === -1) {
    throw new Error(
      `fallow did not report: ${run.error?.message || run.stderr || run.stdout}\n`
        + '`boardsmith audit` runs this same binary. Install it with `npm install`.',
    );
  }
  return JSON.parse(run.stdout.slice(start)).findings;
}

describe('the audit gate enforces the complexity ceiling it advertises (#277)', () => {
  it('states its thresholds in .fallowrc.json instead of inheriting fallow defaults', () => {
    expect(HEALTH, '.fallowrc.json has no `health` block, so the gate runs on fallow defaults').toBeDefined();
    expect(typeof HEALTH.maxCyclomatic).toBe('number');
  });

  it(`is silent on a function at cyclomatic ${HEALTH?.maxCyclomatic}`, () => {
    expect(healthFindings(functionOfComplexity('atCeiling', HEALTH.maxCyclomatic))).toEqual([]);
  });

  it(`reports a function at cyclomatic ${HEALTH?.maxCyclomatic + 1}, and the advice is to split it`, () => {
    const ceiling = HEALTH.maxCyclomatic;
    const findings = healthFindings(functionOfComplexity('overCeiling', ceiling + 1));

    expect(findings).toHaveLength(1);
    expect(findings[0].name).toBe('overCeiling');
    expect(findings[0].cyclomatic).toBe(ceiling + 1);
    expect(findings[0].exceeded).toBe('cyclomatic');

    // The finding must not carry the one action nobody here can take. `add-tests`
    // is fallow's CRAP remedy, and CRAP here is estimated from the module graph,
    // so writing a test cannot move it.
    expect(findings[0].actions.map((action) => action.type)).not.toContain('add-tests');
    expect(findings[0]).not.toHaveProperty('crap');
  });
});
