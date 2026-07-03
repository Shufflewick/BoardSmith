import { describe, it, expect } from 'vitest';
import {
  ALLOWED_TOP_LEVEL_KEYS,
  suggestKey,
  findUnknownKeys,
} from '../lib/config-schema.js';
import { checkMetadataIssues } from './validate.js';
import { MAX_BUNDLE_SIZE } from '../lib/bundle-limits.js';

describe('config-schema', () => {
  it('ALLOWED_TOP_LEVEL_KEYS matches boardsmith.schema.json properties (single source, no drift)', async () => {
    const schema = (await import('../lib/boardsmith.schema.json')).default as {
      properties: Record<string, unknown>;
    };
    expect([...ALLOWED_TOP_LEVEL_KEYS].sort()).toEqual(Object.keys(schema.properties).sort());
  });

  it('suggestKey maps a near-miss typo to the correct allowed key', () => {
    expect(suggestKey('gameOption')).toBe('gameOptions');
    expect(suggestKey('playerOption')).toBe('playerOptions');
    expect(suggestKey('colorPallete')).toBe('colorPalette');
  });

  it('suggestKey returns undefined for a string far from any allowed key', () => {
    expect(suggestKey('completelyUnrelatedXyz')).toBeUndefined();
  });

  it('findUnknownKeys reports only the unknown key, with a suggestion when close enough', () => {
    const result = findUnknownKeys({ name: 'x', gameOption: {} });
    expect(result).toEqual([{ key: 'gameOption', suggestion: 'gameOptions' }]);
  });

  it('findUnknownKeys ignores every valid key and returns nothing for a fully valid config', () => {
    const result = findUnknownKeys({
      name: 'x',
      displayName: 'X',
      description: 'desc',
      gameOptions: [],
      playerOptions: [],
      colorPalette: [],
      paths: { rules: 'src/rules' },
      gameId: 'abc123',
      version: '1.0.0',
      ui: 'auto',
    });
    expect(result).toEqual([]);
  });

  it('findUnknownKeys reports an unknown key with no suggestion when nothing is close', () => {
    const result = findUnknownKeys({ name: 'x', completelyUnrelatedXyz: true });
    expect(result).toEqual([{ key: 'completelyUnrelatedXyz' }]);
  });
});

describe('validate.ts checkMetadataIssues', () => {
  it('fails on an unknown top-level key and names a suggestion', () => {
    const issues = checkMetadataIssues({
      name: 'x',
      displayName: 'X',
      description: 'desc',
      gameOption: {},
    });
    expect(issues.some((i) => i.includes('gameOption') && i.includes('gameOptions'))).toBe(true);
  });

  it('fails on a leftover playerCount key with a pointed migration message', () => {
    const issues = checkMetadataIssues({
      name: 'x',
      displayName: 'X',
      description: 'desc',
      playerCount: { min: 2, max: 4 },
    });
    expect(
      issues.some((i) => i.includes('playerCount') && i.toLowerCase().includes('gamedefinition')),
    ).toBe(true);
  });

  it('does not require playerCount as a top-level key', () => {
    const issues = checkMetadataIssues({
      name: 'x',
      displayName: 'X',
      description: 'desc',
    });
    expect(issues.some((i) => i.includes('Missing required field: playerCount'))).toBe(false);
  });

  it('PROC-02: pre-fix validate silently PASSES a config carrying an unknown key / playerCount — the new check must flip it to FAIL', () => {
    const issues = checkMetadataIssues({
      name: 'x',
      displayName: 'X',
      description: 'desc',
      gameOption: {},
      playerCount: { min: 2, max: 4 },
    });
    expect(issues.length).toBeGreaterThan(0);
  });

  it('passes a fully valid config with no unknown keys and no playerCount', () => {
    const issues = checkMetadataIssues({
      name: 'x',
      displayName: 'X',
      description: 'desc',
      ui: 'auto',
      gameOptions: [],
    });
    expect(issues).toEqual([]);
  });
});

describe('bundle-limits', () => {
  it('MAX_BUNDLE_SIZE is 50MB, matching the authoritative games-worker upload gate', () => {
    // PROC-02: RED against the pre-fix local `maxTotalBundle = 200 * 1024 *
    // 1024` in validate.ts — this asserts the shared, correct constant.
    expect(MAX_BUNDLE_SIZE).toBe(50 * 1024 * 1024);
  });
});
