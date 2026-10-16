import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  describeAudienceMismatch,
  resolveTarget,
  PublishTargetError,
  savedPlatformIds,
  recordPlatformIds,
  staleIdsHint,
  abortInFlightPublish,
  publishCommand,
} from './publish.js';
import {
  getPlatformUrl,
  type TaxonomyAudience,
  abortPublish,
  checkVersionAvailable,
  completePublish,
  fetchTaxonomy,
  initiatePublish,
  uploadBundle,
} from '../lib/publish-api.js';
import { validateBundleSize, validateCommand } from './validate.js';
import type * as PublishApi from '../lib/publish-api.js';
import type * as Validate from './validate.js';
import { spawnCli } from '../spawn-cli.test-helper.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { publishGate, recordPublished } from '../lib/publish-gate.js';
import { VERIFY_CHECK_NAMES, buildVerifyResult, verifyResultPath, writeVerifyResult, type VerifyCheckResult } from '../lib/verify-result.js';
import { commitAll, git, initRepo, writeFiles } from '../lib/verify-result.test-helper.js';

// A spawn can exceed vitest's 5s default under full-suite parallelism; see
// spawn-cli.test-helper.ts. This is a hang guard, not a performance budget.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// publishCommand's tests answer for the platform; every other test here gets the real calls.
vi.mock('../lib/publish-api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof PublishApi>();
  return {
    ...actual,
    checkVersionAvailable: vi.fn(actual.checkVersionAvailable),
    fetchTaxonomy: vi.fn(actual.fetchTaxonomy),
    initiatePublish: vi.fn(actual.initiatePublish),
    uploadBundle: vi.fn(actual.uploadBundle),
    completePublish: vi.fn(actual.completePublish),
    abortPublish: vi.fn(actual.abortPublish),
  };
});
vi.mock('./validate.js', async (importOriginal) => {
  const actual = await importOriginal<typeof Validate>();
  return { ...actual, validateCommand: vi.fn(actual.validateCommand), validateBundleSize: vi.fn(actual.validateBundleSize) };
});
vi.mock('./build.js', () => ({
  buildCommand: vi.fn(async () => {
    mkdirSync(join(process.cwd(), 'dist', 'rules'), { recursive: true });
    writeFileSync(join(process.cwd(), 'dist', 'manifest.json'), JSON.stringify({ backend: 'table', audience: 'casual', playerCount: { min: 2, max: 2 } }));
    writeFileSync(join(process.cwd(), 'dist', 'rules', 'rules.js'), 'export {};\n');
    mkdirSync(join(process.cwd(), 'dist', 'ui'), { recursive: true });
    writeFileSync(join(process.cwd(), 'dist', 'ui', 'index.html'), '<!doctype html>\n');
  }),
}));
vi.mock('../lib/config.js', async (importOriginal) => ({ ...(await importOriginal<object>()), getApiKey: () => 'spk_test' }));

const AUDIENCES: TaxonomyAudience[] = [
  { value: 'strategy', label: 'Strategy', helperText: 'For dedicated gamers', litmus: 'l1' },
  { value: 'casual', label: 'Casual', helperText: 'For anyone', litmus: 'l2' },
  { value: 'party', label: 'Party', helperText: 'For groups', litmus: 'l3' },
];

describe('describeAudienceMismatch (publish preflight)', () => {
  it('returns null for a valid audience', () => {
    expect(describeAudienceMismatch('casual', AUDIENCES)).toBeNull();
  });

  it('names the invalid value and lists every valid audience with its helper text', () => {
    const lines = describeAudienceMismatch('familly', AUDIENCES);
    expect(lines).not.toBeNull();
    const joined = lines!.join('\n');
    expect(joined).toContain('"familly"');
    for (const a of AUDIENCES) {
      expect(joined).toContain(a.value);
      expect(joined).toContain(a.helperText);
    }
  });

  it('reports a missing audience (undefined) rather than crashing', () => {
    const lines = describeAudienceMismatch(undefined, AUDIENCES);
    expect(lines).not.toBeNull();
    expect(lines![0]).toContain('missing');
  });
});

