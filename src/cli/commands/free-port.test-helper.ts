/**
 * A port nobody else is on, for the tests and browser regressions that serve
 * a dev host.
 *
 * Its own module, with nothing but Node imports, because the browser
 * regressions load `fixture-world.test-helper.ts` outside Vitest, and a module
 * that imports `vitest` throws there.
 */
import { createServer, type AddressInfo } from 'node:net';

export function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.on('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => done(port));
    });
  });
}
