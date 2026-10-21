/**
 * #294: `boardsmith chunk-merge`, for the files two chunks built together both touch, and its
 * preconditions. chunk-merge.test.ts holds the rest; the two run side by side (#1319).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { existsSync, promises as fs } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { takeOsLock } from '../lib/os-lock.js';
import { chunkMerge, resolveDesignConflicts } from './chunk-merge.js';
import { assessSignoffs } from './chunk-signoff.js';
import { recordVerifiedAgainst } from './chunk-provenance.js';
import { type TestRunner } from './constraint-check.js';
import {
  git,
  write,
  read,
  budgetRunner,
  typeCheck,
  chunkMd,
  main,
  setUp,
  buildOnBranch,
  head,
  status,
} from './chunk-merge.test-helper.js';

// chunk-merge.test.ts says what this timeout covers.
vi.setConfig({ testTimeout: 30_000 });

beforeEach(setUp);

describe('chunkMerge: references between chunks built together go to the audit', () => {
  it('records what the two chunks both touch as pending review, and the next merge waits for the ruling', async () => {
    const venues = (first: string, last = '') =>
      `export const VENUES = [${first}];\n// one\n// two\n// three\nexport const LAST = 1;\n${last}`;
    await write(main, { 'src/venues.ts': venues("'market'") });
    git(main, 'add', '-A');
    git(main, 'commit', '-q', '-m', 'venues');
    // Trading changes the venue list; quests, on its own branch, starts using one of them.
    await buildOnBranch('trading', 100, { 'src/venues.ts': venues("'market', 'harbor'") });
    await buildOnBranch('quests', 100, {
      'src/venues.ts': venues("'market'", "export const QUEST_VENUE = 'market';\n"),
    });
    await buildOnBranch('auctions', 100);

    expect((await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck })).refusals).toEqual([]);
    const second = await chunkMerge(main, 'quests', { runTests: budgetRunner, typeCheck });
    expect(second.refusals).toEqual([]);
    expect(second.crossChunk).toBe('pending');

    const ledger = await read(main, 'design/CROSS-CHUNK.md');
    expect(ledger).toMatch(/^### Merge 1$/m);
    expect(ledger).toContain('- Chunk: quests');
    expect(ledger).toContain('- Built alongside: trading');
    expect(ledger).toContain('`market`');
    expect(ledger).toMatch(/^- Verdict: pending$/m);

    const third = await chunkMerge(main, 'auctions', { runTests: budgetRunner, typeCheck });
    expect(third.merged).toBe(false);
    expect(third.refusals.join('\n')).toMatch(/CROSS-CHUNK\.md, Merge 1/);
  });
});

describe('chunkMerge: a file it cannot read is refused, never read as missing (#1049)', () => {
  /** Replaces `rel` in `dir` with a link to itself, which no read gets through, and commits it. */
  async function commitLoop(dir: string, rel: string): Promise<void> {
    await fs.mkdir(dirname(join(dir, rel)), { recursive: true });
    await fs.rm(join(dir, rel), { force: true });
    await fs.symlink(basename(rel), join(dir, rel));
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', `${rel} links to itself`);
  }

  for (const [what, rel] of [
    ['a file the branch changed', 'docs/loop.txt'],
    ["the chunk's CHUNK.md", 'design/chunks/trading/CHUNK.md'],
    ['the sketch whose session lock it keeps', 'design/SKETCH.md'],
  ] as const) {
    it(`refuses ${what}, naming it, and leaves main as it was`, async () => {
      await commitLoop(await buildOnBranch('trading', 100), rel);
      const before = head();

      await expect(chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck })).rejects.toThrow(new RegExp(`Could not read \\S+/game/${rel} \\(ELOOP\\)`));
      expect(head()).toBe(before);
      expect(status()).toBe('');
    });
  }
});

