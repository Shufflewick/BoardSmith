/**
 * The seats waiting on the step clock in a harness with no wall clock
 * (`boardsmith simulate`, the bot trainer's benchmark; see `FROZEN_NOW`), #1541.
 *
 * @module
 */
import type { GameRunner } from './runner.js';

/** The instant a seat waits for, if any, and who waits, for messages. */
interface ClockWait {
  until: number | undefined;
  who: string;
}

/**
 * Seats that chose to wait since the game last changed, as a live host holds
 * them. They are not asked again until it changes, or until every seat that
 * can move waits: then the clock moves to the earliest instant they wait for,
 * as a host's reoffer timer would, and every seat is asked again.
 */
export class ClockWaits {
  private readonly waits = new Map<number, ClockWait>();

  /** Record that `seat` waits until host instant `until`, or with no instant, until the game changes (#1719). */
  add(seat: number, until: number | undefined, who: string): void {
    this.waits.set(seat, { until, who });
  }

  /** The game changed, so every seat is asked again. */
  clear(): void {
    this.waits.clear();
  }

  /**
   * The seats to ask now, from `canMove()`, the seats that can move: those not
   * waiting. When every one waits, the clock moves first and all are asked.
   * Returns why the game stops instead when no seat waits for an instant, or
   * when the earliest wait reaches the open step's time limit, when a host
   * would close the seats: these harnesses run no deadlines.
   */
  seatsToAsk<S extends { seat: number }>(runner: GameRunner, canMove: () => S[]): S[] | string {
    const seats = canMove();
    if (seats.length === 0 || seats.some(({ seat }) => !this.waits.has(seat))) {
      return seats.filter(({ seat }) => !this.waits.has(seat));
    }
    const late = this.moveClock(runner);
    return late ?? canMove();
  }

  private moveClock(runner: GameRunner): string | undefined {
    const timed = [...this.waits.values()].filter((wait): wait is { until: number; who: string } => wait.until !== undefined);
    if (timed.length === 0) {
      const seats = [...this.waits].map(([seat, { who }]) => `seat ${seat} (${who})`).join(', ');
      return (
        `Every seat that can move waits until the game changes, and none of them will change it: ${seats}. ` +
        'A host would hold these seats forever, so the game stops here. Have one of them return the move it makes now.'
      );
    }
    const { until, who } = timed.reduce((earliest, wait) => (wait.until < earliest.until ? wait : earliest));
    const now = runner.game._hostNow;
    if (now === undefined || !(until > now)) {
      throw new Error(
        `${who} waits until instant ${until}, which is not after the game's instant ${now}, so the game would never move on. ` +
          "Wait only for an instant later than the game's, or return the move the seat makes now.",
      );
    }
    const closesAt = runner.game.stepClosesAt();
    if (closesAt !== undefined && until >= closesAt) {
      return (
        `${who} waits until instant ${until}, but the open step's time limit ends at instant ${closesAt}, when a host would close the seat. ` +
        'The simulator and the benchmark run no deadlines, so the game stops here. Have the bot stop waiting before the time limit ends.'
      );
    }
    runner.setNow(until);
    this.waits.clear();
    return undefined;
  }
}
