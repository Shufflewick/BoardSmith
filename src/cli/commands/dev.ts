import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createServer as createViteServer } from 'vite';
import type { Plugin as VitePlugin } from 'vite';
import { build } from 'esbuild';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import chalk from 'chalk';
import open from 'open';

import type { GameDefinition, Op, OpResult } from '../../session/index.js';
import { MultiplayerHost } from '../dev-host/multiplayer-host.js';
import { getProjectContext, boardsmithResolvePlugin, cliMonorepoRoot, toPosix, BOARDSMITH_PACKAGE_DIRS } from './game-runtime.js';
import { findUnknownKeys } from '../lib/config-schema.js';

/** executeOp bundled from the SAME module graph as the rules (one engine). */
type RuntimeExecuteOp = (
  def: { gameClass: new (...args: unknown[]) => unknown; gameType: string; minPlayers: number; maxPlayers: number },
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: unknown,
  pendingState: Record<string, unknown> | null,
  op: Op,
  hostOptions?: { teachingDisabled?: boolean },
) => Promise<OpResult>;
import type { DevHostConfig, DevOptionDef } from '../dev-host/config-types.js';

interface DevOptions {
  port: string;
  host?: string;
  lan?: boolean;
  players: string;
  ai?: string[];
  aiLevel?: string;
  lockTeaching?: boolean;
}

/** Thrown by the pure dev.ts flag/host validators below; `devCommand` catches
 * it, prints an actionable `chalk.red` error, and exits non-zero. Kept as a
 * distinct class (not a bare Error) so devCommand's catch can distinguish an
 * intentional validation failure from an unexpected bug. */
export class DevFlagError extends Error {}

/**
 * Fail-fast positive-integer parser for `--port`/`--players` (CLIX-06),
 * copying the `simulate.ts:145-153` idiom. Pure (no process.exit) so it is
 * directly unit-testable without a real dev server (PROC-02).
 */
export function parsePositiveInt(flagName: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new DevFlagError(`Error: --${flagName} must be a positive integer, got "${raw}"`);
  }
  return value;
}

/**
 * Fail-fast `--ai` seat parser (CLIX-06). Player positions are 1-indexed and
 * comma-separated per flag occurrence (`--ai 1,2` or repeated `--ai 1 --ai 2`).
 * Unlike the old `.filter(n => !isNaN(n))` behavior, a non-numeric entry now
 * throws instead of being silently dropped.
 */
export function parseAiSeats(raw: string[] | undefined): number[] {
  if (!raw) return [];
  const seats: number[] = [];
  for (const group of raw) {
    for (const part of group.split(',')) {
      const trimmed = part.trim();
      const value = Number(trimmed);
      if (!Number.isInteger(value)) {
        throw new DevFlagError(`Error: --ai must be a comma-separated list of positive integers, got "${trimmed}"`);
      }
      seats.push(value);
    }
  }
  return seats;
}

/**
 * CLIX-06 / F34: `--players` outside the game's [minPlayers, maxPlayers]
 * range now ERRORS (naming the bound) instead of silently clamping.
 */
export function resolveEffectivePlayerCount(playerCount: number, minPlayers: number, maxPlayers: number): number {
  if (playerCount < minPlayers || playerCount > maxPlayers) {
    throw new DevFlagError(
      `Error: --players ${playerCount} is out of range for this game (must be between ${minPlayers} and ${maxPlayers}).`,
    );
  }
  return playerCount;
}

/**
 * CLIX-06 / F34 (Pitfall 3): `--ai` seats must be validated against the
 * EFFECTIVE (post-resolution) player count, not the raw pre-clamp CLI value —
 * call this only after `resolveEffectivePlayerCount` has run.
 */
export function validateAiSeats(aiPlayers: number[], effectivePlayerCount: number): void {
  const invalidAiPlayers = aiPlayers.filter(p => p < 1 || p > effectivePlayerCount);
  if (invalidAiPlayers.length > 0) {
    throw new DevFlagError(
      `Error: Invalid AI player position(s): ${invalidAiPlayers.join(', ')}\n` +
        `Player positions are 1-indexed (1 to ${effectivePlayerCount}).\n` +
        `Example: --ai 2 for a 2-player game means player 2 is AI.`,
    );
  }
}

