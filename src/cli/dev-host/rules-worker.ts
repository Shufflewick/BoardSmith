/**
 * A RULES BUNDLE, RUN IN A WORKER THAT A RELOAD THROWS AWAY (#885).
 *
 * Node never unloads an ES module, so `boardsmith dev` importing each rebuilt
 * rules bundle kept every old one alive. The dev host imports none: each bundle
 * runs in its own `worker_threads` worker, which the host calls by message and
 * terminates when a reload replaces it. docs/architecture.md § "The
 * `boardsmith dev` rules worker" says why a worker and what crosses.
 *
 * Both halves of the protocol live here, so they cannot disagree: the host
 * side ({@link startRulesWorker}) and the worker side ({@link serveRules}),
 * which a road's worker module calls from inside the bundle.
 */
import { pathToFileURL } from 'node:url';
import { styleText } from 'node:util';
import { parentPort, Worker, workerData } from 'node:worker_threads';

import { toWireJson } from './wire-json.js';

/** Host -> worker: one call. */
interface Call {
  readonly id: number;
  readonly type: string;
  readonly payload: unknown;
}

/**
 * Worker -> host. A ready answer and a call's answer cross as the wire's JSON,
 * so the host holds exactly what a page would receive, never a live game
 * element (#885). `value` is absent for a call that answers nothing.
 */
type FromWorker =
  | { readonly ready: string }
  | ({ readonly failed: string } & Stacked)
  | { readonly id: number; readonly value?: string }
  | ({ readonly id: number; readonly error: string } & Stacked)
  | { readonly event: unknown };

