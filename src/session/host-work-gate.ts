/**
 * HOW A HOST HOLDS THE WORK A SESSION STARTS ITSELF (#387, #388).
 *
 * A session does work nobody sent a message for: the narrated demo's next move
 * when its pace runs out, and a chain of bot moves. `boardsmith dev` replaces
 * the rules a session runs whenever the author saves, and that work must run
 * on the rules the author saved, not the ones from before the save. The dev
 * host's rules reload queue is this gate; a host whose rules never change
 * under a running game uses {@link runsAtOnce}.
 */
export interface HostWorkGate {
  /**
   * Whether the rules this session runs on are about to be replaced. Work
   * started now would run on the rules from before the save.
   */
  readonly reloadPending: boolean;
  /** Run `work` now, or once a pending reload has settled. */
  hold(work: () => void | Promise<void>): void;
}

/** A host no rules edit can reach runs its own work as it comes due. */
export const runsAtOnce: HostWorkGate = {
  reloadPending: false,
  hold: (work) => void work(),
};
