import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  ALLOWED_TOP_LEVEL_KEYS,
  suggestKey,
  findUnknownKeys,
} from '../lib/config-schema.js';
import { checkMetadataIssues, checkTaxonomyShape, validateBundleSize } from './validate.js';
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
      audience: 'casual',
      tags: ['abstract'],
      playtime: { min: 15, max: 30 },
      cooperative: false,
      gameOptions: [],
      playerOptions: [],
      colorPalette: [],
      paths: { rules: 'src/rules' },
      gameId: 'abc123',
      version: '1.0.0',
      asyncPlay: true,
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

/** A minimal fully-valid config — spread and override per test. */
function validConfig(): Record<string, unknown> {
  return {
    name: 'x',
    displayName: 'X',
    description: 'desc',
    audience: 'casual',
    tags: ['abstract'],
    playtime: { min: 15, max: 30 },
    cooperative: false,
  };
}

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
      ...validConfig(),
      gameOptions: [],
    });
    expect(issues).toEqual([]);
  });

  // The manifest no longer describes UIs — src/ui/uis.ts does. A leftover `ui`
  // key is a migration signal, so it gets a pointed message rather than a
  // generic did-you-mean (matching the playerCount/categories precedent).
  it("rejects a leftover 'ui' key and names src/ui/uis.ts as the replacement", () => {
    const issues = checkMetadataIssues({ ...validConfig(), ui: 'auto' });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("Unknown key 'ui'");
    expect(issues[0]).toContain('src/ui/uis.ts');
    expect(issues[0]).toContain('defineGameUIs');
  });

  it('passes a config carrying the editor $schema key (CR-02 regression)', () => {
    const issues = checkMetadataIssues({
      $schema: 'https://boardsmith.io/schemas/boardsmith.schema.json',
      ...validConfig(),
    });
    expect(issues).toEqual([]);
  });

  it('requires the taxonomy fields: audience, tags, playtime, cooperative', () => {
    const issues = checkMetadataIssues({ name: 'x', displayName: 'X', description: 'desc' });
    for (const field of ['audience', 'tags', 'playtime', 'cooperative']) {
      expect(issues).toContain(`Missing required field: ${field}`);
    }
  });

  it('accepts cooperative: false as present (falsy but valid)', () => {
    const issues = checkMetadataIssues(validConfig());
    expect(issues).toEqual([]);
  });

  it('fails a leftover categories key with a pointed migration message naming audience and tags', () => {
    const issues = checkMetadataIssues({ ...validConfig(), categories: ['card-game'] });
    expect(issues.some((i) => i.includes("'categories'") && i.includes('audience') && i.includes('tags'))).toBe(true);
  });

  it('fails a leftover estimatedDuration key with a pointed migration message naming playtime', () => {
    const issues = checkMetadataIssues({ ...validConfig(), estimatedDuration: '15-30 minutes' });
    expect(issues.some((i) => i.includes("'estimatedDuration'") && i.includes('playtime'))).toBe(true);
  });
});