describe('chunkMerge: preconditions', () => {
  it('refuses while another chunk-merge holds the lock, naming it, and merges once it is released (#441)', async () => {
    await buildOnBranch('trading', 100);
    const common = git(main, 'rev-parse', '--path-format=absolute', '--git-common-dir').trim();
    const other = await takeOsLock(join(common, 'boardsmith-chunk-merge.flock'), 'chunk-merge', 'chunk-merge of quests (branch chunk/quests)');
    if (typeof other === 'string') throw new Error(other);

    const refused = await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck });
    // A merge in flight leaves the main checkout dirty; a second run is told about the merge, not
    // asked to clean up the files that merge is working on.
    const sketch = await read(main, 'design/SKETCH.md');
    await fs.writeFile(join(main, 'design/SKETCH.md'), `${sketch}\nmid-merge\n`);
    const whileDirty = await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck });
    await fs.writeFile(join(main, 'design/SKETCH.md'), sketch);
    await other.release();
    expect(refused.merged).toBe(false);
    expect(refused.refusals.join('\n')).toContain(
      `Another chunk-merge holds the lock: chunk-merge of quests (branch chunk/quests), pid ${process.pid}`,
    );
    expect(whileDirty.refusals).toEqual(refused.refusals);
    expect(git(main, 'status', '--porcelain')).toBe('');

    expect((await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck })).refusals).toEqual([]);
    expect(existsSync(join(common, 'boardsmith-chunk-merge.flock.holder'))).toBe(false);
  });

  it('names a merge a killed chunk-merge left half done, and how to undo it (#441)', async () => {
    await buildOnBranch('trading', 100);
    git(main, 'merge', '--no-ff', '--no-commit', 'chunk/trading');
    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck });
    expect(result.refusals).toEqual([
      'The main checkout holds a merge that was started and never finished, most likely by a chunk-merge ' +
        'that was stopped partway. Undo it with `git merge --abort` in the main checkout, then run chunk-merge again.',
    ]);
  });

  it('refuses a dirty main checkout, a missing branch, and a chunk that is not verified', async () => {
    expect((await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck })).refusals.join('\n')).toMatch(/no branch chunk\/trading/);

    await buildOnBranch('trading', 100);
    await fs.appendFile(join(main, 'src/core.ts'), '// edit\n');
    expect((await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck })).refusals.join('\n')).toMatch(/uncommitted changes/);
    git(main, 'checkout', '--', 'src/core.ts');

    const worktree = join(dirname(main), 'wt-quests');
    git(main, 'worktree', 'add', '-q', '-b', 'chunk/quests', worktree);
    await write(worktree, { 'src/quests.ts': 'export const PARTITION_BYTES = 1;\n', 'design/chunks/quests/CHUNK.md': await chunkMd('quests') });
    git(worktree, 'add', '-A');
    git(worktree, 'commit', '-q', '-m', 'wip');
    expect((await chunkMerge(main, 'quests', { runTests: budgetRunner, typeCheck })).refusals.join('\n')).toMatch(/quests is "built", not verified/);
    expect(status()).toBe('');
  });

  it('refuses, before any test runs, a project whose config would collect the chunk worktrees (#298)', async () => {
    await buildOnBranch('trading', 100);
    const before = head();
    const { refusals } = await chunkMerge(main, 'trading');
    expect(refusals).toEqual([expect.stringMatching(/has no vite\.config\.ts[\s\S]*boardsmith doctor --fix/)]);
    expect([head(), status()]).toEqual([before, '']);
  });

  it('refuses with git\'s own reason when git will not start the merge, leaving the index untouched (#824)', async () => {
    await buildOnBranch('trading', 100);
    // An untracked file where the branch adds one: git refuses before writing anything, so no MERGE_HEAD.
    await fs.writeFile(join(main, 'src/trading.ts'), '// mine\n');
    const before = head();
    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck });
    expect(result.merged).toBe(false);
    expect(result.refusals).toEqual([expect.stringMatching(/untracked working tree files would be overwritten[\s\S]*src\/trading\.ts/)]);
    expect(result.refusals.join('\n')).not.toMatch(/not verified/);
    expect([head(), git(main, 'status', '--porcelain')]).toEqual([before, '?? src/trading.ts\n']);
    expect(await read(main, 'src/trading.ts')).toBe('// mine\n');
  });
});

