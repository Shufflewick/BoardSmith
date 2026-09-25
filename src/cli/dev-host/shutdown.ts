/**
 * One thing a dev host holds, and how to let go of it.
 */
export interface HeldResource {
  /** What the terminal calls it if it does not close: "the Vite dev server". */
  readonly name: string;
  readonly close: () => Promise<void> | void;
}

/** How long a stop may take before it is given up on, naming what did not close. */
export const STOP_LIMIT_MS = 10_000;

/**
 * A HOST'S TEARDOWN: WHAT IT HOLDS, CLOSED IN ORDER, ONCE, AND BOUNDED (#366).
 *
 * `run()` closes each resource after the one before it has closed, and every
 * caller joins the same run. It resolves when everything has closed. It
 * rejects, naming what is still open, when a close fails (the rest are still
 * closed) or when the whole stop has not finished within `limitMs`. A stop
 * used to await one close that never finished, so it never said anything and
 * never ended (#366).
 */
interface Teardown {
  run(): Promise<void>;
  /** What has not closed yet, in the order it closes. */
  stillOpen(): readonly string[];
}

/**
 * WHAT A DEV COMMAND HOLDS, FROM ITS FIRST LINE (#386).
 *
 * The teardown used to be built once the host was ready, so a stop during
 * startup (the rules bundling, the world store open, Vite starting) had nothing
 * to run: the process died at once, leaving the build directory on disk and an
 * opened world unclosed. Now a command creates this before it does anything and
 * adds each thing to it as it is acquired, so a stop at any point releases
 * exactly what exists by then.
 *
 * What was held last closes first, and a group held together closes in the
 * order it was given, because a later resource is built on an earlier one:
 * the pages' sockets ride on the HTTP server, and everything is written into
 * the build directory.
 */
export interface HostHoldings extends Teardown {
  /** Hold `resources` until the host stops. */
  hold(resources: readonly HeldResource[]): void;
  /**
   * Open something the host will hold, and hold `held(opened)`.
   *
   * A stop requested while it is opening waits for it to finish, holds what it
   * opened and closes that with the rest, so nothing is removed from under a
   * writer still running (the rules bundle writes into the build directory).
   * From then on the stop owns the process: this never settles, and startup
   * goes no further. Once a stop has begun it opens nothing at all.
   */
  acquire<T>(open: () => Promise<T>, held: (opened: T) => readonly HeldResource[]): Promise<T>;
}

export function hostHoldings(limitMs: number = STOP_LIMIT_MS): HostHoldings {
  /** Held groups, oldest first. Emptied from the end as they close. */
  const groups: HeldResource[][] = [];
  const opening = new Set<Promise<unknown>>();
  const failures = new Map<string, string>();
  let stopping = false;
  const stillOpen = (): string[] => [...groups].reverse().flatMap((group) => group.map((resource) => resource.name));
  const named = (): string =>
    stillOpen()
      .map((name) => (failures.has(name) ? `${name} (${failures.get(name)})` : name))
      .join(', ');
  /** Where startup stops once the stop owns the process. */
  const stopped = new Promise<never>(() => {});

  const closeAll = async (): Promise<void> => {
    while (opening.size > 0) await Promise.allSettled([...opening]);
    for (const group of [...groups].reverse()) {
      for (const resource of [...group]) {
        try {
          await resource.close();
          group.splice(group.indexOf(resource), 1);
        } catch (error) {
          failures.set(resource.name, error instanceof Error ? error.message : String(error));
        }
      }
    }
    if (stillOpen().length > 0) throw new Error(`Stopping did not finish. Still open: ${named()}.`);
  };

  let running: Promise<void> | null = null;
  const run = (): Promise<void> =>
    (running ??= new Promise<void>((resolve, reject) => {
      stopping = true;
      // Referenced on purpose: a close that never settles may leave nothing
      // else on the event loop, and the process would then end silently with
      // the teardown unfinished instead of saying so.
      const limit = setTimeout(
        () =>
          reject(
            new Error(`Stopping did not finish within ${limitMs / 1000} seconds. Still open: ${named()}.`),
          ),
        limitMs,
      );
      closeAll().then(
        () => {
          clearTimeout(limit);
          resolve();
        },
        (error: unknown) => {
          clearTimeout(limit);
          reject(error);
        },
      );
    }));

  return {
    run,
    stillOpen,
    hold(resources) {
      groups.push([...resources]);
    },
    async acquire(open, held) {
      if (stopping) return stopped;
      const opened = open();
      opening.add(opened);
      try {
        const value = await opened;
        groups.push([...held(value)]);
        if (stopping) return stopped;
        return value;
      } catch (error) {
        if (stopping) return stopped;
        throw error;
      } finally {
        opening.delete(opened);
      }
    },
  };
}

/** A teardown of resources a host already holds, closed in the order given. */
export function teardownInOrder(resources: readonly HeldResource[], limitMs: number = STOP_LIMIT_MS): Teardown {
  const holdings = hostHoldings(limitMs);
  holdings.hold(resources);
  return holdings;
}

/**
 * Two signals this close together are one Ctrl-C delivered twice: through a
 * package script the terminal signals the process and npm forwards the signal
 * it received as well (#197). A second press comes later than this.
 */
export const DUPLICATE_SIGNAL_MS = 1_000;

interface ShutdownHandle {
  /** Stop listening for signals, once the host has been stopped some other way. */
  cancel(): void;
}

/**
 * Stop the host on SIGINT or SIGTERM, then end the process.
 *
 * The first signal runs `teardown` and exits 0 once everything has closed, or
 * 1 naming what did not. A dev command therefore never registers signal
 * handlers itself. A second Ctrl-C while the teardown is still running exits
 * at once, naming what is still open; the duplicate a package script delivers
 * for one keypress is not a second Ctrl-C.
 */
export function onShutdown(
  teardown: Teardown,
  io: { say: (line: string) => void; exit?: (code: number) => void },
): ShutdownHandle {
  const exit = io.exit ?? ((code: number) => process.exit(code));
  let firstAt: number | null = null;
  const onSignal = (): void => {
    if (firstAt === null) {
      firstAt = Date.now();
      io.say('\n  Shutting down... (Ctrl+C again stops without waiting)');
      teardown.run().then(
        () => exit(0),
        (error: Error) => {
          io.say(error.message);
          exit(1);
        },
      );
      return;
    }
    if (Date.now() - firstAt < DUPLICATE_SIGNAL_MS) return;
    io.say(`Stopped without waiting. Still open: ${teardown.stillOpen().join(', ')}.`);
    exit(1);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  return {
    cancel() {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
    },
  };
}

/**
 * SAY WHERE THE HOST IS, ONCE, FOR BOTH HOSTS.
 *
 * Two dev commands print the same three lines about the same server, and the
 * two copies had already drifted in their wording. What differs is only what
 * the thing is CALLED, so that is the argument.
 */
export function announceHost(args: {
  hostUrl: string;
  what: string;
  join: string;
  networkUrls: readonly string[];
  say: (line: string) => void;
  green: (line: string) => string;
  cyan: (line: string) => string;
}): void {
  args.say(args.green(`  ${args.what} running on ${args.hostUrl}`));
  for (const networkUrl of args.networkUrls) {
    args.say(args.cyan(`  Network (${args.join}): ${networkUrl}`));
  }
}