describe('resolveTarget (#36: production is never the zero-effort default)', () => {
  it('requires an explicit target rather than shipping to production', () => {
    // `boardsmith publish` used to mean "deploy to production, no questions
    // asked", so one forgotten flag while iterating put a work-in-progress
    // build in front of players.
    expect(() => resolveTarget({})).toThrow(PublishTargetError);
    expect(() => resolveTarget({})).toThrow(/--prod/);
    expect(() => resolveTarget({})).toThrow(/--dev/);
  });

  it('does not offer the retired test platform (#264)', () => {
    // test.shufflewick.pub was removed on 2026-08-24. A flag that names a
    // platform which no longer exists sits one character from --prod.
    expect(() => resolveTarget({})).not.toThrow(/--test/);
    expect(() => resolveTarget({})).not.toThrow(/test\.shufflewick\.pub/);
  });

  it('resolves each target from its own flag', () => {
    expect(resolveTarget({ dev: true })).toBe('dev');
    expect(resolveTarget({ prod: true })).toBe('prod');
  });

  it('refuses two targets at once rather than picking one', () => {
    expect(() => resolveTarget({ dev: true, prod: true })).toThrow(PublishTargetError);
  });

  it('names every flag that was passed, so the fix is obvious', () => {
    expect(() => resolveTarget({ dev: true, prod: true })).toThrow(/--dev/);
    expect(() => resolveTarget({ dev: true, prod: true })).toThrow(/--prod/);
  });
});

describe('platform URLs', () => {
  it('keeps the two surviving platforms pointed where they were', () => {
    expect(getPlatformUrl('dev')).toBe('http://localhost:3006');
    expect(getPlatformUrl('prod')).toBe('https://shufflewick.pub');
  });
});

