/**
 * ONE ORDERLY STOP, HOWEVER MANY TIMES IT IS ASKED FOR (#197).
 *
 * Ctrl-C at a terminal signals the whole foreground process group, and a dev
 * server started through a package script is two processes in it -- so both
 * SIGINT handlers can run, and a second one used to print "Shutting down..."
 * again and then walk a database its own first pass had already closed.
 *
 * A dev command therefore never registers signal handlers itself: it hands its
 * teardown here, and gets the guarantee that the teardown body runs exactly
 * once no matter how many signals arrive.
 */
interface ShutdownHandle {
  /** Run the teardown now (or join the run already in progress). */
  run(): Promise<void>;
  /** Stop listening for signals. For tests and for a host that restarts. */
  cancel(): void;
}

/**
 * Run `teardown` on the first SIGINT or SIGTERM, once.
 *
 * `teardown` is expected to end the process; this only guarantees it is
 * entered a single time.
 */
export function onShutdown(teardown: () => Promise<void>): ShutdownHandle {
  let running: Promise<void> | null = null;
  const run = (): Promise<void> => (running ??= teardown());
  const onSignal = (): void => {
    void run();
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  return {
    run,
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
