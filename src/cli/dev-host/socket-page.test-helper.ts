/**
 * A PAGE OVER A REAL SOCKET, for tests that drive a dev host's own connection
 * layer (`createDevHostConnectionHandler`, `createWorldConnections`) the way a
 * browser does.
 *
 * `serveSockets` is the server half: a real `ws` server on a free port, each
 * connection handed to the road's own handler, and a way to wait until the
 * host has RECEIVED a message a page sent, or a page's socket closing. That last part is what lets a test
 * say "this message was already at the host when the rules finished
 * rebuilding" without waiting on a clock (#379).
 */
import { WebSocket, WebSocketServer } from 'ws';

type Frame = Record<string, unknown> & { type: string };

interface SocketPage {
  readonly socket: WebSocket;
  /** Every frame this page has been sent, in order. */
  readonly frames: Frame[];
  /** Resolves with the first frame from now on that `accept` takes. */
  next(accept: (frame: Frame) => boolean): Promise<Frame>;
  send(message: Record<string, unknown>): void;
}

interface ServedSockets {
  readonly port: number;
  /** Resolves once the server has handed a message `accept` takes to the handler. */
  received(accept: (message: Frame) => boolean): Promise<void>;
  /** Resolves once the server has handed a page's socket closing to the handler. */
  closed(): Promise<void>;
  close(): Promise<void>;
}

/** A real socket server handing each connection to `onConnection`. */
export async function serveSockets(onConnection: (socket: WebSocket) => void): Promise<ServedSockets> {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  const waiters: Array<{ accept: (message: Frame) => boolean; resolve: () => void }> = [];
  const closeWaiters: Array<() => void> = [];
  wss.on('connection', (socket) => {
    onConnection(socket);
    socket.on('close', () => {
      for (const resolve of closeWaiters.splice(0)) resolve();
    });
    // Registered AFTER the road's own handler, so by the time this sees a
    // message the handler has already taken it.
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as Frame;
      for (const waiter of [...waiters]) {
        if (!waiter.accept(message)) continue;
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve();
      }
    });
  });
  await new Promise<void>((resolve) => wss.once('listening', resolve));
  return {
    port: (wss.address() as { port: number }).port,
    received: (accept) => new Promise((resolve) => waiters.push({ accept, resolve })),
    closed: () => new Promise((resolve) => closeWaiters.push(resolve)),
    close: async () => {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}

/** Open a page on `port`, say hello as `clientId`, and resolve once the host sends a frame `greeted` takes. */
export async function openSocketPage(
  port: number,
  clientId: string,
  greeted: (frame: Frame) => boolean,
): Promise<SocketPage> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const frames: Frame[] = [];
  const waiters: Array<{ accept: (frame: Frame) => boolean; resolve: (frame: Frame) => void }> = [];
  socket.on('message', (raw) => {
    const frame = JSON.parse(raw.toString()) as Frame;
    frames.push(frame);
    for (const waiter of [...waiters]) {
      if (!waiter.accept(frame)) continue;
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(frame);
    }
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  const page: SocketPage = {
    socket,
    frames,
    next: (accept) => new Promise((resolve) => waiters.push({ accept, resolve })),
    send: (message) => socket.send(JSON.stringify(message)),
  };
  const greeting = page.next(greeted);
  page.send({ type: 'hello', clientId });
  await greeting;
  return page;
}
