/**
 * Issue 134: under `npx boardsmith dev` a missing game asset came back as the
 * SPA index.html — HTTP 200, `text/html` — so every card fell back to its
 * placeholder with nothing anywhere reporting a problem. Two defects in one:
 *
 *  1. The board iframe was served at `/__boardsmith/play`, one directory deep,
 *     so a relative asset reference (`cards/x.png`, which is what the built
 *     dist resolves correctly) resolved to `/__boardsmith/cards/x.png`.
 *  2. Vite's `appType: 'spa'` fallback answered that — and every other missing
 *     path — with index.html at 200 instead of a 404.
 *
 * These tests drive the REAL plugin on a REAL Vite server over HTTP.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer, type ViteDevServer } from 'vite';
import { boardsmithDevHostPlugin, GAME_IFRAME_PATH } from './dev.js';
import type { DevHostConfig } from '../dev-host/config-types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const devHostDir = resolve(__dirname, '..', 'dev-host');

const devConfig = {
  gameType: 'fixture',
  displayName: 'Fixture',
  minPlayers: 2,
  maxPlayers: 2,
  playerCount: 2,
  botSeats: [],
  botLevel: 'medium',
  gameOptions: [],
  playerOptions: [],
  presets: [],
  colorPalette: [],
  gameUrl: GAME_IFRAME_PATH,
  teachingDisabled: false,
} as unknown as DevHostConfig;

describe('boardsmith dev asset serving (issue 134)', () => {
  let projectDir: string;
  let server: ViteDevServer;
  let origin: string;

  beforeAll(async () => {
    projectDir = mkdtempSync(join(tmpdir(), 'boardsmith-dev-assets-'));
    mkdirSync(join(projectDir, 'public', 'cards'), { recursive: true });
    mkdirSync(join(projectDir, 'src', 'rules'), { recursive: true });
    writeFileSync(join(projectDir, 'public', 'cards', 'doom-core.png'), 'not-really-a-png');
    writeFileSync(
      join(projectDir, 'index.html'),
      '<html><body><div id="app">game shell</div></body></html>',
    );
    writeFileSync(
      join(projectDir, 'src', 'rules', 'index.ts'),
      'export const gameDefinition = {};\n',
    );

    server = await createViteServer({
      root: projectDir,
      logLevel: 'silent',
      // No dependency pre-bundling: this fixture imports nothing, and the
      // optimizer's esbuild process keeps the server from closing at teardown.
      optimizeDeps: { noDiscovery: true, include: [] },
      server: {
        port: 0,
        host: '127.0.0.1',
        open: false,
        // No HMR websocket: these are plain HTTP assertions, and a live ws
        // server keeps the http server from closing at teardown.
        hmr: false,
        fs: { allow: [projectDir, resolve(devHostDir, '..', '..', '..')] },
      },
      plugins: [
        boardsmithDevHostPlugin({
          devHostDir,
          uiPath: projectDir,
          rulesIndexPath: join(projectDir, 'src', 'rules', 'index.ts'),
          devConfig,
        }),
      ],
    });
    await server.listen();
    const url = server.resolvedUrls?.local[0];
    if (!url) throw new Error('Vite dev server reported no local URL');
    origin = new URL(url).origin;
  }, 30_000);

  afterAll(async () => {
    await server?.close();
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
  }, 30_000);

  it('never answers a missing asset request with HTML', async () => {
    const res = await fetch(`${origin}/cards/does-not-exist.png`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type') ?? '').not.toContain('text/html');
    // Actionable: it names where assets are served from.
    expect(await res.text()).toContain('public/');
  });

  it('resolves a relative asset reference from the board iframe to the public dir', async () => {
    // Exactly what a browser does with `<img src="cards/doom-core.png">` on
    // the iframe document.
    const assetUrl = new URL('cards/doom-core.png', `${origin}${GAME_IFRAME_PATH}`);
    expect(assetUrl.pathname).toBe('/cards/doom-core.png');

    const res = await fetch(assetUrl);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').not.toContain('text/html');
    expect(await res.text()).toBe('not-really-a-png');
  });

  it('serves the dev-host page at the root', async () => {
    const res = await fetch(`${origin}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('text/html');
    expect(await res.text()).toContain('BoardSmith Dev');
  });

  it('serves the game UI document at the board iframe path', async () => {
    const res = await fetch(`${origin}${GAME_IFRAME_PATH}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('text/html');
    expect(await res.text()).toContain('game shell');
  });

  it('404s an unknown route instead of silently serving the game shell', async () => {
    const res = await fetch(`${origin}/not-a-route`);
    expect(res.status).toBe(404);
  });
});
