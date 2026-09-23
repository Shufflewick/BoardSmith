import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { checkTestStep, parseSpecManifest, testStepCheckCommand } from './test-step-check.js';
import {
  findDefinedVerbs,
  findDispatchWrappers,
  findDispatchedVerbs,
  findTestBlocks,
  findUnreachableGuards,
  findVerbWrappers,
} from './test-step-ast.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { INSTALLED_MODULES } from '../../testing/installed-modules.test-helper.js';

// -------------------------------------------------------------------------------------------
// parseSpecManifest
// -------------------------------------------------------------------------------------------

const chunkMd = (manifestRows: string, claims = '1. **One.** a\n2. **Two.** b\n') => `# Chunk

## Interpretation

${claims}
## Spec Manifest
<!-- | src/...test.ts | 1, 3, 4 | pending / yes | -->

| Test File | Claims Covered | RED Observed |
|-----------|----------------|--------------|
${manifestRows}
## Build Manifest

| File | Status |
|------|--------|
`;

describe('parseSpecManifest', () => {
  it('reads each row as a test file, its claim numbers and its RED observation', () => {
    const manifest = parseSpecManifest(
      chunkMd('| `tests/auction.test.ts` | 1, 2 | yes |\n| tests/other.test.ts | 3 | pending |\n'),
    );
    expect(manifest.rows).toEqual([
      { testFile: 'tests/auction.test.ts', claims: [1, 2], redObserved: 'yes' },
      { testFile: 'tests/other.test.ts', claims: [3], redObserved: 'pending' },
    ]);
    expect(manifest.exemption).toBeUndefined();
  });

  it('reads an exemption row as the exemption and its reason, not as a test file', () => {
    const manifest = parseSpecManifest(chunkMd('| exempt | asset swap only, no rules change | n/a |\n'));
    expect(manifest.rows).toEqual([]);
    expect(manifest.exemption).toBe('asset swap only, no rules change');
  });

  it('ignores table-shaped lines inside an HTML comment, such as the template\'s own example', () => {
    const manifest = parseSpecManifest(
      chunkMd('<!-- written as\n     | exempt | <reason> | n/a |\n-->\n| tests/a.test.ts | 1 | yes |\n'),
    );
    expect(manifest.exemption).toBeUndefined();
    expect(manifest.rows.map((r) => r.testFile)).toEqual(['tests/a.test.ts']);
  });

  it('reads only standalone claim numbers, never digits inside words or a parenthetical note', () => {
    const manifest = parseSpecManifest(
      chunkMd(
        '| tests/a.test.ts | 21 (12 superseded by 21), 13 | yes |\n' +
          '| tests/b.test.ts | `ui:` major — the a11y floor | yes |\n' +
          '| tests/c.test.ts | SKILLAUTO-08 drive, claims 4 and 5 | yes |\n',
      ),
    );
    expect(manifest.rows.map((r) => r.claims)).toEqual([[21, 13], [], [4, 5]]);
  });

  it('expands a range, drops ruling links, and reads "16→32/33" as covered by 32 and 33', () => {
    const manifest = parseSpecManifest(
      chunkMd(
        '| tests/a.test.ts | 1-3, 7–8 (5 superseded) | yes |\n' +
          '| tests/b.test.ts | 14, 16→32/33, 77(a); [[Ruling 92]] | yes |\n',
      ),
    );
    expect(manifest.rows.map((r) => r.claims)).toEqual([[1, 2, 3, 7, 8], [14, 32, 33, 77]]);
  });

  it('refuses a CHUNK.md with no Spec Manifest section, naming the section to add', () => {
    expect(() => parseSpecManifest('# Chunk\n\n## Interpretation\n')).toThrow(/## Spec Manifest/);
  });
});

// -------------------------------------------------------------------------------------------
// findTestBlocks
// -------------------------------------------------------------------------------------------

describe('findTestBlocks', () => {
  it('takes claim citations from the title, the comment directly above, and enclosing describes', () => {
    const blocks = findTestBlocks(`import { it, describe, expect } from 'vitest';
describe('claim 4 — auction', () => {
  // Claim 2: a bid must beat the high bid.
  it('rejects a low bid', () => {
    expect(1).toBe(1);
  });

  it('claim 3 — closes the auction', () => {});
});
`);
    expect(blocks.map((b) => ({ title: b.title, claims: b.claims, line: b.line }))).toEqual([
      { title: 'rejects a low bid', claims: [2, 4], line: 4 },
      { title: 'claim 3 — closes the auction', claims: [3, 4], line: 8 },
    ]);
    expect(blocks.every((b) => !b.skipped)).toBe(true);
  });

  it('marks skipped, todo and conditional tests as skipped so they never count as coverage', () => {
    const blocks = findTestBlocks(`
it.skip('claim 1 a', () => {});
it.todo('claim 2 b');
xit('claim 3 c', () => {});
describe.skip('outer', () => { it('claim 4 d', () => {}); });
it.skipIf(true)('claim 5 e', () => {});
it.each([1, 2])('claim 6 f %s', () => {});
`);
    expect(blocks.map((b) => [b.claims[0], b.skipped])).toEqual([
      [1, true],
      [2, true],
      [3, true],
      [4, true],
      [5, true],
      [6, false],
    ]);
  });

  it('does not take a comment separated from the test by code', () => {
    const blocks = findTestBlocks(`// Claim 9: unrelated
const x = 1;
it('plain', () => {});
`);
    expect(blocks[0].claims).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------
// verbs
// -------------------------------------------------------------------------------------------

describe('findDefinedVerbs', () => {
  it('finds every Action.create name, with or without a type argument', () => {
    expect(
      findDefinedVerbs(`
export const bid = (g) => Action.create<MyGame>('bid').execute(() => {});
export const pass = Action.create("pass");
const other = Something.create('notAVerb');
`),
    ).toEqual(['bid', 'pass']);
  });
});

describe('findDefinedVerbs through worlds and wrappers', () => {
  it('finds a world verb, and a verb named through a project wrapper that passes its parameter on', () => {
    const rules = `
function standingVerb(name: string, prompt: string) {
  return worldAction<G>(name).prompt(prompt);
}
const counter = (verbName: string) => standingVerb(verbName, 'x');
const look = worldAction<G>('look');
const bid = counterRounds(standingVerb('bidOnItem', 'Bid'));
const list = counter('auctionOffItem');
const notAVerb = standingVerb;
`;
    const wrappers = findVerbWrappers([{ path: 'src/rules/world.ts', text: rules }]);
    expect([...wrappers.entries()]).toEqual([['standingVerb', 0], ['counter', 0]]);
    expect(findDefinedVerbs(rules, 'world.ts', wrappers)).toEqual(['look', 'bidOnItem', 'auctionOffItem']);
  });
});

describe('findVerbWrappers on a file that names no verb', () => {
  it('never parses it, so a data file nested too deeply for the parser does not stop the check', () => {
    const data = `export const NAMES = "a"${' + "b"'.repeat(20_000)};\n`;
    expect(findVerbWrappers([{ path: 'src/rules/names.ts', text: data }])).toEqual(new Map());
  });
});

describe('findDispatchedVerbs through a project harness', () => {
  it('counts a harness method that hands its parameter to the world engine as the command name', () => {
    const harness = `
export function launch() {
  return {
    async run(command: string, seat: number, args = {}) {
      return engine.applyCommand(playerOf(seat), { name: command, args }, {});
    },
    async offers(seat: number) { return engine.offersFor(seat); },
  };
}
`;
    const wrappers = findDispatchWrappers([{ path: 'tests/support/world.ts', text: harness }]);
    expect([...wrappers.entries()]).toEqual([['run', 0]]);
    expect(
      findDispatchedVerbs(
        "await world.run('bidOnItem', 2, {});\nawait world.offers(2);\nlistAuction(almanac, seller);\n",
        'tests/a.test.ts',
        wrappers,
      ),
    ).toEqual(['bidOnItem']);
  });
});

describe('findDispatchedVerbs', () => {
  it('counts every engine entry point, with the verb as a literal', () => {
    expect(
      findDispatchedVerbs(`
testGame.doAction(1, 'a');
testGame.tryAction(1, 'b', {});
simulateAction(testGame, 1, 'c');
simulateActions(testGame, [[1, 'd'], [2, 'e', {}]]);
assertActionSucceeds(testGame, 1, 'f');
runner.performAction('g', 1, {});
await world.take(1, 'h');
testGame.action('i', 1).select('x', 2).execute();
`),
    ).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
  });

  it('does not count a direct function call, a builder never executed, a failure-only dispatch, or a skipped test', () => {
    expect(
      findDispatchedVerbs(`
resolveBid(game, 3);
testGame.action('built', 1).select('x', 2);
assertActionFails(testGame, 1, 'failing');
it.skip('x', () => { testGame.doAction(1, 'skipped'); });
`),
    ).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------
// findUnreachableGuards
// -------------------------------------------------------------------------------------------

describe('findUnreachableGuards', () => {
  const source = `export function f(x: number) {
  if (x < 0) {
    // unreachable: callers validate first
    throw new Error('should never happen');
  }
  throw new Error(\`Bid of \${x} is below the high bid. Bid more or pass.\`);
}
`;

  it('finds comments and error messages on added lines that call a guard unreachable', () => {
    expect(findUnreachableGuards(source, new Set([1, 2, 3, 4, 5, 6])).map((g) => g.line)).toEqual([3, 4]);
  });

  it('ignores lines this chunk did not add', () => {
    expect(findUnreachableGuards(source, new Set([6]))).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------
// checkTestStep — a real git project
// -------------------------------------------------------------------------------------------

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

async function write(project: string, files: Record<string, string>): Promise<void> {
  for (const [rel, text] of Object.entries(files)) {
    await fs.mkdir(dirname(join(project, rel)), { recursive: true });
    await fs.writeFile(join(project, rel), text);
  }
}

const AUCTION_CHUNK = (rows: string) =>
  chunkMd(rows, '1. **Bid.** a bid must beat the high bid\n2. **Pass.** a player may pass\n');

describe('checkTestStep (static checks)', () => {
  let project: string;

  beforeEach(async () => {
    const tree = tempTree('bs-test-step-');
    project = join(tree, 'project');
    await fs.mkdir(project, { recursive: true });
    git(project, 'init', '-q');
    git(project, 'config', 'user.email', 't@example.com');
    git(project, 'config', 'user.name', 'T');
    await write(project, {
      'src/rules/game.ts': "export const start = Action.create('start');\n",
    });
    git(project, 'add', '-A');
    git(project, 'commit', '-q', '-m', 'chunk-setup/step-close');
    await write(project, { 'design/chunks/auction/CHUNK.md': AUCTION_CHUNK('') });
    git(project, 'add', '-A');
    git(project, 'commit', '-q', '-m', 'chunk-auction/step-ask');
  });

  async function build(files: Record<string, string>, rows: string): Promise<void> {
    await write(project, { ...files, 'design/chunks/auction/CHUNK.md': AUCTION_CHUNK(rows) });
    git(project, 'add', '-A');
    git(project, 'commit', '-q', '-m', 'chunk-auction/step-build');
  }

  const RULES = `export const bid = Action.create('bid');
export const pass = Action.create('pass');
`;

  it('passes a chunk whose manifest names real claim tests and whose verbs go through the engine', async () => {
    await build(
      {
        'src/rules/auction.ts': RULES,
        'tests/auction.test.ts': `import { it, expect } from 'vitest';
it('claim 1 — a low bid is refused', () => { testGame.doAction(1, 'bid', { amount: 1 }); expect(1).toBe(1); });
// Claim 2: a player may pass.
it('passes', () => { testGame.doAction(1, 'pass'); });
`,
      },
      // A note after "yes" is common in real manifests and still records the observation.
      '| tests/auction.test.ts | 1, 2 | yes (3 red) |\n',
    );
    const result = await checkTestStep(project, 'auction');
    expect(result.findings).toEqual([]);
    expect(result.verbs).toEqual(['bid', 'pass']);
  });

  it('reports a verb the chunk added that no test dispatches through the engine', async () => {
    await build(
      {
        'src/rules/auction.ts': RULES,
        'tests/auction.test.ts': `import { it } from 'vitest';
it('claim 1 — a low bid is refused', () => { testGame.doAction(1, 'bid'); });
it('claim 2 — pass', () => { passTurn(game); });
`,
      },
      '| tests/auction.test.ts | 1, 2 | yes |\n',
    );
    const result = await checkTestStep(project, 'auction');
    expect(result.findings.map((f) => [f.kind, f.subject])).toEqual([['verb-not-dispatched', 'pass']]);
    expect(result.findings[0].detail).toMatch(/doAction/);
  });

  it('follows a world game\'s verb wrapper and its test harness, and still catches the verb it never runs (sotf#36)', async () => {
    await write(project, {
      'src/rules/verbs.ts': `export function standingVerb(name: string) {
  return worldAction(name);
}
`,
    });
    git(project, 'add', '-A');
    git(project, 'commit', '-q', '--amend', '--no-edit');
    await build(
      {
        'src/rules/auction.ts': `import { standingVerb } from './verbs';
export const list = standingVerb('auctionOffItem');
export const bid = standingVerb('bidOnItem');
`,
        'tests/support/world.ts': `export function launch() {
  return {
    async run(command: string, seat: number, args = {}) {
      return engine.applyCommand(seat, { name: command, args }, {});
    },
  };
}
`,
        'tests/auction.test.ts': `import { it } from 'vitest';
it('claim 1 and 2', async () => {
  await world.run('auctionOffItem', 1, {});
  bidAuction(almanac, reader, 5);
});
`,
      },
      '| tests/auction.test.ts | 1, 2 | yes |\n',
    );
    const result = await checkTestStep(project, 'auction');
    expect(result.verbs).toEqual(['auctionOffItem', 'bidOnItem']);
    expect(result.findings.map((f) => [f.kind, f.subject])).toEqual([['verb-not-dispatched', 'bidOnItem']]);
  });

  it('never attributes a verb another chunk committed while this one was under way', async () => {
    await build(
      {
        'src/rules/auction.ts': RULES,
        'tests/auction.test.ts': `import { it } from 'vitest';
it('claim 1 and 2', () => { testGame.doAction(1, 'bid'); testGame.doAction(1, 'pass'); });
`,
      },
      '| tests/auction.test.ts | 1, 2 | yes |\n',
    );
    await write(project, {
      'src/rules/auction.ts': `${RULES}export const talk = Action.create('talkToBartender');\n`,
    });
    git(project, 'add', '-A');
    git(project, 'commit', '-q', '-m', 'chunk-bar/step-build');
    const result = await checkTestStep(project, 'auction');
    expect(result.verbs).toEqual(['bid', 'pass']);
    expect(result.findings).toEqual([]);
  });

  it('never demands a dispatch for a verb an earlier chunk added', async () => {
    await build(
      {
        'src/rules/auction.ts': RULES,
        'tests/auction.test.ts': `import { it } from 'vitest';
it('claim 1 and 2', () => { testGame.doAction(1, 'bid'); testGame.doAction(1, 'pass'); });
`,
      },
      '| tests/auction.test.ts | 1, 2 | yes |\n',
    );
    expect((await checkTestStep(project, 'auction')).verbs).not.toContain('start');
  });

  it('reports a manifest claim with no test, a missing file, an uncovered claim and an unobserved RED', async () => {
    await build(
      {
        'src/rules/auction.ts': 'export const x = 1;\n',
        'tests/auction.test.ts': `import { it } from 'vitest';
it('claim 1 — only in a skipped test', () => {});
it.skip('claim 2', () => {});
`,
      },
      '| tests/auction.test.ts | 2 | pending |\n| tests/gone.test.ts | 7 | yes |\n',
    );
    const kinds = (await checkTestStep(project, 'auction')).findings.map((f) => `${f.kind} ${f.subject}`);
    expect(kinds).toEqual([
      'red-not-observed tests/auction.test.ts',
      'claim-test-missing claim 2 in tests/auction.test.ts',
      'test-file-missing tests/gone.test.ts',
      'claim-not-live claim 7 in tests/gone.test.ts',
      'claim-uncovered claim 1',
    ]);
  });

  it('never demands a test for a claim a later claim supersedes', async () => {
    await write(project, {
      'design/chunks/auction/CHUNK.md': chunkMd(
        '| tests/auction.test.ts | 2 | yes |\n',
        '1. a bid must beat the high bid\n2. Supersedes claim 1 per redteam objection: a bid must beat it by 10\n',
      ),
      'tests/auction.test.ts': "import { it } from 'vitest';\nit('claim 2', () => {});\n",
    });
    expect((await checkTestStep(project, 'auction')).findings).toEqual([]);
  });

  it('reports an exemption row on a chunk that has claims, and an empty manifest', async () => {
    await build({}, '| exempt | restyle | n/a |\n');
    expect((await checkTestStep(project, 'auction')).findings.map((f) => f.kind)).toEqual([
      'exemption-with-claims',
    ]);
    await build({}, '');
    expect((await checkTestStep(project, 'auction')).findings.map((f) => f.kind)).toEqual([
      'spec-manifest-empty',
    ]);
  });

  it('reports an "unreachable" guard the chunk added, with a readable next step', async () => {
    await build(
      {
        'src/rules/auction.ts': `${RULES}export function f(x: number) {
  if (x < 0) throw new Error('unreachable');
}
`,
        'tests/auction.test.ts': `import { it } from 'vitest';
it('claim 1 and 2', () => { testGame.doAction(1, 'bid'); testGame.doAction(1, 'pass'); });
`,
      },
      '| tests/auction.test.ts | 1, 2 | yes |\n',
    );
    const findings = (await checkTestStep(project, 'auction')).findings;
    expect(findings.map((f) => [f.kind, f.subject])).toEqual([['unreachable-guard', 'src/rules/auction.ts:4']]);
    expect(findings[0].detail).toMatch(/test that reaches it|what to do/);
  });

  it('counts uncommitted and untracked implementation as the chunk\'s own', async () => {
    await write(project, {
      'src/rules/auction.ts': RULES,
      'tests/auction.test.ts': `import { it } from 'vitest';
it('claim 1 and 2', () => { testGame.doAction(1, 'bid'); });
`,
      'design/chunks/auction/CHUNK.md': AUCTION_CHUNK('| tests/auction.test.ts | 1, 2 | yes |\n'),
    });
    const result = await checkTestStep(project, 'auction');
    expect(result.findings.map((f) => [f.kind, f.subject])).toEqual([['verb-not-dispatched', 'pass']]);
  });

  it('refuses a chunk with no step commit, saying how to commit one', async () => {
    await write(project, { 'design/chunks/other/CHUNK.md': AUCTION_CHUNK('') });
    await expect(checkTestStep(project, 'other')).rejects.toThrow(/chunk-other\/step-/);
  });
});

// -------------------------------------------------------------------------------------------
// testStepCheckCommand — static checks, then mutation, one exit code
// -------------------------------------------------------------------------------------------

describe('testStepCheckCommand', () => {
  let project: string;

  beforeEach(async () => {
    const tree = tempTree('bs-test-step-cmd-');
    project = join(tree, 'project');
    await write(project, {
      'vitest.config.ts': `import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts'] } });
`,
      'src/rules/engine.ts': 'export const Action = { create: (name: string) => ({ name }) };\n',
      '.gitignore': 'node_modules\n.boardsmith\n',
    });
    await fs.symlink(INSTALLED_MODULES, join(project, 'node_modules'), 'dir');
    git(project, 'init', '-q');
    git(project, 'config', 'user.email', 't@example.com');
    git(project, 'config', 'user.name', 'T');
    git(project, 'add', '-A');
    git(project, 'commit', '-q', '-m', 'project start');
    await write(project, {
      'src/rules/auction.ts': `import { Action } from './engine';
export const bid = Action.create('bid');
export function resolveBid(high: number, offer: number): boolean {
  return offer > high;
}
`,
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  async function commitTests(tests: string): Promise<void> {
    await write(project, {
      'tests/auction.test.ts': `import { it, expect } from 'vitest';
import { resolveBid } from '../src/rules/auction';
const testGame = {
  doAction: (_seat: number, _verb: string, args: { high: number; offer: number }) => resolveBid(args.high, args.offer),
};
${tests}`,
      'design/chunks/auction/CHUNK.md': AUCTION_CHUNK('| tests/auction.test.ts | 1, 2 | yes |\n'),
    });
    git(project, 'add', '-A');
    git(project, 'commit', '-q', '-m', 'chunk-auction/step-build');
  }

  it('passes, exit code untouched, when every test can fail and every verb runs through the engine', async () => {
    await commitTests(`it('claim 1 — a higher offer wins', () => { expect(testGame.doAction(1, 'bid', { high: 3, offer: 4 })).toBe(true); });
it('claim 2 — an equal offer loses', () => { expect(testGame.doAction(1, 'bid', { high: 3, offer: 3 })).toBe(false); });
`);
    const result = await testStepCheckCommand('auction', { project, json: true });
    expect(result.findings).toEqual([]);
    expect(result.mutation?.killed).toBeGreaterThan(0);
    expect(process.exitCode).toBeUndefined();
  }, 60_000);

  it('fails the step on a test no break of the code can make fail', async () => {
    await commitTests(`it('claim 1 — a higher offer wins', () => { expect(testGame.doAction(1, 'bid', { high: 3, offer: 4 })).toBe(true); });
it('claim 2 — tautology', () => { const high = 3; expect(high).toBe(3); });
`);
    const result = await testStepCheckCommand('auction', { project, json: true });
    expect(result.findings.map((f) => f.kind)).toEqual(['claim-survives-mutation', 'test-survives-mutation']);
    expect(process.exitCode).toBe(1);
  }, 60_000);

  it('fails the step on a static finding without running any mutant', async () => {
    await commitTests(`it('claim 1 and claim 2', () => { expect(resolveBid(3, 4)).toBe(true); });
`);
    const result = await testStepCheckCommand('auction', { project, json: true });
    expect(result.findings.map((f) => [f.kind, f.subject])).toEqual([['verb-not-dispatched', 'bid']]);
    expect(result.mutation).toBeUndefined();
    expect(process.exitCode).toBe(1);
  });
});
