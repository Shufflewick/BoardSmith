import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { spawnCli } from '../spawn-cli.test-helper.js';
import { checkConstraints, constraintCheckCommand, runVitest, type TestRunner } from './constraint-check.js';
import { INSTALLED_MODULES } from '../../testing/installed-modules.test-helper.js';

/**
 * #288: four sotf chunks closed with state that grew without limit against a 512 KiB partition
 * budget, and nothing in the pipeline checked the project's hard constraints. These tests pin the
 * code half of the fix: a growing structure with no cap and no designer ruling is refused, every
 * hard constraint is in the ledger, and a measured one names a test that runs.
 */

let tree: string;

beforeEach(() => {
  tree = tempTree('bs-constraint-check-');
  process.exitCode = undefined;
});

async function makeProject(files: Record<string, string>): Promise<string> {
  const project = join(tree, 'game');
  for (const [rel, text] of Object.entries(files)) {
    await fs.mkdir(dirname(join(project, rel)), { recursive: true });
    await fs.writeFile(join(project, rel), text);
  }
  return project;
}

const ledger = (constraints: string, structures = ''): string =>
  `# Constraints\n\n## Hard Constraints\n\n${constraints}\n## Growing Structures\n\n${structures}`;

const MAIL = [
  '### G1',
  '- State: Almanac.mail, in the world partition',
  '- Grows with: players and time',
  '- Chunk: clans',
].join('\n');

const passingRunner: TestRunner = async () => ({ ok: true, output: '' });

/** Exactly one refusal, matching every pattern. */
function expectOneRefusal(refusals: string[], ...patterns: RegExp[]): void {
  expect(refusals).toHaveLength(1);
  for (const pattern of patterns) expect(refusals[0]).toMatch(pattern);
}

async function refusalsFor(files: Record<string, string>, slug?: string): Promise<string[]> {
  const project = await makeProject(files);
  return (await checkConstraints(project, { slug })).refusals;
}

describe('the ledger must exist', () => {
  it('refuses a project with no design/CONSTRAINTS.md and names the template', async () => {
    const refusals = await refusalsFor({ 'design/SKETCH.md': '# Sketch\n' });
    expectOneRefusal(refusals, /design\/CONSTRAINTS\.md/, /CONSTRAINTS\.template\.md/);
  });

  it('passes an empty ledger for a project with no hard constraints and nothing growing', async () => {
    expect(await refusalsFor({ 'design/CONSTRAINTS.md': ledger('') })).toEqual([]);
  });
});

