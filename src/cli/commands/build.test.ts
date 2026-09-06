import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { GameDefinition } from '../../session/index.js';
import { Game, Player } from '../../engine/index.js';
import { deriveManifest, resolveUiBuild } from './build.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Minimal fixture gameDefinition — only the fields deriveManifest reads
 * (minPlayers/maxPlayers) are meaningful; the rest satisfy the type.
 */
function makeGameDefinition(minPlayers: number, maxPlayers: number): GameDefinition {
  return {
    gameClass: class FixtureGame extends Game<FixtureGame, Player> {},
    gameType: 'fixture',
    minPlayers,
    maxPlayers,
  };
}

/**
 * A game's version comes from package.json and nowhere else, so every call
 * has to be handed one. This is the "it is stated correctly" case; the tests
 * that matter about versions state their own.
 */
const PKG = { name: 'fixture', version: '1.0.0' };

/**
 * `deriveManifest` under the ordinary stamp: a stated version, the current
 * engine, and no world UI. The tests that are ABOUT one of those three
 * arguments (the version suite, the world-UI suite) still call `deriveManifest`
 * directly, so an explicit call in this file always means "this argument is the
 * subject".
 */
function derive(
  config: Record<string, unknown>,
  gameDefinition: Pick<GameDefinition, 'minPlayers' | 'maxPlayers'> = makeGameDefinition(2, 4),
): Record<string, unknown> {
  return deriveManifest(config, PKG, gameDefinition, { protocol: 1, revision: 7 });
}

describe('deriveManifest', () => {
  it('derives playerCount from gameDefinition.minPlayers/maxPlayers', () => {
    const manifest = derive({ name: 'fixture', displayName: 'Fixture Game' });

    expect(manifest.playerCount).toEqual({ min: 2, max: 4 });
  });

  it('carries the platform-consumed blocks through the config spread untouched', () => {
    // `world` (and its FR-006 siblings) have no derivation of their own: the
    // platform reads them straight out of manifest.json, so the spread is the
    // whole transport. If a future manifest allowlist ever replaces the
    // spread, this is the test that catches the drop.
    const config = {
      name: 'fixture',
      // The live block, not the round architecture's: `validate` refuses that
      // shape's keys by name, so a fixture written in it taught a manifest the
      // toolchain rejects (#304).
      world: { maxPlayers: 200 },
      persistence: true,
      bot: true,
      joinInProgress: true,
      asyncPlay: true,
      idleAction: { name: 'pass' },
      roundDeadline: { defaultHours: 24, minHours: 6, maxHours: 72, mindingSafe: true },
    };

    const manifest = derive(config);

    // Every key the author wrote survives, and the build adds none: `world.ui`
    // was the one the build owned, and #170 deleted it along with the branch it
    // fed (a world project always emits its entry now).
    expect(manifest.world).toEqual(config.world);
    expect(manifest.persistence).toBe(true);
    expect(manifest.bot).toBe(true);
    expect(manifest.joinInProgress).toBe(true);
    expect(manifest.asyncPlay).toBe(true);
    expect(manifest.idleAction).toEqual({ name: 'pass' });
    expect(manifest.roundDeadline).toEqual(config.roundDeadline);
  });

  it('PROC-02: a stale config playerCount does NOT reach the manifest — gameDefinition wins', () => {
    // Stale/hand-edited boardsmith.json claiming a 9-9 player count, while the
    // compiled rules (gameDefinition) say 2-4. This is exactly the drift
    // scenario T-135-07 must prevent: a raw `{ ...config }` spread would let
    // the stale 9/9 ride into the manifest unchanged.
    const manifest = derive({ name: 'fixture', playerCount: { min: 9, max: 9 } });

    expect(manifest.playerCount).toEqual({ min: 2, max: 4 });
    expect(manifest.playerCount).not.toEqual({ min: 9, max: 9 });
  });

  it('preserves buildTime/engineProtocol and other passthrough config keys', () => {
    const config = {
      name: 'fixture',
      displayName: 'Fixture Game',
      description: 'A test game',
    };
    const gameDefinition = makeGameDefinition(1, 8);

    const manifest = deriveManifest(config, { version: '2.0.0' }, gameDefinition, { protocol: 3, revision: 7 });

    expect(manifest.name).toBe('fixture');
    expect(manifest.displayName).toBe('Fixture Game');
    expect(manifest.description).toBe('A test game');
    expect(manifest.version).toBe('2.0.0');
    expect(manifest.engineProtocol).toBe(3);
    expect(manifest.engineRevision).toBe(7);
    expect(typeof manifest.buildTime).toBe('string');
    expect(() => new Date(manifest.buildTime as string).toISOString()).not.toThrow();
  });

  it('stamps engineRevision even when boardsmith.json tries to set its own', () => {
    // Both engine stamps are the BUILDING BoardSmith's to declare. If a hand
    // edited value could ride through the `...config` spread, a game could
    // claim an older revision than it was built against and defeat the
    // platform's skew check — so the derived values must overwrite, not merge.
    const config = { name: 'fixture', engineProtocol: 99, engineRevision: 99 };

    const manifest = derive(config, makeGameDefinition(2, 2));

    expect(manifest.engineProtocol).toBe(1);
    expect(manifest.engineRevision).toBe(7);
  });

  it('passes the taxonomy fields (audience/tags/playtime/cooperative) through to the manifest', () => {
    const config = {
      name: 'fixture',
      audience: 'casual',
      tags: ['abstract', 'classic'],
      playtime: { min: 15, max: 30 },
      cooperative: false,
    };

    const manifest = derive(config);

    expect(manifest.audience).toBe('casual');
    expect(manifest.tags).toEqual(['abstract', 'classic']);
    expect(manifest.playtime).toEqual({ min: 15, max: 30 });
    expect(manifest.cooperative).toBe(false);
  });

  it('throws an actionable error when the gameDefinition lacks minPlayers/maxPlayers', () => {
    // minPlayers/maxPlayers are optional on GameDefinition — a game that never
    // declared them must fail the BUILD with the fix, not publish a bundle
    // whose playerCount silently serialized to nothing.
    const gameDefinition = {} as Pick<GameDefinition, 'minPlayers' | 'maxPlayers'>;

    expect(() => derive({ name: 'fixture' }, gameDefinition))
      .toThrow(/minPlayers\/maxPlayers.*src\/rules\/index\.ts/s);
  });
});