/**
 * CLIX-04 / F32: `boardsmith dev` defaults to 127.0.0.1 (local-only).
 * `--lan` is shorthand for `--host 0.0.0.0`; an explicit `--host` always wins.
 * This REVERSES the previous LAN-by-default (0.0.0.0) — 135-RESEARCH.md's
 * State-of-the-Art table incorrectly stated the default stayed 0.0.0.0; the
 * F32 verdict in 135-FINDINGS-VERIFICATION.md corrects that and governs here.
 */
export function resolveHost(options: { host?: string; lan?: boolean }): { host: string; isNonLocal: boolean } {
  const host = options.host ?? (options.lan ? '0.0.0.0' : '127.0.0.1');
  const isNonLocal = host !== '127.0.0.1' && host !== 'localhost';
  return { host, isNonLocal };
}

/**
 * CLIX-02 / F22: loud (non-exiting) startup warning for unknown top-level
 * `boardsmith.json` keys, reusing the Plan 05 `config-schema` module. `dev`
 * WARNS (does not exit) — `boardsmith validate` is the hard gate.
 */
export function formatUnknownKeyWarnings(config: Record<string, unknown>): string[] {
  return findUnknownKeys(config).map(({ key, suggestion }) =>
    suggestion
      ? `Warning: Unknown boardsmith.json key "${key}" (did you mean "${suggestion}"?) — this key is ignored.`
      : `Warning: Unknown boardsmith.json key "${key}" — this key is ignored.`,
  );
}

/** Option definition in boardsmith.json array format (id/name is a field, not a key) */
interface ConfigOptionDefinition {
  id?: string;
  name?: string;
  type: string;
  label: string;
  description?: string;
  default?: unknown;
  [key: string]: unknown;
}

interface BoardSmithConfig {
  name: string;
  displayName?: string;
  // CLIX-01: no minPlayers/maxPlayers/playerCount fields — gameDefinition
  // (compiled rules) is the sole source of truth for player count.
  rulesPackage?: string;
  paths?: {
    rules?: string;
    ui?: string;
  };
  /** Game-level options (array format for JSON config) */
  gameOptions?: ConfigOptionDefinition[];
  /** Per-player options (array format for JSON config) */
  playerOptions?: ConfigOptionDefinition[];
  /** Custom color palette (hex strings or objects with hex/value + label) */
  colorPalette?: Array<string | Record<string, unknown>>;
}

/**
 * Normalize colorPalette entries to {value, label} format.
 * Accepts plain hex strings, {value, label}, or {hex, label, id} objects.
 */
function normalizeColorPalette(
  palette: Array<string | Record<string, unknown>>
): Array<{ value: string; label: string }> {
  return palette.map(entry => {
    if (typeof entry === 'string') return { value: entry, label: entry };
    const hex = (entry.value ?? entry.hex ?? entry.color) as string | undefined;
    const label = (entry.label ?? entry.name ?? hex) as string | undefined;
    return { value: hex ?? '', label: label ?? '' };
  });
}

/**
 * Convert boardsmith.json array-format options to the object-keyed format
 * that GameDefinition uses. The array format uses { name, type, ... } entries,
 * while the object format uses { [name]: { type, ... } }.
 */
function configOptionsToRecord<T>(options: ConfigOptionDefinition[]): Record<string, T> {
  const result: Record<string, unknown> = {};
  for (const opt of options) {
    const { id, name, ...rest } = opt;
    const key = id ?? name;
    if (!key) continue;
    result[key] = rest;
  }
  return result as Record<string, T>;
}

/** Flatten object-keyed option definitions to the dev host's id-carrying list. */
function optionRecordToList(record: Record<string, unknown> | undefined): DevOptionDef[] {
  if (!record) return [];
  return Object.entries(record).map(([id, def]) => ({ id, ...(def as object) } as DevOptionDef));
}

// Get the CLI's directory to find the dev-host source (cliMonorepoRoot is
// imported from game-runtime.ts, computed there so `__dirname` path-depth
// math for both files stays identical).
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Locate the dev-host source directory. It ships in the package `src/` (the
 * package `files` array includes `src`), so it is present whether the CLI runs
 * from source (tsx) or from the bundled `dist/cli.js`.
 */