describe('a structure that grows needs a cap the code enforces, or a designer ruling', () => {
  it('refuses a growing structure with neither, naming both ways out', async () => {
    const refusals = await refusalsFor({ 'design/CONSTRAINTS.md': ledger('', MAIL) });
    expectOneRefusal(refusals, /G1/, /Almanac\.mail/, /no cap/i, /Cap:/, /Ruling/);
  });

  it('accepts a cap enforced in the named file and measured by a test that uses it', async () => {
    const refusals = await refusalsFor({
      'design/CONSTRAINTS.md': ledger(
        '',
        `${MAIL}\n- Cap: MAILBOX_CAP in src/rules/mail.ts\n- Measured by: tests/mail-budget.test.ts\n`,
      ),
      'src/rules/mail.ts': 'export const MAILBOX_CAP = 20;\nif (box.length >= MAILBOX_CAP) refuse();\n',
      'tests/mail-budget.test.ts': "import { MAILBOX_CAP } from '../src/rules/mail';\n",
    });
    expect(refusals).toEqual([]);
  });

  it('refuses a cap the named file does not contain', async () => {
    const refusals = await refusalsFor({
      'design/CONSTRAINTS.md': ledger(
        '',
        `${MAIL}\n- Cap: MAILBOX_CAP in src/rules/mail.ts\n- Measured by: tests/mail-budget.test.ts\n`,
      ),
      'src/rules/mail.ts': 'export const MAILBOX = 20;\n',
      'tests/mail-budget.test.ts': 'MAILBOX_CAP\n',
    });
    expect(refusals.join('\n')).toMatch(/MAILBOX_CAP.*src\/rules\/mail\.ts/);
  });

  it('refuses a cap with no measurement, and a measurement that never uses the cap', async () => {
    const noTest = await refusalsFor({
      'design/CONSTRAINTS.md': ledger('', `${MAIL}\n- Cap: MAILBOX_CAP in src/rules/mail.ts\n`),
      'src/rules/mail.ts': 'export const MAILBOX_CAP = 20;\n',
    });
    expect(noTest.join('\n')).toMatch(/Measured by/);

    // sotf#36: the budget was measured at an arbitrary count, not the cap the code enforces.
    const arbitrary = await refusalsFor({
      'design/CONSTRAINTS.md': ledger(
        '',
        `${MAIL}\n- Cap: MAILBOX_CAP in src/rules/mail.ts\n- Measured by: tests/mail-budget.test.ts\n`,
      ),
      'src/rules/mail.ts': 'export const MAILBOX_CAP = 20;\n',
      'tests/mail-budget.test.ts': 'for (let i = 0; i < 4; i++) push();\n',
    });
    expect(arbitrary.join('\n')).toMatch(/tests\/mail-budget\.test\.ts.*MAILBOX_CAP/);
  });

  it('accepts a designer ruling that exists in RULINGS.md, and refuses one that does not', async () => {
    const withRuling = `${MAIL}\n- Ruling: Ruling 7\n`;
    expect(
      await refusalsFor({
        'design/CONSTRAINTS.md': ledger('', withRuling),
        'design/RULINGS.md': '# Rulings\n\n## Ledger\n\n### Ruling 7\n- Decision: mail may grow.\n',
      }),
    ).toEqual([]);
    const missing = await refusalsFor({
      'design/CONSTRAINTS.md': ledger('', withRuling),
      'design/RULINGS.md': '# Rulings\n\n## Ledger\n',
    });
    expect(missing.join('\n')).toMatch(/Ruling 7/);
    expect(missing.join('\n')).toMatch(/RULINGS\.md/);
  });
});

const CLAUDE_MD = [
  '# My Game',
  '',
  '## Hard constraints',
  '',
  '- **A partition is refused past 512 KiB**, in UTF-8 bytes, at genesis and at every checkpoint.',
  '- **A command declares its partitions from arguments and seat alone**, before anything is',
  '  loaded.',
  '',
  '## Commands',
  '',
  '- npm test',
].join('\n');

const C1 = [
  '### C1',
  '- Quote: A partition is refused past 512 KiB',
  '- Source: CLAUDE.md',
  '- Kind: measured',
  '- Test: tests/world-budget.test.ts',
].join('\n');

const C2 = [
  '### C2',
  '- Quote: A command declares its partitions from arguments and seat alone, before anything is loaded.',
  '- Source: CLAUDE.md',
  '- Kind: reviewed',
].join('\n');

describe("every hard constraint in the project's CLAUDE.md is in the ledger", () => {
  it('accepts a ledger that quotes every hard-constraint bullet', async () => {
    const refusals = await refusalsFor({
      'CLAUDE.md': CLAUDE_MD,
      'tests/world-budget.test.ts': 'test\n',
      'design/CONSTRAINTS.md': ledger(`${C1}\n\n${C2}\n`),
    });
    expect(refusals).toEqual([]);
  });

  it('refuses a hard constraint no entry quotes, quoting it back', async () => {
    const refusals = await refusalsFor({
      'CLAUDE.md': CLAUDE_MD,
      'tests/world-budget.test.ts': 'test\n',
      'design/CONSTRAINTS.md': ledger(`${C1}\n`),
    });
    expectOneRefusal(refusals, /CLAUDE\.md/, /declares its partitions/);
  });

  it('refuses a quote its source does not contain', async () => {
    const refusals = await refusalsFor({
      'CLAUDE.md': CLAUDE_MD,
      'tests/world-budget.test.ts': 'test\n',
      'design/CONSTRAINTS.md': ledger(`${C1.replace('512 KiB', '1 MiB')}\n\n${C2}\n`),
    });
    expect(refusals.join('\n')).toMatch(/C1.*1 MiB/s);
  });

  it('refuses a measured constraint whose test does not exist', async () => {
    const refusals = await refusalsFor({
      'CLAUDE.md': CLAUDE_MD,
      'design/CONSTRAINTS.md': ledger(`${C1}\n\n${C2}\n`),
    });
    expect(refusals.join('\n')).toMatch(/C1.*tests\/world-budget\.test\.ts/s);
  });
});