/**
 * WHERE A GAME'S VERSION COMES FROM (ShufflewickPub #240).
 *
 * package.json, and nowhere else. It is what `boardsmith publish` already
 * sends to the platform (publish.ts reads `pkg.version` and refuses without
 * it), so it is the number the platform pins a release under; a manifest
 * derived from anything else can only disagree with it. The build used to
 * take the version from boardsmith.json and fall back to the literal
 * '1.0.0' when that key was absent, which shipped eleven games in the
 * catalogue labelled as a version they were not.
 */
describe('deriveManifest - the game version', () => {
  it('takes the version from package.json', () => {
    const manifest = deriveManifest(
      { name: 'fixture' },
      { name: 'fixture', version: '1.1.12' },
      makeGameDefinition(2, 2),
      { protocol: 1, revision: 7 },
    );

    expect(manifest.version).toBe('1.1.12');
  });

  it('fails the build, naming the file and key, when package.json states no version', () => {
    expect(() =>
      deriveManifest(
        { name: 'fixture' },
        { name: 'fixture' },
        makeGameDefinition(2, 2),
        { protocol: 1, revision: 7 },
        ),
    ).toThrow(/package\.json.*"version"/s);
  });

  it('never emits the old 1.0.0 default for a game that states no version', () => {
    let manifest: Record<string, unknown> | undefined;
    try {
      manifest = deriveManifest(
        { name: 'fixture' },
        { name: 'fixture' },
        makeGameDefinition(2, 2),
        { protocol: 1, revision: 7 },
        );
    } catch {
      manifest = undefined;
    }
    expect(manifest).toBeUndefined();
  });

  it('rejects an empty version string rather than labelling the bundle with nothing', () => {
    expect(() =>
      deriveManifest(
        { name: 'fixture' },
        { name: 'fixture', version: '  ' },
        makeGameDefinition(2, 2),
        { protocol: 1, revision: 7 },
        ),
    ).toThrow(/package\.json.*"version"/s);
  });

  it('refuses a boardsmith.json that declares a version of its own, even a matching one', () => {
    // Two places to state a version is one place too many: the copy that is
    // not read drifts, and nothing notices until a release is labelled wrong.
    expect(() =>
      deriveManifest(
        { name: 'fixture', version: '1.1.12' },
        { name: 'fixture', version: '1.1.12' },
        makeGameDefinition(2, 2),
        { protocol: 1, revision: 7 },
        ),
    ).toThrow(/boardsmith\.json.*"version".*package\.json/s);
  });
});

