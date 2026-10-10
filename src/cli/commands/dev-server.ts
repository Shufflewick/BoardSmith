/**
 * WHAT THE TABLE DEV HOST AND THE WORLD DEV HOST BOTH NEED FROM A DEV SERVER.
 *
 * `boardsmith dev` has two roads (`dev.ts` for a table, `dev-world.ts` for a
 * persistent world) and they serve different documents over different
 * protocols. What they must NOT differ about is the handful of decisions below,
 * every one of which was a bug once:
 *
 *   - a second `WebSocketServer` attached with `{ server }` collides with
 *     Vite's own HMR socket, so both break and Vite reload-loops the page;
 *   - Vite's SPA fallback answers EVERY unmatched request with index.html at
 *     HTTP 200, so a missing card image silently became a placeholder with no
 *     error anywhere (issue 134) -- which is why both roads set
 *     `appType: 'custom'` and both end in a PLAIN TEXT 404;
 *   - in a monorepo checkout, `boardsmith/*` has to resolve to this repo's own
 *     `src/`, or the dev host runs a different engine from the one being
 *     edited;
 *   - editing `vite.config.ts` makes Vite replace its own HTTP server, so a
 *     socket registered once at startup is left on a closed object and every
 *     page afterwards loads but never connects (issue 214) -- which is why the
 *     claim below is a PLUGIN rather than a call;
 *   - the host runs rules it bundled once at startup, so a saved edit that
 *     reached only the browser left new UI acting on old rules, on either road
 *     (#201 for worlds, #343 for tables) -- which is why both reload through
 *     `reloadOnRulesEdit`, into one `RulesReloadQueue` that holds moves sent
 *     while the edit is still building (#379);
 *   - a Vite server whose listen was refused still holds the process open, so
 *     a run refused its port never exited (#345);
 *   - a Vite that owns the HTTP server registers its own SIGTERM handler,
 *     which exits the process before the host's teardown finishes (#382) --
 *     which is why both roads serve Vite in middleware mode through
 *     `serveVite`;
 *   - Vite's own `close()` never finishes while its dependency optimiser's
 *     first run is in flight, so a quick "start, look, Ctrl+C" hung (#366) --
 *     which is why `serveVite` closes Vite through `closeViteServer`.
 *
 * Two copies of any of those is how they come to disagree, and a disagreement
 * here is invisible until somebody's asset 404s or their HMR dies.
 */

import { existsSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join, relative, resolve } from 'node:path';

import type { Duplex } from 'node:stream';

import { createServer as createViteServer, normalizePath, type Connect, type InlineConfig, type Plugin as VitePlugin, type ViteDevServer } from 'vite';
import { WebSocketServer, type WebSocket } from 'ws';

import type { RulesReloadQueue } from '../dev-host/rules-reload-queue.js';
import { boardsmithSourceEntries } from './game-runtime.js';
import type { HeldResource } from '../dev-host/shutdown.js';
import { portRefusal } from '../dev-host/port.js';

/**
 * The one thing this module needs of an HTTP server: that it emits `upgrade`.
 *
 * Vite types `httpServer` as its own union (an HTTP or HTTP/2 server), so
 * naming `node:http`'s `Server` here would refuse the value the caller
 * actually has. What is used is the event, so that is what is asked for.
 */
interface HttpUpgradeServer {
  on(
    event: 'upgrade',
    listener: (req: Connect.IncomingMessage, socket: Duplex, head: Buffer) => void,
  ): unknown;
}

/**
 * A claimed upgrade path, and the way to close it. `serveVite` attaches it to
 * the HTTP server it owns, so it is claimed for as long as that server runs.
 */
interface ClaimedWebSocketPath {
  /** Route this path's upgrades on `httpServer`. `serveVite` calls it. */
  attach(httpServer: HttpUpgradeServer): void;
  /** Stop accepting connections; called from the run's shutdown. */
  close(): void;
}

/**
 * Claim ONE upgrade path for our socket.
 *
 * `noServer` plus our own routing, rather than `new WebSocketServer({ server })`:
 * a second server attached to the same HTTP server competes with Vite's HMR
 * socket for every upgrade, and the visible symptom is a page that reloads
 * forever with no error that names the cause.
 *
 * It is attached to the HTTP server the host owns, not to one Vite made. When
 * Vite owned it, editing `vite.config.ts` made Vite build a second server and
 * close the first, so a listener registered at startup was on a closed object
 * and every page afterwards loaded but never connected (#214). The host's
 * server outlives every Vite restart.
 */
export function claimWebSocketPath(
  path: string,
  onConnection: (socket: WebSocket) => void,
): ClaimedWebSocketPath {
  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', onConnection);
  return {
    attach(httpServer) {
      httpServer.on('upgrade', (req, socket, head) => {
        let pathname: string;
        try {
          pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        } catch {
          return;
        }
        if (pathname !== path) return; // not ours -- Vite HMR handles it
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
      });
    },
    close: () => wss.close(),
  };
}

