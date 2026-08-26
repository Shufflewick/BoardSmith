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
import { DEFAULT_COLOR_PALETTE, type GameStateSnapshot } from '../../engine/index.js';
import { MultiplayerHost } from '../dev-host/multiplayer-host.js';
import { createDevHostConnectionHandler } from '../dev-host/connection-handler.js';
import { getProjectContext, boardsmithResolvePlugin, cliMonorepoRoot, toPosix, BOARDSMITH_PACKAGE_DIRS } from './game-runtime.js';
import { findUnknownKeys } from '../lib/config-schema.js';
import { parseBotLevel } from '../../bot/index.js';

/** executeOp bundled from the SAME module graph as the rules (one engine). */
type RuntimeExecuteOp = (
  def: { gameClass: new (...args: unknown[]) => unknown; gameType: string; minPlayers: number; maxPlayers: number },
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: unknown,
  pendingState: Record<string, unknown> | null,
  op: Op,
  hostOptions?: { teachingDisabled?: boolean; seedSnapshot?: GameStateSnapshot },
) => Promise<OpResult>;
import type { DevHostConfig, DevOptionDef } from '../dev-host/config-types.js';
import { validateGameOptionSelection } from '../dev-host/config-types.js';
import type { GameOptionDefinition, GamePreset } from '../../session/types.js';

interface DevOptions {
  port: string;
  host?: string;
  lan?: boolean;
  /** Unset when `--players` is not passed (D14: defaults to the game's minPlayers, resolved once it's known). */
  players?: string;
  bot?: string[];
  botLevel?: string;
  lockTeaching?: boolean;
  /** Commander's negatable `--no-open` sets this to `false`; unset/true auto-opens. */
  open?: boolean;
  /** D13/DEVHOST-01: repeatable `--game-option key=value`. */
  gameOption?: string[];
  /** D13/DEVHOST-01: `--preset name` applies a declared preset's whole bundle. */
  preset?: string;
  /** FEAT-01/168-02: path to a recorded GameStateSnapshot JSON file to seed the initial state from. */
  seed?: string;
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
 * Fail-fast `--seed <file>` parser (FEAT-01/168-02). Reads and parses a
 * recorded `GameStateSnapshot` JSON file so `--seed` can thread it into the
 * host's `start` op instead of a fresh start. Fails LOUD — naming the exact
 * path and reason — on a missing file or invalid JSON; there is deliberately
 * NO silent fallback to a fresh start (CLAUDE.md hard rule: no fallbacks that
 * mask real problems). Pure (no process.exit) so it is directly unit-testable,
 * mirroring `parsePositiveInt`/`parseBotSeats`.
 */
export function parseSeedFile(path: string): GameStateSnapshot {
  if (!existsSync(path)) {
    throw new DevFlagError(`Error: --seed file not found: ${path}`);
  }
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new DevFlagError(`Error: --seed file could not be read at ${path}: ${reason}`);
  }
  try {
    return JSON.parse(raw) as GameStateSnapshot;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new DevFlagError(`Error: --seed file at ${path} is not valid JSON: ${reason}`);
  }
}

/**
 * Fail-fast `--bot-level` validator. The level names a difficulty preset or an
 * explicit iteration count; anything else is a typo, and a session that quietly
 * downgrades to medium hides it for every move of every game.
 */
export function validateBotLevel(level: string): void {
  try {
    parseBotLevel(level);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new DevFlagError(`Error: --bot-level is invalid. ${reason}`);
  }
}

/**
 * Fail-fast `--bot` seat parser (CLIX-06). Player positions are 1-indexed and
 * comma-separated per flag occurrence (`--bot 1,2` or repeated `--bot 1 --bot 2`).
 * Unlike the old `.filter(n => !isNaN(n))` behavior, a non-numeric entry now
 * throws instead of being silently dropped.
 */
