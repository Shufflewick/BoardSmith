/**
 * THE SMOKE WALK'S CLOCK (#609): time that counts only while the page and `boardsmith dev` answer.
 *
 * Every wait in the walk asks whether something happened in time: a game dealt, a turn offered, a
 * control pressable. Each is meant to catch a game or a page that is stuck, and a stuck one is
 * stuck while it answers. On a machine running many verifies at once the browser and the dev host
 * are starved instead: they answer late, and a wait measured on the wall clock ran out on a game
 * that was only slow. So the walk asks the page and the dev host a trivial question every
 * {@link ANSWER_TICK_MS}, and counts each answer as that tick and its slack at most, however long
 * it took: time a starved page or host spends not answering is not counted, and a stuck page that
 * answers promptly is charged in full, failing when it did before with the same message.
 *
 * A page or host that stops answering altogether would stop the clock for good, so one that has
 * not answered for {@link FROZEN_MS} is {@link PageClock.frozen}, and the walk reports that.
 *
 * The walk's waits on that clock live here too ({@link withinPageTime}, {@link actWithinPageTime}),
 * keyed by the page whose clock they read ({@link clocks}).
 *
 * Nothing here imports Playwright: `boardsmith dev` imports {@link DEV_HOST_ALIVE_PATH} from it.
 *
 * @module
 */

/** How often the clock asks the page and the dev host whether they are answering. */
export const ANSWER_TICK_MS = 100;

/** How much longer than a tick an answer may take and still count whole: a prompt answer takes a few ms. */
const ANSWER_SLACK_MS = 100;

/**
 * How long the page or the dev host may go without answering a trivial question before it counts as
 * having stopped. Starved, they answer in well under a second; a minute of silence is something in
 * them that runs without end.
 */
export const FROZEN_MS = 60_000;

/** The path `boardsmith dev` answers at once, with nothing, so the walk can tell it is answering (#609). */
export const DEV_HOST_ALIVE_PATH = '/__boardsmith-alive';

/** How the walk says a page or dev host stopped answering altogether. */
const FROZEN_SAYS =
  `the page stopped answering for ${FROZEN_MS / 1000}s: the browser, or \`boardsmith dev\` behind it, was busy the whole ` +
  'time and never finished. Run `boardsmith smoke` to watch it, and look for something in the board or the rules that ' +
  'runs without end.';

/** Thrown by a wait in the walk when the page or the dev host has stopped answering ({@link PageClock.frozen}). */
export class PageFrozen extends Error {
  constructor() {
    super(FROZEN_SAYS);
    this.name = 'PageFrozen';
  }
}

/**
 * Thrown by a call into the page that was still not done after its budget of the page's time
 * ({@link PageClock.now}), while the page kept answering: something in the page held that one call
 * up. `what` names the call as the walk describes it ("looking for the control again"). Callers
 * pass it on as it is: it is neither a control that never became pressable nor a page that was
 * replaced or stopped answering (#666).
 */
export class PageTimeOverrun extends Error {
  constructor(what: string, budgetMs: number) {
    super(
      `${what} was still not done after ${budgetMs / 1000}s, though the page kept answering the whole time, so something ` +
        'in the page held that call up. Run `boardsmith smoke` to watch it.',
    );
    this.name = 'PageTimeOverrun';
  }
}

/**
 * The time a page and its dev host have been answering, read with {@link now}. `ask` puts the
 * trivial question; one that is refused (a page navigating away refuses an evaluation) was still
 * answered. {@link start} starts asking, and {@link stop} stops it when the walk is done.
 */
export class PageClock {
  private counted = 0;
  private lastAnswer = Date.now();
  private running = false;

  constructor(private readonly ask: () => Promise<unknown>) {}

  start(): void {
    this.running = true;
    this.lastAnswer = Date.now();
    void this.keepAsking();
  }

  stop(): void {
    this.running = false;
  }

  /** The milliseconds the page and its dev host have been answering since {@link start}. */
  now(): number {
    return this.counted;
  }

  /** Whether the page or its dev host has gone {@link FROZEN_MS} without answering. */
  frozen(): boolean {
    return Date.now() - this.lastAnswer > FROZEN_MS;
  }

  private async keepAsking(): Promise<void> {
    while (this.running) {
      const asked = Date.now();
      await new Promise((tick) => setTimeout(tick, ANSWER_TICK_MS));
      if (!this.running) return;
      await this.ask().catch(() => undefined);
      const answered = Date.now();
      this.counted += Math.min(answered - asked, ANSWER_TICK_MS + ANSWER_SLACK_MS);
      this.lastAnswer = answered;
    }
  }
}

