import { describe, it, expect } from 'vitest';
import { describeAudienceMismatch } from './publish.js';
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