/** The path part of a request, with any query string dropped. */
function requestPath(req: Connect.IncomingMessage): string {
  return (req.url ?? '/').split('?')[0]!;
}

/**
 * Serve one of the dev host's own HTML documents, transformed by Vite.
 *
 * `read` answers the document's source for a URL, or `null` to pass the request
 * on. Registered in the `configureServer` BODY so it runs BEFORE Vite's own
 * middlewares, which is what lets the dev host own its two documents.
 */
export function serveDevDocuments(
  server: ViteDevServer,
  read: (url: string) => string | null,
): void {
  server.middlewares.use(async (req, res, next) => {
    const url = requestPath(req);
    let source: string | null;
    try {
      source = read(url);
    } catch (error) {
      next(error as Error);
      return;
    }
    if (source === null) return next();
    try {
      const html = await server.transformIndexHtml(url, source, req.originalUrl);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html');
      res.end(html);
    } catch (error) {
      next(error as Error);
    }
  });
}

/**
 * The last middleware: a PLAIN TEXT 404 naming what to do about it.
 *
 * Returned from `configureServer` so Vite installs it AFTER its own
 * middlewares, which means it only ever sees a request nothing served. Plain
 * text on purpose: connect's default handler answers with an HTML body, and an
 * HTML body at a missing asset is exactly what made issue 134 invisible.
 *
 * `advice` is the road's own -- a table run and a world run serve different
 * documents, so they have different things to say about the one that was asked
 * for.
 */
export function devNotFoundMiddleware(
  server: ViteDevServer,
  advice: (url: string) => string,
): () => void {
  return () => {
    server.middlewares.use((req, res) => {
      const url = requestPath(req);
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(`boardsmith dev: nothing is served at ${url}\n\n${advice(url)}`);
    });
  };
}

/**
 * Locate the dev-host source directory, which ships in the package `src/`.
 *
 * `marker` is a file the caller knows lives there, so a road that moves its own
 * entry point finds out here rather than by serving a 404 for its host page.
 */
export function resolveDevHostDir(fromDir: string, marker: string): string {
  const candidates = [
    join(fromDir, '..', 'dev-host'), // tsx: src/cli/commands → src/cli/dev-host
    join(fromDir, '..', 'src', 'cli', 'dev-host'), // bundled: dist → <root>/src/cli/dev-host
    join(fromDir, 'dev-host'),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, marker))) return candidate;
  }
  return candidates[0]!;
}

/**
 * In a monorepo checkout, `boardsmith/*` resolves to this repo's own `src/`.
 *
 * Without it the dev host loads the PUBLISHED engine while an author edits the
 * local one, so a change appears to have no effect for reasons nothing reports.
 *
 * ONE LOOKUP, against the package's own `exports` (`boardsmithSourceEntries`).
 * This used to rebuild a subpath from a directory name and three guesses at the
 * layout -- `src/<pkg>/src/<subpath>`, from a layout this repo has not had --
 * so `boardsmith/ui/auto-ui` and both CSS exports resolved to files that are
 * not there, and every entry missing from the hand-written map resolved to
 * nothing at all. An export is a declared fact; guessing at one is how a
 * loader ends up disagreeing with Node about what a game imports.
 */
export function monorepoBoardsmithResolvePlugin(): VitePlugin {
  return {
    name: 'boardsmith-resolve',
    enforce: 'pre',
    resolveId(source: string) {
      if (!source.startsWith('boardsmith')) return null;
      return boardsmithSourceEntries().get(source) ?? null;
    },
  };
}

/**
 * A SAVED RULES FILE RELOADS THE RULES THE HOST RUNS (#201, #343).
 *
 * The host bundles the project's rules once, at startup, and the browser gets
 * every later edit through Vite. Without this the page ran the edited rules and
 * the host kept the old ones until `boardsmith dev` was restarted.
 *
 * This is only the ear: a change under the rules directory is handed to the
 * road's `RulesReloadQueue` the moment the watcher hears it, before anything is
 * bundled, so the pages' messages are held from the save on (#379). Loading
 * the new rules first, adopting them, and one save at a time are the queue's
 * (`dev-host/rules-reload-queue.ts`).
 */
export function reloadOnRulesEdit(args: {
  vite: Pick<ViteDevServer, 'watcher'>;
  /** The project's rules directory. Only a change under it reloads. */
  rulesDir: string;
  /** The project root, so the terminal names the file the way the author does. */
  cwd: string;
  queue: Pick<RulesReloadQueue, 'saved'>;
}): void {
  args.vite.watcher.add(args.rulesDir);
  args.vite.watcher.on('change', (changed: string) => {
    if (!changed.startsWith(args.rulesDir)) return;
    void args.queue.saved(relative(args.cwd, changed));
  });
}

