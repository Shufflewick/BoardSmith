/**
 * `boardsmith dev` FOR A PERSISTENT WORLD (#167, closing #163).
 *
 * The world half of `dev.ts`, and a separate file for the reason
 * `world-host.ts` is separate from `multiplayer-host.ts`: the two serve
 * different documents, speak different wire protocols, and hold different
 * things authoritative. A table run owns a lobby, a seat picker, game options,
 * presets, bots and a snapshot session; a world run owns a durable store, a
 * schedule and a residency model, and has no lobby at all because the world is
 * already there before anybody opens a browser.
 *
 * WHAT IT SHARES WITH THE TABLE RUN, deliberately and by import rather than by
 * copy: the Vite server, `boardsmithResolvePlugin`'s monorepo resolution, the
 * "no SPA fallback, a missing asset is a 404" rule (issue 134), the
 * `noServer` WebSocket upgrade that leaves Vite's HMR socket alone, and the
 * iframe-in-platform-mode shape -- the outer page is dev chrome and the game's
 * own surface renders inside a frame over the exact protocol production uses.
 *
 * ## WHAT IT SERVES
 *
 * The bundle's `world.html`, and only ever that. There used to be a second
 * document with a debug board in it for a project that had written none, and
 * with it two code paths, only one of which production takes.
 *
 * #170 deleted the branch instead: a world project ALWAYS has an entry, written
 * into the author's own repository by `ensureWorldEntry` the first time it is
 * built or run, mounting `WorldShell` over `src/ui/uis.ts` exactly as a table's
 * `index.html` mounts `GameShell`. A world with no board of its own gets AutoUI
 * from its registry -- a real board, in the bundle, on the platform too, not a
 * surface only `boardsmith dev` could show.
 */

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import chalk from 'chalk';
import open from 'open';
import { createServer as createViteServer, type Plugin as VitePlugin } from 'vite';
import { WebSocket } from 'ws';

import { worldBudgets } from '../../world/index.js';
import {
  LocalWorldHost,
  type WorldDevRequest,
  type WorldLiftOutcome,
  type WorldMigrationOutcome,
} from '../dev-host/world-host.js';
import { openWorldStore, worldStorePath, type LocalWorldStore } from '../dev-host/world-store.js';
import { announceHost, onShutdown } from '../dev-host/shutdown.js';
import type { WorldDevConfig } from '../dev-host/world-config-types.js';
import { ensureWorldEntry, WORLD_ENTRY_HTML } from '../lib/world-entry.js';
import type { GameDefinition } from '../../session/index.js';
import { toPosix } from './game-runtime.js';
import {
  claimWebSocketPath,
  devNotFoundMiddleware,
  monorepoBoardsmithResolvePlugin,
  resolveDevHostDir,
  serveDevDocuments,
} from './dev-server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The document the world's own surface is served from.
 *
 * ONE path segment, for the reason `GAME_IFRAME_PATH` is one: a bundle
 * references its art the way its built dist does -- relatively -- and a
 * relative reference resolves against the DIRECTORY of the document making it.
 * At a nested path every asset would resolve one directory too deep and 404
 * (issue 134).
 */
export const WORLD_IFRAME_PATH = '/__boardsmith-world';

/** Where the world host's browser talks to the Node host. Distinct from the
 *  table host's `/__boardsmith/ws`, so a table client and a world host can
 *  never half-consume each other's frames. */
export const WORLD_WS_PATH = '/__boardsmith/world';

/** The lines `boardsmith dev` prints before a world starts. Returned rather
 *  than printed so their wording is testable. */
export function worldDevBanner(args: {
  worldName: string;
  seatCount: number;
  launched: boolean;
  storePath: string;
}): string[] {
  return [
    `Persistent world: ${args.worldName}, ${args.seatCount} seats.`,
    args.launched
      ? `  Reopening the world already in ${args.storePath}. Genesis has already run.`
      : `  This world has never been played. Genesis runs into ${args.storePath} at startup.`,
    `  Serving your ${WORLD_ENTRY_HTML}.`,
    '  The dev bar switches seats, fires due events without waiting for them, and wakes the',
    '  world from parked so the rehydration path is exercised rather than assumed.',
    '  `boardsmith dev --reset` deletes this world and runs genesis again.',
  ];
}

/**
 * The Vite plugin for a world run.
 *
 * Two documents and one virtual module, and it sets `appType: 'custom'` for the
 * reason the table's plugin does: Vite's SPA fallback answers EVERY unmatched
 * request with index.html at HTTP 200, so a missing card image becomes a
 * placeholder with no error anywhere (issue 134).
 */
