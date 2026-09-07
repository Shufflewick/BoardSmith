import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { build as viteBuild } from 'vite';
import chalk from 'chalk';
import ora from 'ora';
import { BUNDLE_PROTOCOL_VERSION } from '../../engine/protocol-version.js';
import { ENGINE_REVISION } from '../../contract/index.js';
import { getProjectContext, loadGameDefinition } from './game-runtime.js';
import { buildCli, CLI_ENTRY, CLI_OUTFILE } from '../lib/build-cli.js';
import { requireGameProjectManifests } from '../lib/game-project.js';
import { ensureWorldEntry, WORLD_ENTRY_HTML } from '../lib/world-entry.js';
import { readWorldDefinition, type WorldDefinition } from '../../world/index.js';
import type { GameBackend, GameDefinition } from '../../session/index.js';
import {
  GAME_BACKENDS,
  capabilityContradictions,
  isGameBackend,
  resolveCapabilities,
} from '../../session/index.js';

interface BuildOptions {
  outDir?: string;
}

/**
 * THE GAME VERSION (ShufflewickPub #240).
 *
 * package.json is the single source of truth, because it is the version the
 * PLATFORM already pins a release under: `boardsmith publish` reads
 * `pkg.version` and refuses to publish without it. A manifest version taken
 * from anywhere else can only ever agree with that by coincidence.
 *
 * There is no default. This used to fall back to the literal '1.0.0' when
 * boardsmith.json omitted a version, which labelled eleven games in the
 * catalogue as a version they were not, and a bundle that states the wrong
 * version is worse than a build that stops and says so.
 *
 * Pure and cheap, so `buildCommand` calls it before Vite runs (a project that
 * cannot state its version should hear about it in a second, not after a full
 * compile) and `deriveManifest` calls it again, which keeps the rule true for
 * every caller rather than only for the CLI path.
 */
function resolveGameVersion(
  config: Record<string, unknown>,
  pkg: Record<string, unknown>,
): string {
  if (config.version !== undefined) {
    throw new Error(
      `boardsmith.json declares "version": ${JSON.stringify(config.version)}, but a game's version comes only `
      + `from package.json (currently ${JSON.stringify(pkg.version ?? null)}). `
      + 'Delete the "version" key from boardsmith.json so the two can never disagree.',
    );
  }
  const version = typeof pkg.version === 'string' ? pkg.version.trim() : '';
  if (version === '') {
    throw new Error(
      'Cannot determine the game version: package.json has no usable "version" field. '
      + 'package.json is the one place a game states its version, and it is what `boardsmith publish` '
      + 'sends to the platform. Add one to package.json, e.g. "version": "1.0.0".',
    );
  }
  return version;
}

/**
 * WHICH BACKEND THIS PROJECT DECLARED, or a refusal naming both answers.
 *
 * `boardsmith.json` is where it is declared and the compiled rules are what it
 * is checked against (`capabilityContradictions` below). There is no default:
 * a default backend is a backend nobody chose, and the two hold state in
 * fundamentally different ways.
 */
function readBackend(config: Record<string, unknown>): GameBackend {
  const declared = config.backend;
  if (isGameBackend(declared)) return declared;
  const named = GAME_BACKENDS.map((backend) => `"${backend}"`).join(' or ');
  throw new Error(
    `boardsmith.json must declare a "backend": ${named}. `
    + '"table" holds the whole element tree resident, snapshots per action, and keeps history, '
    + 'undo, bots and spectators; "world" keeps only named partitions resident, checkpoints what '
    + 'a command dirtied, and runs continuously. '
    + (declared === undefined
      ? 'It has no default: what a game may promise its players follows from it.'
      : `Got ${JSON.stringify(declared)}, which is not a backend this engine runs.`),
  );
}