// WR-02 regression: `.boardsmith` is a SHARED directory (pack tarballs,
// evolve-bot-weights' rules-bundle.mjs fallback, a running dev server's runtime
// bundle). build's temp-dir cleanup must only ever remove a build-owned
// subdirectory, never the shared parent.
describe('build temp-dir scoping (WR-02)', () => {
  const src = readFileSync(join(__dirname, 'build.ts'), 'utf-8');

  it('uses a build-owned subdirectory of .boardsmith as its temp dir', () => {
    expect(src).toContain("join(cwd, '.boardsmith', 'build-tmp')");
    // The shared parent must never be the temp dir itself.
    expect(src).not.toMatch(/tempDir = join\(cwd, '\.boardsmith'\)/);
  });

  it('only rmSyncs the scoped tempDir, never the shared .boardsmith parent', () => {
    const rmTargets = [...src.matchAll(/rmSync\(([^,)]+)/g)].map((m) => m[1].trim());
    expect(rmTargets).toEqual(['tempDir']);
  });
});

/**
 * THE WORLD UI FLAG IS GONE (BoardSmith #170).
 *
 * It said whether the build had produced a world surface, so a host could
 * choose between mounting the bundle's own and showing a generic one. #170
 * makes the entry ALWAYS emitted for a world project, which is what
 * ShufflewickPub #128 actually needed: a host reading "no world.html" as "this
 * game ships no world UI" cannot tell that apart from a UI that failed to
 * deploy, and answers a broken publish with a surface that looks deliberate.
 *
 * A constant-true flag is worse than no flag -- it invites a branch on a
 * question with one answer -- so the field went with the branch. A `world`
 * block implies a surface, and `uiUrl === null` now means the publish is broken
 * (ShufflewickPub #357).
 */
describe('deriveManifest — the world block', () => {
  const worldConfig = { name: 'fixture', displayName: 'Fixture', world: { maxPlayers: 40 } };

  it('carries the world block through untouched, with no derived ui flag', () => {
    const manifest = deriveManifest(worldConfig, PKG, makeGameDefinition(2, 4), { protocol: 1, revision: 7 });
    expect(manifest.world).toEqual({ maxPlayers: 40 });
  });

  it('strips a hand-written ui flag nowhere reads any more', () => {
    const config = { ...worldConfig, world: { maxPlayers: 40, ui: true } };
    const manifest = deriveManifest(config, PKG, makeGameDefinition(2, 4), { protocol: 1, revision: 7 });
    expect((manifest.world as Record<string, unknown>).ui).toBeUndefined();
  });

  it('leaves a game that is not a world alone', () => {
    const manifest = deriveManifest({ name: 'fixture' }, PKG, makeGameDefinition(2, 4), { protocol: 1, revision: 7 });
    expect(manifest.world).toBeUndefined();
  });
});


/**
 * BoardSmith #168: a project may have either UI entry point, or both.
 *
 * Naming an input that does not exist fails the build with rollup's
 * `UNRESOLVED_ENTRY` and a stack trace, which is not a sentence anybody can act
 * on. The world direction was the one that broke: `world.html` was named only
 * when it existed, but `index.html` was assumed always to, so the first
 * world-only project ever scaffolded could not be built at all.
 */
describe('resolveUiBuild — which surfaces a project has (#168)', () => {
  it('leaves a table game on Vite\'s own default input, unchanged', () => {
    expect(resolveUiBuild('/game', true, false)).toEqual({ surfaces: '' });
  });

  it('names both entries for a game that has a table and a world', () => {
    expect(resolveUiBuild('/game', true, true)).toEqual({
      surfaces: 'table and world',
      input: { index: join('/game', 'index.html'), world: join('/game', 'world.html') },
    });
  });

  it('names only world.html for a world with no table half', () => {
    expect(resolveUiBuild('/game', false, true)).toEqual({
      surfaces: 'world',
      input: { world: join('/game', 'world.html') },
    });
  });

  it('refuses a project with no surface at all, in a sentence naming both entries', () => {
    expect(() => resolveUiBuild('/game', false, false)).toThrow(/index\.html/);
    expect(() => resolveUiBuild('/game', false, false)).toThrow(/world\.html/);
  });
});