export function parseBotSeats(raw: string[] | undefined): number[] {
  if (!raw) return [];
  const seats: number[] = [];
  for (const group of raw) {
    for (const part of group.split(',')) {
      const trimmed = part.trim();
      const value = Number(trimmed);
      if (!Number.isInteger(value)) {
        throw new DevFlagError(`Error: --bot must be a comma-separated list of positive integers, got "${trimmed}"`);
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
 * D14/DEVHOST-02: `--players` defaults to the game's `minPlayers` (not a
 * hardcoded '2') so a bare `boardsmith dev` on a solo game (minPlayers=1,
 * maxPlayers=1) starts instead of erroring (default 2 > max 1). An EXPLICIT
 * `--players` is unaffected: it still runs through `parsePositiveInt` +
 * `resolveEffectivePlayerCount`, which still throws on an out-of-range value
 * naming the bound — this only changes what happens when the flag is unset.
 */
export function resolvePlayerCount(rawPlayers: string | undefined, minPlayers: number, maxPlayers: number): number {
  if (rawPlayers === undefined) return minPlayers;
  return resolveEffectivePlayerCount(parsePositiveInt('players', rawPlayers), minPlayers, maxPlayers);
}

/**
 * CLIX-06 / F34 (Pitfall 3): `--bot` seats must be validated against the
 * EFFECTIVE (post-resolution) player count, not the raw pre-clamp CLI value —
 * call this only after `resolveEffectivePlayerCount` has run.
 */
export function validateBotSeats(botPlayers: number[], effectivePlayerCount: number): void {
  const invalidBotPlayers = botPlayers.filter(p => p < 1 || p > effectivePlayerCount);
  if (invalidBotPlayers.length > 0) {
    throw new DevFlagError(
      `Error: Invalid bot player position(s): ${invalidBotPlayers.join(', ')}\n` +
        `Player positions are 1-indexed (1 to ${effectivePlayerCount}).\n` +
        `Example: --bot 2 for a 2-player game means player 2 is bot.`,
    );
  }
}

/**
 * CLIX-04 / F32: `boardsmith dev` defaults to 127.0.0.1 (local-only).
 * `--lan` is shorthand for `--host 0.0.0.0`. This REVERSES the previous
 * LAN-by-default (0.0.0.0) — 135-RESEARCH.md's State-of-the-Art table
 * incorrectly stated the default stayed 0.0.0.0; the F32 verdict in
 * 135-FINDINGS-VERIFICATION.md corrects that and governs here.
 *
 * WR-04: combining `--lan` with an explicit `--host` ERRORS instead of
 * silently dropping one — silently ignoring a security-relevant flag is the
 * same class of defect this phase removed from `--bot`/`--players`.
 */
/**
 * 138: whether `devCommand` should auto-launch a real browser tab at the dev
 * host URL. Defaults to true (the normal interactive workflow) but `--no-open`
 * (commander's negatable-option convention sets `options.open = false`) opts
 * out — required for scripted/headless drivers of `boardsmith dev` (e.g.
 * Playwright smokes), where the auto-opened REAL system browser would
 * otherwise connect over WS as an uncontrolled extra player and win the
 * "first arrival auto-seats seat 1" race in MultiplayerHost.hello() before the
 * scripted client ever connects — starving the scripted client of its own
 * seat's turn (or, in a simultaneousActionStep, letting the bot auto-play the
 * seat the scripted client meant to occupy during the brief bot-seat window
 * before it joins).
 */
export function shouldOpenBrowser(options: { open?: boolean }): boolean {
  return options.open !== false;
}

export function resolveHost(options: { host?: string; lan?: boolean }): { host: string; isNonLocal: boolean } {
  if (options.lan && options.host !== undefined) {
    throw new DevFlagError(
      `Error: --lan and --host ${options.host} conflict; pass one or the other.\n` +
        `--lan is shorthand for --host 0.0.0.0 (serve to your whole network).`,
    );
  }
  const host = options.host ?? (options.lan ? '0.0.0.0' : '127.0.0.1');
  const isNonLocal = host !== '127.0.0.1' && host !== 'localhost';
  return { host, isNonLocal };
}

/**
 * Host-aware multiplayer banner line. Under the local-only default
 * (127.0.0.1) no other computer can connect — telling the user to "open the
 * page on another computer" would send them down a path that fails silently.
 * Point them at --lan instead; only a non-local bind gets the join message.
 */
export function multiplayerBannerLine(isNonLocal: boolean): string {
  return isNonLocal
    ? 'Multiplayer: each browser is a player; open the page on another computer to join.'
    : 'Multiplayer: each browser tab is a player. To let other computers join, restart with --lan.';
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
 *
 * IN-01: an object entry missing all of `value`/`hex`/`color` is malformed
 * (a typo'd field name, most often) — warn loudly (matches the
 * `formatUnknownKeyWarnings` non-exiting pattern) and DROP the entry instead
 * of emitting an invisible/unclickable empty-string swatch in the lobby
 * color picker.
 */
function normalizeColorPalette(
  palette: Array<string | Record<string, unknown>>
): Array<{ value: string; label: string }> {
  const result: Array<{ value: string; label: string }> = [];
  for (const entry of palette) {
    if (typeof entry === 'string') {
      result.push({ value: entry, label: entry });
      continue;
    }
    const hex = (entry.value ?? entry.hex ?? entry.color) as string | undefined;
    if (hex === undefined) {
      console.warn(
        chalk.yellow(
          `  Warning: colorPalette entry ${JSON.stringify(entry)} is missing "value"/"hex"/"color" — skipped (not rendered as a swatch).`,
        ),
      );
      continue;
    }
    const label = (entry.label ?? entry.name ?? hex) as string;
    result.push({ value: hex, label });
  }
  return result;
}

/**
 * D16/DEVHOST-04: ordered dev color-palette resolver — a game's
 * code-declared `GameDefinition.colorPalette` is honored ahead of
 * `boardsmith.json`'s `colorPalette`, which is honored ahead of the engine's
 * `DEFAULT_COLOR_PALETTE`. Reuses `normalizeColorPalette` (already coerces
 * plain hex strings, `{value,label}`, and `{id,hex,label}` objects) — no new
 * normalizer, no new palette shape.
 */
export function resolveColorPalette(
  gameDefinition: { colorPalette?: Array<{ id: string; hex: string; label: string }> },
  config: { colorPalette?: Array<string | Record<string, unknown>> },
): Array<{ value: string; label: string }> {
  if (gameDefinition.colorPalette) return normalizeColorPalette(gameDefinition.colorPalette);
  if (config.colorPalette) return normalizeColorPalette(config.colorPalette);
  return normalizeColorPalette([...DEFAULT_COLOR_PALETTE]);
}

/**
 * D13/DEVHOST-01: parse repeatable `--game-option key=value` flags into a flat
 * record, splitting each entry on the FIRST "=" (a value may itself contain
 * "="). Fail-loud (T-161-03) on an entry missing "=" instead of silently
 * dropping it — matches the `parsePositiveInt`/`parseBotSeats` idiom.
 */
export function parseGameOptionFlags(raw: string[] | undefined): Record<string, string> {
  if (!raw) return {};
  const result: Record<string, string> = {};
  for (const entry of raw) {
    const eq = entry.indexOf('=');
    if (eq === -1) {
      throw new DevFlagError(
        `Error: --game-option must be "key=value", got "${entry}" (missing "=").`,
      );
    }
    result[entry.slice(0, eq)] = entry.slice(eq + 1);
  }
  return result;
}

/**
 * D13/DEVHOST-01: merge `gameDefinition.gameOptions` with `boardsmith.json`'s
 * `gameOptions` — gameDefinition is AUTHORITATIVE on a key conflict. Replaces
 * the previous replace-not-merge spread (`...(gameOptions && { gameOptions })`)
 * that silently dropped one source's options whenever the other declared any.
 */
export function mergeGameOptionDefinitions(
  gameDefOptions: Record<string, GameOptionDefinition> | undefined,
  configOptions: Record<string, GameOptionDefinition> | undefined,
): Record<string, GameOptionDefinition> {
  return { ...configOptions, ...gameDefOptions };
}

/** D13/DEVHOST-01: a preset's resolved options bundle + optional player count. */
export interface ResolvedPreset {
  options: Record<string, unknown>;
  /** Present only when the preset declares `players` (its length is the count). */
  playerCount?: number;
}

/**
 * D13/DEVHOST-01: look up a preset by name (`--preset name` or the host
 * `configure` message's `preset` field). Applying a preset is a shortcut for
 * setting its underlying options — returns the WHOLE bundle (never a partial
 * pick) plus the preset's player count when it declares `players`. Throws an
 * actionable `DevFlagError` naming the unknown preset and the declared names.
 */
export function resolvePreset(presets: GamePreset[] | undefined, name: string): ResolvedPreset {
  const preset = (presets ?? []).find((p) => p.name === name);
  if (!preset) {
    const known = (presets ?? []).map((p) => p.name).join(', ') || '(none declared)';
    throw new DevFlagError(`Error: --preset "${name}" is not declared by this game. Declared presets: ${known}.`);
  }
  const resolved: ResolvedPreset = { options: { ...preset.options } };
  if (preset.players?.length) resolved.playerCount = preset.players.length;
  return resolved;
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
  botSeats: number[];
  botLevel: string;
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
    botSeats: args.botSeats,
    botLevel: args.botLevel,
    gameOptions: optionRecordToList(gd.gameOptions),
    playerOptions: optionRecordToList(gd.playerOptions),
    // D13/DEVHOST-01: gameDefinition.presets, surfaced for the first time so a
    // browser selector (Plan 03) can render them and apply one via `configure`.
    presets: gd.presets ?? [],
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
  // Fail-fast on non-numeric --port/--players/--bot (CLIX-06) — actionable
  // errors before any server work, matching simulate.ts's Number.isInteger idiom.
  const port = exitOnDevFlagError(() => parsePositiveInt('port', options.port));
  const botPlayers = exitOnDevFlagError(() => parseBotSeats(options.bot));
  // NOTE: --players is resolved AFTER gameDefinition loads (D14) — its default
  // is the game's minPlayers, not a literal, so it cannot be parsed this early.

  // CLIX-04: default 127.0.0.1 (local-only); --lan / --host 0.0.0.0 opts into
  // LAN exposure. This REVERSES the previous LAN-by-default (0.0.0.0) per the
  // F32 verdict in 135-FINDINGS-VERIFICATION.md. Combining --lan with an
  // explicit --host errors (WR-04).
  const { host, isNonLocal } = exitOnDevFlagError(() => resolveHost({ host: options.host, lan: options.lan }));
  const cwd = process.cwd();

  if (UNSAFE_PORTS.has(port)) {
    console.error(chalk.red(`Error: Port ${port} is blocked by browsers for security reasons.`));
    console.error(chalk.dim('Try a different port like 5173, 3000, 8080, or any port above 1024 that isn\'t restricted.'));
    process.exit(1);
  }

  const botLevel = options.botLevel ?? 'medium';
  validateBotLevel(botLevel);
  // Single source of truth for the teaching lockout — passed into both the server
  // (MultiplayerHost → createDevSession adapters) and the client (buildDevConfig →
  // DevHost.vue init postMessage → GameShell).
  const teachingDisabled = options.lockTeaching === true;

  // FEAT-01/168-02: --seed reads + parses the file up front (fail loud before
  // any server work, mirroring the other flag validators above) and threads
  // the resulting GameStateSnapshot into MultiplayerHost below.
  const seedSnapshot = options.seed !== undefined
    ? exitOnDevFlagError(() => parseSeedFile(resolve(process.cwd(), options.seed as string)))
    : undefined;

  // NOTE: --bot seat validation is intentionally NOT done here (Pitfall 3 /
  // F34) — it must run against the EFFECTIVE post-resolution player count,
  // which is only known once gameDefinition's minPlayers/maxPlayers are
  // loaded below. See the `validateBotSeats` call after `resolveEffectivePlayerCount`.

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

    // D13/DEVHOST-01: merge gameDefinition.gameOptions with boardsmith.json's
    // gameOptions — gameDefinition is AUTHORITATIVE on a key conflict. This
    // REPLACES the previous replace-not-merge spread, which silently dropped
    // whichever source's options weren't chosen. gameDefinition.presets are
    // read here for the first time (never read before).
    const configGameOptions = config.gameOptions
      ? configOptionsToRecord<GameOptionDefinition>(config.gameOptions)
      : undefined;
    const gameOptions = mergeGameOptionDefinitions(gameDefinition.gameOptions, configGameOptions);
    const presets: GamePreset[] = gameDefinition.presets ?? [];

    let playerOptions = config.playerOptions
      ? configOptionsToRecord<import('../../session/types.js').PlayerOptionDefinition>(config.playerOptions)
      : undefined;

    // D16/DEVHOST-04: gameDefinition.colorPalette -> boardsmith.json
    // colorPalette -> engine DEFAULT_COLOR_PALETTE. Always resolves to a
    // non-empty palette, so the `color` playerOption is always offered.
    colorPalette = resolveColorPalette(gameDefinition, config);
    playerOptions = {
      ...playerOptions,
      color: { type: 'color' as const, label: 'Color', choices: colorPalette },
    };

    gameDefinition = {
      ...gameDefinition,
      minPlayers,
      maxPlayers,
      gameOptions,
      presets,
      ...(playerOptions && { playerOptions }),
    };

    console.log(chalk.dim(`  Loaded game: ${gameDefinition.displayName || gameDefinition.gameType}`));
  } catch (error) {
    console.error(chalk.red('Failed to load game rules:'), error);
    process.exit(1);
  }

  // D13/DEVHOST-01: --game-option/--preset resolve into the SELECTED gameOptions
  // (flag beats preset beats default). A preset's player count is honored only
  // when --players was NOT explicitly passed (an explicit --players always wins).
  const gameOptionFlags = exitOnDevFlagError(() => parseGameOptionFlags(options.gameOption));
  const presetBundle =
    options.preset !== undefined
      ? exitOnDevFlagError(() => resolvePreset(gameDefinition.presets, options.preset as string))
      : undefined;
  const selectedGameOptions: Record<string, unknown> = { ...presetBundle?.options, ...gameOptionFlags };
  exitOnDevFlagError(() =>
    validateGameOptionSelection(optionRecordToList(gameDefinition.gameOptions), selectedGameOptions),
  );
  const rawPlayers = options.players ?? (presetBundle?.playerCount !== undefined ? String(presetBundle.playerCount) : undefined);

  // CLIX-06 / F34 (Pitfall 3): out-of-range --players now ERRORS (naming the
  // bound) instead of silently clamping, and --bot seats are validated against
  // this EFFECTIVE count, not the raw pre-clamp CLI value — both checks must
  // run here, after minPlayers/maxPlayers are known. D14: an UNSET --players
  // defaults to minPlayers instead of a hardcoded '2'.
  const effectivePlayerCount = exitOnDevFlagError(() => resolvePlayerCount(rawPlayers, minPlayers, maxPlayers));
  exitOnDevFlagError(() => validateBotSeats(botPlayers, effectivePlayerCount));

  const devConfig = buildDevConfig({
    gameDefinition,
    minPlayers,
    maxPlayers,
    playerCount: effectivePlayerCount,
    botSeats: botPlayers,
    botLevel,
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
      // Thread bot config (hintTargetFromMove + objectives) into the stateless executor.
      // Required so hint/heatmapToggle ops can run MCTS and extract board targets.
      bot: gameDefinition.bot,
    };
    // D13/DEVHOST-01: defaults, overlaid by the resolved --preset bundle, then
    // by --game-option flags (flag beats preset beats default) — replaces the
    // frozen `.default`-only computation.
    const optionDefaults = Object.fromEntries(devConfig.gameOptions.map((o) => [o.id, o.default]));
    const baseGameOptions = { ...optionDefaults, ...selectedGameOptions };
    const clients = new Map<string, WebSocket>();
    const mpHost = new MultiplayerHost({
      playerCount: effectivePlayerCount,
      minPlayers,
      maxPlayers,
      botLevel,
      designatedBotSeats: botPlayers,
      colorPalette,
      baseGameOptions,
      // D13/DEVHOST-01: lets a host `configure` wire message (Plan 03's
      // selector) validate and apply a selection after startup.
      declaredGameOptions: devConfig.gameOptions,
      presets: devConfig.presets,
      teachingDisabled,
      seedSnapshot,
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

    // Per-connection WS handling (hello routing + DEF-C stale-close guard) lives
    // in one shared, unit-tested factory so the dev server and the DEF-C
    // regression test run the identical implementation. A rejected message
    // handler must never crash the dev process — log and continue.
    wss.on(
      'connection',
      createDevHostConnectionHandler({
        mpHost,
        clients,
        onError: (err, msgType) =>
          console.error(chalk.red(`[boardsmith dev] message '${msgType}' failed:`), err),
      }),
    );

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

    console.log(chalk.dim(`  ${multiplayerBannerLine(isNonLocal)}`));
    console.log(chalk.cyan(`  Seats: ${effectivePlayerCount} (open seats play as bot${botPlayers.length ? `; --bot ${botPlayers.join(',')} pre-marked` : ''}, level ${botLevel}).`));
    if (teachingDisabled) {
      console.log(chalk.yellow(`  Teaching lockout active (--lock-teaching): hint, heatmap, demo, and tutorial are disabled.`));
    }
    if (seedSnapshot) {
      console.log(chalk.cyan(`  Seeded start (--seed ${options.seed}): initial state loaded from the recorded snapshot instead of a fresh start.`));
    }

    if (shouldOpenBrowser(options)) {
      await open(hostUrl);
    } else {
      console.log(chalk.dim('  Skipping auto-open (--no-open): connect a client to claim seat 1 yourself.'));
    }

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
