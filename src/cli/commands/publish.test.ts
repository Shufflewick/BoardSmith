import { readFileSync, writeFileSync } from 'node:fs';
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
} from './publish.js';
import { getPlatformUrl, type TaxonomyAudience } from '../lib/publish-api.js';
import { spawnCli } from '../spawn-cli.test-helper.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

// A spawn can exceed vitest's 5s default under full-suite parallelism; see
// spawn-cli.test-helper.ts. This is a hang guard, not a performance budget.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

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
