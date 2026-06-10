import { SnapshotSessionHost } from '../snapshot-session-host.js';
import { executeOp, type GameDefinitionLike, type Op } from '../stateless-ops.js';

/** Drives a SnapshotSessionHost with an IN-PROCESS executeOp, forcing every op
 *  payload and every broadcast through structuredClone so non-cloneable data
 *  throws exactly as postMessage would in the production iframe. */
export function createHeadlessSession(
  def: GameDefinitionLike,
  gameOptions: { playerCount: number; seed?: string },
  aiSeats: Array<{ seat: number; level?: string }> = [],
) {
  const broadcasts: unknown[] = [];
  const host = new SnapshotSessionHost({
    playerCount: gameOptions.playerCount,
    aiSeats,
    executeOp: (snap, pend, op) => executeOp(def, gameOptions, snap, pend, op),
    broadcast: (views) => {
      // structuredClone here mirrors the production postMessage boundary: a
      // broadcast carrying a live game object would throw a DataCloneError.
      broadcasts.push(structuredClone(views));
    },
  });
  return {
    host,
    broadcasts,
    async start() {
      await host.start();
    },
    async send(seat: number, op: Op) {
      structuredClone(op); // throws DataCloneError if a payload carries a non-cloneable game object
      return host.handleOp(seat, op);
    },
  };
}