const chunk = (review: string): string =>
  `# clans\n\nStatus: built\n\n## Constraints Review\n\n${review}\n\n## Findings Ledger\n`;

describe("a chunk's constraints review covers every constraint, and none is violated", () => {
  const base = {
    'CLAUDE.md': CLAUDE_MD,
    'tests/world-budget.test.ts': 'test\n',
    'design/CONSTRAINTS.md': ledger(`${C1}\n\n${C2}\n`),
  };

  it('accepts a review with a verdict and a citation for every constraint', async () => {
    const refusals = await refusalsFor(
      {
        ...base,
        'design/chunks/clans/CHUNK.md': chunk(
          '- C1: held. tests/world-budget.test.ts fills mail to MAILBOX_CAP at 500 seats.\n' +
            '- C2: not applicable. This chunk adds no command.',
        ),
      },
      'clans',
    );
    expect(refusals).toEqual([]);
  });

  it('refuses a missing verdict, a violated constraint, and a verdict with no citation', async () => {
    const refusals = await refusalsFor(
      {
        ...base,
        'design/chunks/clans/CHUNK.md': chunk('- C1: violated. src/rules/mail.ts:40 has no cap.'),
      },
      'clans',
    );
    const text = refusals.join('\n');
    expect(text).toMatch(/C1.*violated/);
    expect(text).toMatch(/C2/);

    const bare = await refusalsFor(
      { ...base, 'design/chunks/clans/CHUNK.md': chunk('- C1: held.\n- C2: held. src/x.ts') },
      'clans',
    );
    expect(bare.join('\n')).toMatch(/C1.*citation/i);
  });
});

describe('measured constraints run as code', () => {
  it('runs every measured test and every cap measurement, and refuses when they fail', async () => {
    const project = await makeProject({
      'CLAUDE.md': CLAUDE_MD,
      'tests/world-budget.test.ts': 'test\n',
      'tests/mail-budget.test.ts': 'MAILBOX_CAP\n',
      'src/rules/mail.ts': 'export const MAILBOX_CAP = 20;\n',
      'design/CONSTRAINTS.md': ledger(
        `${C1}\n\n${C2}\n`,
        `${MAIL}\n- Cap: MAILBOX_CAP in src/rules/mail.ts\n- Measured by: tests/mail-budget.test.ts\n`,
      ),
    });
    const asked: string[][] = [];
    const failing: TestRunner = async (_dir, files) => {
      asked.push([...files]);
      return { ok: false, output: 'mail partition is 600 KiB' };
    };
    const result = await checkConstraints(project, { runTests: failing });
    expect(asked).toEqual([['tests/world-budget.test.ts', 'tests/mail-budget.test.ts']]);
    expect(result.refusals.join('\n')).toMatch(/600 KiB/);

    expect((await checkConstraints(project, { runTests: passingRunner })).refusals).toEqual([]);
  });

  it('does not run tests when the ledger itself is refused', async () => {
    const project = await makeProject({ 'design/CONSTRAINTS.md': ledger('', MAIL) });
    let ran = false;
    await checkConstraints(project, {
      runTests: async () => {
        ran = true;
        return { ok: true, output: '' };
      },
    });
    expect(ran).toBe(false);
  });
});