describe('chunkMerge: a design file one side deleted and the other edited (#825)', () => {
  // git leaves a modify/delete conflict with no markers, so there is nothing a merge may resolve.
  async function expectRefused(): Promise<void> {
    const before = head();
    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck });
    expect(result.merged).toBe(false);
    expect(result.refusals).toEqual([expect.stringMatching(/conflicts in .*design\/rulebook\/05-market\.md/)]);
    expect([head(), status()]).toEqual([before, '']);
  }

  it('refuses when the branch deleted it and the main line edited it', async () => {
    const worktree = await buildOnBranch('trading', 100);
    git(worktree, 'rm', '-q', 'design/rulebook/05-market.md');
    git(worktree, 'commit', '-q', '-m', 'chunk-trading/drop market');
    await fs.appendFile(join(main, 'design/rulebook/05-market.md'), 'Prices rise.\n');
    git(main, 'commit', '-q', '-am', 'edit market');
    await expectRefused();
  });

  it('refuses when the main line deleted it and the branch edited it', async () => {
    const worktree = await buildOnBranch('trading', 100);
    await fs.appendFile(join(worktree, 'design/rulebook/05-market.md'), 'Prices rise.\n');
    git(worktree, 'commit', '-q', '-am', 'chunk-trading/edit market');
    git(main, 'rm', '-q', 'design/rulebook/05-market.md');
    git(main, 'commit', '-q', '-m', 'drop market');
    await expectRefused();
  });

  it('refuses, rather than failing to read it, when both renamed it differently and git left no file there', async () => {
    const worktree = await buildOnBranch('trading', 100);
    git(worktree, 'mv', 'design/rulebook/05-market.md', 'design/rulebook/05-bazaar.md');
    git(worktree, 'commit', '-q', '-m', 'chunk-trading/rename market');
    git(main, 'mv', 'design/rulebook/05-market.md', 'design/rulebook/05-shops.md');
    git(main, 'commit', '-q', '-m', 'rename market');
    await expectRefused();
  });
});

