import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ALLOWED_TOP_LEVEL_KEYS,
  CONVEX_SINK_KEYS,
  suggestKey,
  findUnknownKeys,
  ASSET_PATH_KEYS,
} from '../lib/config-schema.js';
import {
  checkMetadataIssues,
  checkTaxonomyShape,
  validateBundleSize,
  validateAssetPaths,
  parseProgramFiles,
  findUntypedTestFiles,
  hasBlockingFailure,
  buildChoiceCardinalityResult,
  validateRequiredFiles,
  successGuidance,
} from './validate.js';
import { MAX_BUNDLE_SIZE, describeZipSizeViolation } from '../lib/bundle-limits.js';

describe('config-schema', () => {
  it('ALLOWED_TOP_LEVEL_KEYS matches boardsmith.schema.json properties (single source, no drift)', async () => {
    const schema = (await import('../lib/boardsmith.schema.json')).default as {
      properties: Record<string, unknown>;
    };
    expect([...ALLOWED_TOP_LEVEL_KEYS].sort()).toEqual(Object.keys(schema.properties).sort());
  });

  /**
   * THE GATE THAT MAKES THE FORWARDING DECISION MANDATORY.
   *
   * Twice now a key was declared here, written faithfully into
   * dist/manifest.json, and then dropped silently on its way to the platform
   * because nobody added it to `buildInitiateManifest`'s list: `asyncPlay`
   * (Phase 65.1) and then `roundDeadline` (Phase 66) — the second one four
   * lines below a comment telling the reader to add it. Prose does not hold
   * this.
   *
   * So the disposition lives IN the schema, as `x-convex-sink`, and it is
   * REQUIRED on every top-level property. `CONVEX_SINK_KEYS` is derived from
   * it and `buildInitiateManifest` forwards exactly that set, which makes
   * "marked true but not forwarded" unrepresentable rather than merely
   * discouraged. The one remaining way to be silent — adding a key and
   * declaring nothing — is what this test refuses.
   */
  /**
   * The gate's coverage is derived, not hand-listed: marking a new asset key
   * `x-asset-path` in the schema is the whole of what it takes for
   * `validateAssetPaths` to check that it resolves.
   */
  it('ASSET_PATH_KEYS is exactly the set of properties marked x-asset-path', async () => {
    const schema = (await import('../lib/boardsmith.schema.json')).default as {
      properties: Record<string, Record<string, unknown>>;
    };
    const marked = Object.entries(schema.properties)
      .filter(([, property]) => property['x-asset-path'] === true)
      .map(([key]) => key);

    expect([...ASSET_PATH_KEYS].sort()).toEqual(marked.sort());
    // The key the scaffold used to dangle must stay covered.
    expect(ASSET_PATH_KEYS).toContain('thumbnail');
  });

  it('every top-level schema property declares an x-convex-sink disposition', async () => {
    const schema = (await import('../lib/boardsmith.schema.json')).default as {
      properties: Record<string, Record<string, unknown>>;
    };

    const undeclared = Object.entries(schema.properties)
      .filter(([, property]) => typeof property['x-convex-sink'] !== 'boolean')
      .map(([key]) => key);

    expect(undeclared).toEqual([]);
  });

  /**
   * The derived set is the one the publish path forwards, so it must be
   * exactly what the schema marks — a hand-maintained copy would be the same
   * drift this whole arrangement exists to remove.
   */
  it('CONVEX_SINK_KEYS is exactly the set of properties marked x-convex-sink', async () => {
    const schema = (await import('../lib/boardsmith.schema.json')).default as {
      properties: Record<string, Record<string, unknown>>;
    };

    const marked = Object.entries(schema.properties)
      .filter(([, property]) => property['x-convex-sink'] === true)
      .map(([key]) => key);

    expect([...CONVEX_SINK_KEYS].sort()).toEqual(marked.sort());
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
      asyncPlay: true,
    });
    expect(result).toEqual([]);
  });

  it('findUnknownKeys rejects a "version" key, because a game states its version in package.json', () => {
    // ShufflewickPub #240: two places to state a version is one place too
    // many. The build refuses one as well; this is the earlier of the two
    // gates, so the key is caught before anything is compiled.
    expect(findUnknownKeys({ name: 'x', version: '1.0.0' })).toEqual([{ key: 'version' }]);
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
    backend: 'table',
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
 * The platform-consumed blocks (`backend`, `roundDeadline`, `idleAction`,
 * `joinInProgress`, `asyncPlay`). Every one of them reaches the publishing
 * platform through build.ts's `deriveManifest` -- the two capability flags
 * inside the resolved `capabilities` object, the rest through the config
 * spread -- and until this change none of them was in
 * `boardsmith.schema.json`, so `boardsmith validate` / `boardsmith dev` flagged
 * an author for writing exactly the block the platform requires. The shapes
 * below mirror ShufflewickPub `games/src/manifest-schema.ts`, which is the
 * upload-time authority.
 */
describe('platform-consumed blocks', () => {
  it('requires a backend, because a default is a backend nobody chose', () => {
    const { backend: _backend, ...noBackend } = validConfig();
    expect(checkMetadataIssues(noBackend)).toContain('Missing required field: backend');
  });

  it('accepts either backend and rejects a name this engine does not run', () => {
    expect(checkMetadataIssues({ ...validConfig(), backend: 'world' })).toEqual([]);
    const [message] = checkMetadataIssues({ ...validConfig(), backend: 'tables' });
    expect(message).toContain('"backend" must be "table" or "world"');
  });

  it('rejects the world block, which is now the compiled rules\' to declare (#171)', () => {
    // A world's capacity was hand-written here AND in the rules, and only the
    // rules' copy was ever enforced at run time.
    const [message] = checkMetadataIssues({ ...validConfig(), world: { maxPlayers: 200 } });
    expect(message).toContain("Unknown key 'world'");
    expect(message).toContain('"backend": "world"');
    expect(message).toContain('maxPlayers');
  });

  it('rejects `bot`, which is now derived from the compiled rules', () => {
    const [message] = checkMetadataIssues({ ...validConfig(), bot: true });
    expect(message).toContain("Unknown key 'bot'");
    expect(message).toContain('capabilities.bots');
    expect(message).toContain('world backend has no bots');
  });

  it('rejects `persistence`, which is now derived from the compiled rules', () => {
    const [message] = checkMetadataIssues({ ...validConfig(), persistence: true });
    expect(message).toContain("Unknown key 'persistence'");
    expect(message).toContain('capabilities.crossSessionState');
  });

  it('accepts the two capability flags an author still declares, and rejects non-boolean values', () => {
    expect(checkMetadataIssues({
      ...validConfig(),
      joinInProgress: false,
      asyncPlay: true,
    })).toEqual([]);
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


/**
 * Issue 142: `boardsmith validate` reported `Asset Paths: PASS` on a manifest
 * whose `thumbnail` named a file that did not exist, because the check only
 * scanned built JS and data/*.json for path STYLE and never opened
 * boardsmith.json. A manifest that can name a file the bundle does not carry,
 * with every gate green, is the wrong path being easy.
 */
describe('validate.ts validateAssetPaths — declared manifest assets must resolve', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'boardsmith-asset-paths-'));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  function writeConfig(config: Record<string, unknown>): void {
    writeFileSync(join(projectDir, 'boardsmith.json'), JSON.stringify(config, null, 2));
  }

  /**
   * Ship one file containing an absolute `/public`-rooted path and run the
   * scan. The path STYLE is the defect; which shipped file carries it is the
   * only thing the cases below differ on, so that is all each one states.
   */
  async function scanShippedFile(relativePath: string, content: string) {
    mkdirSync(join(projectDir, 'public', 'cards'), { recursive: true });
    mkdirSync(dirname(join(projectDir, relativePath)), { recursive: true });
    writeFileSync(join(projectDir, relativePath), content);
    writeConfig({ name: 'x' });
    return validateAssetPaths(projectDir);
  }

  it('fails on a thumbnail path that resolves to nothing', async () => {
    writeConfig({ name: 'x', thumbnail: './public/thumbnail.png' });
    const result = await validateAssetPaths(projectDir);

    expect(result.passed).toBe(false);
    expect((result.details ?? []).join('\n')).toContain('thumbnail');
    expect((result.details ?? []).join('\n')).toContain('public/thumbnail.png');
  });

  it('fails even when the project has no public/ directory at all', async () => {
    writeConfig({ name: 'x', thumbnail: 'art/cover.png' });
    const result = await validateAssetPaths(projectDir);
    expect(result.passed).toBe(false);
  });

  it('passes once the declared file exists', async () => {
    mkdirSync(join(projectDir, 'public'), { recursive: true });
    writeFileSync(join(projectDir, 'public', 'thumbnail.png'), 'png-bytes');
    writeConfig({ name: 'x', thumbnail: './public/thumbnail.png' });

    const result = await validateAssetPaths(projectDir);
    expect(result.passed).toBe(true);
  });

  it('passes a manifest that declares no asset paths at all', async () => {
    writeConfig({ name: 'x' });
    const result = await validateAssetPaths(projectDir);
    expect(result.passed).toBe(true);
  });

  it('catches absolute public/ path style in the built rules bundle', async () => {
    const result = await scanShippedFile(
      join('dist', 'rules', 'rules.js'),
      'card.$images = { face: { sprite: "/cards/deck-sprite.svg" } };',
    );

    expect(result.passed).toBe(false);
    expect((result.details ?? []).join('\n')).toContain('dist/rules/rules.js');
  });

  it('still catches absolute public/ path style in data JSON', async () => {
    const result = await scanShippedFile(
      join('data', 'cards.json'),
      JSON.stringify([{ image: '/cards/one.png' }]),
    );

    expect(result.passed).toBe(false);
    expect((result.details ?? []).join('\n')).toContain('/cards/');
  });
});

/**
 * THE SPLIT THIS EXISTS TO CLOSE (ShufflewickPub #260).
 *
 * `boardsmith test` runs whatever vitest globs; `boardsmith validate`
 * type-checks whatever the game's `tsconfig.json` includes. Eight of thirteen
 * catalogue games named only `src/**` in that include, so every one of their
 * test files ran in a gate that never compiled it, and 240 real type errors sat
 * there for as long as anyone had been running both commands and believing them.
 *
 * The compiler is asked rather than the config: `--listFiles` reports the
 * program from the SAME run that reports the errors, so no glob is
 * reinterpreted here and the two can never disagree.
 */
describe('validate.ts test-type-coverage', () => {
  describe('parseProgramFiles', () => {
    it('keeps the compiled files and drops the diagnostics they are printed beside', () => {
      const output = [
        '/repo/src/rules/game.ts',
        '/repo/tests/game.test.ts',
        '/repo/tests/game.test.ts(12,5): error TS2345: Argument of type X.',
        '',
        'Found 1 error in 1 file.',
      ].join('\n');

      expect(parseProgramFiles(output)).toEqual([
        '/repo/src/rules/game.ts',
        '/repo/tests/game.test.ts',
      ]);
    });

    it('reads a Windows drive-letter path as a file, not as prose', () => {
      const output = ['C:\\repo\\src\\rules\\game.ts', 'Found 0 errors.'].join('\r\n');
      expect(parseProgramFiles(output)).toEqual(['C:\\repo\\src\\rules\\game.ts']);
    });
  });

  describe('findUntypedTestFiles', () => {
    const cwd = '/repo';

    it('names every test file vitest runs that the compiler never opened', () => {
      const program = ['/repo/src/rules/game.ts', '/repo/tests/covered.test.ts'];
      const tests = ['tests/covered.test.ts', 'tests/orphan.test.ts', 'tests/second.test.ts'];

      expect(findUntypedTestFiles(program, tests, cwd)).toEqual([
        'tests/orphan.test.ts',
        'tests/second.test.ts',
      ]);
    });

    it('finds nothing when the program covers every file vitest runs', () => {
      const program = ['/repo/src/rules/game.ts', '/repo/tests/a.test.ts', '/repo/tests/b.test.ts'];
      expect(findUntypedTestFiles(program, ['tests/a.test.ts', 'tests/b.test.ts'], cwd)).toEqual([]);
    });

    it('matches whether vitest reported a path relative or absolute', () => {
      const program = ['/repo/tests/a.test.ts'];
      expect(findUntypedTestFiles(program, ['/repo/tests/a.test.ts'], cwd)).toEqual([]);
    });

    it('reports a file outside the project relative to it, rather than losing it', () => {
      expect(findUntypedTestFiles([], ['/elsewhere/a.test.ts'], cwd)).toEqual([
        '../elsewhere/a.test.ts',
      ]);
    });
  });
});

describe('validate.ts choice cardinality (#172)', () => {
  it('hasBlockingFailure ignores a failed check marked as a warning', () => {
    expect(
      hasBlockingFailure([
        { name: 'Metadata', passed: true, message: '' },
        { name: 'Choice cardinality', passed: false, message: 'x', severity: 'warning' },
      ]),
    ).toBe(false);
  });

  it('hasBlockingFailure still blocks on an ordinary failed check', () => {
    expect(
      hasBlockingFailure([
        { name: 'Choice cardinality', passed: false, message: 'x', severity: 'warning' },
        { name: 'TypeScript', passed: false, message: 'boom' },
      ]),
    ).toBe(true);
  });

  it('reports a pass when nothing offers too much', () => {
    const result = buildChoiceCardinalityResult([]);
    expect(result.passed).toBe(true);
    expect(result.details ?? []).toEqual([]);
  });

  it('reports each unbounded step as a warning with the count and both fixes', () => {
    const result = buildChoiceCardinalityResult([
      { action: 'shout', selection: 'verb', maxCandidates: 40 },
    ]);
    expect(result.passed).toBe(false);
    expect(result.severity).toBe('warning');
    expect(result.details).toHaveLength(1);
    expect(result.details![0]).toContain('40');
    expect(result.details![0]).toContain('boardRef');
    expect(result.details![0]).toContain('dependsOn');
  });
});

/**
 * BoardSmith #168: a world and a table have different entry points.
 *
 * `Required Files` demanded `src/ui/App.vue` and `src/ui/uis.ts` of every
 * project, so the first world-only project ever scaffolded could not pass
 * validate -- and the only way to make it pass would have been to give it the
 * vestigial table half #174 is taking out of the worlds that have one.
 */
describe('validateRequiredFiles — a world has a different entry point (#168)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bs-required-files-'));
    mkdirSync(join(dir, 'src', 'rules'), { recursive: true });
    mkdirSync(join(dir, 'src', 'ui'), { recursive: true });
    for (const file of ['boardsmith.json', 'package.json']) writeFileSync(join(dir, file), '{}');
    for (const file of ['index.ts', 'game.ts']) writeFileSync(join(dir, 'src', 'rules', file), '');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function writeTableUi(): void {
    writeFileSync(join(dir, 'src', 'ui', 'App.vue'), '');
    writeFileSync(join(dir, 'src', 'ui', 'uis.ts'), '');
  }

  function writeWorldUi(): void {
    writeFileSync(join(dir, 'world.html'), '');
    writeFileSync(join(dir, 'src', 'world-main.ts'), '');
    // A world declares its boards in `src/ui/uis.ts` like a table (#170): #169
    // gave it an action table, which is the whole of what `validate` used to
    // cite for denying it a registry.
    writeFileSync(join(dir, 'src', 'ui', 'uis.ts'), '');
    writeFileSync(join(dir, 'src', 'rules', 'world.ts'), '');
  }

  it('passes a table game with the table entry point', async () => {
    writeTableUi();
    expect((await validateRequiredFiles(dir, false)).passed).toBe(true);
  });

  it('passes a world with the world entry point and no table half', async () => {
    writeWorldUi();
    expect((await validateRequiredFiles(dir, true)).passed).toBe(true);
  });

  it('fails a world that declares one and has no world surface', async () => {
    writeTableUi();
    const result = await validateRequiredFiles(dir, true);
    expect(result.passed).toBe(false);
    expect(result.details).toContain('world.html');
    expect(result.details).toContain('src/rules/world.ts');
  });

  it('still fails a table game missing its UI registry', async () => {
    const result = await validateRequiredFiles(dir, false);
    expect(result.passed).toBe(false);
    expect(result.details).toContain('src/ui/uis.ts');
  });
});