/**
 * Pure manifest-derivation function (T-135-07). Takes the raw parsed
 * `boardsmith.json`, the COMPILED `gameDefinition`, and what the build actually
 * produced, and returns the publish manifest.
 *
 * ## Everything a reader needs is DERIVED here, and derived once
 *
 * `backend` is the one thing an author declares, and this is where it is
 * checked against the code that implements it. Everything that FOLLOWS from it
 * -- whether the game has a table, whether it can be played asynchronously,
 * whether a seat can be a bot, whether a move can be taken back -- is resolved
 * into the single `capabilities` object (#171) that the shell, the CLI and the
 * publishing platform all read INSTEAD OF THE BACKEND'S NAME. The flags that
 * object was resolved from do not travel beside it: two places to look is how
 * the platform ended up with three separate per-flag manifest parsers, each
 * read by a different surface.
 *
 * `playerCount` is a TABLE's seat range and is derived from
 * `gameDefinition.minPlayers/maxPlayers`, set AFTER the `...config` spread so
 * the derived value always overwrites a stale hand-edited one (CLIX-01 / F9).
 * A WORLD-ONLY bundle emits none at all: it has no table, and a derived one is
 * exactly what made the three example worlds ship a vestigial table half the
 * game page then led with (ShufflewickPub #354).
 *
 * `world.maxPlayers` is likewise derived, from `gameDefinition.world.maxPlayers`
 * -- the number the RUNTIME enforces. It used to be hand-written in
 * `boardsmith.json` beside a second hand-written copy in the rules, and only
 * the manifest's was ever checked at publish while only the code's was ever
 * enforced at run time.
 *
 * The version comes from `package.json` and is likewise never copied from the
 * config spread; `resolveGameVersion` above is the whole rule.
 */
/**
 * THE MANIFEST'S WORLD BLOCK, DERIVED WHOLE FROM THE COMPILED RULES (#194).
 *
 * Both numbers in it come from `gameDefinition.world` and neither may be
 * hand-written in `boardsmith.json`, which is #171's rule for capacity applied
 * to the compatibility promise for the same reason: the manifest's copy is what
 * the platform checks, the rules' copy is what the world actually is, and two
 * places to write one number is how they come to disagree.
 *
 * `readWorldDefinition` is the library's own reading of that block, so an
 * unusable one is refused HERE, at build, in the same sentence the dev host
 * would have used -- rather than passing validation and failing on somebody's
 * first command.
 *
 * `stateVersion` is written down even when it is 0, so an author who declares
 * nothing and one who declares zero publish the same bytes.
 */
function deriveWorldBlock(world: WorldDefinition): { maxPlayers: number; stateVersion: number } {
  const declared = readWorldDefinition({ world });
  return { maxPlayers: declared.maxPlayers, stateVersion: declared.stateVersion ?? 0 };
}

