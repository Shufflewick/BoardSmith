/**
 * #1089: TEXT A PAGE CHOSE REACHES THE DEVELOPER'S TERMINAL ESCAPED AND CAPPED.
 *
 * The dev server does not check where a socket comes from (#719), so any web
 * page can name a message type holding terminal control sequences (an ESC CSI,
 * or the 8-bit CSI U+009B that `JSON.stringify` leaves alone) or megabytes of
 * text. Both dev hosts log a failed message's type; driven here over real
 * sockets through the handlers `boardsmith dev` runs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { createDevHostConnectionHandler } from './connection-handler.js';
import { pageText } from './socket-message.js';
import { openSocketPage, serveSockets } from './socket-page.test-helper.js';
import { createWorldConnections } from './world-connections.js';
import type { LocalWorldHost } from './world-host.js';

const hostile = `\u001b[2J\u009b31m${'x'.repeat(100 * 1024)}`;
const failing = { admit: () => Promise.reject(new Error('boom')) };

/** No C0, DEL or C1 character left, the escape sequences shown, and the 100 KB cut short. */
function expectEscapedAndCapped(logged: string) {
  expect(logged).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
  expect(logged).toContain('\\u001b[2J\\u009b31m');
  expect(logged).toContain('more characters');
  expect(logged.length).toBeLessThan(1000);
}

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of closers.splice(0)) await close();
});

describe('#1089: a page-chosen message type in the dev server log', () => {
  it('table host: reaches the failure report escaped and capped', async () => {
    let reported!: (msgType: string) => void;
    const report = new Promise<string>((resolve) => (reported = resolve));
    const server = await serveSockets(
      createDevHostConnectionHandler({
        mpHost: { handleMessage: async () => {}, disconnect: async () => {} },
        clients: new Map(),
        queue: failing,
        onError: (_err, msgType) => {
          if (msgType !== 'hello') reported(msgType);
        },
      }),
    );
    closers.push(server.close);
    const page = await openSocketPage(server.port, 'A', (f) => f.type === 'welcome');
    page.send({ type: hostile });

    expectEscapedAndCapped(await report);
  });

  it('world host: reaches the failure report escaped and capped', async () => {
    const logged = new Promise<string>((resolve) =>
      vi.spyOn(console, 'error').mockImplementation((line: string) => {
        if (line.includes('xxxx')) resolve(line);
      }),
    );
    const server = await serveSockets(createWorldConnections(() => ({}) as LocalWorldHost, failing).accept);
    closers.push(server.close);
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((resolve) => socket.once('open', resolve));
    socket.send(JSON.stringify({ type: 'hello', clientId: 'p1' }));
    socket.send(JSON.stringify({ type: hostile }));

    // Only the quoted type: under FORCE_COLOR the line's own red styling starts with an ESC.
    expectEscapedAndCapped(/world message '(.*)' failed/s.exec(await logged)?.[1] ?? '');
    socket.terminate();
  });
});

describe('#1089: pageText', () => {
  it('keeps text of exactly 200 characters whole, and notes the one past it', () => {
    expect(pageText('a'.repeat(200))).toBe('a'.repeat(200));
    expect(pageText('a'.repeat(201))).toBe(`${'a'.repeat(200)}... (1 more characters)`);
  });

  it('escapes DEL and both ends of C1', () => {
    expect(pageText('\u007f\u0080\u009f')).toBe('\\u007f\\u0080\\u009f');
  });
});