/** A dev host's Vite, served over the HTTP server the host owns. */
interface ServedVite {
  readonly vite: ViteDevServer;
  /** Where this machine reaches the host. */
  readonly localUrl: string;
  /** Where other machines reach it: empty unless it is bound beyond loopback. */
  readonly networkUrls: readonly string[];
  /** What it holds, in the order it closes: Vite, then the HTTP server. */
  readonly resources: readonly HeldResource[];
}

/**
 * A VITE DEV SERVER, SERVED OVER AN HTTP SERVER THE HOST OWNS, OR NOTHING LEFT OPEN.
 *
 * Vite runs in middleware mode. When Vite owns the HTTP server it also
 * registers process handlers: on SIGTERM, and when stdin ends, it closes
 * itself and calls `process.exit()`. That raced the host's own teardown and
 * usually won, so the rest of it never ran (#382). In middleware mode Vite
 * registers none, and the process's signals belong to `onShutdown` alone.
 * Its HMR socket rides on the host's server (`hmr.server`), as do `sockets`.
 *
 * `release` is whatever the caller opened before asking for this server (its
 * socket, its world). It is required because a failure here has to give those
 * back: if Vite cannot be built or the port is refused (taken after
 * `devCommand` checked it), everything opened here is closed, `release` runs,
 * and only then is the error thrown. Anything left open keeps the process
 * alive after the refusal is printed (#345).
 */
export async function serveVite(args: {
  readonly config: InlineConfig;
  readonly port: number;
  readonly host: string;
  readonly sockets: readonly ClaimedWebSocketPath[];
  readonly release: () => Promise<void> | void;
}): Promise<ServedVite> {
  let vite: ViteDevServer | undefined;
  // Through `vite.middlewares` on every request, because a `vite.config.ts`
  // restart replaces them on the same `vite` object.
  const httpServer = createHttpServer((req, res) => vite!.middlewares(req, res));
  for (const socket of args.sockets) socket.attach(httpServer);
  try {
    vite = await createViteServer({
      ...args.config,
      server: { ...args.config.server, middlewareMode: true, hmr: { server: httpServer } },
    });
    await new Promise<void>((listening, reject) => {
      httpServer.once('error', (error: NodeJS.ErrnoException) => reject(new Error(portRefusal(args.port, args.host, error))));
      httpServer.listen(args.port, args.host, listening);
    });
  } catch (error) {
    await vite?.close();
    await args.release();
    throw error;
  }
  const served = vite;
  return {
    vite: served,
    localUrl: `http://localhost:${args.port}`,
    networkUrls: networkUrls(args.host, args.port),
    resources: [
      { name: 'the Vite dev server', close: () => closeViteServer(served) },
      {
        name: 'the HTTP server',
        close: () =>
          new Promise<void>((closed, reject) => {
            httpServer.close((error) => (error ? reject(error) : closed()));
            httpServer.closeAllConnections();
          }),
      },
    ],
  };
}

/**
 * Where other machines reach a host bound to `host`. A wildcard bind is
 * reachable at every external IPv4 address this machine has; a loopback bind
 * at none.
 */
function networkUrls(host: string, port: number): string[] {
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1') return [];
  if (host !== '0.0.0.0' && host !== '::') return [`http://${host}:${port}`];
  return Object.values(networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .filter((address) => address.family === 'IPv4' && !address.internal)
    .map((address) => `http://${address.address}:${port}`);
}

/**
 * CLOSE A VITE DEV SERVER, AFTER THE DEPENDENCY TRANSFORMS IT HAS IN FLIGHT (#366).
 *
 * Vite's `close()` shuts its dependency optimiser down and then waits for every
 * transform still in flight. A transform of a pre-bundled dependency (the
 * `vue.js` a page imports) waits for the optimiser run that commits it, and a
 * closed optimiser abandons that run without settling its waiters, so
 * `close()` never finishes. That happens whenever a host is stopped between a
 * fresh project's first page and the optimiser's first commit, which is a
 * quick "start, look, Ctrl+C". Vite 5.4 through 8.3 close the same way.
 *
 * So the optimiser is let finish first. Every pre-bundled module the page's
 * imports put in the module graph and that has not been transformed yet is
 * requested again, which joins the transform already in flight and settles
 * when the optimiser commits (or fails). Repeated until none is left, because
 * a run can discover further dependencies. Each module is waited on once, so a
 * transform that fails does not keep the loop going. Only then is Vite closed,
 * with nothing left for it to wait on.
 */
async function closeViteServer(vite: ViteDevServer): Promise<void> {
  const depsDir = `${normalizePath(resolve(vite.config.cacheDir, 'deps'))}/`;
  const waited = new Set<string>();
  for (;;) {
    const inFlight = [...vite.moduleGraph.urlToModuleMap.values()].filter(
      (module) =>
        module.file !== null &&
        module.file.startsWith(depsDir) &&
        module.transformResult === null &&
        !waited.has(module.url),
    );
    if (inFlight.length === 0) break;
    await Promise.allSettled(
      inFlight.map((module) => {
        waited.add(module.url);
        return vite.transformRequest(module.url);
      }),
    );
  }
  await vite.close();
}
