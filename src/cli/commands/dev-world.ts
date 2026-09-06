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
 * The bundle's `world.html` when the project has one. When it does not --
 * `example-rts` and `example-mud` are both that shape -- it serves the SHELL'S
 * OWN SURFACE (`world-fallback.html`), which mounts the same `WorldShell` over
 * the same wire and draws a board of its own. It is not a debug console wired
 * to the socket: a world with no UI is exercised through the code path a world
 * with one takes, or local behaviour stops predicting published behaviour for
 * exactly the games most likely to be prototypes.
 */

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import chalk from 'chalk';
import open from 'open';
import { createServer as createViteServer, type Plugin as VitePlugin } from 'vite';
import { WebSocket } from 'ws';

import { worldBudgets } from '../../world/index.js';
import { LocalWorldHost, type WorldDevRequest } from '../dev-host/world-host.js';
import { openWorldStore, worldStorePath } from '../dev-host/world-store.js';
import type { WorldDevConfig } from '../dev-host/world-config-types.js';
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

/** The world entry a bundle writes, if it has written one. */
export const WORLD_ENTRY_HTML = 'world.html';

/** The lines `boardsmith dev` prints before a world starts. Returned rather
 *  than printed so their wording is testable. */
export function worldDevBanner(args: {
  worldName: string;
  seatCount: number;
  launched: boolean;
  ownWorldUi: boolean;
  storePath: string;
}): string[] {
  return [
    `Persistent world: ${args.worldName}, ${args.seatCount} seats.`,
    args.launched
      ? `  Reopening the world already in ${args.storePath}. Genesis has already run.`
      : `  This world has never been played. Genesis runs into ${args.storePath} at startup.`,
    args.ownWorldUi
      ? `  Serving your ${WORLD_ENTRY_HTML}.`
      : `  This project has no ${WORLD_ENTRY_HTML}, so the shell's own surface is served instead: ` +
        'the same WorldShell your world UI would mount, with a generic board inside it.',
    '  The dev bar switches seats, fires due events without waiting for them, and wakes the',
    '  world from parked so the rehydration path is exercised rather than assumed.',
    '  `boardsmith dev --reset` deletes this world and runs genesis again.',
  ];
}

/**
 * Whether this project ships its own world surface, and what to serve.
 *
 * Answered as a pair rather than as a boolean, because the two facts travel
 * together everywhere: what document to read, and what to say about it.
 */
export function resolveWorldSurface(
  uiPath: string,
  devHostDir: string,
): { path: string; ownWorldUi: boolean } {
  const own = join(uiPath, WORLD_ENTRY_HTML);
  return existsSync(own)
    ? { path: own, ownWorldUi: true }
    : { path: join(devHostDir, 'world-fallback.html'), ownWorldUi: false };
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
  ownWorldUi: boolean;
  config: WorldDevConfig;
}): VitePlugin {
  const VIRTUAL_CONFIG = 'virtual:boardsmith-world-dev-config';
  const RESOLVED_CONFIG = '\0' + VIRTUAL_CONFIG;
  const hostHtmlPath = join(args.devHostDir, 'world-host.html');
  const hostMainPath = join(args.devHostDir, 'world-host-main.ts');
  const fallbackMainPath = join(args.devHostDir, 'world-fallback-main.ts');

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
          const source = readFileSync(args.surfacePath, 'utf-8');
          // A bundle's own `world.html` is served exactly as the author wrote
          // it; only the fallback carries a placeholder.
          return args.ownWorldUi
            ? source
            : source.replace('__WORLD_MAIN_SRC__', `/@fs/${toPosix(fallbackMainPath)}`);
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
}

/**
 * START THE WORLD.
 *
 * The store is opened and the world launched BEFORE the browser is pointed at
 * anything, so an author whose bundle cannot run a world -- no `world.commands`,
 * no `view`, a `maxPlayers` the host will not hold -- meets the library's own
 * refusal in the terminal instead of a blank frame.
 */
export async function startWorldDevServer(options: WorldDevServerOptions): Promise<void> {
  const devHostDir = resolveDevHostDir(__dirname, 'world-host.html');
  const boardsmithRoot = resolve(devHostDir, '..', '..', '..');
  const surface = resolveWorldSurface(options.uiPath, devHostDir);

  // THE ONE PLACE THE BUDGETS ARE DECIDED, and they are the library's defaults
  // rather than numbers this file invents. A laptop running different ceilings
  // from production makes a game's local behaviour a poor guide to its
  // published behaviour, which is the whole reason #165 made them parameters.
  const budgets = worldBudgets();
  const store = openWorldStore(worldStorePath(options.cwd), budgets);
  const launchedBefore = store.isLaunched();

  const clients = new Map<string, WebSocket>();
  const worldHost = new LocalWorldHost({
    definition: options.gameDefinition as unknown as ConstructorParameters<
      typeof LocalWorldHost
    >[0]['definition'],
    worldName: options.displayName,
    // ONE SEED FOREVER, derived from the project rather than from the run: the
    // same world has to come back on every wake, and a fresh seed per run would
    // make a rebuilt world a different world.
    seed: `world:${options.gameDefinition.gameType}`,
    budgets,
    store,
    send: (clientId, message) => {
      const socket = clients.get(clientId);
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    },
  });

  await worldHost.start();

  const config: WorldDevConfig = {
    displayName: options.displayName,
    seatCount: worldHost.seatCount,
    worldUrl: WORLD_IFRAME_PATH,
    ownWorldUi: surface.ownWorldUi,
    storePath: store.path,
  };

  for (const line of worldDevBanner({
    worldName: options.displayName,
    seatCount: worldHost.seatCount,
    launched: launchedBefore,
    ownWorldUi: surface.ownWorldUi,
    storePath: store.path,
  })) {
    console.log(chalk.dim(`  ${line}`));
  }

  const plugins: VitePlugin[] = [
    boardsmithWorldDevPlugin({
      devHostDir,
      uiPath: options.uiPath,
      surfacePath: surface.path,
      ownWorldUi: surface.ownWorldUi,
      config,
    }),
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

  if (!vite.httpServer) throw new Error('Vite dev server has no HTTP server to attach the world socket to.');
  const wss = claimWebSocketPath(vite.httpServer, WORLD_WS_PATH, (socket: WebSocket) => {
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

  const uiPort = vite.resolvedUrls?.local[0]
    ? parseInt(new URL(vite.resolvedUrls.local[0]).port || String(options.port), 10)
    : options.port;
  const hostUrl = `http://localhost:${uiPort}`;
  console.log(chalk.green(`  World host running on ${hostUrl}`));
  for (const networkUrl of vite.resolvedUrls?.network ?? []) {
    console.log(chalk.cyan(`  Network (others can join this world): ${networkUrl}`));
  }
  if (options.openBrowser) await open(hostUrl);
  console.log(chalk.green('\n  Ready! Press Ctrl+C to stop.\n'));

  const cleanup = async () => {
    console.log(chalk.dim('\n  Shutting down...'));
    wss.close();
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
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}