describe('chunkMerge: a source file two chunks built together both edited (#403)', () => {
  /** One rules module both chunks add to, each in its own part. */
  const world = (trading: number, quests: number) =>
    `// world\n// a\n// b\n// c\nexport const TRADING = ${trading};\n// one\n// two\n// three\nexport const QUESTS = ${quests};\n`;

  /**
   * Each chunk's own test, run as code: quests' test assumes trading's constant is still 0, so it
   * passes on quests' branch and fails once trading's edit is in the combined file.
   */
  const ownTestsRunner: TestRunner = async (projectDir, files) => {
    for (const file of files) {
      const source = await read(projectDir, file);
      if (source.includes('assumes TRADING = 0') && (await read(projectDir, 'src/world.ts')).includes('TRADING = 1')) {
        return { ok: false, output: `${file}: expected TRADING to be 0` };
      }
    }
    return budgetRunner(projectDir, files);
  };

  /** A chunk whose Build Manifest names the shared file (src/world.ts), with a quoted claim and its own test. */
  async function sharedChunkMd(slug: string, claim: string, shared = 'src/world.ts'): Promise<string> {
    return (await chunkMd(slug))
      .replace(`| src/${slug}.ts | written |`, `| src/${slug}.ts | written |\n| ${shared} | written |`)
      .replace(/^1\. \*\*<!-- claim text -->\*\*\n.*\n.*\n/m, `${claim}\n`)
      .replace('<!-- | src/...test.ts | 1, 3, 4 | pending / yes | -->', `| tests/${slug}.test.ts | 1 | yes |`);
  }

  const TRADING_CLAIM = [
    '1. **Every trade is public.**',
    '   > Every trade is public.',
    '   Source: rulebook/04-trading.md §"Trading"',
  ].join('\n');
  const QUESTS_CLAIM = [
    '1. **A quest has one giver.**',
    '   > A quest has one giver.',
    '   Source: rulebook/07-quests.md §"Quests"',
  ].join('\n');

  async function buildShared(
    slug: 'trading' | 'quests',
    options: { claim?: string; test?: string; worldFile?: string; shared?: string; chunkCheck?: boolean; extra?: Record<string, string> } = {},
  ): Promise<void> {
    const claim = options.claim ?? (slug === 'trading' ? TRADING_CLAIM : QUESTS_CLAIM);
    const shared = options.shared ?? 'src/world.ts';
    const worktree = await buildOnBranch(slug, 100, {
      [`design/chunks/${slug}/CHUNK.md`]: await sharedChunkMd(slug, claim, shared),
      [`tests/${slug}.test.ts`]: options.test ?? `// ${slug}'s own test\n`,
      [shared]: options.worldFile ?? (slug === 'trading' ? world(1, 0) : world(0, 1)),
      ...options.extra,
    });
    if (options.chunkCheck === false) return;
    await recordVerifiedAgainst(slug, { project: worktree });
    git(worktree, 'add', '-A');
    git(worktree, 'commit', '-q', '-m', `chunk-${slug}/close: chunk-check`);
  }

  beforeEach(async () => {
    await write(main, {
      'src/world.ts': world(0, 0),
      'design/rulebook/04-trading.md': '# Trading\n\nEvery trade is public.\n',
      'design/rulebook/07-quests.md': '# Quests\n\nA quest has one giver.\n',
    });
    git(main, 'add', '-A');
    git(main, 'commit', '-q', '-m', 'world');
  });

  it("vouches for the combined file with both chunks' own checks, and records it naming both chunks and the merge", async () => {
    await buildShared('trading');
    await buildShared('quests');
    expect((await chunkMerge(main, 'trading', { runTests: ownTestsRunner, typeCheck })).refusals).toEqual([]);
    const mainBefore = head();
    const branchTip = git(main, 'rev-parse', 'chunk/quests').trim();

    const result = await chunkMerge(main, 'quests', { runTests: ownTestsRunner, typeCheck });
    expect(result.refusals).toEqual([]);
    expect(await read(main, 'src/world.ts')).toBe(world(1, 1));

    const ledger = await read(main, 'design/MERGE-SIGNOFFS.md');
    expect(ledger).toContain('### src/world.ts');
    expect(ledger).toContain('- Chunks: quests, trading');
    expect(ledger).toContain(`- Merge: chunk/quests ${branchTip} into ${mainBefore}`);
    expect(ledger).toMatch(/^- Content: [0-9a-f]{64}$/m);
    expect(ledger).toMatch(/^- Checks: tests, chunk-check, claim-quote-check$/m);
    // The merge commit carries the record, and its parents are the two commits it names.
    expect(git(main, 'rev-parse', 'HEAD^1', 'HEAD^2').trim().split('\n')).toEqual([mainBefore, branchTip]);

    const signoffs = await assessSignoffs(main);
    expect(signoffs.get('trading')).toEqual({
      problems: [],
      sharedEdits: [{ path: 'src/world.ts', coveredBy: 'quests, trading', how: 'merged' }],
    });
    expect(signoffs.get('quests')).toEqual({
      problems: [],
      sharedEdits: [{ path: 'src/world.ts', coveredBy: 'quests, trading', how: 'merged' }],
    });
    expect(status()).toBe('');
  });

  it('vouches for a shared file whose name has non-ASCII letters, as the Build Manifests write it (#1113)', async () => {
    await write(main, { 'src/règles.ts': world(0, 0) });
    git(main, 'add', '-A');
    git(main, 'commit', '-q', '-m', 'règles');
    await buildShared('trading', { shared: 'src/règles.ts' });
    await buildShared('quests', { shared: 'src/règles.ts' });
    expect((await chunkMerge(main, 'trading', { runTests: ownTestsRunner, typeCheck })).refusals).toEqual([]);
    expect((await chunkMerge(main, 'quests', { runTests: ownTestsRunner, typeCheck })).refusals).toEqual([]);
    expect(await read(main, 'design/MERGE-SIGNOFFS.md')).toContain('### src/règles.ts');
  });

  /**
   * Merges `first`, then `second`, and expects the second merge to be refused with `refusal`,
   * leaving the main line, its working tree and design/MERGE-SIGNOFFS.md as they were.
   */
  async function expectSecondMergeRefused(first: string, second: string, refusal: RegExp): Promise<void> {
    expect((await chunkMerge(main, first, { runTests: ownTestsRunner, typeCheck })).refusals).toEqual([]);
    await expectMergeRefused(second, ownTestsRunner, refusal);
  }

  /** Expects merging `slug` to be refused with `refusal`, leaving the main line and its records as they were. */
  async function expectMergeRefused(slug: string, runTests: TestRunner, refusal: RegExp): Promise<void> {
    const before = head();
    const result = await chunkMerge(main, slug, { runTests, typeCheck });
    expect(result.merged).toBe(false);
    expect(result.refusals.join('\n')).toMatch(refusal);
    expect([head(), status()]).toEqual([before, '']);
    await expect(fs.access(join(main, 'design/MERGE-SIGNOFFS.md'))).rejects.toThrow();
  }

  it("refuses when a chunk's own tests fail on the combined file, naming the check and the chunk", async () => {
    await buildShared('trading');
    await buildShared('quests', { test: '// quests: assumes TRADING = 0\n' });
    await expectSecondMergeRefused(
      'trading',
      'quests',
      /quests's own tests \(tests\/quests\.test\.ts\) fail on the combined tree[\s\S]*src\/world\.ts[\s\S]*expected TRADING to be 0/,
    );
  });

  it("refuses when a chunk's claim-quote-check fails on the combined tree", async () => {
    // Trading quotes Ruling 1; quests, built alongside, rewords it.
    const rulingClaim = ['1. **The core loop comes first.**', '   > the core loop.', '   Source: RULINGS.md §"Ruling 1"'].join('\n');
    await buildShared('trading', { claim: rulingClaim });
    const quests = join(dirname(main), 'wt-quests');
    await buildShared('quests');
    await write(quests, { 'design/RULINGS.md': '# Rulings\n\n### Ruling 1\n- Decision: the game loop.\n' });
    git(quests, 'commit', '-q', '-am', 'chunk-quests/revise: Ruling 1 reworded');
    await expectSecondMergeRefused('quests', 'trading', /claim-quote-check fails for trading on the combined tree[\s\S]*Claim 1/);
  });

  it('vouches for a closed chunk after the skills were reinstalled on the main line (#438)', async () => {
    const skill = '.claude/skills/bs-build-chunk/SKILL.md';
    await write(main, { [skill]: 'skill text v1\n' });
    git(main, 'add', '-A');
    git(main, 'commit', '-q', '-m', 'skills v1');
    await buildShared('trading');
    await buildShared('quests');
    await write(main, { [skill]: 'skill text v2\n' });
    git(main, 'commit', '-q', '-am', 'skills reinstalled');

    expect((await chunkMerge(main, 'trading', { runTests: ownTestsRunner, typeCheck })).refusals).toEqual([]);
    expect((await chunkMerge(main, 'quests', { runTests: ownTestsRunner, typeCheck })).refusals).toEqual([]);
  });

  it("refuses when a chunk's chunk-check fails on the combined tree", async () => {
    await buildShared('trading');
    await buildShared('quests', { chunkCheck: false });
    await expectSecondMergeRefused('trading', 'quests', /chunk-check fails for quests on the combined tree[\s\S]*Verified Against/);
  });

  it("refuses, and leaves no record behind, when a chunk's sign-off fails once the merge has vouched", async () => {
    await buildShared('trading');
    await buildShared('quests');
    expect((await chunkMerge(main, 'trading', { runTests: ownTestsRunner, typeCheck })).refusals).toEqual([]);
    // An edit to trading's own file on the main line that no chunk accounts for voids its sign-off.
    await write(main, { 'src/trading.ts': 'export const PARTITION_BYTES = 101;\n' });
    git(main, 'commit', '-q', '-am', 'an unaccounted edit');
    await expectMergeRefused('quests', ownTestsRunner, /chunk-check fails for trading on the combined tree[\s\S]*src\/trading\.ts changed after it/);
  });

  it("vouches for signed-off code the merge renumbered, so allocating a ledger number voids no sign-off (#435)", async () => {
    const signedWorld = `// Ruling @trading.1: prices are public.\n${world(1, 0)}`;
    await buildShared('trading', {
      worldFile: signedWorld,
      extra: { 'design/RULINGS.md': '# Rulings\n\n### Ruling 1\n- Decision: the core loop.\n\n### Ruling @trading.1\n- Decision: prices are public.\n' },
    });

    const result = await chunkMerge(main, 'trading', { runTests: ownTestsRunner, typeCheck });
    expect(result.refusals).toEqual([]);
    expect(result.allocated).toEqual({ 'Ruling @trading.1': 'Ruling 2' });
    expect(await read(main, 'src/world.ts')).toBe(`// Ruling 2: prices are public.\n${world(1, 0)}`);
    expect(result.vouched).toEqual([{ path: 'src/world.ts', chunks: ['trading'], why: 'renumbered' }]);
    expect(await read(main, 'design/MERGE-SIGNOFFS.md')).toContain('### src/world.ts');
    expect((await assessSignoffs(main)).get('trading')).toEqual({
      problems: [],
      sharedEdits: [{ path: 'src/world.ts', coveredBy: 'trading', how: 'merged' }],
    });
    expect(status()).toBe('');
  });

  describe('a test-runner config the main line edited after a chunk signed it off (#479)', () => {
    // A game's config, built with BoardSmith's (#528): vite.config.ts is its test-runner config too.
    const config = (exclude: string[], more = '') =>
      `import { defineGameViteConfig } from 'boardsmith/vite-config';\n` +
      `export default defineGameViteConfig({\n  test: {\n    exclude: ${JSON.stringify(exclude)},${more}\n  },\n});\n`;

    /**
     * Vitest as it really behaves: a test file named on the command line that the config excludes
     * is skipped without a word, and the run still exits 0. Only the files that ran say otherwise.
     */
    const configRunner: TestRunner = async (projectDir, files) => {
      const text = await read(projectDir, 'vite.config.ts');
      const run = await ownTestsRunner(projectDir, files);
      return 'refused' in run ? run : { ...run, ran: files.filter((f) => !text.includes(`"${f}"`)) };
    };

    /**
     * Trading signs off vite.config.ts with its code, with a second test file of its own; then the
     * main line edits only the config, to `edited`.
     */
    async function tradingSignsTheConfig(edited: string): Promise<void> {
      await write(main, { 'vite.config.ts': config(['node_modules/**']) });
      git(main, 'add', '-A');
      git(main, 'commit', '-q', '-m', 'vite config');
      const chunk = (await sharedChunkMd('trading', TRADING_CLAIM))
        .replace('| src/world.ts | written |', '| src/world.ts | written |\n| vite.config.ts | written |')
        .replace('| tests/trading.test.ts | 1 | yes |', '| tests/trading.test.ts | 1 | yes |\n| tests/trading-prices.test.ts | 1 | yes |');
      await buildShared('trading', {
        extra: {
          'design/chunks/trading/CHUNK.md': chunk,
          'tests/trading-prices.test.ts': '// trading prices\n',
          'vite.config.ts': config(['node_modules/**', 'dist/**']),
        },
      });
      expect((await chunkMerge(main, 'trading', { runTests: configRunner, typeCheck })).refusals).toEqual([]);
      // Quests shares no file with trading; only the config stands between it and the main line.
      await buildOnBranch('quests', 100);
      await write(main, { 'vite.config.ts': edited });
      git(main, 'commit', '-q', '-am', 'tests: change the vite config');
    }

    it("vouches for an edit to test.exclude with the signed chunk's own checks, so it voids no sign-off", async () => {
      await tradingSignsTheConfig(config(['node_modules/**', 'dist/**', '.worktrees/**', '**/tests/browser/**']));
      expect((await assessSignoffs(main)).get('trading')!.problems.join('\n')).toMatch(/vite\.config\.ts changed after it/);

      const result = await chunkMerge(main, 'quests', { runTests: configRunner, typeCheck });
      expect(result.refusals).toEqual([]);
      expect(result.alongside).toEqual([]);
      expect(result.vouched).toEqual([{ path: 'vite.config.ts', chunks: ['trading'], why: 'test-config' }]);
      expect(await read(main, 'design/MERGE-SIGNOFFS.md')).toContain('### vite.config.ts');
      expect((await assessSignoffs(main)).get('trading')).toEqual({
        problems: [],
        sharedEdits: [{ path: 'vite.config.ts', coveredBy: 'trading', how: 'merged' }],
      });
      expect(status()).toBe('');
    });

    it("refuses when the edit excludes one of the chunk's own test files, though vitest exits 0 without it", async () => {
      await tradingSignsTheConfig(config(['node_modules/**', 'dist/**', 'tests/trading-prices.test.ts']));
      await expectMergeRefused(
        'quests',
        configRunner,
        /trading's own tests did not all run on the combined tree, so this merge cannot vouch for vite\.config\.ts \(a test-runner config edited since the chunk signed it off\): tests\/trading-prices\.test\.ts did not run/,
      );
    });

    const editExclude = () => tradingSignsTheConfig(config(['node_modules/**', 'dist/**', '.worktrees/**']));

    it("refuses when the run does not report which files ran, since vitest's report is then missing or unreadable", async () => {
      await editExclude();
      const unreported: TestRunner = async (projectDir, files) => {
        const run = await configRunner(projectDir, files);
        return 'refused' in run ? run : { ok: run.ok, output: run.output };
      };
      await expectMergeRefused(
        'quests',
        unreported,
        /trading's own tests cannot be confirmed on the combined tree, so this merge cannot vouch for vite\.config\.ts[^:]*: vitest's JSON report, which names the test files it ran, is missing or unreadable/,
      );
    });

    it("refuses when the run also ran a file outside the chunk's own, which could share state with its tests", async () => {
      // Vitest runs every collected file whose path contains a named one, and an include edit can add one.
      await editExclude();
      const alsoRan: TestRunner = async (projectDir, files) => {
        const run = await configRunner(projectDir, files);
        return 'refused' in run || files.length === 0 ? run : { ...run, ran: [...(run.ran ?? []), 'extra/tests/trading.test.ts'] };
      };
      await expectMergeRefused(
        'quests',
        alsoRan,
        /trading's own tests did not run alone on the combined tree, so this merge cannot vouch for vite\.config\.ts[^:]*: extra\/tests\/trading\.test\.ts ran with them/,
      );
    });

    it('aborts the merge, leaving the main line as it was, when a check throws', async () => {
      await editExclude();
      const before = head();
      const throws: TestRunner = async () => {
        throw new Error('the test runner broke');
      };
      await expect(chunkMerge(main, 'quests', { runTests: throws, typeCheck })).rejects.toThrow('the test runner broke');
      expect([head(), status()]).toEqual([before, '']);
      await expect(fs.access(join(main, '.git/MERGE_HEAD'))).rejects.toThrow();
    });

    it('does not vouch for any other edit to the config, which voids the sign-off as before', async () => {
      // A setup file can mock what the chunk's tests exercise, so this is not a collection change.
      await tradingSignsTheConfig(config(['node_modules/**', 'dist/**'], "\n    setupFiles: ['tests/setup.ts'],"));
      await expectMergeRefused('quests', configRunner, /chunks\/trading\/CHUNK\.md's sign-off \([^)]*\) was for different code: vite\.config\.ts changed after it/);
    });

    it('refuses a deleted signed config after migration, naming the affected chunk and how to refresh its sign-off (#709)', async () => {
      const oldConfig = `import { defineConfig } from 'vitest/config';\nexport default defineConfig({ test: {} });\n`;
      await write(main, { 'vitest.config.ts': oldConfig });
      git(main, 'add', 'vitest.config.ts');
      git(main, 'commit', '-q', '-m', 'vitest config');
      await buildOnBranch('trading', 100, {
        'design/chunks/trading/CHUNK.md': (await chunkMd('trading'))
          .replace('| src/trading.ts | written |', '| src/trading.ts | written |\n| vitest.config.ts | written |'),
      });
      expect((await chunkMerge(main, 'trading', { runTests: ownTestsRunner, typeCheck })).refusals).toEqual([]);
      await buildOnBranch('quests', 100);
      await fs.unlink(join(main, 'vitest.config.ts'));
      await write(main, { 'vite.config.ts': config(['**/tests/browser/**']) });
      git(main, 'add', 'vitest.config.ts', 'vite.config.ts');
      git(main, 'commit', '-q', '-m', 'migrate to defineGameViteConfig');
      expect(status()).toBe('');
      expect((await assessSignoffs(main)).get('trading')!.problems.join('\n')).toContain('vitest.config.ts changed after it');

      await expectMergeRefused(
        'quests',
        configRunner,
        /chunks\/trading\/CHUNK\.md's sign-off[^\n]*vitest\.config\.ts changed after it[^\n]*boardsmith chunk-signoff trading/,
      );
    });
  });

  it('refuses a branch that writes the merge sign-offs itself', async () => {
    await buildOnBranch('trading', 100, { 'design/MERGE-SIGNOFFS.md': '# Merge Sign-offs\n' });
    const result = await chunkMerge(main, 'trading', { runTests: budgetRunner, typeCheck });
    expect(result.refusals.join('\n')).toMatch(/design\/MERGE-SIGNOFFS\.md/);
  });
});

describe('resolveDesignConflicts', () => {
  const conflict = (ours: string, base: string, theirs: string) =>
    `before\n<<<<<<< HEAD\n${ours}||||||| base\n${base}=======\n${theirs}>>>>>>> chunk/x\nafter\n`;

  it('keeps both sides of two appends at the same place', () => {
    const result = resolveDesignConflicts(conflict('- idea a\n', '', '- idea b\n'));
    expect(result).toEqual({ text: 'before\n- idea a\n- idea b\nafter\n', unresolved: 0 });
  });

  it('keeps the main line\'s session lock', () => {
    const result = resolveDesignConflicts(
      conflict('Session Lock: "a,b @ run"\n', 'Session Lock: "a,b @ old"\n', 'Session Lock: none\n'),
    );
    expect(result).toEqual({ text: 'before\nSession Lock: "a,b @ run"\nafter\n', unresolved: 0 });
  });

  it('leaves a real edit conflict for a person to resolve', () => {
    const result = resolveDesignConflicts(conflict('- Decision: yes\n', '- Decision: maybe\n', '- Decision: no\n'));
    expect(result.unresolved).toBe(1);
  });
});
