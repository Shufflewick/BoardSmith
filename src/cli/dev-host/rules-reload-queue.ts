/**
 * WHAT A PAGE SENDS WHILE AN EDITED RULES FILE IS STILL REBUILDING (#379).
 *
 * `boardsmith dev` reloads the host's rules on every save (#201 for worlds,
 * #343 for tables), but bundling the edit takes time: a second or two on an
 * idle machine, half a minute on a loaded one. A move, or "New game", that
 * arrived in that window used to run on the rules from before the save, and
 * nothing said so. A designer who saves and clicks at once was testing the
 * previous rules without knowing it.
 *
 * So a save starts a PENDING RELOAD the moment the watcher hears it, before
 * bundling starts, and every message a page sends from then on is held, in the
 * order it arrived, until the reload has settled:
 *
 *   - THE NEW RULES ARE IN PLACE: the held messages run on them, in order.
 *   - THE REBUILD FAILED: every held message that would run the rules is
 *     refused with the reason, and the host stays on the rules it had. A held
 *     message that only connects or reads (a page saying hello, asking for the
 *     lobby) still runs, because the host is still there to answer it.
 *
 * Pages are told when a reload starts and when it settles, so they can say
 * "Reloading rules..." instead of looking stuck.
 *
 * ONE QUEUE FOR BOTH ROADS. The table host and the world host differ in what
 * "adopt the new rules" means (a table carries its game across, a world
 * reopens itself), and in the words a refusal is sent in. They do not differ
 * about when a message may run, and two copies of that decision is how one
 * road ends up running moves on stale rules again.
 *
 * Saves are reloaded one at a time, in order: a save-all across four files is
 * four reloads, never four overlapping ones. Held messages wait for the LAST
 * pending reload, so a message sent between two saves runs on the rules the
 * designer saved last.
 *
 * WORK THE HOST STARTS ITSELF WAITS IN THE SAME QUEUE (#387). A step deadline
 * running out, a world's scheduled event or a departure's grace coming due is
 * not a page's message, but it runs the rules just the same, and it used to
 * fire during the rebuild on the rules from before the save. Each host hands
 * such work to `hold`, usually through `heldClock`. It is never refused: it runs
 * on the edited rules once they are in place, or on the ones the host kept
 * when the rebuild failed.
 *
 * The queue is the session's `HostWorkGate` too (#388): the narrated demo's
 * next move goes through `hold`, and a chain of bot moves reads
 * `reloadPending` and stops between moves until the reload has settled.
 */
import chalk from 'chalk';

import type { HostWorkGate } from '../../session/host-work-gate.js';
import type { WorldHostClock } from './node-world-clock.js';

/** What a page is told about the host's rules while a save is reloading them. */
export type RulesReloadNotice =
  | { readonly state: 'reloading' }
  | { readonly state: 'reloaded' }
  | { readonly state: 'failed'; readonly message: string };

/** One message a page sent, as the queue holds it. */
interface ReloadAdmission {
  /** Deliver the message to the host. */
  run(): Promise<void>;
  /**
   * Answer the page that the message was not run, in its road's own words.
   * Present only for a message that runs the rules; a message without it
   * still runs after a failed reload, on the rules the host kept.
   */
  refuse?: (message: string) => void;
}

export interface RulesReloadQueue extends HostWorkGate {
  /**
   * A rules file was saved: from this call on, messages are held until the
   * rules it makes are in place. Resolves once that reload has settled and
   * the messages it held have been dealt with.
   */
  saved(file: string): Promise<void>;
  /**
   * Deliver a page's message now, or hold it while a reload is pending.
   * Resolves once it has run or been refused, and rejects when running it does.
   */
  admit(message: ReloadAdmission): Promise<void>;
  /**
   * Whether a save has been heard and its reload has not settled yet: the
   * rules the host runs are about to be replaced.
   */
  readonly reloadPending: boolean;
  /**
   * Run work the host started itself (a timer going off, a demo move coming
   * due) now, or once a pending reload has settled, in order with the pages'
   * messages. A failure is reported in the terminal, since nobody asked for it.
   */
  hold(work: () => void | Promise<void>): void;
}

/**
 * The gate of a queue built after the host it gates. The table road builds its
 * host first, because the queue adopts edited rules into it.
 */