export function deriveManifest(
  config: Record<string, unknown>,
  pkg: Record<string, unknown>,
  gameDefinition: Pick<
    GameDefinition,
    'minPlayers' | 'maxPlayers' | 'bot' | 'persistence' | 'world'
  >,
  engine: { protocol: number; revision: number },
  artifacts: { tableUi: boolean; worldUi: boolean },
): Record<string, unknown> {
  const backend = readBackend(config);

  // EVERY WAY THE DECLARATION AND THE CODE DISAGREE, IN ONE ERROR. Reporting
  // them one at a time turns a single bad edit into a queue of rebuilds.
  const contradictions = capabilityContradictions({
    backend,
    definition: gameDefinition,
    declared: config,
  });
  if (contradictions.length > 0) {
    throw new Error(contradictions.join('\n\n'));
  }

  const version = resolveGameVersion(config, pkg);

  // WHAT THE BUILD ACTUALLY PRODUCED HAS TO MATCH THE DECLARED BACKEND, and a
  // mismatch is refused in every direction rather than recorded.
  //
  // There is no `world.ui` flag any more (BoardSmith #170), and its absence is
  // the point. It said whether the build had produced a world surface, so a
  // host could choose between mounting the bundle's own and showing a generic
  // one of its own. ShufflewickPub #128 is the reason that could not hold: a
  // host reading "no world.html" as "this game ships no world UI" cannot tell
  // that apart from a UI that failed to deploy, and answers a broken publish
  // with a surface that looks deliberate.
  //
  // So a world project ALWAYS emits its entry (`ensureWorldEntry`), the flag
  // would be constant-true, and a constant-true flag is worse than no flag: it
  // invites a branch on a question with one answer. Declaring "backend":
  // "world" IS the claim that a surface is there, which is why the missing one
  // below is an error and not a `false`. `uiUrl === null` then means the
  // publish is broken, which is the one thing the platform needs it to mean
  // (ShufflewickPub #357).
  //
  // The other two directions are a surface the declared backend cannot mount:
  // nothing could ever load it, so it is bytes in every download for a page no
  // player can reach.
  if (backend === 'world' && !artifacts.worldUi) {
    throw new Error(
      'This project declares "backend": "world" but the build produced no ' + WORLD_ENTRY_HTML
      + ', so a player would have no world surface to load. A world project always emits its '
      + 'entry; if this bundle has none, the build that made it did not run `boardsmith build`.',
    );
  }
  if (backend === 'table' && artifacts.worldUi) {
    throw new Error(
      'This project has a world.html entry but boardsmith.json declares "backend": "table", so '
      + 'nothing could ever mount it. Set "backend": "world" and export a `world` block from your '
      + 'gameDefinition, or delete world.html.',
    );
  }
  if (backend === 'table' && !artifacts.tableUi) {
    throw new Error(
      'This project declares "backend": "table" and has no index.html, so a player has no table '
      + 'surface to load. A table mounts GameShell from index.html; add one, or declare '
      + '"backend": "world".',
    );
  }

  const { minPlayers, maxPlayers } = gameDefinition;
  const hasTableRoster = Number.isInteger(minPlayers) && Number.isInteger(maxPlayers);

  // The flags the capability set was RESOLVED FROM never travel beside it.
  const { asyncPlay: _asyncPlay, joinInProgress: _joinInProgress, ...rest } = config;

  return {
    ...rest,
    backend,
    capabilities: resolveCapabilities({
      backend,
      definition: gameDefinition,
      declared: config,
    }),
    // A world's seat count and its state version, and nothing else: the surface
    // is guaranteed above rather than described here (#170).
    ...(backend === 'world' ? { world: deriveWorldBlock(gameDefinition.world!) } : {}),
    buildTime: new Date().toISOString(),
    version,
    // Stamp the engine ABI version so the executor can reject a bundle built
    // against an incompatible BoardSmith (INFRA-04). Automatic — authors never
    // set this; it comes from the BoardSmith building the bundle.
    engineProtocol: engine.protocol,
    // Stamp the engine contract revision too. `engineProtocol` only moves on a
    // breaking ABI change, so it cannot express the far more common "this game
    // was built against a newer engine than the platform vendored" — which is
    // the skew that produces mystery runtime bugs. The platform rejects a
    // bundle whose revision exceeds its own. Also automatic.
    engineRevision: engine.revision,
    // Derived — never copied from the raw config spread. Absent entirely for a
    // world-only bundle, which is how the manifest says "this game has no
    // table".
    ...(hasTableRoster ? { playerCount: { min: minPlayers, max: maxPlayers } } : {}),
  };
}

/**
 * Build the BoardSmith library's own distributable: the bundled CLI.
 *
 * The engine/ui/session sources ship as TypeScript (see the package `exports`
 * map), so `dist/cli.js` is the only compiled artifact the library produces.
 */
async function buildLibrary(repoRoot: string): Promise<void> {
  console.log(chalk.cyan('\nBuilding BoardSmith CLI...\n'));
  const spinner = ora(`Bundling ${CLI_ENTRY}...`).start();

  try {
    await buildCli(repoRoot);
  } catch (error) {
    spinner.fail('CLI build failed');
    console.error(chalk.red('\nBuild error:'), error);
    process.exit(1);
  }

  spinner.succeed(`CLI built (${CLI_OUTFILE})`);
  console.log(chalk.dim('\n  Installed copies of BoardSmith run this bundle.'));
  console.log(chalk.dim('  Inside this repo the CLI always runs from source, so you rarely need it.\n'));
}


/**
 * WHICH SURFACES THIS PROJECT HAS, AND WHAT VITE MUST BE TOLD ABOUT THEM.
 *
 * A game can have either entry point or both, and naming one that does not
 * exist fails the build with rollup's `UNRESOLVED_ENTRY` rather than a sentence
 * anybody can act on. `index.html` mounts `GameShell` and is what a TABLE
 * loads; `world.html` mounts `WorldShell` and is what a persistent WORLD loads
 * -- a different shell because a world has no turn, no flow position and no
 * action table, and a table shell can only render one by being told things that
 * are not true (`src/ui/world/worldProtocol.ts`).
 *
 * A WORLD-ONLY PROJECT IS THE NORMAL SHAPE, not a broken one: `boardsmith init
 * --world` scaffolds exactly that, because a vestigial table half is what
 * BoardSmith #174 is taking OUT of the world games that have one.
 *
 * `input` is left undefined for a table alone, which is Vite's own default and
 * the case that must keep behaving identically.
 */