function boardsmithWorldDevPlugin(args: {
  devHostDir: string;
  uiPath: string;
  surfacePath: string;
  config: WorldDevConfig;
}): VitePlugin {
  const VIRTUAL_CONFIG = 'virtual:boardsmith-world-dev-config';
  const RESOLVED_CONFIG = '\0' + VIRTUAL_CONFIG;
  const hostHtmlPath = join(args.devHostDir, 'world-host.html');
  const hostMainPath = join(args.devHostDir, 'world-host-main.ts');

  return {
    name: 'boardsmith-world-dev-host',
    enforce: 'pre',
    config() {
      return { appType: 'custom' as const };
    },
    resolveId(source) {
      return source === VIRTUAL_CONFIG ? RESOLVED_CONFIG : null;
    },
    load(id) {
      return id === RESOLVED_CONFIG
        ? `export const worldDevConfig = ${JSON.stringify(args.config)};`
        : null;
    },
    configureServer(server) {
      // The world run serves exactly two documents: the dev chrome in the main
      // window, and the world's own surface in the frame.
      serveDevDocuments(server, (url) => {
        const isHostPage = url === '/' || url === '/index.html';
        if (!isHostPage) {
          if (url !== WORLD_IFRAME_PATH) return null;
          // ONE PATH FROM AUTHOR TO PRODUCTION (#170): the bundle's own
          // `world.html`, served exactly as written, because a world project
          // always has one -- `ensureWorldEntry` wrote it if the author had not.
          // The second document this used to have, with a debug board inside it,
          // was a surface only `boardsmith dev` could ever show.
          return readFileSync(args.surfacePath, 'utf-8');
        }
        return readFileSync(hostHtmlPath, 'utf-8').replace(
          '__HOST_MAIN_SRC__',
          `/@fs/${toPosix(hostMainPath)}`,
        );
      });

      return devNotFoundMiddleware(
        server,
        () =>
          `This is a persistent-world run. The world's own surface is ${WORLD_IFRAME_PATH}; ` +
          `game assets live in the project's public/ directory and are served from the site ` +
          `root, so public/cards/x.png is /cards/x.png.\n`,
      );
    },
  };
}

interface WorldDevServerOptions {
  readonly cwd: string;
  readonly uiPath: string;
  readonly gameDefinition: GameDefinition;
  readonly displayName: string;
  readonly context: 'monorepo' | 'standalone';
  readonly port: number;
  readonly host: string;
  readonly tempDir: string;
  readonly openBrowser: boolean;
  /**
   * READ THE PROJECT'S RULES AGAIN (#201).
   *
   * A world runs the rules this process loaded at startup, and an author's
   * saved edits reach only the browser -- so a rule edit used to leave the new
   * UI acting on the old rules, and the world committed the result. This is how
   * the host gets the new ones: `loadGameRuntime` cache-busts its own import,
   * so calling it again is a genuine re-read of the edited source.
   */
  readonly reloadRules: () => Promise<GameDefinition>;
}

/**
 * START THE WORLD.
 *
 * The store is opened and the world launched BEFORE the browser is pointed at
 * anything, so an author whose bundle cannot run a world -- no `world.actions`,
 * no `view`, a `maxPlayers` the host will not hold -- meets the library's own
 * refusal in the terminal instead of a blank frame.
 */
