import { describe, it, expect, vi } from 'vitest';
import { describeAudienceMismatch, resolveTarget, PublishTargetError } from './publish.js';
import { getPlatformUrl, type TaxonomyAudience } from '../lib/publish-api.js';
import { spawnCli } from '../spawn-cli.test-helper.js';

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
