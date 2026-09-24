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
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createServer as createViteServer, type ViteDevServer } from 'vite';
import { WebSocket as WsClient } from 'ws';

import { claimWebSocketPath, reloadOnRulesEdit } from './dev-server.js';
import { createRulesReloadQueue } from '../dev-host/rules-reload-queue.js';
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

/**
 * #201 / #343: ONE WAY A SAVED RULES FILE REACHES THE HOST, FOR BOTH ROADS.
 *
 * The browser gets an author's edit through Vite; the host only ever gets it
 * through this watcher. It runs a REAL Vite watcher over a REAL file write,
 * because "the host never heard about the save" is the whole of the bug.
 */
describe('a rules edit reloads the rules on the server (#201, #343)', () => {
  async function watchedProject() {
    dir = tempTree('bs-dev-rules-watch-');
    const rulesDir = join(dir, 'src', 'rules');
    mkdirSync(rulesDir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>t</title>');
    writeFileSync(join(rulesDir, 'index.ts'), 'export const version = 1;');
    vite = await createViteServer({
      root: dir,
      configFile: false,
      logLevel: 'silent',
      // Polled, because a native file-event stream can start late on a loaded
      // machine and drop the one write a test makes. What is under test is what
      // the host does with a change event, not how the OS delivers one.
      server: { port: 0, host: '127.0.0.1', open: false, watch: { usePolling: true, interval: 50 } },
    });
    await vite.listen();
    return { root: dir, rulesDir, server: vite };
  }

  /** Wait until the watcher is looking at the rules, as it is long before an author's first save. */
  async function watching(server: ViteDevServer, rulesDir: string): Promise<void> {
    await vi.waitFor(() => expect(server.watcher.getWatched()[rulesDir]).toContain('index.ts'), {
      timeout: 10000,
    });
  }

  /** Hear `rulesDir` the way `boardsmith dev` does, reloading through a queue made of `reload`. */
  function watch(
    server: ViteDevServer,
    rulesDir: string,
    root: string,
    reload: Omit<Parameters<typeof createRulesReloadQueue<number>>[0], 'tell'>,
  ): void {
    reloadOnRulesEdit({ vite: server, rulesDir, cwd: root, queue: createRulesReloadQueue({ ...reload, tell: () => {} }) });
  }

  /** Resolves on the next call of the returned function, with its argument. */
  function nextCall<T>() {
    let settle: (value: T) => void = () => {};
    const called = new Promise<T>((resolve) => (settle = resolve));
    return { called, fn: (value: T) => settle(value) };
  }

  it('loads the edited rules and hands them to the host', async () => {
    const { root, rulesDir, server } = await watchedProject();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const adopted = nextCall<number>();
    let loads = 0;
    watch(server, rulesDir, root, {
      what: 'table',
      load: async () => ++loads,
      adopt: async (rules) => adopted.fn(rules),
    });

    await watching(server, rulesDir);
    writeFileSync(join(rulesDir, 'index.ts'), 'export const version = 2;');

    expect(await adopted.called).toBe(1);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining(join('src', 'rules', 'index.ts')));
    vi.restoreAllMocks();
  }, 30000);

  it('keeps the rules it had when the edited ones do not load, and says why', async () => {
    const { root, rulesDir, server } = await watchedProject();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const printed = nextCall<string>();
    vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => printed.fn(parts.join(' ')));
    const adopt = vi.fn(async () => {});
    watch(server, rulesDir, root, {
      what: 'table',
      load: async () => {
        throw new Error('Expected ";" but found "}"');
      },
      adopt,
    });

    await watching(server, rulesDir);
    writeFileSync(join(rulesDir, 'index.ts'), 'export const version = ;');

    const said = await printed.called;
    expect(said).toContain('this table is still running the ones it had');
    expect(said).toContain('Expected ";" but found "}"');
    expect(adopt).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  }, 30000);

  it('reloads one save at a time, in order, so a save-all never overlaps itself', async () => {
    const { root, rulesDir, server } = await watchedProject();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    writeFileSync(join(rulesDir, 'other.ts'), 'export const other = 1;');
    const events: string[] = [];
    const second = nextCall<void>();
    let release: () => void = () => {};
    const firstHeld = new Promise<void>((resolve) => (release = resolve));
    let loads = 0;
    watch(server, rulesDir, root, {
      what: 'table',
      load: async () => ++loads,
      adopt: async (rules) => {
        events.push(`start ${rules}`);
        if (rules === 1) await firstHeld;
        events.push(`end ${rules}`);
        if (rules === 2) second.fn();
      },
    });

    await watching(server, rulesDir);
    writeFileSync(join(rulesDir, 'index.ts'), 'export const version = 2;');
    await vi.waitFor(() => expect(events).toEqual(['start 1']), { timeout: 10000 });
    writeFileSync(join(rulesDir, 'other.ts'), 'export const other = 2;');
    // The second save waits for the first reload, however long it takes.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(events).toEqual(['start 1']);
    release();

    await second.called;
    expect(events).toEqual(['start 1', 'end 1', 'start 2', 'end 2']);
    vi.restoreAllMocks();
  }, 30000);
});