function resolveDevHostDir(): string {
  const candidates = [
    resolve(__dirname, '..', 'dev-host'),                 // tsx: src/cli/commands → src/cli/dev-host
    resolve(__dirname, '..', 'src', 'cli', 'dev-host'),   // bundled: dist → <root>/src/cli/dev-host
    resolve(__dirname, 'dev-host'),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, 'host-main.ts'))) return c;
  }
  return candidates[0];
}

/**
 * Bundle and load the game runtime (Node side): the author's `gameDefinition`
 * AND `executeOp`, from ONE esbuild bundle so they share a single engine
 * instance. This matters because the Node multiplayer host runs the game with
 * `executeOp(gameDefinition.gameClass, …)`; if `executeOp` came from the CLI's
 * own bundle instead, it would be a different engine module than the rules'
 * base classes and cross-instance identity (instanceof, registries) would break
 * — the same reason production externalizes a single boardsmith for the executor.
 */
async function loadGameRuntime(
  rulesPath: string,
  tempDir: string,
  context: 'monorepo' | 'standalone',
): Promise<{ gameDefinition: GameDefinition; executeOp: RuntimeExecuteOp }> {
  const rulesIndexPath = join(rulesPath, 'index.ts');
  const entryPath = join(tempDir, 'runtime-entry.ts');
  writeFileSync(
    entryPath,
    [
      `export { gameDefinition } from ${JSON.stringify(toPosix(rulesIndexPath))};`,
      `export { executeOp } from 'boardsmith/session';`,
    ].join('\n'),
  );
  const bundlePath = join(tempDir, 'runtime-bundle.mjs');

  await build({
    entryPoints: [entryPath],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: bundlePath,
    logLevel: 'silent',
    plugins: [boardsmithResolvePlugin(context)],
  });

  const moduleUrl = pathToFileURL(bundlePath).href;
  const module = await import(`${moduleUrl}?t=${Date.now()}`);

  if (!module.gameDefinition) {
    throw new Error('Rules module must export a gameDefinition');
  }
  if (typeof module.executeOp !== 'function') {
    throw new Error("Could not load executeOp from 'boardsmith/session'.");
  }

  return { gameDefinition: module.gameDefinition, executeOp: module.executeOp as RuntimeExecuteOp };
}

// Ports blocked by browsers for security (Chrome's restricted port list)
const UNSAFE_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723,
  2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697,
  10080,
]);

/** The URL the host iframe loads to render the game UI (GameShell, platform mode). */
const GAME_IFRAME_PATH = '/__boardsmith/play';

/**
 * The dev-host Vite plugin: it serves the HOST page in the main window, exposes
 * the author's gameDefinition + dev config as virtual modules, and lets the game
 * UI be served (via SPA fallback) at the iframe route. This is what makes
 * `boardsmith dev` drive the game through the production iframe/postMessage path.
 */
function boardsmithDevHostPlugin(args: {
  devHostDir: string;
  rulesIndexPath: string;
  devConfig: DevHostConfig;
}): VitePlugin {
  const VIRTUAL_GAME = 'virtual:boardsmith-game';
  const VIRTUAL_CONFIG = 'virtual:boardsmith-dev-config';
  const RESOLVED_GAME = '\0' + VIRTUAL_GAME;
  const RESOLVED_CONFIG = '\0' + VIRTUAL_CONFIG;

  const hostHtmlPath = join(args.devHostDir, 'host.html');
  const hostMainPath = join(args.devHostDir, 'host-main.ts');

  return {
    name: 'boardsmith-dev-host',
    enforce: 'pre',
    resolveId(source) {
      if (source === VIRTUAL_GAME) return RESOLVED_GAME;
      if (source === VIRTUAL_CONFIG) return RESOLVED_CONFIG;
      return null;
    },
    load(id) {
      if (id === RESOLVED_GAME) {
        // Re-export the author's compiled rules so the host page runs the SAME
        // gameDefinition the executor would, with no sandbox (author's own code).
        return `export { gameDefinition } from ${JSON.stringify(toPosix(args.rulesIndexPath))};`;
      }
      if (id === RESOLVED_CONFIG) {
        return `export const devConfig = ${JSON.stringify(args.devConfig)};`;
      }
      return null;
    },
    configureServer(server) {
      // Serve the HOST page for the main window. Added in configureServer so it
      // runs before Vite's SPA index fallback, which then serves the GAME UI at
      // the iframe route (GAME_IFRAME_PATH) in platform mode.
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url ?? '/').split('?')[0];
        if (url !== '/' && url !== '/index.html') return next();
        try {
          const raw = readFileSync(hostHtmlPath, 'utf-8').replace(
            '__HOST_MAIN_SRC__',
            `/@fs/${toPosix(hostMainPath)}`,
          );
          const html = await server.transformIndexHtml(req.url ?? '/', raw);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html');
          res.end(html);
        } catch (err) {
          next(err as Error);
        }
      });
    },
  };
}