describe('publish --help (what the real CLI registers)', () => {
  it('offers --dev and --prod and nothing else to name a platform', async () => {
    const result = await spawnCli(['publish', '--help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('--dev');
    expect(result.stdout).toContain('--prod');
    expect(result.stdout).not.toContain('--test');
    expect(result.stdout).not.toContain('test.shufflewick.pub');
  });
});

describe('per-platform ids (#704: dev and prod are separate deployments with separate ids)', () => {
  const bothPlatforms = () => ({
    name: 'x',
    platforms: {
      dev: { gameId: 'dev-game', publisherId: 'dev-pub' },
      prod: { gameId: 'prod-game', publisherId: 'prod-pub' },
    },
  });

  it('reads only the target platform\'s ids', () => {
    expect(savedPlatformIds(bothPlatforms(), 'prod')).toEqual({ gameId: 'prod-game', publisherId: 'prod-pub' });
    expect(savedPlatformIds(bothPlatforms(), 'dev')).toEqual({ gameId: 'dev-game', publisherId: 'dev-pub' });
  });

  it('has no ids for a platform never published to, whatever the other platform holds', () => {
    const config = { name: 'x', platforms: { dev: { gameId: 'dev-game', publisherId: 'dev-pub' } } };
    expect(savedPlatformIds(config, 'prod')).toEqual({});
    expect(savedPlatformIds({ name: 'x' }, 'dev')).toEqual({});
  });

  it('refuses the old top-level ids, saying where they go and what to do when unsure', () => {
    for (const old of [{ gameId: 'g' }, { publisherId: 'p' }]) {
      let message = '';
      try {
        savedPlatformIds({ name: 'x', ...old }, 'prod');
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toContain(Object.keys(old)[0]);
      expect(message).toContain('platforms.dev');
      expect(message).toContain('platforms.prod');
      expect(message).toMatch(/delete it and publish again/);
    }
  });

  it('a prod publish writes platforms.prod and leaves platforms.dev exactly as it was', () => {
    const config = bothPlatforms();
    const devBefore = structuredClone(config.platforms.dev);
    expect(recordPlatformIds(config, 'prod', { gameId: 'new-prod-game', publisherId: 'new-prod-pub' })).toBe(true);
    expect(config.platforms.prod).toEqual({ gameId: 'new-prod-game', publisherId: 'new-prod-pub' });
    expect(config.platforms.dev).toEqual(devBefore);
  });

  it('a dev publish writes platforms.dev and leaves platforms.prod exactly as it was', () => {
    const config = bothPlatforms();
    const prodBefore = structuredClone(config.platforms.prod);
    expect(recordPlatformIds(config, 'dev', { gameId: 'new-dev-game', publisherId: 'new-dev-pub' })).toBe(true);
    expect(config.platforms.dev).toEqual({ gameId: 'new-dev-game', publisherId: 'new-dev-pub' });
    expect(config.platforms.prod).toEqual(prodBefore);
  });

  it('a first publish to a platform creates its block, and an unchanged republish writes nothing', () => {
    const config: Record<string, unknown> = { name: 'x' };
    expect(recordPlatformIds(config, 'prod', { gameId: 'g', publisherId: 'p' })).toBe(true);
    expect(config.platforms).toEqual({ prod: { gameId: 'g', publisherId: 'p' } });
    expect(recordPlatformIds(config, 'prod', { gameId: 'g', publisherId: 'p' })).toBe(false);
  });

  it('a stale-id hint names only the target platform\'s block', () => {
    const dev = staleIdsHint('dev');
    expect(dev).toContain('"platforms.dev"');
    expect(dev).toContain('--dev --publisher');
    expect(dev).not.toContain('platforms.prod');
    expect(staleIdsHint('prod')).toContain('"platforms.prod"');
    expect(staleIdsHint('prod')).not.toContain('platforms.dev');
  });

  it('the real CLI refuses old top-level ids before any key or network, and leaves boardsmith.json alone', async () => {
    const dir = tempTree('bs704-');
    const configText = JSON.stringify({ name: 'x', gameId: 'g', publisherId: 'p' }, null, 2) + '\n';
    writeFileSync(join(dir, 'boardsmith.json'), configText);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }));

    const result = await spawnCli(['publish', '--prod'], dir);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('platforms.prod');
    expect(result.stderr).not.toMatch(/API key/);
    expect(readFileSync(join(dir, 'boardsmith.json'), 'utf-8')).toBe(configText);
  });
});

describe('abortInFlightPublish (#745: a refused abort is reported, not silent)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([401, 500])('prints the could-not-clean-up note on HTTP %i', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status })));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    await abortInFlightPublish('https://platform.example', 'key', 'version-id');

    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('Could not clean up'));
  });

  it('prints nothing when the abort succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    await abortInFlightPublish('https://platform.example', 'key', 'version-id');

    expect(errorLog).not.toHaveBeenCalled();
  });
});