export async function startWorldDevServer(options: WorldDevServerOptions): Promise<void> {
  const devHostDir = resolveDevHostDir(__dirname, 'world-host.html');
  const boardsmithRoot = resolve(devHostDir, '..', '..', '..');
  // A world project always has an entry, and this is where a project that did
  // not have one gets it -- the same files `boardsmith init --world` writes, in
  // the author's own repository, so what `boardsmith dev` serves is what
  // production loads.
  const { created } = await ensureWorldEntry(options.cwd, options.displayName);
  const surfacePath = join(options.uiPath, WORLD_ENTRY_HTML);

  // THE ONE PLACE THE BUDGETS ARE DECIDED, and they are the library's defaults
  // rather than numbers this file invents. A laptop running different ceilings
  // from production makes a game's local behaviour a poor guide to its
  // published behaviour, which is the whole reason #165 made them parameters.
  const budgets = worldBudgets();
  const store = openWorldStore(worldStorePath(options.cwd), budgets);
  const launchedBefore = store.isLaunched();

  const clients = new Map<string, WebSocket>();
  const send = (clientId: string, message: unknown) => {
    const socket = clients.get(clientId);
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };
  const hostOver = (definition: GameDefinition, over: LocalWorldStore) =>
    new LocalWorldHost({
      definition: definition as unknown as ConstructorParameters<
        typeof LocalWorldHost
      >[0]['definition'],
      worldName: options.displayName,
      // ONE SEED FOREVER, derived from the project rather than from the run: the
      // same world has to come back on every wake, and a fresh seed per run
      // would make a rebuilt world a different world.
      seed: `world:${definition.gameType}`,
      budgets,
      store: over,
      send,
    });

  // MUTABLE, because a rule edit replaces the whole world host (#201): the
  // rules, the store handle and the resident tree go together, or the two
  // halves are a world made of two versions.
  let worldHost: LocalWorldHost = hostOver(options.gameDefinition, store);

  const started = await worldHost.start();
  reportMigration(started);

  const config: WorldDevConfig = {
    displayName: options.displayName,
    seatCount: worldHost.seatCount,
    worldUrl: WORLD_IFRAME_PATH,
    storePath: store.path,
  };

  for (const line of worldDevBanner({
    worldName: options.displayName,
    seatCount: worldHost.seatCount,
    launched: launchedBefore,
    storePath: store.path,
  })) {
    console.log(chalk.dim(`  ${line}`));
  }
  for (const file of created) {
    console.log(chalk.dim(`  Wrote ${file} -- a world project needs an entry, and this one had none.`));
  }

  const worldSocket = claimWebSocketPath(WORLD_WS_PATH, (socket: WebSocket) => {
    let clientId: string | null = null;
    socket.on('message', (raw) => {
      let message: { type?: string; clientId?: unknown; [key: string]: unknown };
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (message.type === 'hello') {
        clientId =
          typeof message.clientId === 'string'
            ? message.clientId
            : `anon-${Math.random().toString(36).slice(2)}`;
        clients.set(clientId, socket);
      }
      if (clientId === null) return; // a client identifies itself first
      void worldHost
        .handleMessage(clientId, message as unknown as WorldDevRequest)
        .catch((error: unknown) =>
          console.error(
            chalk.red(`[boardsmith dev] world message '${String(message.type)}' failed:`),
            error,
          ),
        );
    });
    socket.on('close', () => {
      // Only tear down if THIS socket still owns the id: a reload's new socket
      // may be helloed before the old one's close fires, and a stale close
      // would drop the seat the reconnected page just took.
      if (clientId !== null && clients.get(clientId) === socket) {
        clients.delete(clientId);
        void worldHost.disconnect(clientId);
      }
    });
  });

  const plugins: VitePlugin[] = [
    boardsmithWorldDevPlugin({
      devHostDir,
      uiPath: options.uiPath,
      surfacePath,
      config,
    }),
    // The socket is claimed by a PLUGIN so a `vite.config.ts` restart re-claims
    // it: the HTTP server it was attached to does not survive one (#214).
    worldSocket.plugin,
  ];
  if (options.context === 'monorepo') plugins.unshift(monorepoBoardsmithResolvePlugin());

  const vite = await createViteServer({
    root: options.uiPath,
    server: {
      port: options.port,
      host: options.host,
      strictPort: true,
      open: false,
      fs: { allow: [options.uiPath, options.cwd, boardsmithRoot] },
    },
    plugins,
    optimizeDeps: { exclude: ['boardsmith', 'boardsmith/ui', 'boardsmith/client', 'boardsmith/session'] },
  });
  await vite.listen();

  // A RULE EDIT IS A COORDINATED WORLD RELOAD (#201).
  //
  // The Node runtime is loaded once, before this server starts, so an author's
  // saved rules used to reach the browser through HMR and never reach the
  // world: the new surface offered a verb the old rules did not have, or the
  // new shape of one they did, and the world committed the result. A durable
  // world made of two versions is the one thing it must never be.
  //
  // So the two halves switch TOGETHER, and the order below is the whole of the
  // safety:
  //
  //   1. LOAD THE NEW RULES FIRST. A broken edit -- a syntax error, a bundle
  //      that will not build -- throws here, and the world is still the old
  //      one, still running, still playable.
  //   2. STOP THE OLD WORLD. `close` checkpoints whatever the resident tree
  //      holds, so nothing a command left in memory is lost with the isolate.
  //   3. OPEN THE SAME WORLD AGAIN, on the new rules. Genesis does not re-run
  //      (`start` runs it only for a world that has never launched), and a
  //      `stateVersion` bump is migrated or refused there (#200) -- the same
  //      path a fresh `boardsmith dev` takes.
  //   4. TELL EVERY PAGE. Vite is hot-reloading the bundle's UI in the same
  //      moment; a page that kept its socket would be new UI holding a seat in
  //      a world that has just been rebuilt.
  //
  // A FAILURE AT ANY STEP LEAVES THE WORLD IT COULD NOT REPLACE. Step 1 leaves
  // the old host untouched; 2-3 can only fail on rules that already loaded, and
  // the refusal is printed with the world durable on disk, exactly where the
  // old host checkpointed it.
  const rulesDir = join(options.cwd, 'src', 'rules');
  let reloading: Promise<void> = Promise.resolve();
  vite.watcher.add(rulesDir);
  vite.watcher.on('change', (changed: string) => {
    if (!changed.startsWith(rulesDir)) return;
    // QUEUED, so a save-all across four files is one reload rather than four
    // overlapping ones tearing down each other's world.
    reloading = reloading.then(() => reloadWorld(relative(options.cwd, changed)));
  });

  async function reloadWorld(named: string): Promise<void> {
    console.log(chalk.dim(`\n  ${named} changed -- reloading the world's rules...`));
    let rules: GameDefinition;
    try {
      rules = await options.reloadRules();
    } catch (error) {
      console.error(
        chalk.red('  Those rules did not load, so this world is still running the ones it had:'),
        error,
      );
      return;
    }
    try {
      await worldHost.close();
      worldHost = hostOver(rules, openWorldStore(worldStorePath(options.cwd), budgets));
      reportMigration(await worldHost.start());
    } catch (error) {
      console.error(
        chalk.red('  Those rules cannot run this world, so nothing was changed on disk:'),
        error instanceof Error ? error.message : String(error),
      );
      return;
    }
    // EVERY PAGE STARTS AGAIN. Their sockets are attached to a host that no
    // longer exists, and their UI has just been hot-reloaded to match rules the
    // world only now has.
    for (const [clientId, socket] of clients) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'world_reload' }));
      }
      clients.delete(clientId);
    }
    console.log(chalk.green('  Reloaded. The world is durable and running the new rules.\n'));
  }

  const uiPort = vite.resolvedUrls?.local[0]
    ? parseInt(new URL(vite.resolvedUrls.local[0]).port || String(options.port), 10)
    : options.port;
  const hostUrl = `http://localhost:${uiPort}`;
  announceHost({
    hostUrl,
    what: 'World host',
    join: 'others can join this world',
    networkUrls: vite.resolvedUrls?.network ?? [],
    say: (line) => console.log(line),
    green: chalk.green,
    cyan: chalk.cyan,
  });
  if (options.openBrowser) await open(hostUrl);
  console.log(chalk.green('\n  Ready! Press Ctrl+C to stop.\n'));

  onShutdown(async () => {
    console.log(chalk.dim('\n  Shutting down...'));
    worldSocket.close();
    clients.clear();
    // THE WORLD IS CLOSED, NOT DELETED. A persistent world that erased itself
    // when its host stopped would be a session; `--reset` is the only thing
    // that removes one.
    await worldHost.close();
    await vite.close();
    try {
      rmSync(options.tempDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
    process.exit(0);
  });
}

/**
 * SAY WHAT AN UPGRADE MOVED, IN THE TERMINAL.
 *
 * A migration runs before the first socket exists, so there is nobody in the
 * world to tell -- and the person who published the new rules is standing here
 * (#200). Silent for the ordinary start, which moved nothing.
 */
function reportMigration(started: {
  migrated?: WorldMigrationOutcome;
  lifted?: WorldLiftOutcome;
}): void {
  if (started.lifted !== undefined) {
    // SAID FIRST, because it happened first and because it is the sentence
    // that explains why a world written on an older BoardSmith could suddenly
    // grow (#223).
    const { offset, partitions, events } = started.lifted;
    console.log(
      chalk.green(
        `  Lifted this world's element ids by ${offset} so its seat count can change: ` +
          `${partitions} partition(s) and ${events} queued event(s), in one durable step.`,
      ),
    );
  }
  if (started.migrated === undefined) return;
  const { from, to, partitions, created, events } = started.migrated;
  console.log(
    chalk.green(
      `  Migrated this world from state version ${from} to ${to}: ` +
        `${partitions} partition(s), ${created} new partition root(s) and ` +
        `${events} queued event(s), in one durable step.`,
    ),
  );
}