/**
 * How long one try at a wait gets on the wall clock before the walk reads the page's clock again: a
 * wait is tried again until its time on the page's clock has passed.
 */
export const TRY_MS = 1_000;

/** Each browser's clock, keyed by its page, started when it opens (`startClock` in `browser-smoke`). */
export const clocks = new WeakMap<object, PageClock>();

/**
 * A stopwatch on `page`'s clock, started now: whether `budgetMs` of the page's time has passed. It
 * throws {@link PageFrozen} once the page or the dev host has stopped answering altogether, which
 * no wait outlasts.
 */
export function stopwatch(page: object): (budgetMs: number) => boolean {
  const clock = clocks.get(page);
  if (clock === undefined) throw new Error('The smoke walk opened a page without starting its clock (startClock).');
  const since = clock.now();
  return (budgetMs) => {
    if (clock.frozen()) throw new PageFrozen();
    return clock.now() - since > budgetMs;
  };
}

/** Whether `error` is a wait running out of time. */
export const ranOut = (error: unknown) => error instanceof Error && error.name === 'TimeoutError';

/**
 * Waits for what `attempt` waits for, given `timeout` ms of the wall clock a try, until `budgetMs`
 * of `page`'s time has passed, and then throws the last try's timeout. `what` names the wait in the
 * {@link PageTimeOverrun} a try that hangs throws ("waiting for the seat switcher"). Only for a wait that may be
 * tried again: one that reads or waits, never one that presses. A try that hangs in the page, as a
 * script Playwright runs once it has found the element does, is held to the page's time too (#618).
 */
export async function withinPageTime<T>(
  page: object,
  budgetMs: number,
  what: string,
  attempt: (timeout: number) => Promise<T>,
): Promise<T> {
  const over = stopwatch(page);
  for (;;) {
    try {
      return await actWithinPageTime(page, budgetMs, what, () => attempt(TRY_MS));
    } catch (error) {
      if (!ranOut(error) || over(budgetMs)) throw error;
    }
  }
}

/**
 * Waits, as {@link withinPageTime} does, until any of `attempts` is met: true once one is, false
 * when every one ran out of page time. Any other error, as a frame detached under its wait, is
 * thrown, even when another wait ran out, so it is reported rather than taken for a quiet game (#926).
 */
export function anyWithinPageTime(page: object, budgetMs: number, what: string, attempts: readonly ((timeout: number) => Promise<unknown>)[]): Promise<boolean> {
  const any = (timeout: number) =>
    Promise.any(attempts.map((attempt) => attempt(timeout))).catch((none: AggregateError) => Promise.reject(none.errors.find((error) => !ranOut(error)) ?? none.errors[0]));
  return withinPageTime(page, budgetMs, what, any).then(
    () => true,
    (error: unknown) => {
      if (!ranOut(error)) throw error;
      return false;
    },
  );
}

/**
 * Does what `act` does once, with no timeout of its own (`timeout` 0), and returns what it gives.
 * It throws {@link PageTimeOverrun}, naming `what`, when `act` has not finished in `budgetMs` of
 * `page`'s time, and
 * {@link PageFrozen} once the page has stopped answering, running `meanwhile` every tenth of a try
 * while it waits. For a press, which is never tried again: one that ran out may still land, so the
 * walk ends there (its set-up presses) or reports it and moves on, as `press` and closing a dialog
 * with Escape do. And for every call into the page that takes no time limit of its own
 * (`inPageTime` in `browser-smoke`).
 */
export async function actWithinPageTime<T>(
  page: object,
  budgetMs: number,
  what: string,
  act: (timeout: number) => Promise<T>,
  meanwhile?: () => Promise<void>,
): Promise<T> {
  const over = stopwatch(page);
  const acting = act(0);
  acting.catch(() => undefined);
  for (;;) {
    if (await Promise.race([acting.then(() => true), new Promise<boolean>((tick) => setTimeout(() => tick(false), TRY_MS / 10))])) return acting;
    if (over(budgetMs)) throw new PageTimeOverrun(what, budgetMs);
    await meanwhile?.();
  }
}

/** How much of each page's time the walk gives errors its last press raised to reach the page's listeners. */
const LAST_ERRORS_MS = 250;

/**
 * Waits until {@link LAST_ERRORS_MS} of each of `pages`' own time has passed, so errors the walk's
 * last press raised in any seat's browser land before the verdict, however starved that browser is (#925).
 */
export async function lastErrorsLand(pages: readonly object[]): Promise<void> {
  await Promise.all(
    pages.map(async (page) => {
      const over = stopwatch(page);
      while (!over(LAST_ERRORS_MS)) await new Promise((tick) => setTimeout(tick, ANSWER_TICK_MS));
    }),
  );
}
