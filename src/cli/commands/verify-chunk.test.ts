/**
 * `boardsmith verify --chunk <slug>`: the chunk's fast checks.
 * The `boardsmith verify` tests are split across the verify*.test.ts files so they run side by
 * side (#1319); verify-fixture.test-helper.ts holds the fixtures they share.
 */
import { describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnCli } from '../spawn-cli.test-helper.js';
import { commitAll, git, writeFiles as write } from '../lib/verify-result.test-helper.js';
import { check } from './verify-cli.test-helper.js';
import { runVerify } from './verify.js';
import { FEE_TEST, gameOnBranch, CHECKS, signoff } from './verify-fixture.test-helper.js';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 60_000 });

/**
 * `--chunk <slug>` runs only the fast checks (#985): the test files the chunk added or changed since
 * its verify base, the commit before its first `chunk-<slug>/` commit, and typecheck. The full
 * suite, build, validate, smoke and mutation checks run at publish. A chunk's gates take only such
 * a result, and nothing else takes it.
 */
describe('boardsmith verify --chunk <slug>: the chunk\'s fast checks', () => {
  it('runs only the test files the chunk changed, and typecheck, from where the chunk started; the sign-off accepts it', async () => {
    // The chunk breaks `bid`, whose test file it never touched: that is the full suite's to find, at publish.
    const dir = await gameOnBranch(true);
    const started = git(dir, 'rev-parse', 'main').trim();
    await write(dir, { 'design/DECISIONS.md': '## Decision 1\n' });
    commitAll(dir, 'chunk-deal/step-playtest');

    const { result } = await runVerify({ projectDir: dir, chunk: 'deal', log: () => {} });

    expect(result.passed).toBe(true);
    expect(result.base).toEqual({ ref: 'base of chunk-deal', commit: started });
    expect(result.chunk).toBe('deal');
    expect(result.checks.map((c) => [c.name, c.passed])).toEqual([['test', true], ['typecheck', true]]);
    expect(check(result, 'test').counts).toEqual({ files: 1, tests: 1, passed: 1, failed: 0, skipped: 0 });
    expect(check(result, 'test').summary).toBe('1 test passed in 1 file the chunk added or changed.');
    await expect(signoff(dir)).resolves.toMatchObject({ basis: 'designer' });
  });

  it('opens no mutant cache, since it runs no mutation check', async () => {
    const dir = await gameOnBranch(false);
    // A linked package the cache cannot read makes opening the cache say so (#484).
    const dep = join(dirname(dir), 'dep');
    await write(dep, { 'index.js': 'export const rate = 2;\n', 'secret/x.js': 'export {};\n' });
    await fs.mkdir(join(dirname(dir), 'node_modules'));
    await fs.symlink(dep, join(dirname(dir), 'node_modules', 'dep'), 'dir');
    await fs.chmod(join(dep, 'secret'), 0o000);
    const lines: string[] = [];
    try {
      await runVerify({ projectDir: dir, chunk: 'deal', log: (l) => lines.push(l) });
    } finally {
      await fs.chmod(join(dep, 'secret'), 0o755);
    }
    expect(lines.filter((l) => /mutant cache/.test(l))).toEqual([]);
  });

  it('fails a test the chunk changed, saying it is the chunk\'s', async () => {
    const dir = await gameOnBranch(false);
    await write(dir, { 'tests/fee.test.ts': FEE_TEST.replace('toBe(6)', 'toBe(7)') });
    commitAll(dir, 'chunk-deal/wrong test');

    const { result } = await runVerify({ projectDir: dir, chunk: 'deal', log: () => {} });

    expect(result.passed).toBe(false);
    expect(check(result, 'test').summary).toBe('1 test failed in the chunk\'s tests, in a file you changed: tests/fee.test.ts.');
    await expect(signoff(dir)).rejects.toThrow(/test: 1 test failed in the chunk's tests/);
  });

  /** Commits a `combat` chunk that changes code and its CHUNK.md, with `manifestRow` its one Spec Manifest row, and no test. */
  async function chunkWithoutTests(dir: string, manifestRow: string): Promise<void> {
    await write(dir, {
      'src/rules.ts': `${await fs.readFile(join(dir, 'src', 'rules.ts'), 'utf-8')}export const tax = 1;\n`,
      'design/chunks/combat/CHUNK.md': `# combat\n\n## Spec Manifest\n\n| Test File | Claims Covered | RED Observed |\n|---|---|---|\n${manifestRow}\n`,
    });
    commitAll(dir, 'chunk-combat/build');
  }

  it('fails a chunk that added or changed no test file, rather than passing with nothing run', async () => {
    const dir = await gameOnBranch(false);
    await chunkWithoutTests(dir, '| tests/combat.test.ts | 1 | yes |');

    const { result } = await runVerify({ projectDir: dir, chunk: 'combat', log: () => {} });

    expect(result.passed).toBe(false);
    const test = check(result, 'test');
    expect(test.summary).toMatch(/^Chunk "combat" added or changed no test file since its base/);
    expect(test.next).toMatch(/boardsmith verify --chunk combat/);
  });

  // #1497: a plain vitest run never collects a sim (#1494), so a sim is not a test of the chunk's own.
  it('fails a chunk whose only new test file is a sim, which no fast check runs', async () => {
    const dir = await gameOnBranch(false);
    await write(dir, { 'tests/combat.sim.test.ts': FEE_TEST });
    await chunkWithoutTests(dir, '| tests/combat.test.ts | 1 | yes |');

    const { result } = await runVerify({ projectDir: dir, chunk: 'combat', log: () => {} });

    expect(check(result, 'test').summary).toMatch(/^Chunk "combat" added or changed no test file since its base/);
    expect(check(result, 'test').next).toMatch(/^tests\/combat\.sim\.test\.ts is a sim, which no fast check runs/);
  });

  // #995 ruling: spec writes a chunk's tests, so the steps before it (investigate, redteam, ask) need none of their own.
  it('passes a chunk with no test of its own while it has only reached the steps before spec, and fails it from spec on', async () => {
    const dir = await gameOnBranch(false);
    const chunkMd = '# combat\n\n## Claims\n\n1. A hit costs one health.\n\n## Spec Manifest\n\n| Test File | Claims Covered | RED Observed |\n|---|---|---|\n';
    await write(dir, { 'design/chunks/combat/CHUNK.md': chunkMd });
    commitAll(dir, 'chunk-combat/step-investigate');

    const steps: [string, boolean][] = [];
    for (const step of ['redteam', 'ask', 'spec', 'build']) {
      const { result } = await runVerify({ projectDir: dir, chunk: 'combat', log: () => {} });
      steps.push([git(dir, 'log', '-1', '--format=%s').trim(), check(result, 'test').passed]);
      if (step === 'redteam') {
        expect(check(result, 'test').summary).toBe(
          'No test ran: chunk "combat" has only reached the steps before spec (investigate, redteam, ask), and spec writes its tests.',
        );
      }
      await write(dir, { 'design/chunks/combat/CHUNK.md': `${chunkMd}\n<!-- ${step} -->\n` });
      commitAll(dir, `chunk-combat/step-${step}`);
    }
    const { result } = await runVerify({ projectDir: dir, chunk: 'combat', log: () => {} });
    steps.push([git(dir, 'log', '-1', '--format=%s').trim(), check(result, 'test').passed]);

    expect(steps).toEqual([
      ['chunk-combat/step-investigate', true],
      ['chunk-combat/step-redteam', true],
      ['chunk-combat/step-ask', true],
      ['chunk-combat/step-spec', false],
      ['chunk-combat/step-build', false],
    ]);
    expect(check(result, 'test').summary).toMatch(/^Chunk "combat" added or changed no test file since its base/);
    expect(check(result, 'test').next).toMatch(/Write the chunk's tests \(its spec step\).*boardsmith verify --chunk combat/);
  });

  // #1201: a step before spec writes only design files, so game code cannot arrive untested under its name.
  it('fails a chunk whose step before spec changed a file outside design/, naming the commit and file', async () => {
    const dir = await gameOnBranch(false);
    await write(dir, {
      'design/chunks/combat/CHUNK.md': '# combat\n',
      'src/rules.ts': `${await fs.readFile(join(dir, 'src', 'rules.ts'), 'utf-8')}export const tax = 1;\n`,
    });
    commitAll(dir, 'chunk-combat/step-investigate');
    const investigate = git(dir, 'rev-parse', 'HEAD').trim();

    const { result } = await runVerify({ projectDir: dir, chunk: 'combat', log: () => {} });

    expect(result.passed).toBe(false);
    expect(check(result, 'test').summary).toBe(
      `Chunk "combat" changed files outside design/ in a step before spec, which writes no game code: ` +
        `${investigate.slice(0, 10)} (chunk-combat/step-investigate) changed src/rules.ts.`,
    );
    expect(check(result, 'test').next).toMatch(/rewrite those commits, which are not pushed yet,.*a new commit on top, a revert included, does not clear this/);
  });

  it('keeps failing a chunk whose step before spec changed game code after later commits add passing tests, naming every such commit', async () => {
    const dir = await gameOnBranch(false);
    await write(dir, { 'design/chunks/combat/CHUNK.md': '# combat\n', 'src/rules.ts': `${await fs.readFile(join(dir, 'src', 'rules.ts'), 'utf-8')}export const tax = 1;\n` });
    commitAll(dir, 'chunk-combat/step-investigate');
    const investigate = git(dir, 'rev-parse', 'HEAD').trim();
    await write(dir, { 'src/extra.ts': 'export const extra = 2;\n' });
    commitAll(dir, 'chunk-combat/step-ask');
    const ask = git(dir, 'rev-parse', 'HEAD').trim();
    await write(dir, { 'tests/fee.test.ts': FEE_TEST });
    commitAll(dir, 'chunk-combat/step-spec');

    const { result } = await runVerify({ projectDir: dir, chunk: 'combat', log: () => {} });

    expect(result.passed).toBe(false);
    expect(check(result, 'test').summary).toBe(
      `Chunk "combat" changed files outside design/ in a step before spec, which writes no game code: ` +
        `${investigate.slice(0, 10)} (chunk-combat/step-investigate) changed src/rules.ts; ${ask.slice(0, 10)} (chunk-combat/step-ask) changed src/extra.ts.`,
    );
  });

  it('checks only the commits not yet pushed to a remote, wherever they were pushed, so pushed history is left alone (#1201)', async () => {
    const dir = await gameOnBranch(false);
    await write(dir, { 'src/rules.ts': `${await fs.readFile(join(dir, 'src', 'rules.ts'), 'utf-8')}export const tax = 1;\n` });
    commitAll(dir, 'chunk-combat/step-investigate');
    const origin = join(dirname(dir), 'origin.git');
    git(dirname(dir), 'init', '-q', '--bare', origin);
    git(dir, 'remote', 'add', 'origin', origin);
    git(dir, 'push', '-q', 'origin', 'chunk/deal');
    await write(dir, { 'design/chunks/combat/CHUNK.md': '# combat\n' });
    commitAll(dir, 'chunk-combat/step-redteam');

    const pushed = await runVerify({ projectDir: dir, chunk: 'combat', log: () => {} });
    expect(check(pushed.result, 'test').summary).toMatch(/^No test ran: chunk "combat" has only reached the steps before spec/);

    await write(dir, { 'src/extra.ts': 'export const extra = 2;\n' });
    const ask = commitAll(dir, 'chunk-combat/step-ask');
    const unpushed = await runVerify({ projectDir: dir, chunk: 'combat', log: () => {} });
    expect(check(unpushed.result, 'test').summary).toBe(
      `Chunk "combat" changed files outside design/ in a step before spec, which writes no game code: ${ask.slice(0, 10)} (chunk-combat/step-ask) changed src/extra.ts.`,
    );
  });

  it('reads a step before spec that is a merge commit by what the merge itself changed (#1201)', async () => {
    const dir = await gameOnBranch(false);
    git(dir, 'checkout', '-q', '-b', 'side');
    await write(dir, { 'design/notes.md': 'notes\n' });
    commitAll(dir, 'notes');
    git(dir, 'checkout', '-q', 'chunk/deal');
    git(dir, 'merge', '-q', '--no-ff', '--no-commit', 'side');
    await write(dir, { 'src/extra.ts': 'export const extra = 2;\n' });
    const merge = commitAll(dir, 'chunk-combat/step-investigate');

    const { result } = await runVerify({ projectDir: dir, chunk: 'combat', log: () => {} });

    expect(check(result, 'test').summary).toBe(
      `Chunk "combat" changed files outside design/ in a step before spec, which writes no game code: ${merge.slice(0, 10)} (chunk-combat/step-investigate) changed src/extra.ts.`,
    );
  });

  it('passes a step before spec that wrote a design file whose name git would quote (#1201)', async () => {
    const dir = await gameOnBranch(false);
    await write(dir, { 'design/notes "draft".md': 'notes\n' });
    commitAll(dir, 'chunk-combat/step-investigate');

    const { result } = await runVerify({ projectDir: dir, chunk: 'combat', log: () => {} });

    expect(check(result, 'test').summary).toMatch(/^No test ran: chunk "combat" has only reached the steps before spec/);
  });

  it('fails a step before spec that changed game code even when the suite cannot run (#1201)', async () => {
    const dir = await gameOnBranch(false);
    await fs.rm(join(dir, 'tests'), { recursive: true });
    commitAll(dir, 'drop the tests');
    await write(dir, { 'src/extra.ts': 'export const extra = 2;\n' });
    const investigate = commitAll(dir, 'chunk-combat/step-investigate');

    const { result } = await runVerify({ projectDir: dir, chunk: 'combat', log: () => {} });

    expect(check(result, 'test').summary).toBe(
      `Chunk "combat" changed files outside design/ in a step before spec, which writes no game code: ${investigate.slice(0, 10)} (chunk-combat/step-investigate) changed src/extra.ts.`,
    );
  });

  it('passes an exempt chunk with no test of its own on typecheck alone, saying no test ran and why', async () => {
    const dir = await gameOnBranch(false);
    await chunkWithoutTests(dir, '| exempt | a restyle, no rules change | n/a |');

    const { result } = await runVerify({ projectDir: dir, chunk: 'combat', log: () => {} });

    expect(result.passed).toBe(true);
    expect(result.checks.map((c) => [c.name, c.passed])).toEqual([['test', true], ['typecheck', true]]);
    expect(check(result, 'test').summary).toBe(
      'No test ran: chunk "combat" added or changed no test file, and its Spec Manifest marks it exempt ("a restyle, no rules change"), so typecheck alone is its fast check.',
    );
  });

  it.each([
    ['with no reason', '| exempt |  | n/a |', /exempt row gives no reason/],
    ['beside a test file row', '| exempt | a restyle | n/a |\n| tests/combat.test.ts | 1 | yes |', /exempt but also lists tests\/combat\.test\.ts/],
  ])('refuses a chunk with no test of its own whose exempt row is %s', async (_, rows, message) => {
    const dir = await gameOnBranch(false);
    await chunkWithoutTests(dir, rows);

    const { result } = await runVerify({ projectDir: dir, chunk: 'combat', log: () => {} });

    expect(result.passed).toBe(false);
    expect(check(result, 'test').summary).toMatch(message);
  });

  it('refuses a chunk whose CHUNK.md it cannot read, rather than asking for its tests', async () => {
    const dir = await gameOnBranch(false);
    await chunkWithoutTests(dir, '| exempt | a restyle, no rules change | n/a |');
    const chunkMd = join(dir, 'design', 'chunks', 'combat', 'CHUNK.md');
    await fs.rm(chunkMd);
    await fs.symlink('CHUNK.md', chunkMd);
    commitAll(dir, 'chunk-combat/a CHUNK.md that links to itself');

    const { result } = await runVerify({ projectDir: dir, chunk: 'combat', log: () => {} });

    expect(result.passed).toBe(false);
    expect(check(result, 'test').summary).toContain(`Could not read ${chunkMd} (ELOOP)`);
  });

  it('a full result satisfies no chunk gate, and the chunk\'s fast checks satisfy only its own', async () => {
    const dir = await gameOnBranch(false);
    const { result } = await runVerify({ projectDir: dir, base: 'main', checks: CHECKS, log: () => {} });
    expect(result.passed).toBe(true);
    expect(result.chunk).toBeNull();
    await expect(signoff(dir)).rejects.toThrow(/not made for chunk "deal".*Run `boardsmith verify --chunk deal`/s);

    const refused = await spawnCli(['verify', '--check', '--chunk', 'deal', '--project', dir]);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toMatch(/not made for chunk "deal".*Run `boardsmith verify --chunk deal`/s);

    await runVerify({ projectDir: dir, chunk: 'deal', log: () => {} });
    const accepted = await spawnCli(['verify', '--check', '--chunk', 'deal', '--project', dir]);
    expect(accepted.stderr).toBe('');
    expect(accepted.code).toBe(0);
    expect(accepted.stdout).toMatch(/passed `boardsmith verify --chunk deal` \(the chunk's tests and typecheck\) on a clean tree/);

    const full = await spawnCli(['verify', '--check', '--project', dir]);
    expect(full.code).toBe(1);
    expect(full.stderr).toMatch(/fast checks.*not the full verify/s);
  });

  it('refuses a chunk with no commit yet, saying how to name one, and refuses --chunk together with --base', async () => {
    const dir = await gameOnBranch(false);
    await expect(runVerify({ projectDir: dir, chunk: 'combat', log: () => {} })).rejects.toThrow(
      /No commit for chunk "combat" yet.*chunk-combat\/step-<name>/s,
    );
    await expect(runVerify({ projectDir: dir, chunk: 'deal', base: 'main', log: () => {} })).rejects.toThrow(
      /--chunk deal.*--base does not apply/s,
    );
    const both = await spawnCli(['verify', '--chunk', 'deal', '--base', 'main', '--project', dir]);
    expect(both.code).toBe(1);
    expect(both.stderr).toMatch(/--base does not apply/);
  });
});