/**
 * Give a world project its entry if it has none, and say so.
 *
 * Its own function so `buildCommand` stays readable, and because the same two
 * files are written by `boardsmith dev` and `boardsmith init --world` from the
 * same generator -- one definition of what a world's entry is.
 */
async function writeWorldEntryIfMissing(
  cwd: string,
  config: Record<string, unknown>,
): Promise<void> {
  // The DECLARED backend is what decides, because it is the only thing the
  // build knows before it compiles the rules -- and #171 made it the one place
  // the answer is written (`world` is no longer a boardsmith.json key at all).
  if (config.backend !== 'world') return;
  const { created } = await ensureWorldEntry(cwd, String(config.displayName || config.name));
  for (const file of created) {
    console.log(
      chalk.dim(`  Wrote ${file} - a world project needs an entry, and this one had none.`),
    );
  }
}

export function resolveUiBuild(
  cwd: string,
  hasTableUi: boolean,
  hasWorldUi: boolean,
): { surfaces: string; input?: Record<string, string> } {
  if (!hasTableUi && !hasWorldUi) {
    throw new Error(
      `This project has no UI entry point: neither index.html nor ${WORLD_ENTRY_HTML} exists, so ` +
        'there is no surface for a player to load. A table game mounts GameShell from ' +
        `index.html; a persistent world mounts WorldShell from ${WORLD_ENTRY_HTML}.`,
    );
  }
  if (hasTableUi && !hasWorldUi) return { surfaces: '' };
  return {
    surfaces: hasTableUi ? 'table and world' : 'world',
    input: {
      ...(hasTableUi ? { index: join(cwd, 'index.html') } : {}),
      ...(hasWorldUi ? { world: join(cwd, WORLD_ENTRY_HTML) } : {}),
    },
  };
}

