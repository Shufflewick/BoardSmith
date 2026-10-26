/**
 * #1490: A SCRIPT READS A RUNNING WORLD'S COMMITTED STATE OVER HTTP.
 *
 * `boardsmith dev` holds `world.db` exclusively, so a script that opens the
 * file meets "database is locked". The dev server answers
 * `GET /__boardsmith/world/read` instead, from the rows the world committed.
 * These tests run the real world dev host on a fixture, commit a command over
 * the world's own socket, and read it back over HTTP.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, expect, it, onTestFinished, vi } from 'vitest';
import type { ViteDevServer } from 'vite';

import { openSocketPage } from '../dev-host/socket-page.test-helper.js';
import { withFixtureWorld } from './fixture-world.test-helper.js';
import { answerWorldRead, WORLD_READ_PATH, WORLD_WS_PATH } from './dev-world.js';

// Links these tests to the rules worker the fixture runs by path (#1415).
import.meta.glob('../dev-host/world-rules-worker.ts');

// Bundling the rules and starting Vite is the slow part. A hang guard, not a budget.
vi.setConfig({ testTimeout: 120_000 });

// `stoke` schedules the later event first, so due order is not arming order.
const RULES = `import { Game, Player, Space } from 'boardsmith';
import type { GameElement, GameOptions } from 'boardsmith';
import type { GameDefinition } from 'boardsmith/session';
import { worldAction, worldClockAction } from 'boardsmith/world';

class Fire extends Space<CampGame> { logs = 0; }

export class CampGame extends Game<CampGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Fire]);
  }
}

export const gameDefinition: GameDefinition = {
  gameClass: CampGame,
  gameType: 'fixture-camp',
  displayName: 'Fixture Camp',
  world: {
    maxPlayers: 2,
    genesis: (game) => ({ fire: (game as CampGame).create(Fire, 'fire') as GameElement }),
    view: () => ['fire'],
    actions: [
      worldAction<CampGame>('stoke').needs(() => ['fire']).execute((_args: unknown, ctx: any) => {
        (ctx.world.partition('fire') as Fire).logs += 1;
        ctx.world.schedule({ delayMs: 20 * 60_000, action: 'late', args: {} });
        ctx.world.schedule({ delayMs: 10 * 60_000, action: 'early', args: {} });
      }),
      worldClockAction<CampGame>('late').needs(() => ['fire']).execute(() => {}),
      worldClockAction<CampGame>('early').needs(() => ['fire']).execute(() => {}),
    ],
  },
};
`;

const BOARD = `import { defineComponent, h } from 'vue';

export default defineComponent({
  name: 'CampBoard',
  setup() {
    return () => h('div', 'the camp');
  },
});
`;

const SPEC = {
  slug: 'fixture-camp',
  displayName: 'Fixture Camp',
  gameClass: 'CampGame',
  rules: RULES,
  boardFile: 'CampBoard',
  board: BOARD,
};

interface Read {
  partitions: Array<{ name: string; parentId: number; json: unknown }>;
  scheduled: Array<{ action: string; due: number }>;
  seats: Array<{ player: string; seat: number }>;
  meta: Record<string, string>;
}

describe(`GET ${WORLD_READ_PATH} (#1490)`, () => {
  it('answers what a committed command wrote, and refuses writes and other sites', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await withFixtureWorld(SPEC, async ({ hostUrl }) => {
        const readUrl = new URL(WORLD_READ_PATH, hostUrl);
        const socketUrl = new URL(WORLD_WS_PATH, hostUrl);
        socketUrl.protocol = 'ws:';
        const page = await openSocketPage(socketUrl.href, 'p1', (f) => f.type === 'world_offers');
        const answer = page.next((f) => f.type === 'world_response' && f.requestId === 'stoke-1');
        page.send({ type: 'action', requestId: 'stoke-1', order: { id: 'order-1', at: Date.now() }, action: 'stoke', args: {} });
        expect(await answer).toMatchObject({ ok: true });
        page.socket.close();

        const response = await fetch(readUrl);
        expect(response.status).toBe(200);
        expect(response.headers.get('access-control-allow-origin')).toBeNull();
        const read = (await response.json()) as Read;
        expect(JSON.stringify(read.partitions.find((p) => p.name === 'fire')?.json)).toMatch(/"logs":1\b/);
        expect(read.scheduled.map((event) => event.action)).toEqual(['early', 'late']);
        expect(read.seats).toEqual([expect.objectContaining({ seat: 1 })]);
        expect(read.meta).toHaveProperty('nextElementId');

        const posted = await fetch(readUrl, { method: 'POST', body: '{}' });
        expect(posted.status).toBe(405);
        expect(posted.headers.get('allow')).toBe('GET');
        expect(await posted.text()).toContain('only answers GET');

        const foreign = await fetch(readUrl, { headers: { Origin: 'http://elsewhere.example' } });
        expect(foreign.status).toBe(403);
        expect(await foreign.text()).toContain('only answers pages served by this boardsmith dev');
      });
    } finally {
      log.mockRestore();
    }
  });
});

describe(`GET ${WORLD_READ_PATH} when the world cannot answer (#1490)`, () => {
  it("answers 503 with the worker's reason, so a script is told what to do", async () => {
    type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
    let handler: Handler | undefined;
    const vite = { middlewares: { use: (h: Handler) => (handler = h) } } as unknown as ViteDevServer;
    const stopped = 'Your rules stopped running (a rule threw). Save a rules file, or restart boardsmith dev, to start them again.';
    answerWorldRead(vite, () => Promise.reject(new Error(stopped)));
    const http = createServer((req, res) => handler!(req, res, () => res.writeHead(404).end()));
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    onTestFinished(() => new Promise<void>((resolve) => http.close(() => resolve())));

    const response = await fetch(`http://127.0.0.1:${(http.address() as AddressInfo).port}${WORLD_READ_PATH}`);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe(`boardsmith dev could not read the world: ${stopped}\n`);
  });
});
