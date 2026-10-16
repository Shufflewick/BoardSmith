/**
 * WHEN A RESIDENT WORLD LETS GO OF A ROOM (#747).
 *
 * The one eviction rule every host runs, so `boardsmith dev`, `TestWorld` and
 * the platform agree about what stays resident. It came from ShufflewickPub's
 * `world-eviction.ts`; the limit is `WorldBudgets.maxResidentPartitions`.
 *
 * A DIRTY PARTITION IS NEVER EVICTED: `evict` deletes rather than spills, so a
 * dirty one evicted would silently roll its room back to the last checkpoint.
 * Run it immediately after a checkpoint.
 *
 * LEAST RECENTLY USED, by `residency()`'s `lastUsed`, which counts a command
 * NAMING a partition, reads included.
 */

/**
 * What to evict now, and what could not be: `blocked` is over budget but
 * dirty, which wants a checkpoint first rather than nothing.
 */
export function planEviction(
  resident: readonly { readonly name: string; readonly lastUsed: number }[],
  dirty: ReadonlySet<string>,
  budget: number,
): { readonly evict: readonly string[]; readonly blocked: readonly string[] } {
  const excess = resident.length - budget;
  if (excess <= 0) return { evict: [], blocked: [] };

  // Coldest first, ties by name, so the order is a function of state and not of array order.
  const coldest = [...resident].sort(
    (a, b) => a.lastUsed - b.lastUsed || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );

  const evict: string[] = [];
  const blocked: string[] = [];
  for (const partition of coldest) {
    if (evict.length >= excess) break;
    // Skipped rather than stopping the scan: a warmer clean one is still a legitimate eviction.
    if (dirty.has(partition.name)) blocked.push(partition.name);
    else evict.push(partition.name);
  }
  // Only what the shortfall actually needed counts as blocked.
  return { evict, blocked: blocked.slice(0, Math.max(0, excess - evict.length)) };
}
