import type { ReconnectTimer } from './multiplayer-host.js';

/**
 * A reconnect-grace timer a test runs by hand (#412). Pass `timer` as the
 * host's `reconnectTimer`; `armed()` is the delay of every grace still pending,
 * and `elapse()` ends them all, as each window running out would.
 */
export function manualGraceTimer() {
  const pending = new Set<{ delayMs: number; fire: () => void }>();
  const timer: ReconnectTimer = (delayMs, fire) => {
    const entry = { delayMs, fire };
    pending.add(entry);
    return () => pending.delete(entry);
  };
  return {
    timer,
    armed: () => [...pending].map((entry) => entry.delayMs),
    elapse: async () => {
      const due = [...pending];
      pending.clear();
      for (const entry of due) entry.fire();
      // The cover's bot pump is fire-and-forget; let it settle.
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}