describe('boardsmith constraint-check', () => {
  it('exits non-zero on an uncapped structure, and zero on a clean ledger', async () => {
    const bad = await makeProject({ 'design/CONSTRAINTS.md': ledger('', MAIL) });
    await constraintCheckCommand(undefined, { project: bad, json: true });
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;
    await fs.writeFile(join(bad, 'design/CONSTRAINTS.md'), ledger(''));
    await constraintCheckCommand(undefined, { project: bad, json: true });
    expect(process.exitCode).toBeUndefined();
  });
});

describe('constraint-check through the real CLI entry point', () => {
  vi.setConfig({ testTimeout: 60_000 });

  it('is registered and exits 1 on an uncapped structure', async () => {
    const project = await makeProject({ 'design/CONSTRAINTS.md': ledger('', MAIL) });
    const refused = await spawnCli(['constraint-check', '--project', project]);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toMatch(/G1 .* has no cap/);
  });
});

/**
 * #294: a chunk built on a parallel branch numbers its entries provisionally (`G@<slug>.<n>`,
 * `Ruling @<slug>.<n>`) until `boardsmith chunk-merge` allocates real numbers. The check must hold
 * those entries to the same rules on the branch, not skip them for having no number, and must
 * refuse one id used twice, which is what two branches taking "the next" number produce.
 */
describe('provisional ids on a parallel branch, and ids used twice', () => {
  const PROVISIONAL_MAIL = MAIL.replace('### G1', '### G@clans.1');

  it('checks a provisional growing structure like any other', async () => {
    const refusals = await refusalsFor({ 'design/CONSTRAINTS.md': ledger('', PROVISIONAL_MAIL) });
    expectOneRefusal(refusals, /G@clans\.1/, /no cap/i);
  });

  it('accepts a provisional ruling that the branch recorded', async () => {
    const refusals = await refusalsFor({
      'design/CONSTRAINTS.md': ledger('', `${PROVISIONAL_MAIL}\n- Ruling: Ruling @clans.1\n`),
      'design/RULINGS.md': '# Rulings\n\n### Ruling @clans.1\n- Decision: mail may grow; the designer accepts it.\n',
    });
    expect(refusals).toEqual([]);
  });

  it('refuses an id used by two entries', async () => {
    const refusals = await refusalsFor({
      'design/CONSTRAINTS.md': ledger('', `${MAIL}\n- Ruling: Ruling 1\n\n${MAIL}\n- Ruling: Ruling 1\n`),
      'design/RULINGS.md': '# Rulings\n\n### Ruling 1\n- Decision: mail may grow.\n',
    });
    expectOneRefusal(refusals, /G1 is used by 2 entries/);
  });
});

/**
 * #294: chunks built at the same time live in worktrees under `.boardsmith/worktrees/<slug>`,
 * inside the project. Vitest's default discovery walks into dot-directories, so without an
 * exclusion a run in the main checkout would also run every in-progress chunk's tests.
 */
describe('runVitest leaves chunk worktrees out of the run', () => {
  it('passes a project whose only failing test is inside .boardsmith/worktrees', async () => {
    const project = await makeProject({
      'vitest.config.mjs': 'export default { test: {} };\n',
      'tests/ok.test.ts': "import { it } from 'vitest';\nit('holds', () => {});\n",
      '.boardsmith/worktrees/quests/tests/wip.test.ts':
        "import { it, expect } from 'vitest';\nit('is still being built', () => { expect(1).toBe(2); });\n",
    });
    await fs.symlink(INSTALLED_MODULES, join(project, 'node_modules'), 'dir');
    const run = await runVitest(project, []);
    expect(run.output).toContain('ok.test.ts');
    expect(run.output).not.toContain('wip.test.ts');
    expect(run.ok).toBe(true);
  }, 60_000);
});