export function gateOf(queue: () => RulesReloadQueue): HostWorkGate {
  return {
    get reloadPending() {
      return queue().reloadPending;
    },
    hold: (work) => queue().hold(work),
  };
}

/**
 * `clock`, with every timer it fires handed to `gate` (#387).
 *
 * An `arm` still replaces the timer whole, as `WorldHostClock` promises: a
 * fire that is waiting in the gate when the timer is armed again, or disarmed,
 * never runs. So a world closed while its alarm waited does not drain, and a
 * step that moved on while its deadline waited is not closed.
 */
export function heldClock(clock: WorldHostClock, gate: HostWorkGate): WorldHostClock {
  let armed = 0;
  return {
    now: () => clock.now(),
    yieldTurn: () => clock.yieldTurn(),
    arm(delayMs, fire) {
      const timer = ++armed;
      clock.arm(delayMs, () =>
        gate.hold(() => {
          if (armed === timer) fire();
        }),
      );
    },
  };
}

type Settled = { readonly ok: true } | { readonly ok: false; readonly message: string };

interface Held {
  readonly message: ReloadAdmission;
  readonly done: () => void;
  readonly failed: (error: unknown) => void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The queue for one dev run.
 *
 * `load` bundles the rules again and must re-read the source; a throw there is
 * a rebuild that failed, and the host is never handed anything. `adopt` gives
 * the loaded rules to the host; a throw there is the road saying the host
 * could not take them, and its message is what the terminal and the pages see.
 */
export function createRulesReloadQueue<R>(args: {
  /** What is running the rules, for the terminal and the pages. */
  what: 'table' | 'world';
  load: () => Promise<R>;
  adopt: (rules: R) => Promise<void>;
  /** Tell every connected page. */
  tell: (notice: RulesReloadNotice) => void;
}): RulesReloadQueue {
  /** Saves heard and not yet settled. Messages are held while this is above 0. */
  let pending = 0;
  /** Whether the pages have been told a reload started and not yet told it ended. */
  let announced = false;
  let draining = false;
  const held: Held[] = [];
  let reloading: Promise<void> = Promise.resolve();

  const reload = async (file: string): Promise<Settled> => {
    console.log(chalk.dim(`\n  ${file} changed -- reloading the ${args.what}'s rules...`));
    let rules: R;
    try {
      rules = await args.load();
    } catch (error) {
      const message = `Your edited rules did not load, so this ${args.what} is still running the ones it had: ${messageOf(error)}`;
      console.error(chalk.red(`  ${message}`));
      return { ok: false, message };
    }
    try {
      await args.adopt(rules);
    } catch (error) {
      const message = messageOf(error);
      console.error(chalk.red(`  ${message}`));
      return { ok: false, message };
    }
    return { ok: true };
  };

  /** Run or refuse what was held, in order, until a new save stops it. */
  const drain = async (settled: Settled): Promise<void> => {
    draining = true;
    try {
      while (pending === 0 && held.length > 0) {
        const next = held.shift()!;
        if (!settled.ok && next.message.refuse !== undefined) {
          next.message.refuse(settled.message);
          next.done();
          continue;
        }
        try {
          await next.message.run();
          next.done();
        } catch (error) {
          next.failed(error);
        }
      }
    } finally {
      draining = false;
    }
    // A save heard during the drain keeps the pages' notice up: its own
    // reload settles it.
    if (pending > 0) return;
    announced = false;
    args.tell(settled.ok ? { state: 'reloaded' } : { state: 'failed', message: settled.message });
  };

  const admit = (message: ReloadAdmission): Promise<void> => {
    if (pending === 0 && !draining && held.length === 0) return message.run();
    return new Promise<void>((done, failed) => held.push({ message, done, failed }));
  };

  return {
    get reloadPending() {
      return pending > 0;
    },

    saved(file) {
      pending += 1;
      if (!announced) {
        announced = true;
        args.tell({ state: 'reloading' });
      }
      reloading = reloading.then(async () => {
        const settled = await reload(file);
        pending -= 1;
        if (pending === 0) await drain(settled);
      });
      return reloading;
    },

    admit,

    hold(work) {
      admit({ run: async () => work() }).catch((error: unknown) =>
        console.error(chalk.red(`  [boardsmith dev] the ${args.what}'s own work failed: ${messageOf(error)}`)),
      );
    },
  };
}
