/**
 * A message that deals a game runs the table's rules, so one held for a saved
 * edit that does not load is refused, not run on the old rules (#379). Table
 * setup's player options deal a game (#1323), as `configure` does.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createDevHostConnectionHandler } from './connection-handler.js';
import { openSocketPage, serveSockets } from './socket-page.test-helper.js';

const servers: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

describe('dev table socket: messages held for a rules edit that does not load', () => {
  it.each(['configure', 'setPlayerOptions'])('refuses %s, which deals a game', async (type) => {
    const ran: string[] = [];
    const server = await serveSockets(
      createDevHostConnectionHandler({
        mpHost: {
          handleMessage: async (_clientId, msg) => void ran.push(msg.type),
          disconnect: () => {},
          bindPageLoad: () => {},
          forgetPageLoad: () => {},
        },
        clients: new Map(),
        // Every message is held for an edit that fails: refused when it may be, else run.
        queue: { admit: async (work) => (work.refuse ? work.refuse('The edit did not load.') : work.run()) },
        onError: (err) => {
          throw err;
        },
      }),
    );
    servers.push(server);
    const page = await openSocketPage(server.port, 'A', (f) => f.type === 'welcome');

    // A lobby read is never refused, so once it has run the message before it has been answered.
    const read = server.received((m) => m.type === 'getLobby');
    const refused = page.next((f) => f.type === 'error');
    page.send({ type, playerOptions: [] });
    page.send({ type: 'getLobby' });
    await read;

    expect(ran).toEqual(['hello', 'getLobby']);
    expect(await refused).toMatchObject({ message: 'The edit did not load.' });
    page.socket.close();
  });
});