export async function buildCommand(options: BuildOptions): Promise<void> {
  const cwd = process.cwd();
  const outDir = options.outDir || 'dist';

  // `build` means "produce this workspace's distributable artifact". In a game
  // that is the rules/UI bundle below; in the BoardSmith library itself it is
  // the CLI bundle that installed copies of the package run.
  const context = getProjectContext(cwd);
  if (context === 'monorepo') {
    await buildLibrary(cwd);
    return;
  }

  // Validate project. The manifest's version comes from package.json, never
  // from boardsmith.json (ShufflewickPub #240), so both files are read here —
  // before anything is compiled.
  const { config, pkg } = requireGameProjectManifests(cwd);
  try {
    resolveGameVersion(config, pkg);
  } catch (error) {
    console.error(chalk.red(`Error: ${(error as Error).message}`));
    process.exit(1);
  }

  console.log(chalk.cyan(`\nBuilding ${config.displayName || config.name}...\n`));

  const spinner = ora('Building game rules...').start();

  try {
    // Build rules (TypeScript -> JS)
    // copyPublicDir disabled — public/ is copied once to dist root below
    await viteBuild({
      root: cwd,
      build: {
        outDir: join(outDir, 'rules'),
        copyPublicDir: false,
        lib: {
          entry: join(cwd, 'src/rules/index.ts'),
          name: config.name,
          fileName: () => 'rules.js',
          formats: ['cjs'],
        },
        rollupOptions: {
          // Mark boardsmith and all its subpath exports as external
          external: ['boardsmith', /^boardsmith\//],
        },
        emptyOutDir: true,
        // Keep class names — the game engine uses constructor.name for element
        // type identification in serialized state and player views.
        minify: 'esbuild',
      },
      esbuild: {
        keepNames: true,
      },
      logLevel: 'warn',
    });
    spinner.succeed('Game rules built');

    // Build UI (Vue -> JS bundle)
    //
    // TWO ENTRY POINTS WHEN THE GAME HAS TWO SURFACES (ShufflewickPub #128).
    // `index.html` mounts `GameShell` and is what a TABLE loads. `world.html`,
    // when the project has one, mounts `WorldShell` and is what a RESIDENT
    // WORLD loads -- a different shell because a world has no turn, no flow
    // position and no action table, and a table shell can only render one by
    // being told things that are not true (`src/ui/world/worldProtocol.ts`).
    //
    // Both land at the bundle root (`src/cli/lib/zip.ts` strips the `ui/`
    // prefix), so the host asks for `.../index.html` or `.../world.html` and
    // gets the surface it meant.
    //
    // A WORLD PROJECT ALWAYS EMITS THE WORLD ENTRY (#170). If the author never
    // wrote one, it is written into their project here -- ordinary files, in
    // source control, identical to what `boardsmith init --world` scaffolds --
    // rather than conjured at build time, so what `boardsmith dev` serves is
    // what production loads. `world.ui` is gone from the manifest with the
    // branch it fed; see `deriveManifest`.
    const tableEntry = join(cwd, 'index.html');
    const worldEntry = join(cwd, WORLD_ENTRY_HTML);
    const hasTableUi = existsSync(tableEntry);
    await writeWorldEntryIfMissing(cwd, config);
    const hasWorldUi = existsSync(worldEntry);
    const ui = resolveUiBuild(cwd, hasTableUi, hasWorldUi);
    spinner.start(`Building UI${ui.surfaces === '' ? '' : ` (${ui.surfaces})`}...`);
    await viteBuild({
      root: cwd,
      base: './',
      build: {
        outDir: join(outDir, 'ui'),
        copyPublicDir: false,
        emptyOutDir: true,
        ...(ui.input === undefined ? {} : { rollupOptions: { input: ui.input } }),
      },
      logLevel: 'warn',
    });
    spinner.succeed(`UI built${ui.surfaces === '' ? '' : ` (${ui.surfaces})`}`);

    // Copy public/ assets once to dist root (not into each sub-build)
    const publicDir = join(cwd, 'public');
    if (existsSync(publicDir)) {
      cpSync(publicDir, join(cwd, outDir), { recursive: true });
    }

    // Copy and update config
    spinner.start('Generating manifest...');

    // Load the COMPILED gameDefinition (Node-side) so playerCount can be
    // derived from code, never copied from the raw boardsmith.json spread
    // (CLIX-01 / T-135-07 — mirrors simulate.ts:158-167).
    const rulesPath = join(cwd, 'src', 'rules');
    // Command-scoped subdirectory (WR-02): `.boardsmith` is SHARED — pack puts
    // tarballs in `.boardsmith/tarballs`, evolve-bot-weights reads
    // `.boardsmith/rules-bundle.mjs`, and a running dev server keeps its
    // runtime bundle there. Only ever create and delete what build owns.
    const tempDir = join(cwd, '.boardsmith', 'build-tmp');
    mkdirSync(tempDir, { recursive: true });

    let gameDefinition: GameDefinition;
    try {
      ({ gameDefinition } = await loadGameDefinition(rulesPath, tempDir, context));
    } finally {
      try {
        // Removes only build-tmp — never the shared .boardsmith parent.
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup; do not mask the original error
      }
    }

    const manifest = deriveManifest(
      config,
      pkg,
      gameDefinition,
      {
        protocol: BUNDLE_PROTOCOL_VERSION,
        revision: ENGINE_REVISION,
      },
      { tableUi: hasTableUi, worldUi: hasWorldUi },
    );

    mkdirSync(join(cwd, outDir), { recursive: true });
    writeFileSync(
      join(cwd, outDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );
    spinner.succeed('Manifest generated');

    // Report build sizes
    console.log(chalk.green('\nBuild complete!\n'));
    console.log(chalk.dim(`  Output: ${outDir}/`));
    console.log(chalk.dim(`    rules/  - Game logic bundle`));
    console.log(chalk.dim(`    ui/     - User interface bundle`));
    if (hasWorldUi) {
      if (hasTableUi) {
        console.log(chalk.dim(`      index.html - the table surface (GameShell)`));
      }
      console.log(chalk.dim(`      world.html - the resident-world surface (WorldShell)`));
    }
    console.log(chalk.dim(`    manifest.json - Game metadata\n`));

    console.log(chalk.cyan('Next steps:'));
    console.log(chalk.dim('  boardsmith validate  - Run pre-publish checks'));
    console.log(chalk.dim('  boardsmith publish   - Publish to boardsmith.io\n'));

  } catch (error) {
    spinner.fail('Build failed');
    console.error(chalk.red('\nBuild error:'), error);
    process.exit(1);
  }
}