describe("#196: what validation tells an author to do next", () => {
  /** Chalk may or may not colour, depending on where the suite runs. */
  const plain = (isWorld: boolean): string =>
    // eslint-disable-next-line no-control-regex
    successGuidance(isWorld).join('\n').replace(/\u001B\[[0-9;]*m/g, '');

  it('a world project is told `boardsmith dev` runs the world, not a table half', () => {
    const text = plain(true);
    expect(text).toContain('`boardsmith dev` runs it');
    expect(text).toContain('durable local store');
    expect(text).toContain('boardsmith dev --reset');
    expect(text).toContain('docs/persistent-worlds.md');
  });

  it('a world project is never told about a table half or a flow it does not have', () => {
    const text = plain(true);
    expect(text).not.toContain('table half');
    expect(text).not.toContain('Flow steps');
    expect(text).not.toContain('play through your game');
  });

  it('a table project keeps the table guidance, and is told nothing about worlds', () => {
    const text = plain(false);
    expect(text).toContain('play through your game');
    expect(text).toContain('Flow steps referencing non-existent actions');
    expect(text).not.toContain('persistent world');
  });

  it('both backends still name build and publish', () => {
    for (const isWorld of [true, false]) {
      expect(plain(isWorld)).toContain('All validation checks passed!');
      expect(plain(isWorld)).toContain('boardsmith build');
      expect(plain(isWorld)).toContain('boardsmith publish');
    }
  });
});
