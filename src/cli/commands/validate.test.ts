import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  ALLOWED_TOP_LEVEL_KEYS,
  suggestKey,
  findUnknownKeys,
} from '../lib/config-schema.js';
import { checkMetadataIssues, validateBundleSize } from './validate.js';
import { MAX_BUNDLE_SIZE, describeZipSizeViolation } from '../lib/bundle-limits.js';

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

  it('accepts the editor $schema key — the shipped boardsmith.schema.json is consumed via exactly this key (CR-02 regression)', () => {
    // Every game in ~/BoardSmithGames carries $schema; rejecting it would make
    // validate hard-fail all of them while this repo simultaneously ships a
    // schema with a public $id that editors can only reference through $schema.
    const result = findUnknownKeys({
      $schema: 'https://boardsmith.io/schemas/boardsmith.schema.json',
      name: 'x',
      displayName: 'X',
      description: 'desc',
    });
    expect(result).toEqual([]);
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

  it('passes a config carrying the editor $schema key (CR-02 regression)', () => {
    const issues = checkMetadataIssues({
      $schema: 'https://boardsmith.io/schemas/boardsmith.schema.json',
      name: 'x',
      displayName: 'X',
      description: 'desc',
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

  it('describeZipSizeViolation returns null at or under the limit (WR-05)', () => {
    expect(describeZipSizeViolation(0)).toBeNull();
    expect(describeZipSizeViolation(MAX_BUNDLE_SIZE)).toBeNull();
  });

  it('describeZipSizeViolation returns an actionable message naming both sizes when over the limit (WR-05)', () => {
    const message = describeZipSizeViolation(MAX_BUNDLE_SIZE + 1024 * 1024);
    expect(message).not.toBeNull();
    expect(message).toContain('51.0 MB');
    expect(message).toContain('50.0 MB');
    expect(message?.toLowerCase()).toContain('reduce');
  });
});

describe('validateBundleSize measures the real publish zip, not the raw dist (WR-05)', () => {
  function makeDist(cwd: string, bigFileBytes: number): void {
    const distDir = join(cwd, 'dist');
    mkdirSync(join(distDir, 'rules'), { recursive: true });
    mkdirSync(join(distDir, 'ui'), { recursive: true });
    writeFileSync(join(distDir, 'manifest.json'), JSON.stringify({
      name: 'fixture', playerCount: { min: 2, max: 4 },
    }));
    writeFileSync(join(distDir, 'rules', 'rules.js'), 'module.exports = {};\n');
    writeFileSync(join(distDir, 'ui', 'index.html'), '<!DOCTYPE html><html></html>');
    // Highly compressible payload: zeros deflate to well under 1% of raw size.
    writeFileSync(join(distDir, 'ui', 'big.json'), Buffer.alloc(bigFileBytes, 0x30));
  }

  it('PASSES a dist whose raw size exceeds 50MB but whose zip is far under it (the server gates the zip)', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'bs-bundle-size-'));
    try {
      makeDist(cwd, 55 * 1024 * 1024); // raw > 50MB limit, zip ~ tiny
      const result = await validateBundleSize(cwd);
      expect(result.passed).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30_000);

  it('reports the compressed size in its detail output so the number matches what publish uploads', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'bs-bundle-size-'));
    try {
      makeDist(cwd, 1024);
      const result = await validateBundleSize(cwd);
      expect(result.passed).toBe(true);
      expect((result.details ?? []).join('\n')).toMatch(/compressed/i);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
