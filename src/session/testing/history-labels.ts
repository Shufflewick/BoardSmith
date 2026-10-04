/**
 * Test-side readers of a game's action history.
 *
 * The history holds two kinds of entry since #494: an action a seat took, and a
 * timed seat the host closed (`SerializedSeatExpiry`). A test that lists what
 * happened wants one label per entry whichever kind it is, and a test that
 * inspects an action's args wants to say so and fail loudly if the entry is
 * not one, rather than cast past the difference.
 */
import { isSeatExpiry, type HistoryEntry, type SerializedAction } from '../../engine/index.js';

/** `name:seat` for an action, `seatExpiry:seat` for a closed timed seat, in order. */
export function historyLabels(history: readonly HistoryEntry[]): string[] {
  return history.map((entry) => (isSeatExpiry(entry) ? `seatExpiry:${entry.player}` : `${entry.name}:${entry.player}`));
}

/** The action recorded at `index`, or a thrown error naming the seat expiry found there instead. */
export function recordedAction(history: readonly HistoryEntry[], index: number): SerializedAction {
  const entry = history[index];
  if (entry === undefined) throw new Error(`The history has ${history.length} entries, so there is none at index ${index}.`);
  if (isSeatExpiry(entry)) throw new Error(`The entry at index ${index} is seat ${entry.player}'s expiry, not an action.`);
  return entry;
}
