/**
 * `requireFreePort` refuses a taken port before `boardsmith dev` opens anything (#345).
 */
import { describe, it, expect } from 'vitest';
import { createServer, type AddressInfo, type Server } from 'node:net';

import { requireFreePort } from './port.js';

async function listening(port = 0): Promise<Server> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
}

const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

describe('requireFreePort (#345)', () => {
  it('refuses a port something else holds, naming it and the flag that picks another', async () => {
    const held = await listening();
    const { port } = held.address() as AddressInfo;
    try {
      await expect(requireFreePort(port, '127.0.0.1')).rejects.toThrow(
        new RegExp(`^Port ${port} is already in use on 127\\.0\\.0\\.1.*--port <number>`, 's'),
      );
    } finally {
      await close(held);
    }
  });

  it('accepts a free port and leaves it free for the server that will take it', async () => {
    const probe = await listening();
    const { port } = probe.address() as AddressInfo;
    await close(probe);

    await requireFreePort(port, '127.0.0.1');

    await close(await listening(port));
  });
});
