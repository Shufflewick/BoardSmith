import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, vi } from 'vitest';
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
  validateChoiceCardinality,
  checkRulesAgreement,
  validateRequiredFiles,
  successGuidance,
  typeScriptFailureDetails,
  validateProject,
} from './validate.js';
import { ENGINE_REVISION } from '../../contract/index.js';
import {
  MAX_TABLE_RULES_ENCODED_BYTES,
  MAX_UPLOAD_ZIP_BYTES,
  MAX_ZIP_ENTRIES,
  describeZipSizeViolation,
  encodedRulesBytes,
} from '../lib/bundle-limits.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { makeCommandBuildDir } from '../lib/project-paths.js';
import {
  fixedDeployDefinition,
  untimedDeployDefinition,
} from '../../session/testing/fixtures/timed-step-fixture.js';
import type { GameDefinition } from '../../session/index.js';
import boardsmithSchema from '../lib/boardsmith.schema.json' with { type: 'json' };

const schema = boardsmithSchema as { properties: Record<string, Record<string, unknown>> };

describe('config-schema', () => {
  it('ALLOWED_TOP_LEVEL_KEYS matches boardsmith.schema.json properties (single source, no drift)', () => {
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
  it('ASSET_PATH_KEYS is exactly the set of properties marked x-asset-path', () => {
    const marked = Object.entries(schema.properties)
      .filter(([, property]) => property['x-asset-path'] === true)
      .map(([key]) => key);

    expect([...ASSET_PATH_KEYS].sort()).toEqual(marked.sort());
    // The key the scaffold used to dangle must stay covered.
    expect(ASSET_PATH_KEYS).toContain('thumbnail');
  });

  it('every top-level schema property declares an x-convex-sink disposition', () => {
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
  it('CONVEX_SINK_KEYS is exactly the set of properties marked x-convex-sink', () => {
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

  // Which agent each role is dispatched as (#454). A mistake here would send a chunk's work to an
  // agent type the project never meant, so validate refuses it before any dispatch does.
  it('passes an "agents" block that maps roles to agent types', () => {
    expect(checkMetadataIssues({ ...validConfig(), agents: { judgement: 'senior', review: 'reviewer' } })).toEqual([]);
  });

  it('refuses an "agents" block naming an unknown role, suggesting the right one', () => {
    const issues = checkMetadataIssues({ ...validConfig(), agents: { judgment: 'senior' } });
    expect(issues).toEqual([
      'Unknown role "judgment" in "agents"; did you mean "judgement"? The roles are mechanical, bounded, judgement, review and second-opinion.',
    ]);
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
  it('MAX_UPLOAD_ZIP_BYTES is 200MB, matching the authoritative games-worker upload gate', () => {
    // #220: the CLI carried 50MB and pointed at a repository that no longer
    // exists, so it rejected uploads the platform would have accepted.
    expect(MAX_UPLOAD_ZIP_BYTES).toBe(200 * 1024 * 1024);
  });

  it('describeZipSizeViolation returns null at or under the limit (WR-05)', () => {
    expect(describeZipSizeViolation(0)).toBeNull();
    expect(describeZipSizeViolation(MAX_UPLOAD_ZIP_BYTES)).toBeNull();
  });

  it('describeZipSizeViolation returns an actionable message naming both sizes when over the limit (WR-05)', () => {
    const message = describeZipSizeViolation(MAX_UPLOAD_ZIP_BYTES + 1024 * 1024);
    expect(message).not.toBeNull();
    expect(message).toContain('201.0 MB');
    expect(message).toContain('200.0 MB');
    expect(message?.toLowerCase()).toContain('reduce');
  });

  it('encodedRulesBytes counts the JSON-encoded form the executor measures, not the bytes on disk (#221)', () => {
    // A quote costs one extra byte, a newline costs one, a control character
    // costs six -- plus the two enclosing quotes.
    expect(encodedRulesBytes('ab')).toBe(4);
    expect(encodedRulesBytes('"')).toBe(4);
    expect(encodedRulesBytes('\n')).toBe(4);
    expect(encodedRulesBytes('\u0001')).toBe(8);
  });
});

describe('validateBundleSize measures the real publish zip, not the raw dist (WR-05)', () => {
  /**
   * A dist `readDistDir` can actually package. The manifest must declare its
   * backend and its seat count and the matching entry point must exist --
   * without those, every measurement below silently falls into the
   * "not measurable" branch and the assertions prove nothing.
   */
  function makeDist(
    cwd: string,
    bigFileBytes: number,
    rulesJs = 'module.exports = {};\n',
    worldMode = false,
  ): void {
    const distDir = join(cwd, 'dist');
    mkdirSync(join(distDir, 'rules'), { recursive: true });
    mkdirSync(join(distDir, 'ui'), { recursive: true });
    writeFileSync(join(distDir, 'manifest.json'), JSON.stringify(
      worldMode
        ? { name: 'fixture', backend: 'world', world: { maxPlayers: 40 } }
        : { name: 'fixture', backend: 'table', playerCount: { min: 2, max: 4 } },
    ));
    writeFileSync(join(distDir, 'rules', 'rules.js'), rulesJs);
    writeFileSync(join(distDir, 'ui', worldMode ? 'world.html' : 'index.html'), '<!DOCTYPE html><html></html>');
    // Highly compressible payload: zeros deflate to well under 1% of raw size.
    // Split across files under the per-file ceiling, so a test about the TOTAL
    // is not silently answered by the per-file gate instead.
    const chunk = 32 * 1024 * 1024;
    let written = 0;
    for (let i = 0; written < bigFileBytes; i += 1) {
      const size = Math.min(chunk, bigFileBytes - written);
      writeFileSync(join(distDir, 'ui', `big${i}.json`), Buffer.alloc(size, 0x30));
      written += size;
    }
  }

  /** Build a dist in a throwaway directory, measure it, and take it away again. */
  async function measure(
    build: (cwd: string) => void,
    worldMode = false,
  ): Promise<{ passed: boolean; details: string }> {
    const cwd = tempTree('bs-bundle-size-');
    build(cwd);
    const result = await validateBundleSize(cwd, worldMode);
    return { passed: result.passed, details: (result.details ?? []).join('\n') };
  }

  /** Under 1 MiB as it sits on disk, over 1 MiB once JSON-encoded (#221). */
  const STRING_HEAVY_RULES = `/*${'"'.repeat(525_000)}*/`;

  it('PASSES a dist whose raw size exceeds the zip limit but whose zip is far under it (the server gates the zip)', async () => {
    const { passed } = await measure((cwd) => makeDist(cwd, 55 * 1024 * 1024));
    expect(passed).toBe(true);
  }, 30_000);

  it('reports the compressed size in its detail output so the number matches what publish uploads', async () => {
    const { passed, details } = await measure((cwd) => makeDist(cwd, 1024));
    expect(passed).toBe(true);
    expect(details).toMatch(/compressed/i);
  });

  it('FAILS a rules.js under 1 MiB raw and over 1 MiB JSON-encoded, and names the encoding overhead (#221)', async () => {
    // The exact bundle that passed validate, passed publish, and then failed
    // EVERY start.
    expect(Buffer.byteLength(STRING_HEAVY_RULES, 'utf-8')).toBeLessThan(MAX_TABLE_RULES_ENCODED_BYTES);
    expect(encodedRulesBytes(STRING_HEAVY_RULES)).toBeGreaterThan(MAX_TABLE_RULES_ENCODED_BYTES);

    const { passed, details } = await measure((cwd) => makeDist(cwd, 1024, STRING_HEAVY_RULES));
    expect(passed).toBe(false);
    expect(details).toMatch(/rules\.js/);
    expect(details).toMatch(/JSON string/i);
    expect(details).toMatch(/on disk/i);
  }, 30_000);

  it('PASSES that same rules.js for a WORLD, whose rules never travel in a request envelope (#220)', async () => {
    const { passed, details } = await measure(
      (cwd) => makeDist(cwd, 1024, STRING_HEAVY_RULES, true),
      true,
    );
    expect(passed).toBe(true);
    expect(details).toMatch(/bundle store/i);
  }, 30_000);

  it('warns while a table rules.js is still under the limit but past the warning band (#221)', async () => {
    // ~90% of the encoded limit, all plain characters so raw ~= encoded.
    const { passed, details } = await measure((cwd) => makeDist(cwd, 1024, `/*${'x'.repeat(950_000)}*/`));
    expect(passed).toBe(true);
    expect(details).toMatch(/Warning: rules\.js is at 9\d% of/);
  }, 30_000);

  it('FAILS a bundle over the games worker file-count ceiling even though it zips small (#220)', async () => {
    const { passed, details } = await measure((cwd) => {
      makeDist(cwd, 16);
      const many = join(cwd, 'dist', 'ui', 'many');
      mkdirSync(many, { recursive: true });
      for (let i = 0; i <= MAX_ZIP_ENTRIES; i += 1) writeFileSync(join(many, `f${i}.txt`), 'x');
    });
    expect(passed).toBe(false);
    expect(details).toMatch(/file ceiling/i);
  }, 60_000);
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
    // #194: an author who read the platform's upgrade docs puts `stateVersion`
    // here too, so the refusal has to say where that one lives as well --
    // otherwise it is rejected with no destination named.
    expect(message).toContain('stateVersion');
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
    projectDir = tempTree('boardsmith-asset-paths-');
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
    const result = buildChoiceCardinalityResult([], 'table');
    expect(result.passed).toBe(true);
    expect(result.details ?? []).toEqual([]);
  });

  it('reports each unbounded table step as a warning with the count and both fixes', () => {
    const result = buildChoiceCardinalityResult(
      [{ action: 'shout', selection: 'verb', maxCandidates: 40 }],
      'table',
    );
    expect(result.passed).toBe(false);
    expect(result.severity).toBe('warning');
    expect(result.details).toHaveLength(1);
    expect(result.details![0]).toContain('40');
    expect(result.details![0]).toContain('boardRef');
    expect(result.details![0]).toContain('dependsOn');
  });
});

/**
 * #306: the check loads the game through a temp dir it owns. It used to write
 * into `.boardsmith/` without creating it, so a fresh checkout that had never
 * run `dev` or `build` got ENOENT, and the catch reported that as a PASS.
 */
describe('validateChoiceCardinality runs in a checkout with no .boardsmith (#306)', () => {
  const fixture = resolve(dirname(fileURLToPath(import.meta.url)), '../lib/choice-cardinality.fixture.ts');

  /** A game project whose rules re-export a real fixture game, and no `.boardsmith/`. */
  function freshProject(rulesIndex: string | null, backend: 'table' | 'world' = 'table'): string {
    const cwd = tempTree('bs-validate-cardinality-');
    writeFileSync(join(cwd, 'boardsmith.json'), JSON.stringify({ name: 'fixture', backend }));
    if (rulesIndex !== null) {
      mkdirSync(join(cwd, 'src', 'rules'), { recursive: true });
      writeFileSync(join(cwd, 'src', 'rules', 'index.ts'), rulesIndex);
    }
    return cwd;
  }

  /** A rules index exporting the named fixture game with the given seat fields. */
  function rulesFor(gameClass: string, seats: string): string {
    return [
      `import { ${gameClass} } from ${JSON.stringify(fixture)};`,
      `export const gameDefinition = { gameClass: ${gameClass}, gameType: 'fixture', displayName: 'Fixture'${seats} };`,
    ].join('\n');
  }

  /** The check did not produce a verdict: never a pass, always a warning saying why. */
  function expectNotRun(result: Awaited<ReturnType<typeof validateChoiceCardinality>>, why: RegExp): void {
    expect(result.passed).toBe(false);
    expect(result.severity).toBe('warning');
    expect(result.message).toMatch(why);
  }

  const wideRules = rulesFor('WideGame', ', minPlayers: 2, maxPlayers: 2');

  it('plays the game and reports what it found, instead of skipping', async () => {
    const cwd = freshProject(wideRules);
    expect(existsSync(join(cwd, '.boardsmith'))).toBe(false);

    const result = await validateChoiceCardinality(cwd, false);

    expect(result.passed).toBe(false);
    expect(result.severity).toBe('warning');
    expect(result.details!.join('\n')).toContain('shout');
  }, 30_000);

  it('removes the temp dir it made once the check is done', async () => {
    const cwd = freshProject(wideRules);
    await validateChoiceCardinality(cwd, false);
    expect(readdirSync(join(cwd, '.boardsmith'))).toEqual([]);
  }, 30_000);

  // #543: two validates of one game used to share `.boardsmith/validate-tmp/`, so the run that
  // finished first deleted the bundle the other was about to import.
  it('lets two validates of the same game run at once, and both leave nothing behind', async () => {
    const cwd = freshProject(wideRules);

    const results = await Promise.all([validateChoiceCardinality(cwd, false), validateChoiceCardinality(cwd, false)]);

    for (const result of results) expect(result.details!.join('\n')).toContain('shout');
    expect(readdirSync(join(cwd, '.boardsmith'))).toEqual([]);
  }, 60_000);

  // #543: the deterministic half of the test above. Whether two runs in one process collide
  // depends on timing; whether a run removes a directory it did not make does not.
  it('leaves the build directory of another validate still running alone', async () => {
    const cwd = freshProject(wideRules);
    const other = makeCommandBuildDir(cwd, 'validate');
    writeFileSync(join(other, 'simulate-bundle.mjs'), 'export {};');

    const result = await validateChoiceCardinality(cwd, false);

    expect(result.details!.join('\n')).toContain('shout');
    expect(existsSync(join(other, 'simulate-bundle.mjs')), 'validate removed another run’s bundle').toBe(true);
    expect(readdirSync(join(cwd, '.boardsmith'))).toEqual([basename(other)]);
  }, 30_000);

  it('plays the game at the seat count its definition starts from', async () => {
    const cwd = freshProject(rulesFor('ThreeSeatWideGame', ', minPlayers: 3, maxPlayers: 4'));

    const result = await validateChoiceCardinality(cwd, false);

    expect(result.details!.join('\n')).toContain('shout');
  }, 30_000);

  it('says it could not run when a table game declares no minPlayers to play it at', async () => {
    const result = await validateChoiceCardinality(freshProject(rulesFor('WideGame', '')), false);

    expectNotRun(result, /could not run.*minPlayers/is);
  }, 30_000);

  /** A rules index exporting a fixture world offering the named actions. */
  function worldRulesFor(actions: string[]): string {
    return [
      `import { cardinalityWorld } from ${JSON.stringify(fixture)};`,
      `export const gameDefinition = cardinalityWorld(${JSON.stringify(actions)});`,
    ].join('\n');
  }

  // #323: a world gets a real verdict, driven the way a host drives it.
  it('drives a world and reports the flat list it offers, with a world’s way out', async () => {
    const result = await validateChoiceCardinality(freshProject(worldRulesFor(['shout', 'mark']), 'world'), true);

    expect(result).toMatchObject({ passed: false, severity: 'warning' });
    expect(result.details).toEqual([expect.stringContaining("'shout' step 'verb' offered 40")]);
    expect(result.details![0]).not.toContain('dependsOn');
  }, 30_000);

  it('passes a world whose every list is short', async () => {
    const result = await validateChoiceCardinality(freshProject(worldRulesFor(['nod']), 'world'), true);

    expect(result.passed).toBe(true);
  }, 30_000);

  it('says it could not run when a world offers nothing it could drive', async () => {
    const result = await validateChoiceCardinality(freshProject(worldRulesFor(['say']), 'world'), true);

    expectNotRun(result, /could not run.*no seat was offered/is);
  }, 30_000);

  it('does not report a pass when the check could not run, and says why', async () => {
    const result = await validateChoiceCardinality(freshProject(null), false);

    expectNotRun(result, /could not run/i);
  }, 30_000);
});

/**
 * #300: the compiled rules and boardsmith.json are held to the same agreement
 * `boardsmith build` enforces, so validate refuses what build would refuse --
 * a timed step with no `idleAction` to close it among them.
 */
describe('validate.ts rules agreement (#300)', () => {
  const timed = fixedDeployDefinition as GameDefinition;
  const untimed = untimedDeployDefinition as GameDefinition;

  it('refuses a timed step without an idleAction, naming the step and the fix', () => {
    const result = checkRulesAgreement({ backend: 'table' }, timed);
    expect(result.passed).toBe(false);
    expect(result.severity).toBeUndefined();
    expect(result.details!.join('\n')).toContain("'deploy'");
    expect(result.details!.join('\n')).toContain('"idleAction": { "name": "pass" }');
  });

  it('passes a timed step whose game declares an idleAction', () => {
    expect(checkRulesAgreement({ backend: 'table', idleAction: { name: 'commit' } }, timed).passed).toBe(true);
  });

  it('passes an untimed game with no idleAction', () => {
    expect(checkRulesAgreement({ backend: 'table' }, untimed).passed).toBe(true);
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
    dir = tempTree('bs-required-files-');
    mkdirSync(join(dir, 'src', 'rules'), { recursive: true });
    mkdirSync(join(dir, 'src', 'ui'), { recursive: true });
    for (const file of ['boardsmith.json', 'package.json']) writeFileSync(join(dir, file), '{}');
    for (const file of ['index.ts', 'game.ts']) writeFileSync(join(dir, 'src', 'rules', file), '');
  });


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
  const plain = (isWorld: boolean, warnings = 0): string =>
    // eslint-disable-next-line no-control-regex
    successGuidance(isWorld, warnings).join('\n').replace(/\u001B\[[0-9;]*m/g, '');

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

  // #306: a warning can be a check that could not run, so a run with one is
  // never summed up as every check having passed.
  it('a run with warnings says so instead of claiming every check passed', () => {
    const text = plain(false, 2);
    expect(text).not.toContain('All validation checks passed!');
    expect(text).toContain('2 warning(s)');
  });
});

/**
 * ShufflewickPub #370: A PICTURE THAT RENDERS HERE AND IS BLOCKED THERE.
 *
 * A published bundle's HTML is served under an `img-src` allowlist, and a game
 * says what belongs on it with `boardsmith.json`'s `imageSources`. Without this
 * scan, a game whose artwork lives in another repository builds cleanly,
 * validates cleanly, publishes cleanly, and shows no pictures at all -- with the
 * only evidence a CSP violation in a console nobody is watching.
 */
describe('remote image sources must be declared before they are used (#370)', () => {
  function project(files: Record<string, string>): string {
    const cwd = tempTree('bs-image-sources-');
    for (const [rel, contents] of Object.entries(files)) {
      const full = join(cwd, rel);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, contents);
    }
    return cwd;
  }

  const REMOTE = 'https://raw.githubusercontent.com/owner/art/abc123/planet.png';

  async function scan(imageSources: string[] | undefined, source = REMOTE) {
    const cwd = project({
      'boardsmith.json': JSON.stringify(imageSources === undefined ? {} : { imageSources }),
      'dist/ui/index.html': `<!doctype html><img src="${source}">`,
    });
    const result = await validateAssetPaths(cwd);
    return { passed: result.passed, details: (result.details ?? []).join('\n'), message: result.message };
  }

  it('FAILS a bundle that loads a remote image it never declared', async () => {
    const { passed, details, message } = await scan(undefined);
    expect(passed).toBe(false);
    expect(details).toContain(REMOTE);
    expect(details).toContain('https://raw.githubusercontent.com');
    expect(details).toContain('imageSources');
    expect(message).toContain('not declared in imageSources');
  });

  it('PASSES when a declared origin covers it', async () => {
    expect((await scan(['https://raw.githubusercontent.com'])).passed).toBe(true);
  });

  it('PASSES when a declared path prefix covers it, the way CSP matches one', async () => {
    expect((await scan(['https://raw.githubusercontent.com/owner/art/abc123/'])).passed).toBe(true);
  });

  it('FAILS when the declared prefix is for a DIFFERENT directory', async () => {
    // The whole value of pinning a prefix: a declaration for last release's
    // commit does not quietly cover this release's URLs.
    const { passed } = await scan(['https://raw.githubusercontent.com/owner/art/999999/']);
    expect(passed).toBe(false);
  });

  it('leaves a non-image URL alone, so a documentation link is not an asset problem', async () => {
    expect((await scan(undefined, 'https://boardsmith.dev/docs/worlds')).passed).toBe(true);
  });

  it('finds one in built CSS and in built rules, not only in HTML', async () => {
    for (const [rel, contents] of [
      ['dist/ui/assets/app.css', `.board { background: url(${REMOTE}); }`],
      ['dist/rules/rules.js', `const sprite = "${REMOTE}";`],
    ] as const) {
      const cwd = project({ 'boardsmith.json': '{}', [rel]: contents });
      const result = await validateAssetPaths(cwd);
      expect(result.passed, `${rel} should have been scanned`).toBe(false);
      expect((result.details ?? []).join('\n')).toContain(REMOTE);
    }
  });

  it('names each distinct URL once, however many times it appears', async () => {
    const cwd = project({
      'boardsmith.json': '{}',
      'dist/ui/index.html': `<img src="${REMOTE}"><img src="${REMOTE}"><img src="${REMOTE}">`,
    });
    const result = await validateAssetPaths(cwd);
    const lines = (result.details ?? []).filter((line) => line.includes(REMOTE));
    expect(lines).toHaveLength(1);
  });
});

/**
 * #423: engine r112 changed `walkDeclaration`, and a game whose test called it
 * the old way failed validate with only the compiler's words. The failure now
 * says which revision since the game's last build changed what the errors use.
 */
describe('typeScriptFailureDetails names the engine change a type error runs into (#423)', () => {
  const DIAGNOSTICS = [
    'tests/world.test.ts(2,11): error TS2554: Expected 4 arguments, but got 3.',
    "tests/world.test.ts(3,7): error TS2740: Type 'WorldWalkAnswers' is missing the following properties from type 'readonly DeclaredSeatActivityStamp[]': length, concat, join, slice, and 20 more.",
  ];

  function game(builtRevision: number | undefined): string {
    const cwd = tempTree('bs-validate-engine-change-');
    mkdirSync(join(cwd, 'tests'));
    writeFileSync(join(cwd, 'tests/world.test.ts'), 'const host = {\n  offers: await walkDeclaration(\n      declaredActivity,\n};\n');
    if (builtRevision !== undefined) {
      mkdirSync(join(cwd, 'dist'));
      writeFileSync(join(cwd, 'dist/manifest.json'), JSON.stringify({ engineRevision: builtRevision }));
    }
    return cwd;
  }

  it('puts the revision that changed walkDeclaration, and what it says, above the errors', () => {
    const details = typeScriptFailureDetails(game(107), DIAGNOSTICS);
    expect(details[0]).toContain(`engine revision 107; this BoardSmith is revision ${ENGINE_REVISION}`);
    expect(details[1]).toMatch(/^Engine revision 112 \(2026-09-26\) changed .*walkDeclaration.*, used at tests\/world\.test\.ts:2, 3: /);
    expect(details[1]).toContain('walkDeclaration takes a fourth reader and returns that object');
    expect(details.slice(2)).toEqual(DIAGNOSTICS);
  });

  it('gives the errors alone for a game never built, or built against this revision', () => {
    expect(typeScriptFailureDetails(game(undefined), DIAGNOSTICS)).toEqual(DIAGNOSTICS);
    expect(typeScriptFailureDetails(game(ENGINE_REVISION), DIAGNOSTICS)).toEqual(DIAGNOSTICS);
  });
});

describe('validateProject stops by throwing, so a command running it stops too (#532)', () => {
  it('rejects with the failure line after printing each check, instead of ending the process', async () => {
    const dir = tempTree('bs-validate-throws-');
    writeFileSync(join(dir, 'boardsmith.json'), JSON.stringify({ name: 'fixture', backend: 'table', playerCount: { min: 2, max: 4 } }));
    const printed: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((line?: unknown) => void printed.push(String(line)));
    try {
      // A type check already run, as verify hands one over, so this fixture needs no compiler.
      const typeCheck = { result: { name: 'TypeScript', passed: true, message: '' }, programFiles: [], compilerReport: [] };
      await expect(validateProject(dir, { typeCheck })).rejects.toThrow('Validation failed. Please fix the issues above.');
    } finally {
      log.mockRestore();
    }
    expect(printed.join('\n')).toContain('playerCount');
  });
});
