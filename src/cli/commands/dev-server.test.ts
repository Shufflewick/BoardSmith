/**
 * #214: A VITE CONFIG RESTART MUST NOT COST THE DEV HOST ITS SOCKET.
 *
 * Editing `vite.config.ts` while `boardsmith dev` runs makes Vite build a
 * SECOND server and `Object.assign` it over the first, so `server.httpServer`
 * is a different object afterwards and the old one has been closed. An
 * `upgrade` listener registered once, on the server that existed at startup,
 * is gone -- and what the author sees is an HTTP server that still answers
 * pages while every world/game socket hangs unanswered.
 *
 * These run a REAL Vite server and a REAL restart, because the whole bug lives
 * in what Vite does to itself: a fake server that kept its `httpServer` would
 * pass either implementation.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createServer as createViteServer, type ViteDevServer } from 'vite';
import { WebSocket as WsClient } from 'ws';

import { claimWebSocketPath } from './dev-server.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

const TEST_WS_PATH = '/__boardsmith/test-ws';

let dir: string | null = null;
let vite: ViteDevServer | null = null;
afterEach(async () => {
  if (vite) await vite.close();
  vite = null;
  dir = null;
});

/** The port Vite actually bound, which is what a client has to dial. */
function boundPort(server: ViteDevServer): number {
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error('Vite reported no local URL to connect to.');
  return Number.parseInt(new URL(url).port, 10);
}

/** Open a socket at the claimed path and resolve with what the host received. */
function connect(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new WsClient(`ws://127.0.0.1:${port}${TEST_WS_PATH}`);
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('the claimed socket path never answered the upgrade'));
    }, 5000);
    socket.on('message', (raw) => {
      clearTimeout(timer);
      socket.close();
      resolve(raw.toString());
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

describe('a dev host socket survives what Vite does on restart (#214)', () => {
  it('answers the claimed path before and after a config restart', async () => {
    dir = tempTree('bs-dev-server-');
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>t</title>');

    let greeted = 0;
    const claimed = claimWebSocketPath(TEST_WS_PATH, (socket) => {
      greeted += 1;
      socket.send(`hello ${greeted}`);
    });

    vite = await createViteServer({
      root: dir,
      configFile: false,
      logLevel: 'silent',
      server: { port: 0, host: '127.0.0.1', open: false },
      plugins: [claimed.plugin],
    });
    await vite.listen();

    expect(await connect(boundPort(vite))).toBe('hello 1');

    // Exactly what `vite.config.ts changed, restarting server...` runs.
    await vite.restart();

    expect(await connect(boundPort(vite))).toBe('hello 2');

    claimed.close();
  }, 30000);

  it('leaves every other upgrade to Vite, restart or not', async () => {
    dir = tempTree('bs-dev-server-');
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>t</title>');

    const claimed = claimWebSocketPath(TEST_WS_PATH, (socket) => socket.send('ours'));
    vite = await createViteServer({
      root: dir,
      configFile: false,
      logLevel: 'silent',
      server: { port: 0, host: '127.0.0.1', open: false },
      plugins: [claimed.plugin],
    });
    await vite.listen();
    await vite.restart();

    // Vite's own HMR socket, which a `{ server }` attachment would have stolen.
    const port = boundPort(vite);
    const hmr = await new Promise<boolean>((resolve) => {
      const socket = new WsClient(`ws://127.0.0.1:${port}/`, 'vite-hmr');
      const timer = setTimeout(() => {
        socket.terminate();
        resolve(false);
      }, 5000);
      socket.on('open', () => {
        clearTimeout(timer);
        socket.close();
        resolve(true);
      });
      socket.on('error', () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
    expect(hmr).toBe(true);

    claimed.close();
  }, 30000);
});
