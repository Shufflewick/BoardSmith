/**
 * IS THE PORT FREE, ASKED BEFORE `boardsmith dev` OPENS ANYTHING (#345).
 *
 * Vite finds out a port is taken only when it listens, and both dev hosts reach
 * that point holding things: a world run has opened its store and started the
 * world, which writes to it, and a table run has opened its session store. A
 * refused second run in the same project therefore wrote to a world the first
 * run owns, and the Vite server it had built kept the process alive after the
 * refusal was printed.
 *
 * So `devCommand` asks here first, before `--reset`, before the rules are
 * bundled, and before either road opens a store. Each road still releases what
 * it holds if Vite's own listen fails, because the port can be taken in the
 * moment between this check and that listen.
 */
import { createServer } from 'node:net';

/**
 * Resolve if `port` can be bound on `host` right now, and leave it unbound.
 *
 * Rejects with a message that names the port and says how to pick another,
 * which is the whole of what the author needs to act on.
 */
export function requireFreePort(port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', (error: NodeJS.ErrnoException) => {
      reject(
        new Error(
          error.code === 'EADDRINUSE'
            ? `Port ${port} is already in use on ${host}, so boardsmith dev did not start. ` +
                'Stop whatever holds it (often another `boardsmith dev` for this project), ' +
                'or pick another port with --port <number>.'
            : `boardsmith dev cannot listen on port ${port} on ${host} (${error.code ?? error.message}). ` +
                'Pick another port with --port <number>.',
        ),
      );
    });
    probe.listen(port, host, () => probe.close(() => resolve()));
  });
}
