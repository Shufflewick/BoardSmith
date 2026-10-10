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
