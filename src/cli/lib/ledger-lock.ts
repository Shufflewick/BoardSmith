/**
 * Serialises a ledger's read-modify-write (#831). `atomicWriteFile` makes each write whole, but two
 * record calls that both read before either renames still lose one entry. Each caller takes
 * `<ledger>.lock` exclusively for the span from its read to its rename.
 *
 * Not `takeOsLock`: that leaves its lock file behind for good, and these ledgers sit in a game's
 * tracked tree, and it refuses at once where a record call should wait its turn.
 */
import { promises as fs } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const WAIT_MS = 20;

/** Runs `work` holding `<ledger>.lock`, waiting up to `tries` turns for it; always releases it. */
export async function withLedgerLock<T>(ledger: string, work: () => Promise<T>, tries = 250): Promise<T> {
  const lockPath = `${ledger}.lock`;
  for (let attempt = 1; ; attempt++) {
    try {
      await (await fs.open(lockPath, 'wx')).close();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (attempt >= tries) {
        throw new Error(
          `Could not lock ${ledger}: ${lockPath} still exists after ${tries} tries. Another verify command ` +
            `may be writing this ledger; wait for it and try again. If no verify command is running, the ` +
            `lock was left by one that was stopped, so delete it (rm "${lockPath}") and try again.`,
        );
      }
      await sleep(WAIT_MS);
    }
  }
  try {
    return await work();
  } finally {
    await fs.rm(lockPath, { force: true });
  }
}
