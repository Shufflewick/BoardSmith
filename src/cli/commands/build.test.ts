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
 * (the seat range, the world block, `bot` and `persistence`) are meaningful;
 * the rest satisfy the type.
 */
function makeGameDefinition(minPlayers: number, maxPlayers: number): GameDefinition {
  return {
    gameClass: class FixtureGame extends Game<FixtureGame, Player> {},
    gameType: 'fixture',
    minPlayers,
    maxPlayers,
  };
}

/** A world game's compiled definition: a world block with its own seat count,
 *  and NO table roster (#171 / ShufflewickPub #354). */
function makeWorldDefinition(maxPlayers = 40): GameDefinition {
  return {
    gameClass: class FixtureWorld extends Game<FixtureWorld, Player> {},
    gameType: 'fixture-world',
    world: { maxPlayers, actions: [], view: () => [] },
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
  gameDefinition: GameDefinition = makeGameDefinition(2, 4),
): Record<string, unknown> {
  return deriveManifest(
    { backend: 'table', ...config },
    PKG,
    gameDefinition,
    { protocol: 1, revision: 7 },
    { tableUi: true, worldUi: false },
  );
}

describe('deriveManifest', () => {
  it('derives playerCount from gameDefinition.minPlayers/maxPlayers', () => {
    const manifest = derive({ name: 'fixture', displayName: 'Fixture Game' });

    expect(manifest.playerCount).toEqual({ min: 2, max: 4 });
  });

  it('carries the round-policy blocks through the config spread untouched', () => {
    // `roundDeadline`/`idleAction` are platform POLICY rather than capabilities:
    // the platform reads them straight out of manifest.json, so the spread is
    // the whole transport. If a future manifest allowlist ever replaces the
    // spread, this is the test that catches the drop.
    const config = {
      name: 'fixture',
      idleAction: { name: 'pass' },
      roundDeadline: { defaultHours: 24, minHours: 6, maxHours: 72, mindingSafe: true },
    };

    const manifest = derive(config);

    expect(manifest.idleAction).toEqual({ name: 'pass' });
    expect(manifest.roundDeadline).toEqual(config.roundDeadline);
  });

  it('resolves the capability set, and does NOT leave the flags it was resolved from beside it', () => {
    // The whole point of #171: one object, and nothing to read instead of it.
    // `asyncPlay`/`joinInProgress` were the manifest's answer AND a capability
    // input; leaving both in would give a reader two places to look and one of
    // them would drift.
    const manifest = derive(
      { name: 'fixture', asyncPlay: true, joinInProgress: true },
      { ...makeGameDefinition(2, 4), persistence: true },
    );

    expect(manifest.backend).toBe('table');
    expect(manifest.capabilities).toEqual({
      table: true,
      world: false,
      undo: true,
      spectators: true,
      bots: false,
      asyncPlay: true,
      joinInProgress: true,
      crossSessionState: true,
    });
    expect(manifest.asyncPlay).toBeUndefined();
    expect(manifest.joinInProgress).toBeUndefined();
    expect(manifest.persistence).toBeUndefined();
    expect(manifest.bot).toBeUndefined();
  });

  it('refuses a manifest that declares no backend, naming both answers', () => {
    expect(() =>
      deriveManifest(
        { name: 'fixture' },
        PKG,
        makeGameDefinition(2, 4),
        { protocol: 1, revision: 7 },
        { tableUi: true, worldUi: false },
      ),
    ).toThrow(/"backend".*"table".*"world"/s);
  });

  it('refuses a backend name it does not run', () => {
    expect(() => derive({ name: 'fixture', backend: 'tables' })).toThrow(/"backend"/);
  });

  it('refuses a declaration the compiled rules contradict', () => {
    // The manifest says table; the rules export a world. Both directions are
    // refused rather than resolved by a precedence rule — picking a winner
    // would ship the mistake.
    expect(() => derive({ name: 'fixture' }, makeWorldDefinition())).toThrow(/"backend": "table"/);
    expect(() =>
      deriveManifest(
        { name: 'fixture', backend: 'world' },
        PKG,
        makeGameDefinition(2, 4),
        { protocol: 1, revision: 7 },
        { tableUi: true, worldUi: false },
      ),
    ).toThrow(/"backend": "world"/);
  });

  it('refuses each flag the world backend already answers, naming it', () => {
    for (const key of ['asyncPlay', 'joinInProgress'] as const) {
      expect(() =>
        deriveManifest(
          { name: 'fixture', backend: 'world', [key]: true },
          PKG,
          makeWorldDefinition(),
          { protocol: 1, revision: 7 },
          { tableUi: false, worldUi: true },
        ),
      ).toThrow(/world backend already answers/);
    }
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
      backend: 'table',
      displayName: 'Fixture Game',
      description: 'A test game',
    };
    const gameDefinition = makeGameDefinition(1, 8);

    const manifest = deriveManifest(config, { version: '2.0.0' }, gameDefinition, { protocol: 3, revision: 7 }, { tableUi: true, worldUi: false });

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

  it('throws an actionable error when a TABLE game lacks minPlayers/maxPlayers', () => {
    // minPlayers/maxPlayers are optional on GameDefinition — a TABLE game that
    // never declared them must fail the BUILD with the fix, not publish a
    // bundle whose playerCount silently serialized to nothing.
    const gameDefinition = { gameType: 'fixture' } as unknown as GameDefinition;

    expect(() => derive({ name: 'fixture' }, gameDefinition))
      .toThrow(/minPlayers\/maxPlayers.*src\/rules\/index\.ts/s);
  });
});

/**
 * ShufflewickPub #354: A WORLD-ONLY BUNDLE HAS NO TABLE, and the manifest has
 * to be able to say so. `playerCount` used to be derived unconditionally, so
 * deleting it from a world game's config did nothing — the next build stamped
 * it straight back, and the game page led with a Start button for a table the
 * game was never written to play.
 */
describe('deriveManifest — a world-only bundle', () => {
  const worldConfig = { name: 'fixture', displayName: 'Fixture', backend: 'world' };

  const deriveWorld = (
    config: Record<string, unknown> = worldConfig,
    definition: GameDefinition = makeWorldDefinition(),
    artifacts = { tableUi: false, worldUi: true },
  ) => deriveManifest(config, PKG, definition, { protocol: 1, revision: 7 }, artifacts);

  it('omits playerCount entirely rather than inventing a seat range', () => {
    expect(deriveWorld()).not.toHaveProperty('playerCount');
  });

  it('resolves the world backend\'s implied capability set', () => {
    expect(deriveWorld().capabilities).toEqual({
      table: false,
      world: true,
      undo: false,
      spectators: false,
      bots: false,
      asyncPlay: true,
      joinInProgress: true,
      crossSessionState: true,
    });
  });

  it('derives world.maxPlayers from the compiled rules, the number the runtime enforces', () => {
    // Two hand-written copies of a world's capacity is one too many: only the
    // manifest's was ever checked at publish, and only the code's was ever
    // enforced at run time.
    expect(deriveWorld(worldConfig, makeWorldDefinition(200)).world).toEqual({
      maxPlayers: 200,
      stateVersion: 0,
    });
  });

  // ── #194: the compatibility promise only the author can make ──────────────
  //
  // The platform refuses an upgrade between two versions whose `stateVersion`
  // differs, and reads it off the MANIFEST. A world author declares it beside
  // the seat count, in the compiled rules, and the build derives it -- the
  // same single-source rule #171 applied to capacity, for the same reason.

  it('derives world.stateVersion from the compiled rules', () => {
    const definition = { ...makeWorldDefinition(12), world: { ...makeWorldDefinition(12).world!, stateVersion: 3 } };
    expect(deriveWorld(worldConfig, definition as GameDefinition).world).toEqual({
      maxPlayers: 12,
      stateVersion: 3,
    });
  });

  it('a world that declares none is version 0, written down rather than implied', () => {
    // An absent declaration and an explicit zero produce the SAME manifest, so
    // "absent means 0" is a fact of the bytes and not a convention each reader
    // has to re-implement.
    const explicit = { ...makeWorldDefinition(12), world: { ...makeWorldDefinition(12).world!, stateVersion: 0 } };
    expect(deriveWorld(worldConfig, makeWorldDefinition(12)).world).toEqual(
      deriveWorld(worldConfig, explicit as GameDefinition).world,
    );
    expect(deriveWorld(worldConfig, makeWorldDefinition(12)).world).toEqual({
      maxPlayers: 12,
      stateVersion: 0,
    });
  });

  it.each([-1, 1.5, Number.NaN, '1', null])(
    'refuses %p as a stateVersion, naming what a usable one is',
    (bad) => {
      const definition = {
        ...makeWorldDefinition(12),
        world: { ...makeWorldDefinition(12).world!, stateVersion: bad as number },
      };
      expect(() => deriveWorld(worldConfig, definition as GameDefinition)).toThrow(/stateVersion/);
    },
  );

  it('refuses a world whose rules still declare a table roster', () => {
    const withRoster = { ...makeWorldDefinition(), minPlayers: 2, maxPlayers: 40 };
    expect(() => deriveWorld(worldConfig, withRoster)).toThrow(/minPlayers/);
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
      { name: 'fixture', backend: 'table' },
      { name: 'fixture', version: '1.1.12' },
      makeGameDefinition(2, 2),
      { protocol: 1, revision: 7 },
      { tableUi: true, worldUi: false },
    );

    expect(manifest.version).toBe('1.1.12');
  });

  it('fails the build, naming the file and key, when package.json states no version', () => {
    expect(() =>
      deriveManifest(
        { name: 'fixture', backend: 'table' },
        { name: 'fixture' },
        makeGameDefinition(2, 2),
        { protocol: 1, revision: 7 },
        { tableUi: true, worldUi: false },
      ),
    ).toThrow(/package\.json.*"version"/s);
  });

  it('never emits the old 1.0.0 default for a game that states no version', () => {
    let manifest: Record<string, unknown> | undefined;
    try {
      manifest = deriveManifest(
        { name: 'fixture', backend: 'table' },
        { name: 'fixture' },
        makeGameDefinition(2, 2),
        { protocol: 1, revision: 7 },
        { tableUi: true, worldUi: false },
      );
    } catch {
      manifest = undefined;
    }
    expect(manifest).toBeUndefined();
  });

  it('rejects an empty version string rather than labelling the bundle with nothing', () => {
    expect(() =>
      deriveManifest(
        { name: 'fixture', backend: 'table' },
        { name: 'fixture', version: '  ' },
        makeGameDefinition(2, 2),
        { protocol: 1, revision: 7 },
        { tableUi: true, worldUi: false },
      ),
    ).toThrow(/package\.json.*"version"/s);
  });

  it('refuses a boardsmith.json that declares a version of its own, even a matching one', () => {
    // Two places to state a version is one place too many: the copy that is
    // not read drifts, and nothing notices until a release is labelled wrong.
    expect(() =>
      deriveManifest(
        { name: 'fixture', backend: 'table', version: '1.1.12' },
        { name: 'fixture', version: '1.1.12' },
        makeGameDefinition(2, 2),
        { protocol: 1, revision: 7 },
        { tableUi: true, worldUi: false },
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
 * question with one answer -- so the field went with the branch. Declaring
 * "backend": "world" IS the claim that a surface is there, a bundle that has
 * none is refused, and `uiUrl === null` now means the publish is broken
 * (ShufflewickPub #357).
 */
describe('deriveManifest — the world surface', () => {
  const worldConfig = { name: 'fixture', displayName: 'Fixture', backend: 'world' };
  const worldDef = makeWorldDefinition();

  const derive = (worldUi: boolean) =>
    deriveManifest(worldConfig, PKG, worldDef, { protocol: 1, revision: 7 }, {
      tableUi: false,
      worldUi,
    });

  it('emits the world block with its seat count and NO ui flag', () => {
    // The flag would be constant-true, and a constant-true flag invites a
    // branch on a question with one answer.
    expect(derive(true).world).toEqual({ maxPlayers: 40, stateVersion: 0 });
  });

  it('refuses a world backend that built no world surface, rather than recording its absence', () => {
    // This is what replaced `world.ui: false`. There is no manifest that says
    // "a world with no surface" any more, which is what lets the platform read
    // `uiUrl === null` as "the publish is broken" and nothing else (#357).
    expect(() => derive(false)).toThrow(/world\.html/);
  });

  it('leaves a game that is not a world with no world block at all', () => {
    const manifest = deriveManifest(
      { name: 'fixture', backend: 'table' },
      PKG,
      makeGameDefinition(2, 4),
      { protocol: 1, revision: 7 },
      { tableUi: true, worldUi: false },
    );
    expect(manifest.world).toBeUndefined();
  });

  it('refuses a world UI in a bundle whose backend is a table, rather than shipping dead bytes', () => {
    expect(() =>
      deriveManifest(
        { name: 'fixture', backend: 'table' },
        PKG,
        makeGameDefinition(2, 4),
        { protocol: 1, revision: 7 },
        { tableUi: true, worldUi: true },
      ),
    ).toThrow(/world\.html/);
  });

  it('refuses a table backend that built no table surface', () => {
    expect(() =>
      deriveManifest(
        { name: 'fixture', backend: 'table' },
        PKG,
        makeGameDefinition(2, 4),
        { protocol: 1, revision: 7 },
        { tableUi: false, worldUi: false },
      ),
    ).toThrow(/index\.html/);
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