/** Where in the rules an error was thrown, for the terminal only: a page is never sent it. */
interface Stacked {
  readonly stack?: string;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stackOf(error: unknown): Stacked {
  return error instanceof Error && error.stack !== undefined ? { stack: error.stack } : {};
}

/** An error the rules threw in their worker. Its stack is theirs, at the author's own file and line. */
export class RulesError extends Error {
  constructor(message: string, stack: string) {
    super(message);
    this.stack = stack;
  }
}

/** The worker's error as the host holds it: a {@link RulesError} when the worker sent where it was thrown. */
function fromWorker(message: string, { stack }: Stacked): Error {
  return stack === undefined ? new Error(message) : new RulesError(message, stack);
}

// ── The worker side, run inside the bundle ────────────────────────────────────

/** A road's calls, by type. Each takes the call's payload. */
export type RulesHandlers = Record<string, (payload: any) => unknown>;

/**
 * SERVE A ROAD'S CALLS FROM INSIDE THE WORKER.
 *
 * `start` gets the rules' `gameDefinition`, the data the host started the
 * worker with, and `emit` for what the worker tells the host unasked. What it
 * returns as `ready` is the host's answer to "did these rules load"; a throw is
 * the refusal, and the host stops the worker.
 */
export function serveRules<D>(
  gameDefinition: D | undefined,
  start: (definition: D, data: unknown, emit: (event: unknown) => void) => { ready: unknown; handlers: RulesHandlers },
): void {
  const port = parentPort;
  if (port === null) throw new Error('This rules bundle runs only in a boardsmith dev rules worker.');
  const post = (message: FromWorker): void => port.postMessage(message);
  let handlers: RulesHandlers;
  try {
    if (!gameDefinition) throw new Error('Rules module must export a gameDefinition');
    const served = start(gameDefinition, workerData, (event) => post({ event }));
    handlers = served.handlers;
    post({ ready: toWireJson(served.ready) });
  } catch (error) {
    post({ failed: messageOf(error), ...stackOf(error) });
    return;
  }
  port.on('message', async ({ id, type, payload }: Call) => {
    try {
      const answer: unknown = await handlers[type]!(payload);
      post(answer === undefined ? { id } : { id, value: toWireJson(answer) });
    } catch (error) {
      post({ id, error: messageOf(error), ...stackOf(error) });
    }
  });
}

// ── The host side ─────────────────────────────────────────────────────────────

/** Every rules worker this process has started and that has not exited. */
const live = new Set<Worker>();

/** How many rules workers are running in this process. */
export function liveRulesWorkers(): number {
  return live.size;
}

/** One running rules bundle, as the host holds it. */
export interface RulesWorker {
  /** Run `type` in the worker; resolves with its answer, rejects with its error's message. */
  call<T>(type: string, payload?: unknown): Promise<T>;
  /** Where the worker's unasked events go. One listener; a later call replaces it. */
  listen(listener: (event: unknown) => void): void;
  /**
   * False once {@link RulesWorker.close} has been asked for or the worker has
   * stopped on its own; every call made then rejects.
   */
  readonly alive: boolean;
  /** Stop the worker, once every call already made on it has answered. */
  close(): Promise<void>;
}

/**
 * Start a worker on the bundle at `bundlePath` and wait for its rules to load.
 * `data` reaches the worker side's `start`. Resolves with the worker and its
 * `ready` answer; a bundle that fails to load is stopped, and its reason thrown.
 */
export async function startRulesWorker(bundlePath: string, data: unknown): Promise<{ worker: RulesWorker; ready: unknown }> {
  // Source maps on before the bundle loads, so a rules stack names the author's file and line. Not
  // by `execArgv`: Node then checks every inherited flag, and refuses one like --max-old-space-size.
  // A load that rejects is rethrown, so it fails the worker whatever --unhandled-rejections says.
  const boot =
    `process.setSourceMapsEnabled(true);\n` +
    `import(${JSON.stringify(pathToFileURL(bundlePath).href)}).catch((error) => process.nextTick(() => { throw error; }));`;
  const worker = new Worker(boot, { eval: true, workerData: data });
  live.add(worker);
  worker.once('exit', () => live.delete(worker));

  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let nextId = 0;
  let listener: ((event: unknown) => void) | null = null;
  let closing: Promise<void> | null = null;
  /** Why calls fail, once the worker has stopped by itself. */
  let stopped: string | null = null;
  let drained: (() => void) | null = null;

  // An idle worker never keeps the process alive; one with a call in flight does.
  const settled = (): void => {
    if (pending.size > 0) return;
    worker.unref();
    drained?.();
  };

  let loaded = false;
  const ready = new Promise<unknown>((resolve, reject) => {
    const stop = (why: string, stacked: Stacked = {}): void => {
      // Nothing may be waiting on a worker that stops between calls, so say so here.
      if (loaded && stopped === null) {
        const said = styleText('red', `[boardsmith dev] Your rules stopped running: ${why}`);
        if (stacked.stack === undefined) console.error(said);
        else console.error(said, `\n${stacked.stack}`);
      }
      stopped ??= why;
      reject(fromWorker(why, stacked));
      for (const call of pending.values()) call.reject(new Error(stopped));
      pending.clear();
      settled();
    };
    worker.on('message', (message: FromWorker) => {
      if ('ready' in message) resolve(JSON.parse(message.ready));
      else if ('failed' in message) reject(fromWorker(message.failed, message));
      else if ('event' in message) {
        if (listener === null) throw new Error('A rules worker sent an event before anything listened for it.');
        listener(message.event);
      } else {
        const call = pending.get(message.id)!;
        pending.delete(message.id);
        if ('error' in message) call.reject(fromWorker(message.error, message));
        else call.resolve(message.value === undefined ? undefined : JSON.parse(message.value));
        settled();
      }
    });
    worker.on('error', (error) => stop(messageOf(error), stackOf(error)));
    worker.on('exit', (code) => {
      if (closing === null) stop(`the rules worker exited with code ${code}`);
    });
  });

  try {
    const answer = await ready;
    loaded = true;
    settled();
    return {
      ready: answer,
      worker: {
        call<T>(type: string, payload?: unknown): Promise<T> {
          if (stopped !== null) {
            return Promise.reject(
              new Error(
                `Your rules stopped running (${stopped}). Save a rules file, or restart boardsmith dev, to start them again.`,
              ),
            );
          }
          if (closing !== null) return Promise.reject(new Error('These rules were replaced, so they take no more calls.'));
          const id = ++nextId;
          return new Promise<T>((resolve, reject) => {
            // Posted first: a payload that cannot be sent rejects here and leaves nothing pending.
            worker.postMessage({ id, type, payload } satisfies Call);
            pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
            worker.ref();
          });
        },
        listen(next) {
          listener = next;
        },
        get alive() {
          return closing === null && stopped === null;
        },
        close() {
          closing ??= (async () => {
            if (pending.size > 0) await new Promise<void>((resolve) => (drained = resolve));
            await worker.terminate();
          })();
          return closing;
        },
      },
    };
  } catch (error) {
    closing = worker.terminate().then(() => {});
    await closing;
    throw error;
  }
}
