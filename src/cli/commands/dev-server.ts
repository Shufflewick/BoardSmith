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
 *     edited.
 *
 * Two copies of any of those is how they come to disagree, and a disagreement
 * here is invisible until somebody's asset 404s or their HMR dies.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { Duplex } from 'node:stream';

import type { Connect, Plugin as VitePlugin, ViteDevServer } from 'vite';
import { WebSocketServer, type WebSocket } from 'ws';

import { BOARDSMITH_PACKAGE_DIRS, cliMonorepoRoot } from './game-runtime.js';

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
 * Claim ONE upgrade path for our socket and leave every other one alone.
 *
 * `noServer` plus our own routing, rather than `new WebSocketServer({ server })`:
 * a second server attached to the same HTTP server competes with Vite's HMR
 * socket for every upgrade, and the visible symptom is a page that reloads
 * forever with no error that names the cause.
 */
export function claimWebSocketPath(
  httpServer: HttpUpgradeServer,
  path: string,
  onConnection: (socket: WebSocket) => void,
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (req, socket, head) => {
    let pathname: string;
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      return;
    }
    if (pathname !== path) return; // not ours — Vite HMR handles it
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', onConnection);
  return wss;
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
 */
export function monorepoBoardsmithResolvePlugin(): VitePlugin {
  return {
    name: 'boardsmith-resolve',
    enforce: 'pre',
    resolveId(source: string) {
      if (!source.startsWith('boardsmith')) return null;
      const srcDir = BOARDSMITH_PACKAGE_DIRS[source];
      if (srcDir) return join(cliMonorepoRoot, 'src', srcDir, 'index.ts');
      if (!source.startsWith('boardsmith/')) return null;
      const parts = source.replace('boardsmith/', '').split('/');
      const pkgSrcDir = BOARDSMITH_PACKAGE_DIRS[`boardsmith/${parts[0]}`];
      const subpath = parts.slice(1).join('/');
      if (!pkgSrcDir || !subpath) return null;
      const srcPath = join(cliMonorepoRoot, 'src', pkgSrcDir, 'src');
      if (subpath.endsWith('.css')) return join(srcPath, subpath);
      for (const candidate of [
        join(srcPath, `${subpath}.ts`),
        join(srcPath, subpath, 'index.ts'),
        join(srcPath, 'components', subpath, 'index.ts'),
      ]) {
        if (existsSync(candidate)) return candidate;
      }
      return null;
    },
  };
}
