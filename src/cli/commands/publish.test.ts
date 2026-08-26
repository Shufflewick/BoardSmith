import { describe, it, expect } from 'vitest';
import { describeAudienceMismatch, resolveTarget, PublishTargetError } from './publish.js';
import type { TaxonomyAudience } from '../lib/publish-api.js';

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
    // asked", so one forgotten flag while iterating against test put a
    // work-in-progress build in front of players.
    expect(() => resolveTarget({})).toThrow(PublishTargetError);
    expect(() => resolveTarget({})).toThrow(/--prod/);
    expect(() => resolveTarget({})).toThrow(/--test/);
    expect(() => resolveTarget({})).toThrow(/--dev/);
  });

  it('resolves each target from its own flag', () => {
    expect(resolveTarget({ dev: true })).toBe('dev');
    expect(resolveTarget({ test: true })).toBe('test');
    expect(resolveTarget({ prod: true })).toBe('prod');
  });

  it('refuses two targets at once rather than picking one', () => {
    expect(() => resolveTarget({ dev: true, test: true })).toThrow(PublishTargetError);
    expect(() => resolveTarget({ test: true, prod: true })).toThrow(PublishTargetError);
    expect(() => resolveTarget({ dev: true, prod: true })).toThrow(PublishTargetError);
  });

  it('names every flag that was passed, so the fix is obvious', () => {
    expect(() => resolveTarget({ dev: true, prod: true })).toThrow(/--dev/);
    expect(() => resolveTarget({ dev: true, prod: true })).toThrow(/--prod/);
  });
});