/** Build the dev-host config the browser consumes from the resolved game definition. */
function buildDevConfig(args: {
  gameDefinition: GameDefinition;
  minPlayers: number;
  maxPlayers: number;
  playerCount: number;
  aiSeats: number[];
  aiLevel: string;
  colorPalette: Array<{ value: string; label: string }>;
  teachingDisabled: boolean;
}): DevHostConfig {
  const gd = args.gameDefinition as GameDefinition & {
    gameOptions?: Record<string, unknown>;
    playerOptions?: Record<string, unknown>;
  };
  return {
    gameType: gd.gameType,
    displayName: gd.displayName ?? gd.gameType,
    minPlayers: args.minPlayers,
    maxPlayers: args.maxPlayers,
    playerCount: args.playerCount,
    aiSeats: args.aiSeats,
    aiLevel: args.aiLevel,
    gameOptions: optionRecordToList(gd.gameOptions),
    playerOptions: optionRecordToList(gd.playerOptions),
    colorPalette: args.colorPalette,
    gameUrl: GAME_IFRAME_PATH,
    teachingDisabled: args.teachingDisabled,
  };
}

/**
 * Runs a `DevFlagError`-throwing validator; on failure prints the actionable
 * `chalk.red` message and exits non-zero (`devCommand`'s `process.exit(1)`
 * convention). Any other error rethrows — this only intercepts intentional
 * flag/host validation failures, not unexpected bugs.
 */
function exitOnDevFlagError<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof DevFlagError) {
      console.error(chalk.red(error.message));
      process.exit(1);
    }
    throw error;
  }
}