describe('publish requires a full, passing boardsmith verify for the commit on a clean tree (#984)', () => {
  /** A game with two commits: the repository's first, and work on top of it. */
  async function game(): Promise<{ dir: string; first: string; head: string }> {
    const dir = join(tempTree('bs984-'), 'game');
    await writeFiles(dir, {
      '.gitignore': '.boardsmith/\n',
      'boardsmith.json': JSON.stringify({ name: 'x' }),
      'package.json': JSON.stringify({ name: 'x', version: '1.0.0' }),
      'index.html': '<!doctype html>\n',
      'src/rules.ts': 'export const x = 1;\n',
    });
    initRepo(dir);
    const first = commitAll(dir, 'first');
    writeFileSync(join(dir, 'src/rules.ts'), 'export const x = 2;\n');
    return { dir, first, head: commitAll(dir, 'work') };
  }

  const passed = (name: VerifyCheckResult['name']): VerifyCheckResult => ({ name, passed: true, summary: `${name} passed` });

  async function verified(
    dir: string,
    commit: string,
    base: string,
    overrides: { cleanTree?: boolean; checks?: VerifyCheckResult[] } = {},
  ): Promise<void> {
    await writeVerifyResult(dir, buildVerifyResult({
      commit,
      cleanTree: overrides.cleanTree ?? true,
      base: { ref: base, commit: base },
      checks: overrides.checks ?? VERIFY_CHECK_NAMES.map(passed),
    }));
  }

  const problemOf = async (dir: string) => {
    const gate = await publishGate(dir);
    return 'problem' in gate ? gate.problem : undefined;
  };

  it('refuses a commit with no result, naming the verify to run from the first commit', async () => {
    const { dir, first, head } = await game();
    const problem = await problemOf(dir);
    expect(problem).toContain(`No \`boardsmith verify\` result for the current commit (${head.slice(0, 12)})`);
    expect(problem).toContain(`boardsmith verify --base ${first}`);
    expect(problem).not.toMatch(/Commit your work/);
  });

  it('refuses uncommitted and untracked changes, saying to commit first', async () => {
    const { dir, first, head } = await game();
    await verified(dir, head, first);
    writeFileSync(join(dir, 'src/rules.ts'), 'export const x = 3;\n');
    expect(await problemOf(dir)).toMatch(/uncommitted changes.*Commit your work/s);
    git(dir, 'checkout', '--', 'src/rules.ts');
    writeFileSync(join(dir, 'src/new.ts'), '');
    expect(await problemOf(dir)).toMatch(/uncommitted changes.*Commit your work/s);
  });

  it('refuses a chunk\'s fast checks from `verify --chunk` (#985)', async () => {
    const { dir, first, head } = await game();
    await writeVerifyResult(dir, buildVerifyResult({
      commit: head,
      cleanTree: true,
      base: { ref: 'base of chunk-deal', commit: first },
      chunk: 'deal',
      checks: [passed('test'), passed('typecheck')],
    }));
    const problem = await problemOf(dir);
    expect(problem).toMatch(/chunk "deal"'s fast checks.*not the full verify/s);
    expect(problem).toContain(`boardsmith verify --base ${first}`);
  });

  it('refuses a failed result, and a result made on a dirty tree', async () => {
    const { dir, first, head } = await game();
    await verified(dir, head, first, {
      checks: VERIFY_CHECK_NAMES.map((name): VerifyCheckResult => (name === 'mutation' ? { name, passed: false, summary: 'a mutant survived' } : passed(name))),
    });
    let problem = await problemOf(dir);
    expect(problem).toMatch(/did not pass/);
    expect(problem).toContain(`boardsmith verify --base ${first}`);

    await verified(dir, head, first, { cleanTree: false });
    problem = await problemOf(dir);
    expect(problem).toMatch(/uncommitted changes/);
    expect(problem).toContain(`boardsmith verify --base ${first}`);
  });

  it('refuses a result with a skipped check', async () => {
    const { dir, first, head } = await game();
    await verified(dir, head, first, {
      checks: VERIFY_CHECK_NAMES.map((name) =>
        name === 'smoke' ? { name, passed: true, skipped: true, summary: 'no UI yet' } : passed(name)),
    });
    const problem = await problemOf(dir);
    expect(problem).toMatch(/skipped its smoke check/);
    expect(problem).toContain(`boardsmith verify --base ${first}`);
  });

  it('refuses a result whose base measured nothing, or started after the required base', async () => {
    const { dir, first, head } = await game();
    await verified(dir, head, head);
    let problem = await problemOf(dir);
    expect(problem).toMatch(/measured no change/);
    expect(problem).toContain(`boardsmith verify --base ${first}`);

    writeFileSync(join(dir, 'src/rules.ts'), 'export const x = 4;\n');
    const later = commitAll(dir, 'more');
    await verified(dir, later, head);
    problem = await problemOf(dir);
    expect(problem).toMatch(/does not cover everything since the repository's first commit/);
    expect(problem).toContain(`boardsmith verify --base ${first}`);
  });

  it('accepts a passing full result measured from the first commit, on a clean tree', async () => {
    const { dir, first, head } = await game();
    await verified(dir, head, first);
    expect(await publishGate(dir)).toEqual({ commit: head, base: first });
  });

  it('after a publish, measures the next one from the published commit', async () => {
    const { dir, first, head } = await game();
    await recordPublished(dir, { commit: head, base: first });
    writeFileSync(join(dir, 'src/rules.ts'), 'export const x = 5;\n');
    const next = commitAll(dir, 'next');
    expect(await problemOf(dir)).toContain(`boardsmith verify --base ${head}`);
    await verified(dir, next, head);
    expect(await publishGate(dir)).toEqual({ commit: next, base: head });
  });

  it('republishing the published commit requires the coverage it was published with, not --base HEAD', async () => {
    const { dir, first, head } = await game();
    await verified(dir, head, first);
    await recordPublished(dir, { commit: head, base: first });
    expect(await publishGate(dir)).toEqual({ commit: head, base: first });
    await verified(dir, head, head);
    expect(await problemOf(dir)).toContain(`boardsmith verify --base ${first}`);
  });

  /** The chain first, a, b, c, with c checked out. */
  async function chain(): Promise<{ dir: string; first: string; a: string; b: string; c: string }> {
    const { dir, first, head: a } = await game();
    writeFileSync(join(dir, 'src/rules.ts'), 'export const x = 6;\n');
    const b = commitAll(dir, 'b');
    writeFileSync(join(dir, 'src/rules.ts'), 'export const x = 7;\n');
    return { dir, first, a, b, c: commitAll(dir, 'c') };
  }

  it('an older commit past the published commit\'s base is measured from that base', async () => {
    const { dir, a, b, c } = await chain();
    await recordPublished(dir, { commit: c, base: a });
    git(dir, 'checkout', '-q', b);
    expect(await problemOf(dir)).toContain(`boardsmith verify --base ${a}`);
    await verified(dir, b, a);
    expect(await publishGate(dir)).toEqual({ commit: b, base: a });
  });

  it('an older commit that is the published commit\'s base is measured from the first commit, not from itself', async () => {
    const { dir, first, b, c } = await chain();
    await recordPublished(dir, { commit: c, base: b });
    git(dir, 'checkout', '-q', b);
    const problem = await problemOf(dir);
    expect(problem).toContain(`boardsmith verify --base ${first}`);
    expect(problem).not.toContain(`--base ${b}`);
  });

  it('after history was rewritten, measures from where it left the published commit', async () => {
    const { dir, a, c } = await chain();
    await recordPublished(dir, { commit: c, base: a });
    git(dir, 'checkout', '-q', '-b', 'rewritten', a);
    writeFileSync(join(dir, 'src/rules.ts'), 'export const x = 8;\n');
    commitAll(dir, 'rewritten');
    expect(await problemOf(dir)).toContain(`boardsmith verify --base ${a}`);
  });

  it('refuses when the published commit is not in this repository, saying what to do', async () => {
    const { dir, first } = await game();
    await recordPublished(dir, { commit: 'f'.repeat(40), base: first });
    expect(await problemOf(dir)).toMatch(/published\.json does not hold a commit of this repository.*Delete it/s);
    const head = git(dir, 'rev-parse', 'HEAD').trim();
    for (const record of [
      'not json',
      'null',
      JSON.stringify({ commit: first }),
      JSON.stringify({ commit: head, base: head }),
      JSON.stringify({ commit: first, base: 'nope' }),
    ]) {
      writeFileSync(join(dir, '.boardsmith', 'published.json'), record);
      expect(await problemOf(dir)).toMatch(/published\.json does not hold a commit of this repository/);
    }
  });

  it('refuses a repository whose only commit is the one being published: there is nothing to measure', async () => {
    const dir = join(tempTree('bs984-'), 'game');
    await writeFiles(dir, { '.gitignore': '.boardsmith/\n', 'src/rules.ts': 'export const x = 1;\n' });
    initRepo(dir);
    commitAll(dir, 'only');
    expect(await problemOf(dir)).toMatch(/is this repository's first commit/);
  });

  it('the real CLI refuses before any API key lookup', async () => {
    const { dir, first } = await game();
    const result = await spawnCli(['publish', '--prod'], dir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`boardsmith verify --base ${first}`);
    expect(result.stdout + result.stderr).not.toMatch(/API key/);
  });
});

describe('publishCommand records the published commit only once the publish completes (#984)', () => {
  afterEach(() => {
    // Back to the real calls, dropping any answer a test queued and did not use.
    for (const mock of [validateCommand, validateBundleSize, checkVersionAvailable, fetchTaxonomy, initiatePublish, uploadBundle, completePublish, abortPublish]) {
      vi.mocked(mock).mockRestore();
    }
    vi.restoreAllMocks();
  });

  async function verifiedGame(): Promise<{ dir: string; first: string; head: string }> {
    const dir = join(tempTree('bs984-cmd-'), 'game');
    await writeFiles(dir, {
      '.gitignore': '.boardsmith/\ndist/\n',
      'boardsmith.json': JSON.stringify({ name: 'x' }),
      'package.json': JSON.stringify({ name: 'x', version: '1.0.0' }),
      'index.html': '<!doctype html>\n',
      'src/rules.ts': 'export const x = 1;\n',
    });
    initRepo(dir);
    const first = commitAll(dir, 'first');
    writeFileSync(join(dir, 'src/rules.ts'), 'export const x = 2;\n');
    const head = commitAll(dir, 'work');
    await writeVerifyResult(dir, buildVerifyResult({
      commit: head,
      cleanTree: true,
      base: { ref: first, commit: first },
      checks: VERIFY_CHECK_NAMES.map((name) => ({ name, passed: true, summary: `${name} passed` })),
    }));
    return { dir, first, head };
  }

  async function publishFrom(dir: string): Promise<void> {
    vi.spyOn(process, 'cwd').mockReturnValue(dir);
    const errors: string[] = [];
    vi.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`process.exit(${code}): ${errors.join(' ')}`); });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args.join(' ')); });
    vi.mocked(validateCommand).mockResolvedValueOnce();
    vi.mocked(validateBundleSize).mockResolvedValueOnce({ name: 'size', passed: true, message: 'ok' });
    vi.mocked(checkVersionAvailable).mockResolvedValueOnce();
    vi.mocked(fetchTaxonomy).mockResolvedValueOnce({ audiences: AUDIENCES });
    vi.mocked(initiatePublish).mockResolvedValueOnce({ versionId: 'v', gameId: 'g', publisherId: 'p', uploadUrl: 'u', uploadCode: 'c' });
    vi.mocked(abortPublish).mockResolvedValueOnce();
    await publishCommand({ prod: true, publisher: 'pub' });
  }

  const record = (dir: string) => join(dir, '.boardsmith', 'published.json');

  it('a completed publish writes the commit and the base its result measured', async () => {
    const { dir, first, head } = await verifiedGame();
    vi.mocked(uploadBundle).mockResolvedValueOnce();
    vi.mocked(completePublish).mockResolvedValueOnce({ gameUrl: 'https://example.test/x' });
    await publishFrom(dir);
    expect(JSON.parse(readFileSync(record(dir), 'utf-8'))).toEqual({ commit: head, base: first });
  });

  it.each([
    ['upload', () => vi.mocked(uploadBundle).mockRejectedValueOnce(new Error('upload broke'))],
    ['finalize', () => {
      vi.mocked(uploadBundle).mockResolvedValueOnce();
      vi.mocked(completePublish).mockRejectedValueOnce(new Error('finalize broke'));
    }],
  ])('a failed %s leaves no record', async (_stage, fail) => {
    const { dir } = await verifiedGame();
    fail();
    await expect(publishFrom(dir)).rejects.toThrow('process.exit(1)');
    expect(existsSync(record(dir))).toBe(false);
  });
});