describe('validate.ts checkTaxonomyShape', () => {
  it('returns nothing for a fully valid config', () => {
    expect(checkTaxonomyShape(validConfig())).toEqual([]);
  });

  it('rejects a non-string audience', () => {
    const issues = checkTaxonomyShape({ ...validConfig(), audience: ['casual'] });
    expect(issues.some((i) => i.includes('"audience"'))).toBe(true);
  });

  it('rejects an empty-string audience', () => {
    const issues = checkTaxonomyShape({ ...validConfig(), audience: '' });
    expect(issues.some((i) => i.includes('"audience"'))).toBe(true);
  });

  it('does NOT validate the audience VALUE against the platform list (validate stays offline)', () => {
    // "obviously-not-a-real-audience" is not a platform audience; shape-wise
    // it is a non-empty string, so offline validate must accept it. The
    // publish preflight (network) is where the value gets checked.
    expect(checkTaxonomyShape({ ...validConfig(), audience: 'obviously-not-a-real-audience' })).toEqual([]);
  });

  it('rejects tags that are not an array of non-empty strings', () => {
    expect(checkTaxonomyShape({ ...validConfig(), tags: 'abstract' }).length).toBe(1);
    expect(checkTaxonomyShape({ ...validConfig(), tags: ['abstract', 7] }).length).toBe(1);
    expect(checkTaxonomyShape({ ...validConfig(), tags: [''] }).length).toBe(1);
  });

  it('accepts an empty tags array', () => {
    expect(checkTaxonomyShape({ ...validConfig(), tags: [] })).toEqual([]);
  });

  it('rejects playtime that is not an object with integer min/max', () => {
    expect(checkTaxonomyShape({ ...validConfig(), playtime: '15-30 minutes' }).length).toBe(1);
    expect(checkTaxonomyShape({ ...validConfig(), playtime: { min: 15 } }).length).toBe(1);
    expect(checkTaxonomyShape({ ...validConfig(), playtime: { min: 15.5, max: 30 } }).length).toBe(1);
  });

  it('rejects playtime with min > max, naming both values', () => {
    const issues = checkTaxonomyShape({ ...validConfig(), playtime: { min: 45, max: 30 } });
    expect(issues.length).toBe(1);
    expect(issues[0]).toContain('45');
    expect(issues[0]).toContain('30');
  });

  it('rejects playtime with min < 1', () => {
    expect(checkTaxonomyShape({ ...validConfig(), playtime: { min: 0, max: 30 } }).length).toBe(1);
  });

  it('accepts min === max (a fixed-length game)', () => {
    expect(checkTaxonomyShape({ ...validConfig(), playtime: { min: 20, max: 20 } })).toEqual([]);
  });

  it('rejects a non-boolean cooperative', () => {
    const issues = checkTaxonomyShape({ ...validConfig(), cooperative: 'yes' });
    expect(issues.some((i) => i.includes('"cooperative"'))).toBe(true);
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

/**
 * The platform-consumed blocks (`world`, `roundDeadline`, `idleAction`, `ai`,
 * `persistence`, `joinInProgress`). Every one of them reaches the publishing
 * platform through build.ts's `deriveManifest` config spread, and until this
 * change none of them was in `boardsmith.schema.json` — so `boardsmith
 * validate` / `boardsmith dev` flagged an author for writing exactly the block
 * the platform requires. The shapes below mirror ShufflewickPub
 * `games/src/manifest-schema.ts`, which is the upload-time authority.
 */
describe('platform-consumed blocks', () => {
  it('accepts a config carrying a valid persistent-world block', () => {
    const issues = checkMetadataIssues({
      ...validConfig(),
      world: { resolveAction: { name: 'resolveRound' } },
    });
    expect(issues).toEqual([]);
  });

  it('accepts world.resolveAction args and the optional enrolAction', () => {
    const issues = checkMetadataIssues({
      ...validConfig(),
      world: {
        resolveAction: { name: 'resolveRound', args: { scope: 'all' } },
        enrolAction: { name: 'enrol' },
      },
    });
    expect(issues).toEqual([]);
  });

  it('rejects an unknown key INSIDE world, naming the key and suggesting the real one', () => {
    const issues = checkMetadataIssues({
      ...validConfig(),
      world: { resolveAction: { name: 'resolveRound' }, resolvAction: { name: 'x' } },
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("Unknown key 'resolvAction'");
    expect(issues[0]).toContain('world');
    expect(issues[0]).toContain('resolveAction');
  });

  it('rejects an unknown key inside world.resolveAction', () => {
    const issues = checkMetadataIssues({
      ...validConfig(),
      world: { resolveAction: { name: 'resolveRound', arg: {} } },
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("Unknown key 'arg'");
    expect(issues[0]).toContain('world.resolveAction');
    expect(issues[0]).toContain("'args'");
  });

  it('rejects a world block with no resolveAction — a world with no resolver can never advance', () => {
    const issues = checkMetadataIssues({ ...validConfig(), world: {} });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('resolveAction');
    expect(issues[0]).toContain('advance a round');
  });

  it('rejects a non-object world block and a resolveAction with an empty name', () => {
    expect(checkMetadataIssues({ ...validConfig(), world: true })[0]).toContain('"world" must be an object');
    expect(
      checkMetadataIssues({ ...validConfig(), world: { resolveAction: { name: '' } } })[0],
    ).toContain('"world.resolveAction.name"');
  });

  it('accepts the boolean platform flags and rejects non-boolean values', () => {
    expect(checkMetadataIssues({
      ...validConfig(),
      persistence: true,
      ai: true,
      joinInProgress: false,
      asyncPlay: true,
    })).toEqual([]);
    expect(checkMetadataIssues({ ...validConfig(), persistence: 'yes' })[0]).toContain('"persistence" must be a boolean');
    expect(checkMetadataIssues({ ...validConfig(), ai: 1 })[0]).toContain('"ai" must be a boolean');
    expect(checkMetadataIssues({ ...validConfig(), joinInProgress: 'true' })[0]).toContain('"joinInProgress" must be a boolean');
    expect(checkMetadataIssues({ ...validConfig(), asyncPlay: 'yes' })[0]).toContain('"asyncPlay" must be a boolean');
  });

  it('accepts a valid idleAction + roundDeadline pair', () => {
    const issues = checkMetadataIssues({
      ...validConfig(),
      idleAction: { name: 'pass' },
      roundDeadline: { defaultHours: 24, minHours: 6, maxHours: 72, mindingSafe: true },
    });
    expect(issues).toEqual([]);
  });

  it('rejects a roundDeadline whose hours are not integers, are inverted, or whose default sits outside the range', () => {
    expect(
      checkMetadataIssues({ ...validConfig(), roundDeadline: { defaultHours: 24, minHours: 6 } })[0],
    ).toContain('"maxHours"');
    expect(
      checkMetadataIssues({ ...validConfig(), roundDeadline: { defaultHours: 24, minHours: 72, maxHours: 6 } })[0],
    ).toContain('must be <=');
    expect(
      checkMetadataIssues({ ...validConfig(), roundDeadline: { defaultHours: 96, minHours: 6, maxHours: 72 } })[0],
    ).toContain('must be between');
  });

  it('rejects an unknown key inside roundDeadline and a malformed idleAction', () => {
    const deadline = checkMetadataIssues({
      ...validConfig(),
      roundDeadline: { defaultHours: 24, minHours: 6, maxHours: 72, mindingSafeish: true },
    });
    expect(deadline).toHaveLength(1);
    expect(deadline[0]).toContain("Unknown key 'mindingSafeish'");
    expect(checkMetadataIssues({ ...validConfig(), idleAction: 'pass' })[0]).toContain('"idleAction" must be an object');
  });
});
