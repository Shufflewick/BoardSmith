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

/** Host -> worker: answer once you get to this, so the host can tell busy rules from idle ones (#609). */
const ASK_ALIVE = 'alive';

/**
 * Worker -> host. A ready answer and a call's answer cross as the wire's JSON,
 * so the host holds exactly what a page would receive, never a live game
 * element (#885). `value` is absent for a call that answers nothing. A refusal
 * (`failed`, `error`) is an answer, so it crosses as its message alone.
 */
type FromWorker =
  | { readonly ready: string }
  | { readonly failed: string }
  | { readonly id: number; readonly value?: string }
  | { readonly id: number; readonly error: string }
  | { readonly event: unknown }
  | { readonly alive: true };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A crash in the rules: an error their worker did not catch, thrown as they loaded or as they ran.
 * Its stack is from inside the worker, at the author's own file and line, and goes to the terminal
 * only. What BoardSmith refuses is caught and answered, so it is never one of these.
 */
export class RulesError extends Error {
  constructor(message: string, stack: string) {
    super(message);
    this.stack = stack;
  }
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
    post({ failed: messageOf(error) });
    return;
  }
  port.on('message', async (message: Call | typeof ASK_ALIVE) => {
    if (message === ASK_ALIVE) return post({ alive: true });
    const { id, type, payload } = message;
    try {
      const answer: unknown = await handlers[type]!(payload);
      post(answer === undefined ? { id } : { id, value: toWireJson(answer) });
    } catch (error) {
      post({ id, error: messageOf(error) });
    }
  });
}

// ── The host side ─────────────────────────────────────────────────────────────

/** Every rules worker this process has started and that has not exited, and how to wait for it to answer. */
const live = new Map<Worker, () => Promise<void>>();

/**
 * Resolves once every running rules worker has answered (#609). The smoke walk does not count time
 * `boardsmith dev` spends not answering; rules busy in their worker, as a loaded machine keeps
 * them, answer late, so the dev host does too. A worker that stops counts as having answered.
 */
export async function rulesAnswered(): Promise<void> {
  await Promise.all([...live.values()].map((answered) => answered()));
}

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
  // The reader is the author, so a rules crash shows them its own text (#1121); this process's env is left alone.
  const worker = new Worker(boot, { eval: true, workerData: data, env: { ...process.env, NODE_ENV: 'development' } });
  /** Who waits for the worker to answer: all of them at its next answer, or when it stops. */
  const waiting: Array<() => void> = [];
  const answered = (): void => {
    for (const done of waiting.splice(0)) done();
  };
  live.set(worker, () => {
    const once = new Promise<void>((resolve) => waiting.push(resolve));
    worker.postMessage(ASK_ALIVE);
    return once;
  });
  worker.once('exit', () => {
    live.delete(worker);
    answered();
  });

  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let nextId = 0;
  let listener: ((event: unknown) => void) | null = null;
  let closing: Promise<void> | null = null;
  /** Why calls fail, once the worker has stopped by itself. */
  let stopped: string | null = null;
  const stoppedError = (): Error =>
    new Error(`Your rules stopped running (${stopped}). Save a rules file, or restart boardsmith dev, to start them again.`);
  let drained: (() => void) | null = null;

  // An idle worker never keeps the process alive; one with a call in flight does.
  const settled = (): void => {
    if (pending.size > 0) return;
    worker.unref();
    drained?.();
  };

  let loaded = false;
  const ready = new Promise<unknown>((resolve, reject) => {
    const stop = (why: string, stack?: string): void => {
      // Nothing may be waiting on a worker that stops between calls, so say so here.
      if (loaded && stopped === null) {
        const said = styleText('red', `[boardsmith dev] Your rules stopped running: ${why}`);
        if (stack === undefined) console.error(said);
        else console.error(said, `\n${stack}`);
      }
      stopped ??= why;
      reject(stack === undefined ? new Error(why) : new RulesError(why, stack));
      for (const call of pending.values()) call.reject(stoppedError());
      pending.clear();
      settled();
    };
    worker.on('message', (message: FromWorker) => {
      if ('alive' in message) answered();
      else if ('ready' in message) resolve(JSON.parse(message.ready));
      else if ('failed' in message) reject(new Error(message.failed));
      else if ('event' in message) {
        if (listener === null) throw new Error('A rules worker sent an event before anything listened for it.');
        listener(message.event);
      } else {
        const call = pending.get(message.id)!;
        pending.delete(message.id);
        if ('error' in message) call.reject(new Error(message.error));
        else call.resolve(message.value === undefined ? undefined : JSON.parse(message.value));
        settled();
      }
    });
    worker.on('error', (error: unknown) => stop(messageOf(error), error instanceof Error ? error.stack : undefined));
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
          if (stopped !== null) return Promise.reject(stoppedError());
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
