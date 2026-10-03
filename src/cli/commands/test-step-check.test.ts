import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  checkTestStep,
  parseSpecManifest,
  testStepCheckCommand,
  type TestStepCheckResult,
} from './test-step-check.js';
import {
  findDefinedVerbs,
  findDispatchWrappers,
  findDispatchedVerbs,
  findTestBlocks,
  findUnreachableGuards,
  findVerbWrappers,
  parseSource,
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
      { testFile: 'tests/auction.test.ts', claims: [1, 2], redObserved: 'yes', regression: false },
      { testFile: 'tests/other.test.ts', claims: [3], redObserved: 'pending', regression: false },
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

describe('parseSource on a file that does not parse', () => {
  // #303: plain `tsc` cannot type a `.vue` import, so pointing a game author at it buries the
  // real syntax error under a TS2307 for every single-file component.
  it('sends the author to vue-tsc, the checker a game installs, never plain tsc', () => {
    expect(() => parseSource('export const = ;', 'src/rules/game.ts')).toThrow(
      /Fix the syntax error \(run `npx vue-tsc --noEmit`\)/,
    );
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

  /** A test file that dispatches both verbs through the engine, so only the check under test reports. */
  const DISPATCHES_BOTH = `import { it } from 'vitest';
it('claim 1 and 2', () => { testGame.doAction(1, 'bid'); testGame.doAction(1, 'pass'); });
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
        'tests/auction.test.ts': DISPATCHES_BOTH,
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
        'tests/auction.test.ts': DISPATCHES_BOTH,
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
    const findings = (await checkTestStep(project, 'auction')).findings;
    // A row build or repair added is held to the same observation, so the message names both (#485).
    expect(findings[0].detail).toMatch(/before the change that makes them pass[^]*build or repair/);
    const kinds = findings.map((f) => `${f.kind} ${f.subject}`);
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

  // The a11y floor's source scans live in tests/guards/: no code mutant can fail a scan, so a
  // guard file listed in the manifest would always come back from the mutation check (#443).
  const GUARD = `import { it, expect } from 'vitest';
import { scanAssetReachability } from 'boardsmith/asset-scan';
it('no bare asset <img>', () => { expect(scanAssetReachability(process.cwd())).toEqual([]); });
`;

  it('reports a guard file listed in the Spec Manifest, and says to take the row out (#443)', async () => {
    await build(
      { 'src/rules/auction.ts': RULES, 'tests/auction.test.ts': DISPATCHES_BOTH, 'tests/guards/a11y-floor.test.ts': GUARD },
      '| tests/auction.test.ts | 1, 2 | yes |\n| tests/guards/a11y-floor.test.ts | a11y | yes |\n',
    );
    const findings = (await checkTestStep(project, 'auction')).findings;
    expect(findings.map((f) => `${f.kind} ${f.subject}`)).toEqual(['guard-in-manifest tests/guards/a11y-floor.test.ts']);
    expect(findings[0].detail).toMatch(/Remove the row/);
    expect(findings[0].detail).toContain('build/test.md');
  });

  it('accepts a guard file the chunk wrote that the Spec Manifest does not list (#443)', async () => {
    const manifestFiles = await passingManifestFiles(
      { 'src/rules/auction.ts': RULES, 'tests/auction.test.ts': DISPATCHES_BOTH, 'tests/guards/a11y-floor.test.ts': GUARD },
      '| tests/auction.test.ts | 1, 2 | yes |\n',
    );
    expect(manifestFiles).toEqual(['tests/auction.test.ts']);
  });

  /** Builds the chunk, expects no finding, and returns the manifest files the mutation check would run. */
  async function passingManifestFiles(files: Record<string, string>, rows: string): Promise<string[]> {
    await build(files, rows);
    const result = await checkTestStep(project, 'auction');
    expect(result.findings).toEqual([]);
    return result.testFiles.map((f) => f.path);
  }

  // A guard is never mutation-tested, so a guard that runs the game's code would hide a test that
  // could be tautological from the mutation check. A guard holds scans only (#443).
  it.each([
    ['imports a component', `import Bid from '../../src/ui/Bid.vue';\nit('x', () => { expect(Bid).toBeTruthy(); });\n`, 1],
    ['mounts with @vue/test-utils', `import { mount } from '@vue/test-utils';\nit('x', () => { mount({}); });\n`, 1],
    ['uses boardsmith/testing', `import { createTestGame } from 'boardsmith/testing';\nit('x', () => { createTestGame(); });\n`, 1],
    ['calls renderAsSeat', `import { it } from 'vitest';\nimport { renderAsSeat } from '../support';\nit('x', () => { renderAsSeat(); });\n`, 2],
    ['dispatches an action', `import { it } from 'vitest';\nit('x', () => {\n  testGame.doAction(1, 'bid');\n});\n`, 3],
  ])('reports a guard the chunk wrote that %s, and says where the test belongs (#443)', async (_what, guard, line) => {
    const findings = await findingsFor({ 'src/rules/auction.ts': RULES, 'tests/guards/a11y-floor.test.ts': guard });
    expect(findings.map((f) => [f.kind, f.subject])).toEqual([['guard-runs-code', `tests/guards/a11y-floor.test.ts:${line}`]]);
    expect(findings[0].detail).toMatch(/scans only/);
    expect(findings[0].detail).toContain('Spec Manifest');
  });

  it('accepts a guard that reads components as text, including a ?raw import (#443)', async () => {
    const findings = await findingsFor({
      'src/rules/auction.ts': RULES,
      'tests/guards/a11y-floor.test.ts': `import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import bidSource from '../../src/ui/Bid.vue?raw';
import { scanAssetReachability } from 'boardsmith/asset-scan';
it('no colour literals', () => { expect(readFileSync('src/ui/Bid.vue', 'utf-8') + bidSource).not.toMatch(/#[0-9a-f]{6}/i); });
it('no bare asset <img>', () => { expect(scanAssetReachability(process.cwd())).toEqual([]); });
`,
    });
    expect(findings).toEqual([]);
  });

  // #485: a guard that imports a rules module or a UI composable from the game's src/ and calls it
  // runs the game's code as surely as one that mounts a component. Only a `?raw` import (text) and
  // literal theme constants a contrast check needs are scans.
  const THEME = `export type Scheme = 'dark' | 'light';
export const PALETTE = { dark: { text: '#eeeeee', surface: '#111111' }, light: { text: '#111111', surface: '#ffffff' } } as const;
const ACCENT = '#ffcc00';
export { ACCENT as ACCENT_COLOR };
export function hexToRgb(hex: string): number[] { return [parseInt(hex.slice(1, 3), 16)]; }
`;

  it.each([
    ['calls a rules function', `import { it } from 'vitest';\nimport { resolveBid } from '../../src/rules/auction';\nit('x', () => { resolveBid(); });\n`, 2, 'src/rules/auction.ts'],
    ['imports a module for its side effects', `import '../../src/rules/auction.js';\n`, 1, 'src/rules/auction.ts'],
    ['loads a game module dynamically', `import { it } from 'vitest';\nit('x', async () => {\n  await import('../../src/rules/auction');\n});\n`, 3, 'src/rules/auction.ts'],
    ['calls a function from the theme module', `import { hexToRgb } from '../../src/ui/theme';\nhexToRgb('#ffffff');\n`, 1, 'src/ui/theme.ts'],
    ['imports the whole theme module', `import * as theme from '../../src/ui/theme';\nvoid theme;\n`, 1, 'src/ui/theme.ts'],
    ['imports a support file that imports the game', `import { helper } from '../support/game';\nhelper();\n`, 1, 'src/rules/auction.ts'],
    ['loads a game module through vi.importActual', `import { vi } from 'vitest';\nawait vi.importActual('../../src/rules/auction');\n`, 2, 'src/rules/auction.ts'],
    ['loads a game module with require', `const auction = require('../../src/rules/auction');\nvoid auction;\n`, 1, 'src/rules/auction.ts'],
    ['loads a game module through a template literal', 'await import(`../../src/rules/auction`);\n', 1, 'src/rules/auction.ts'],
    ['automocks a game module with vi.mock and no factory', `import { vi } from 'vitest';\nvi.mock('../../src/rules/auction');\n`, 2, 'src/rules/auction.ts'],
    ['spies on a game module with vi.mock and an options object', `import { vi } from 'vitest';\nvi.mock('../../src/rules/auction', { spy: true });\n`, 2, 'src/rules/auction.ts'],
    ['loads a game module by a computed path', "const name = 'auction';\nawait import(`../../src/rules/${name}`);\n", 2, 'src/rules/'],
  ])('reports a guard that %s from the game\'s src/ (#485)', async (_what, guard, line, module) => {
    const findings = await findingsFor({
      'src/rules/auction.ts': RULES,
      'src/ui/theme.ts': THEME,
      'tests/support/game.ts': `import { bid } from '../../src/rules/auction.js';\nexport const helper = () => bid;\n`,
      'tests/guards/a11y-floor.test.ts': guard,
    });
    expect(findings.map((f) => [f.kind, f.subject])).toEqual([['guard-runs-code', `tests/guards/a11y-floor.test.ts:${line}`]]);
    expect(findings[0].detail).toContain(module);
  });

  it('accepts a guard that mocks a game module with a factory, which never loads the real one (#485)', async () => {
    const findings = await findingsFor({
      'src/rules/auction.ts': RULES,
      'tests/guards/a11y-floor.test.ts': `import { vi } from 'vitest';\nvi.mock('../../src/rules/auction', () => ({ bid: 1 }));\n`,
    });
    expect(findings).toEqual([]);
  });

  it('accepts a guard that imports literal theme constants and types from the game\'s src/ui (#485)', async () => {
    const findings = await findingsFor({
      'src/rules/auction.ts': RULES,
      'src/ui/theme.ts': THEME,
      'tests/guards/a11y-floor.test.ts': `import { it, expect } from 'vitest';
import { PALETTE, ACCENT_COLOR, type Scheme } from '../../src/ui/theme.js';
import type { bid } from '../../src/rules/auction';
const scheme: Scheme = 'dark';
it('contrast', () => { expect(PALETTE[scheme].text).not.toBe(ACCENT_COLOR); });
`,
    });
    expect(findings).toEqual([]);
  });

  it.each([
    ['outside src/ui', 'src/rules/colours.ts', `export const INK = '#000000';\n`],
    ['whose module runs code when it loads', 'src/ui/colours.ts', `import { register } from './registry';\nexport const INK = '#000000';\nregister(INK);\n`],
    ['that is computed rather than written out', 'src/ui/colours.ts', `export const INK = ['#00', '0000'].join('');\n`],
    ['behind a getter', 'src/ui/colours.ts', `export const INK = { get value() { return '#000000'; } };\n`],
    ['behind a method', 'src/ui/colours.ts', `export const INK = { value() { return '#000000'; } };\n`],
    ['re-exported from another module', 'src/ui/colours.ts', `export { INK } from './palette';\n`],
    ['that is an overloaded function', 'src/ui/colours.ts', `export function INK(): string;\nexport function INK(x?: string): string { return x ?? '#000000'; }\n`],
    ['that is a function sharing its name with a type', 'src/ui/colours.ts', `export type INK = string;\nexport function INK(): string { return '#000000'; }\n`],
    ['that is an arrow sharing its name with an interface', 'src/ui/colours.ts', `export interface INK { value: string }\nexport const INK = () => '#000000';\n`],
  ])('reports a guard that imports a constant %s (#485)', async (_what, path, module) => {
    const specifier = `../../${path.replace(/\.ts$/, '')}`;
    const findings = await findingsFor({
      'src/rules/auction.ts': RULES,
      [path]: module,
      'tests/guards/a11y-floor.test.ts': `import { INK } from '${specifier}';\nvoid INK;\n`,
    });
    expect(findings.map((f) => [f.kind, f.subject])).toEqual([['guard-runs-code', 'tests/guards/a11y-floor.test.ts:1']]);
  });

  it('leaves alone a guard that runs code when the chunk did not touch it (#443)', async () => {
    await write(project, { 'tests/guards/old.test.ts': `import { mount } from '@vue/test-utils';\n` });
    git(project, 'add', '-A');
    git(project, 'commit', '-q', '-m', 'chunk-setup/step-close');
    expect(await findingsFor({ 'src/rules/auction.ts': RULES })).toEqual([]);
  });

  // #485: a test file the chunk adds outside its Spec Manifest is never mutation-tested, so a
  // regression or budget test that runs the game's code must be a row. The ruling's exemptions:
  // the browser smoke test, generated example tests, scan-only guards, and earlier chunks' files.
  const RUNS_GAME = `import { it, expect } from 'vitest';
import { bid } from '../src/rules/auction';
it('regression: a bid is defined', () => { expect(bid).toBeTruthy(); });
`;

  it.each([
    ['imports a game module', 'tests/regression.test.ts', RUNS_GAME, 2],
    ['builds a game with boardsmith/testing', 'tests/state-budget.test.ts', `import { createTestGame } from 'boardsmith/testing';\ncreateTestGame();\n`, 1],
    ['dispatches an action', 'tests/edge/bids.test.ts', `import { it } from 'vitest';\nit('x', () => { testGame.doAction(1, 'bid'); });\n`, 2],
    ['imports a support file that imports the game', 'tests/budget.test.ts', `import { helper } from './support/game';\nhelper();\n`, 1],
  ])('reports a new test file the chunk wrote outside the Spec Manifest that %s (#485)', async (_what, path, text, line) => {
    const findings = await findingsFor({
      'src/rules/auction.ts': RULES,
      'tests/support/game.ts': `import { bid } from '../../src/rules/auction.js';\nexport const helper = () => bid;\n`,
      [path]: text,
    });
    expect(findings.map((f) => [f.kind, f.subject])).toEqual([['test-not-in-manifest', path]]);
    expect(findings[0].detail).toContain(`line ${line}`);
    expect(findings[0].detail).toMatch(/Spec Manifest row[^]*mutation/);
    expect(findings[0].detail).toContain('build/spec.md');
  });

  it('reports a new test file outside the manifest that is not committed yet (#485)', async () => {
    await build({ 'src/rules/auction.ts': RULES, 'tests/auction.test.ts': DISPATCHES_BOTH }, '| tests/auction.test.ts | 1, 2 | yes |\n');
    await write(project, { 'tests/regression.test.ts': RUNS_GAME });
    const findings = (await checkTestStep(project, 'auction')).findings;
    expect(findings.map((f) => [f.kind, f.subject])).toEqual([['test-not-in-manifest', 'tests/regression.test.ts']]);
  });

  it('reports a new test file outside the manifest that is staged but not committed (#485)', async () => {
    await build({ 'src/rules/auction.ts': RULES, 'tests/auction.test.ts': DISPATCHES_BOTH }, '| tests/auction.test.ts | 1, 2 | yes |\n');
    await write(project, { 'tests/regression.test.ts': RUNS_GAME });
    git(project, 'add', 'tests/regression.test.ts');
    const findings = (await checkTestStep(project, 'auction')).findings;
    expect(findings.map((f) => [f.kind, f.subject])).toEqual([['test-not-in-manifest', 'tests/regression.test.ts']]);
  });

  // Git's rename detection would report a moved or rewritten file as renamed rather than added, so
  // the new path would never count as created by this chunk (#485).
  describe('a test file the chunk moved or replaced counts as new (#485)', () => {
    beforeEach(async () => {
      await write(project, { 'tests/old.test.ts': RUNS_GAME });
      git(project, 'add', '-A');
      git(project, 'commit', '-q', '-m', 'chunk-setup/step-close');
      await build({ 'src/rules/auction.ts': RULES, 'tests/auction.test.ts': DISPATCHES_BOTH }, '| tests/auction.test.ts | 1, 2 | yes |\n');
    });

    const unlisted = async () =>
      (await checkTestStep(project, 'auction')).findings.map((f) => [f.kind, f.subject]);

    it('reports an earlier test file the chunk moved in one of its commits', async () => {
      git(project, 'mv', 'tests/old.test.ts', 'tests/moved.test.ts');
      git(project, 'commit', '-q', '-m', 'chunk-auction/step-build');
      expect(await unlisted()).toEqual([['test-not-in-manifest', 'tests/moved.test.ts']]);
    });

    it('reports the same move staged and not committed', async () => {
      git(project, 'mv', 'tests/old.test.ts', 'tests/moved.test.ts');
      expect(await unlisted()).toEqual([['test-not-in-manifest', 'tests/moved.test.ts']]);
    });

    it('reports a new file much like an earlier one the chunk deleted', async () => {
      git(project, 'rm', '-q', 'tests/old.test.ts');
      await write(project, { 'tests/similar.test.ts': `${RUNS_GAME}// moved here\n` });
      git(project, 'add', '-A');
      git(project, 'commit', '-q', '-m', 'chunk-auction/step-build');
      expect(await unlisted()).toEqual([['test-not-in-manifest', 'tests/similar.test.ts']]);
    });
  });

  // vitest collects a test file anywhere in the project, and the CHUNK template's example row is
  // under src/, so a new test file there is held to the same rule (#485).
  it('reports a new game-running test file the chunk wrote under src/', async () => {
    const findings = await findingsFor({
      'src/rules/auction.ts': RULES,
      'src/rules/auction-extra.test.ts': `import { it } from 'vitest';\nimport { bid } from './auction';\nit('x', () => { void bid; });\n`,
    });
    expect(findings.map((f) => [f.kind, f.subject])).toEqual([['test-not-in-manifest', 'src/rules/auction-extra.test.ts']]);
  });

  it('accepts a measurement harness under the chunk\'s evidence/ and a test file vitest never collects (#485)', async () => {
    const findings = await findingsFor({
      'src/rules/auction.ts': RULES,
      'design/chunks/auction/evidence/budget.test.ts': `import { bid } from '../../../../src/rules/auction';\nvoid bid;\n`,
      'tests/browser/flow.spec.ts': `import { bid } from '../../src/rules/auction';\nvoid bid;\n`,
      'dist/auction.test.js': `import { bid } from '../src/rules/auction.js';\nvoid bid;\n`,
    });
    expect(findings).toEqual([]);
  });

  // Ruling (2026-10-03): an exempt chunk that pins an earlier chunk's behaviour adds the test as its
  // own row marked `none (regression)`. It pins behaviour that already exists, so there is no red to
  // observe; it is still mutation-tested. Nothing broader is excused.
  describe('an exempt chunk\'s none (regression) row (#485)', () => {
    const PIN = `import { it, expect } from 'vitest';\nimport { start } from '../src/rules/game';\nit('pins start', () => { expect(start).toBeTruthy(); });\n`;

    async function exemptChunk(rows: string, claims = '') {
      await write(project, { 'tests/pin.test.ts': PIN, 'design/chunks/auction/CHUNK.md': chunkMd(rows, claims) });
      git(project, 'add', '-A');
      git(project, 'commit', '-q', '-m', 'chunk-auction/step-build');
      return checkTestStep(project, 'auction');
    }

    it('hands it to the mutation check as a pin', async () => {
      const result = await exemptChunk('| exempt | refactor, no rules change | n/a |\n| tests/pin.test.ts | none (regression) | n/a |\n');
      expect(result.findings).toEqual([]);
      expect(result.testFiles.map((f) => [f.path, f.pin])).toEqual([['tests/pin.test.ts', true]]);
    });

    it.each(['pending', 'yes', ''])('accepts only n/a as its RED Observed, not "%s"', async (red) => {
      const result = await exemptChunk(`| exempt | refactor, no rules change | n/a |\n| tests/pin.test.ts | none (regression) | ${red} |\n`);
      expect(result.findings.map((f) => [f.kind, f.subject])).toEqual([['red-not-observed', 'tests/pin.test.ts']]);
      expect(result.findings[0].detail).toMatch(/set it to n\/a/);
    });

    it.each([
      ['in a chunk that is not exempt', '| tests/auction.test.ts | 1, 2 | yes |\n| tests/pin.test.ts | none (regression) | n/a |\n', '1. **Bid.** a\n2. **Pass.** b\n'],
      ['marked anything but none (regression)', '| exempt | refactor | n/a |\n| tests/pin.test.ts | none (budget) | n/a |\n', ''],
      ['that lists a claim', '| exempt | refactor | n/a |\n| tests/pin.test.ts | 3 (regression) | n/a |\n', ''],
    ])('still demands an observed red for a row %s', async (_what, rows, claims) => {
      if (rows.includes('tests/auction.test.ts')) await write(project, { 'tests/auction.test.ts': DISPATCHES_BOTH });
      const result = await exemptChunk(rows, claims);
      expect(result.findings.map((f) => [f.kind, f.subject])).toContainEqual(['red-not-observed', 'tests/pin.test.ts']);
    });
  });

  it('accepts a new test file listed as a row with no claims, and runs it in the mutation check (#485)', async () => {
    const manifestFiles = await passingManifestFiles(
      { 'src/rules/auction.ts': RULES, 'tests/auction.test.ts': DISPATCHES_BOTH, 'tests/regression.test.ts': RUNS_GAME },
      '| tests/auction.test.ts | 1, 2 | yes |\n| tests/regression.test.ts | none (regression) | yes |\n',
    );
    expect(manifestFiles).toEqual(['tests/auction.test.ts', 'tests/regression.test.ts']);
  });

  it('accepts the smoke test, generated example tests, a scan outside guards and a support file the chunk wrote (#485)', async () => {
    const findings = await findingsFor({
      'src/rules/auction.ts': RULES,
      'tests/browser/smoke.spec.ts': `import { bid } from '../../src/rules/auction';\nvoid bid;\n`,
      'tests/examples/auction.examples.test.ts': `import { createTestGame } from 'boardsmith/testing';\ncreateTestGame();\n`,
      'tests/scan.test.ts': `import { readFileSync } from 'node:fs';\nimport raw from '../src/rules/auction.ts?raw';\nreadFileSync('src/rules/auction.ts', 'utf-8') + raw;\n`,
      'tests/support/game.ts': `import { bid } from '../../src/rules/auction.js';\nexport const helper = () => bid;\n`,
    });
    expect(findings).toEqual([]);
  });

  it('accepts a game-running test file an earlier chunk wrote that this chunk edits (#485)', async () => {
    await write(project, { 'tests/old.test.ts': RUNS_GAME });
    git(project, 'add', '-A');
    git(project, 'commit', '-q', '-m', 'chunk-setup/step-close');
    const findings = await findingsFor({ 'src/rules/auction.ts': RULES, 'tests/old.test.ts': `${RUNS_GAME}// extended\n` });
    expect(findings).toEqual([]);
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

  /** The findings for a chunk that adds `files` and whose tests dispatch both verbs. */
  async function findingsFor(files: Record<string, string>) {
    await build({ ...files, 'tests/auction.test.ts': DISPATCHES_BOTH }, '| tests/auction.test.ts | 1, 2 | yes |\n');
    return (await checkTestStep(project, 'auction')).findings;
  }

  it('reports a test file of the chunk that provides a key only one shell gives by hand, and names the stubs (#453)', async () => {
    const findings = await findingsFor({
      'src/rules/auction.ts': RULES,
      'tests/support/board.ts': `export function fakeContext() {
  provide(GAME_CONTEXT_KEYS.gameView, computed(() => ({})));
  provide(GAME_CONTEXT_KEYS.gameState, ref(null));
}
`,
    });
    expect(findings.map((f) => [f.kind, f.subject])).toEqual([['hand-built-shell-context', 'tests/support/board.ts:3']]);
    expect(findings[0].detail).toMatch(/GAME_CONTEXT_KEYS\.gameState.*by hand.*renderAsSeat.*tableShellContext.*worldShellContext/s);
  });

  it('leaves alone a hand-built context in a test file the chunk did not touch (#453)', async () => {
    await write(project, { 'tests/old-board.test.ts': 'provide(WORLD_CONTEXT_KEY, fake);\n' });
    git(project, 'add', '-A');
    git(project, 'commit', '-q', '-m', 'chunk-setup/step-close');
    const findings = await findingsFor({ 'src/rules/auction.ts': RULES });
    expect(findings).toEqual([]);
  });

  it('reports an "unreachable" guard the chunk added, with a readable next step', async () => {
    const findings = await findingsFor({
      'src/rules/auction.ts': `${RULES}export function f(x: number) {
  if (x < 0) throw new Error('unreachable');
}
`,
    });
    expect(findings.map((f) => [f.kind, f.subject])).toEqual([['unreachable-guard', 'src/rules/auction.ts:4']]);
    expect(findings[0].detail).toMatch(/test that reaches it|what to do/);
  });

  it('reads a component the chunk changed, reporting an "unreachable" guard in its script at its line in the .vue file (#425)', async () => {
    const findings = await findingsFor({
      'src/rules/auction.ts': RULES,
      'src/ui/Bid.vue': `<template>
  <p>{{ label }}</p>
</template>

<script setup lang="ts">
const props = defineProps<{ amount: number }>();
if (props.amount < 0) throw new Error('unreachable');
const label = \`bid \${props.amount}\`;
</script>
`,
    });
    expect(findings.map((f) => [f.kind, f.subject])).toEqual([['unreachable-guard', 'src/ui/Bid.vue:7']]);
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
  let printed: MockInstance<typeof console.log>;

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
    printed = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  /** Runs the command with --json and returns the report it printed. */
  async function runCommand(): Promise<TestStepCheckResult> {
    await testStepCheckCommand('auction', { project, json: true });
    return JSON.parse(String(printed.mock.calls.at(-1)?.[0])) as TestStepCheckResult;
  }

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
    const result = await runCommand();
    expect(result.findings).toEqual([]);
    expect(result.mutation?.killed).toBeGreaterThan(0);
    expect(process.exitCode).toBeUndefined();
  }, 60_000);

  it('fails the step on a test no break of the code can make fail', async () => {
    await commitTests(`it('claim 1 — a higher offer wins', () => { expect(testGame.doAction(1, 'bid', { high: 3, offer: 4 })).toBe(true); });
it('claim 2 — tautology', () => { const high = 3; expect(high).toBe(3); });
`);
    const result = await runCommand();
    expect(result.findings.map((f) => f.kind)).toEqual(['claim-survives-mutation', 'test-survives-mutation']);
    expect(process.exitCode).toBe(1);
  }, 60_000);

  // Ruling (2026-10-03): an exempt chunk that pins an earlier chunk's behaviour adds the test as its
  // own `none (regression)` row, excused from the observed red and still mutation-tested. The chunk
  // adds no game code (here, an asset swap), so the mutants come from the game code the test loads.
  describe("an exempt chunk's none (regression) row (#485)", () => {
    async function exemptChunkPinning(pin: string): Promise<TestStepCheckResult> {
      git(project, 'add', '-A');
      git(project, 'commit', '-q', '-m', 'chunk-setup/step-close');
      await write(project, {
        'assets/board.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>\n',
        'tests/pin.test.ts': `import { it, expect } from 'vitest';\nimport { resolveBid } from '../src/rules/auction';\n${pin}`,
        'design/chunks/auction/CHUNK.md': chunkMd(
          '| exempt | asset swap only, no rules change | n/a |\n| tests/pin.test.ts | none (regression) | n/a |\n',
          '',
        ),
      });
      git(project, 'add', '-A');
      git(project, 'commit', '-q', '-m', 'chunk-auction/step-build');
      return runCommand();
    }

    it('passes a pin that a break of the earlier code it loads makes fail', async () => {
      const result = await exemptChunkPinning(
        "it('an equal offer still loses', () => { expect(resolveBid(3, 4)).toBe(true); expect(resolveBid(3, 3)).toBe(false); });\n",
      );
      expect(result.findings).toEqual([]);
      expect(result.mutation?.killed).toBeGreaterThan(0);
      expect(process.exitCode).toBeUndefined();
    }, 60_000);

    it('fails the step on a pin no break of that code can make fail', async () => {
      const result = await exemptChunkPinning("it('resolveBid runs', () => { resolveBid(3, 4); expect(typeof resolveBid).toBe('function'); });\n");
      expect(result.findings.map((f) => [f.kind, f.subject])).toEqual([['test-survives-mutation', 'tests/pin.test.ts > resolveBid runs']]);
      expect(result.mutation?.mutants).toBeGreaterThan(0);
      expect(process.exitCode).toBe(1);
    }, 60_000);
  });

  it('fails the step on a static finding without running any mutant', async () => {
    await commitTests(`it('claim 1 and claim 2', () => { expect(resolveBid(3, 4)).toBe(true); });
`);
    const result = await runCommand();
    expect(result.findings.map((f) => [f.kind, f.subject])).toEqual([['verb-not-dispatched', 'bid']]);
    expect(result.mutation).toBeUndefined();
    expect(process.exitCode).toBe(1);
  });
});
