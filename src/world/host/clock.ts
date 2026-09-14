/**
 * THE CLOCK, THE TIMER AND THE TURN, injected as one thing.
 *
 * `boardsmith/world` itself never reads a clock -- time arrives as an argument
 * -- but something has to decide what "now" is before a command can be stamped
 * with it, and that something is the host. So the host core takes this, and
 * every host supplies its own: `boardsmith dev` supplies `Date.now` plus a
 * chained `setTimeout` (`node-world-clock.ts`), and `boardsmith/testing`'s
 * `TestWorld` supplies a number a test moves by hand.
 *
 * It is injected rather than reached for because "fires on its due time" is the
 * one behaviour a test must not prove by waiting for it, and because the "fire
 * due events now" control MOVES the world's clock -- which is only expressible
 * if the host reads time through something it can offset.
 */
export interface WorldHostClock {
  /** Wall clock, in epoch ms. */
  now(): number;
  /** Arm a single timer, replacing any previous one. `null` disarms. */
  arm(delayMs: number | null, fire: () => void): void;
  /**
   * GIVE EVERYTHING ELSE A TURN, without giving up the world lock.
   *
   * Reached once per round of a chronological world's catch-up, so that a
   * defective handler which re-arms itself at zero delay makes a SLOW host
   * rather than a wedged one. It is on the clock rather than written inline
   * because the runtime's turn is the runtime's to define: Node has
   * `setImmediate`, a Worker does not, and a test that drives its own clock
   * wants neither.
   */
  yieldTurn(): Promise<void>;
}
