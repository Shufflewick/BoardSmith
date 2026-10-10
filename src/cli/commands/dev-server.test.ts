/**
 * #214: A VITE CONFIG RESTART MUST NOT COST THE DEV HOST ITS SOCKET.
 *
 * Editing `vite.config.ts` while `boardsmith dev` runs makes Vite build a
 * SECOND server and `Object.assign` it over the first. When Vite owned the
 * HTTP server, the old one was closed with it and an `upgrade` listener
 * registered at startup was gone: pages still loaded while every world/game
 * socket hung unanswered. The host now owns the HTTP server (#382), and these
 * hold that its socket and Vite's HMR both survive a restart.
 *
 * #382: A VITE THAT OWNS THE HTTP SERVER REGISTERS PROCESS HANDLERS. On SIGTERM,
 * and when stdin ends, it closed itself and exited the process before the
 * host's teardown finished. `serveVite` leaves the process's signals alone.
 *
 * These run a REAL Vite server and a REAL restart, because the whole bug lives
 * in what Vite does to itself.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createServer as createViteServer, type ViteDevServer } from 'vite';
import { WebSocket as WsClient } from 'ws';

import { answerAlive, claimWebSocketPath, reloadOnRulesEdit, serveVite } from './dev-server.js';
import { DEV_HOST_ALIVE_PATH } from '../../testing/browser-smoke-clock.js';
import { freePort } from '../lib/free-port.js';
import { teardownInOrder } from '../dev-host/shutdown.js';
import { createRulesReloadQueue } from '../dev-host/rules-reload-queue.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

const TEST_WS_PATH = '/__boardsmith/test-ws';

let dir: string | null = null;
let vite: ViteDevServer | null = null;
let stopServed: (() => Promise<void>) | null = null;
afterEach(async () => {
  if (vite) await vite.close();
  vite = null;
  if (stopServed) await stopServed();
  stopServed = null;
  dir = null;
});

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

/** Serve an empty project through `serveVite`, with one claimed socket path. */
async function serveEmpty(onConnection: Parameters<typeof claimWebSocketPath>[1]) {
  dir = tempTree('bs-dev-server-');
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>t</title>');
  const claimed = claimWebSocketPath(TEST_WS_PATH, onConnection);
  const port = await freePort();
  const served = await serveVite({
    config: { root: dir, configFile: false, logLevel: 'silent' },
    port,
    host: '127.0.0.1',
    sockets: [claimed],
    release: () => claimed.close(),
  });
  const teardown = teardownInOrder([{ name: 'the socket', close: () => claimed.close() }, ...served.resources]);
  stopServed = () => teardown.run();
  return { served, port };
}

describe('a dev host socket survives what Vite does on restart (#214)', () => {
  it('answers the claimed path before and after a config restart', async () => {
    let greeted = 0;
    const { served, port } = await serveEmpty((socket) => {
      greeted += 1;
      socket.send(`hello ${greeted}`);
    });

    expect(await connect(port)).toBe('hello 1');

    // Exactly what `vite.config.ts changed, restarting server...` runs.
    await served.vite.restart();

    expect(await connect(port)).toBe('hello 2');
  }, 30000);

  it('leaves every other upgrade to Vite, restart or not', async () => {
    const { served, port } = await serveEmpty((socket) => socket.send('ours'));
    await served.vite.restart();

    // Vite's own HMR socket, which a `{ server }` attachment would have stolen.
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
  }, 30000);
});

describe('a served Vite leaves the process alone (#382)', () => {
  it('registers no SIGTERM handler and no stdin end handler, restart or not', async () => {
    const sigterm = process.listenerCount('SIGTERM');
    const stdinEnd = process.stdin.listenerCount('end');
    const { served } = await serveEmpty(() => {});
    await served.vite.restart();
    expect(process.listenerCount('SIGTERM')).toBe(sigterm);
    expect(process.stdin.listenerCount('end')).toBe(stdinEnd);
  }, 30000);
});

describe('the dev host says it is answering (#609)', () => {
  it(`answers ${DEV_HOST_ALIVE_PATH} with nothing, and leaves every other path to the rest of the dev host`, async () => {
    dir = tempTree('bs-dev-alive-');
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>t</title>');
    const port = await freePort();
    const served = await serveVite({
      config: {
        root: dir,
        configFile: false,
        logLevel: 'silent',
        plugins: [{ name: 'alive', configureServer: (server) => answerAlive(server) }],
      },
      port,
      host: '127.0.0.1',
      sockets: [],
      release: () => {},
    });
    const teardown = teardownInOrder(served.resources);
    stopServed = () => teardown.run();

    const alive = await fetch(`http://127.0.0.1:${port}${DEV_HOST_ALIVE_PATH}`);
    const page = await fetch(`http://127.0.0.1:${port}/`);

    expect(alive.status).toBe(204);
    expect(await alive.text()).toBe('');
    expect(page.status).toBe(200);
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

  /**
   * Resolve once the watcher has compared `file` against a first look at it (#625).
   *
   * The polling watcher lists a file at once but takes its first stat later, on
   * Node's thread pool. A write that lands before that stat becomes the file's
   * starting state and is never reported, so a test that made it waits forever;
   * a starved machine holds that stat back long enough to lose the write. So
   * touch the file until the watcher reports a touch. Each touch sets the
   * modified time to the same past instant, which the watcher reports only as
   * `raw`, never as a `change`, so nothing reloads.
   */
  function polled(server: ViteDevServer, file: string): Promise<void> {
    const past = new Date(2000, 0, 1);
    return new Promise((resolve) => {
      const touch = setInterval(() => utimesSync(file, new Date(), past), 50);
      const heard = (_event: string, path: string) => {
        if (path !== file) return;
        clearInterval(touch);
        server.watcher.off('raw', heard);
        resolve();
      };
      server.watcher.on('raw', heard);
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

    await polled(server, join(rulesDir, 'index.ts'));
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

    await polled(server, join(rulesDir, 'index.ts'));
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
    const first = nextCall<void>();
    const second = nextCall<void>();
    let release: () => void = () => {};
    const firstHeld = new Promise<void>((resolve) => (release = resolve));
    let loads = 0;
    watch(server, rulesDir, root, {
      what: 'table',
      load: async () => ++loads,
      adopt: async (rules) => {
        events.push(`start ${rules}`);
        if (rules === 1) {
          first.fn();
          await firstHeld;
        }
        events.push(`end ${rules}`);
        if (rules === 2) second.fn();
      },
    });

    await polled(server, join(rulesDir, 'index.ts'));
    await polled(server, join(rulesDir, 'other.ts'));
    writeFileSync(join(rulesDir, 'index.ts'), 'export const version = 2;');
    await first.called;
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