export async function devCommand(options: DevOptions): Promise<void> {
  // Fail-fast on non-numeric --port/--players/--ai (CLIX-06) — actionable
  // errors before any server work, matching simulate.ts's Number.isInteger idiom.
  const port = exitOnDevFlagError(() => parsePositiveInt('port', options.port));
  const playerCount = exitOnDevFlagError(() => parsePositiveInt('players', options.players));
  const aiPlayers = exitOnDevFlagError(() => parseAiSeats(options.ai));

  // CLIX-04: default 127.0.0.1 (local-only); --lan / --host 0.0.0.0 opts into
  // LAN exposure. This REVERSES the previous LAN-by-default (0.0.0.0) per the
  // F32 verdict in 135-FINDINGS-VERIFICATION.md.
  const { host, isNonLocal } = resolveHost({ host: options.host, lan: options.lan });
  const cwd = process.cwd();

  if (UNSAFE_PORTS.has(port)) {
    console.error(chalk.red(`Error: Port ${port} is blocked by browsers for security reasons.`));
    console.error(chalk.dim('Try a different port like 5173, 3000, 8080, or any port above 1024 that isn\'t restricted.'));
    process.exit(1);
  }

  const aiLevel = options.aiLevel ?? 'medium';
  // Single source of truth for the teaching lockout — passed into both the server
  // (MultiplayerHost → createDevSession adapters) and the client (buildDevConfig →
  // DevHost.vue init postMessage → GameShell).
  const teachingDisabled = options.lockTeaching === true;

  // NOTE: --ai seat validation is intentionally NOT done here (Pitfall 3 /
  // F34) — it must run against the EFFECTIVE post-resolution player count,
  // which is only known once gameDefinition's minPlayers/maxPlayers are
  // loaded below. See the `validateAiSeats` call after `resolveEffectivePlayerCount`.

  const configPath = join(cwd, 'boardsmith.json');
  if (!existsSync(configPath)) {
    console.error(chalk.red('Error: boardsmith.json not found'));
    console.error(chalk.dim('Make sure you are in a BoardSmith game project directory'));
    process.exit(1);
  }

  const config: BoardSmithConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
  console.log(chalk.cyan(`\nStarting development server for ${config.displayName || config.name}...`));

  // CLIX-02: loud (non-exiting) warning on unknown top-level boardsmith.json
  // keys — dev warns, `boardsmith validate` is the hard gate.
  for (const warning of formatUnknownKeyWarnings(config as unknown as Record<string, unknown>)) {
    console.warn(chalk.yellow(`  ${warning}`));
  }

  // CLIX-04 (T-135-12): loud, unmissable banner whenever the effective bind
  // host is non-localhost — exposure to the LAN must never be silent.
  if (isNonLocal) {
    console.log(chalk.yellow(`  ⚠ Serving to your whole network (binding ${host}) — anyone on your LAN can join and browse project source.`));
    console.log(chalk.yellow(`    Pass --host 127.0.0.1 for local-only.`));
  }

  const context = getProjectContext(cwd);
  if (context === 'monorepo') {
    console.log(chalk.dim('  Running in monorepo context (using source resolution)'));
  }

  const uiPath = config.paths?.ui ? resolve(cwd, config.paths.ui) : cwd;
  const rulesPath = config.paths?.rules ? resolve(cwd, config.paths.rules) : join(cwd, 'src', 'rules');

  if (!existsSync(uiPath)) {
    console.error(chalk.red(`Error: UI path not found: ${uiPath}`));
    process.exit(1);
  }

  const rulesIndexPath = join(rulesPath, 'index.ts');
  if (!existsSync(rulesIndexPath)) {
    console.error(chalk.red(`Error: Rules not found at ${rulesIndexPath}`));
    console.error(chalk.dim('Make sure your game has a src/rules/index.ts that exports gameDefinition'));
    process.exit(1);
  }

  // Temp dir for the Node-side rules metadata bundle.
  const tempDir = join(cwd, '.boardsmith');
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }

  console.log(chalk.dim(`  Loading game rules from ${rulesPath}...`));

  // Load the game runtime (Node side): gameDefinition + executeOp, one engine.
  let gameDefinition: GameDefinition;
  let runExecuteOp: RuntimeExecuteOp;
  let minPlayers: number;
  let maxPlayers: number;
  let colorPalette: Array<{ value: string; label: string }> = [];
  try {
    const runtime = await loadGameRuntime(rulesPath, tempDir, context);
    gameDefinition = runtime.gameDefinition;
    runExecuteOp = runtime.executeOp;

    // CLIX-01: gameDefinition (code) is the SOLE source of truth for player
    // count — the boardsmith.json config.playerCount/minPlayers fallbacks are
    // removed (they are provably dead: the scaffold always writes
    // gameDefinition.minPlayers/maxPlayers, per the F9 verdict).
    minPlayers = gameDefinition.minPlayers;
    maxPlayers = gameDefinition.maxPlayers;

    // boardsmith.json is the single source of truth for option definitions.
    const gameOptions = config.gameOptions
      ? configOptionsToRecord<import('../../session/types.js').GameOptionDefinition>(config.gameOptions)
      : undefined;

    let playerOptions = config.playerOptions
      ? configOptionsToRecord<import('../../session/types.js').PlayerOptionDefinition>(config.playerOptions)
      : undefined;

    if (config.colorPalette) {
      colorPalette = normalizeColorPalette(config.colorPalette);
      playerOptions = {
        ...playerOptions,
        color: { type: 'color' as const, label: 'Color', choices: colorPalette },
      };
    }

    gameDefinition = {
      ...gameDefinition,
      minPlayers,
      maxPlayers,
      ...(gameOptions && { gameOptions }),
      ...(playerOptions && { playerOptions }),
    };

    console.log(chalk.dim(`  Loaded game: ${gameDefinition.displayName || gameDefinition.gameType}`));
  } catch (error) {
    console.error(chalk.red('Failed to load game rules:'), error);
    process.exit(1);
  }

  // CLIX-06 / F34 (Pitfall 3): out-of-range --players now ERRORS (naming the
  // bound) instead of silently clamping, and --ai seats are validated against
  // this EFFECTIVE count, not the raw pre-clamp CLI value — both checks must
  // run here, after minPlayers/maxPlayers are known.
  const effectivePlayerCount = exitOnDevFlagError(() => resolveEffectivePlayerCount(playerCount, minPlayers, maxPlayers));
  exitOnDevFlagError(() => validateAiSeats(aiPlayers, effectivePlayerCount));

  const devConfig = buildDevConfig({
    gameDefinition,
    minPlayers,
    maxPlayers,
    playerCount: effectivePlayerCount,
    aiSeats: aiPlayers,
    aiLevel,
    colorPalette,
    teachingDisabled,
  });

  const devHostDir = resolveDevHostDir();
  const boardsmithRoot = resolve(devHostDir, '..', '..', '..');

  // Clear Vite cache to prevent stale file references when switching games
  const viteCacheDir = join(uiPath, 'node_modules', '.vite');
  if (existsSync(viteCacheDir)) {
    console.log(chalk.dim('  Clearing Vite cache...'));
    try {
      rmSync(viteCacheDir, { recursive: true, force: true });
    } catch {
      // best-effort; dev works even if stale cache remains
    }
  }

  const vitePlugins: VitePlugin[] = [
    boardsmithDevHostPlugin({ devHostDir, rulesIndexPath, devConfig }),
  ];

  // In monorepo context, add plugin to resolve boardsmith imports to src/
  if (context === 'monorepo') {
    const boardsmithVitePlugin: VitePlugin = {
      name: 'boardsmith-resolve',
      enforce: 'pre',
      resolveId(source: string) {
        if (!source.startsWith('boardsmith')) return null;

        const srcDirs = BOARDSMITH_PACKAGE_DIRS;

        const srcDir = srcDirs[source];
        if (srcDir) {
          return join(cliMonorepoRoot, 'src', srcDir, 'index.ts');
        }

        if (source.startsWith('boardsmith/')) {
          const parts = source.replace('boardsmith/', '').split('/');
          const pkgName = parts[0];
          const subpath = parts.slice(1).join('/');
          const pkgSrcDir = srcDirs[`boardsmith/${pkgName}`];

          if (pkgSrcDir && subpath) {
            const srcPath = join(cliMonorepoRoot, 'src', pkgSrcDir);
            if (subpath.endsWith('.css')) {
              return join(srcPath, 'src', subpath);
            }
            const subpathFile = join(srcPath, 'src', `${subpath}.ts`);
            if (existsSync(subpathFile)) {
              return subpathFile;
            }
            const subpathIndex = join(srcPath, 'src', subpath, 'index.ts');
            if (existsSync(subpathIndex)) {
              return subpathIndex;
            }
            const componentsPath = join(srcPath, 'src', 'components', subpath, 'index.ts');
            if (existsSync(componentsPath)) {
              return componentsPath;
            }
          }
        }

        return null;
      },
    };
    vitePlugins.unshift(boardsmithVitePlugin);
  }

  // Always exclude all boardsmith subpaths - Vite requires exact matches for deep imports
  const optimizeDepsExclude = ['boardsmith', 'boardsmith/ui', 'boardsmith/client', 'boardsmith/session'];

  try {
    const vite = await createViteServer({
      root: uiPath,
      // SPA fallback serves the GAME UI (index.html → GameShell) at the iframe
      // route; the dev-host plugin intercepts '/' to serve the HOST page.
      appType: 'spa',
      server: {
        port,
        host,
        strictPort: true,
        open: false,
        fs: {
          // Allow serving the dev-host source + boardsmith source (via /@fs/) and
          // the game project (rules/ui) outside the Vite root.
          allow: [uiPath, cwd, boardsmithRoot],
        },
      },
      plugins: vitePlugins,
      optimizeDeps: {
        exclude: optimizeDepsExclude,
      },
    });

    await vite.listen();

    // ── Always-on multiplayer host ────────────────────────────────────────
    // The engine is inherently multiplayer, so dev is too: the CLI process owns
    // the authoritative SnapshotSessionHost (the local stand-in for the
    // ShufflewickPub game DO) and every browser is a WebSocket client. A solo
    // dev is just one client; others on the LAN join the same game.
    const gameDef = {
      gameClass: gameDefinition.gameClass as new (...args: unknown[]) => unknown,
      gameType: gameDefinition.gameType,
      minPlayers,
      maxPlayers,
      // Thread tutorial definition un-serialized (mirrors game-session.ts).
      // Required so buildPlayerState emits hasTutorial in all state broadcasts
      // and the startTutorial op can access it from def.tutorial.
      tutorial: gameDefinition.tutorial,
      // Thread AI config (hintTargetFromMove + objectives) into the stateless executor.
      // Required so hint/heatmapToggle ops can run MCTS and extract board targets.
      ai: gameDefinition.ai,
    };
    const baseGameOptions = Object.fromEntries(devConfig.gameOptions.map((o) => [o.id, o.default]));
    const clients = new Map<string, WebSocket>();
    const mpHost = new MultiplayerHost({
      playerCount: effectivePlayerCount,
      minPlayers,
      aiLevel,
      designatedAiSeats: aiPlayers,
      colorPalette,
      baseGameOptions,
      teachingDisabled,
      executeOp: (gameOptions, snapshot, pendingState, op, hostOptions) =>
        runExecuteOp(gameDef, gameOptions, snapshot, pendingState, op, hostOptions),
      send: (clientId, message) => {
        const sock = clients.get(clientId);
        if (sock && sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify(message));
      },
    });

    if (!vite.httpServer) throw new Error('Vite dev server has no HTTP server to attach the WS host to.');
    // CRITICAL: use `noServer` and route upgrades ourselves. Attaching a second
    // WebSocketServer with `{ server }` collides with Vite's own HMR WebSocket on
    // the same http server — both break, HMR drops, and Vite reload-loops the
    // page. We only claim `/__boardsmith/ws` and leave every other upgrade
    // (including Vite HMR) for Vite's handler.
    const WS_PATH = '/__boardsmith/ws';
    const wss = new WebSocketServer({ noServer: true });
    vite.httpServer.on('upgrade', (req, socket, head) => {
      let pathname: string;
      try {
        pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      } catch {
        return;
      }
      if (pathname !== WS_PATH) return; // not ours — Vite HMR handles it
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });

    // A rejected message handler must never crash the dev process.
    const dispatch = (clientId: string, msg: Parameters<typeof mpHost.handleMessage>[1]) => {
      Promise.resolve(mpHost.handleMessage(clientId, msg)).catch((err) => {
        console.error(chalk.red(`[boardsmith dev] message '${msg.type}' failed:`), err);
      });
    };

    wss.on('connection', (socket) => {
      let clientId: string | null = null;
      socket.on('message', (raw) => {
        let msg: { type?: string; clientId?: unknown; [key: string]: unknown };
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (msg.type === 'hello') {
          clientId = typeof msg.clientId === 'string' ? msg.clientId : `anon-${Math.random().toString(36).slice(2)}`;
          clients.set(clientId, socket);
          dispatch(clientId, { type: 'hello' });
          return;
        }
        if (!clientId) return; // a client must identify itself via `hello` first
        dispatch(clientId, msg as Parameters<typeof mpHost.handleMessage>[1]);
      });
      socket.on('close', () => {
        if (clientId) {
          clients.delete(clientId);
          mpHost.disconnect(clientId);
        }
      });
    });

    const resolvedUrl = vite.resolvedUrls?.local[0];
    const uiPort = resolvedUrl ? parseInt(new URL(resolvedUrl).port || '5173', 10) : port;

    if (uiPort !== port) {
      console.log(chalk.yellow(`  Warning: Vite is using port ${uiPort} instead of requested port ${port}`));
      console.log(chalk.dim(`  (Check if the game's vite.config.ts has a hardcoded port)`));
    }

    const hostUrl = `http://localhost:${uiPort}`;
    console.log(chalk.green(`  Dev host running on ${hostUrl}`));
    for (const networkUrl of vite.resolvedUrls?.network ?? []) {
      console.log(chalk.cyan(`  Network (others can join): ${networkUrl}`));
    }

    console.log(chalk.dim(`  Multiplayer: each browser is a player; open the page on another computer to join.`));
    console.log(chalk.cyan(`  Seats: ${effectivePlayerCount} (open seats play as AI${aiPlayers.length ? `; --ai ${aiPlayers.join(',')} pre-marked` : ''}, level ${aiLevel}).`));
    if (teachingDisabled) {
      console.log(chalk.yellow(`  Teaching lockout active (--lock-teaching): hint, heatmap, demo, and tutorial are disabled.`));
    }

    await open(hostUrl);

    console.log(chalk.green('\n  Ready! Press Ctrl+C to stop.\n'));

    const cleanup = async () => {
      console.log(chalk.dim('\n  Shutting down...'));
      wss.close();
      clients.clear();
      await vite.close();
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

  } catch (error) {
    console.error(chalk.red('Failed to start Vite dev server:'), error);
    process.exit(1);
  }
}
