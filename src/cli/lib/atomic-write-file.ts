import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/**
 * Atomically replaces `filePath`'s contents (CR-01's fix): write to a same-directory temp file,
 * `fsync` it, then `rename()` over the target. POSIX `rename()` within one filesystem is atomic,
 * so a crash at any point — including mid-write of the temp file itself, or between the temp
 * write completing and the rename executing — leaves `filePath` either byte-identical to its
 * pre-call state or containing the fully-written new content. Never a torn mix, never a
 * zero-byte/truncated target.
 *
 * The temp name embeds the pid and a random suffix (T-173-08-02) so two calls — even concurrent
 * runs whose ledgers happen to live in the same directory — can never collide on one temp path.
 * If `rename()` itself fails (including a failure injected to simulate the crash window), the
 * orphaned temp file is best-effort cleaned up and the error is re-thrown rather than swallowed —
 * fail loud, per this project's error-handling contract. An orphan that outlives a real crash is
 * harmless (T-173-08-04): its name is never `RUN.md`, so `ledgerFilePath`/`locateFences` and every
 * other ledger reader in `verify-run.ts` can never mistake it for the ledger.
 *
 * This is the ONE atomic write path in the repo, never a second implementation of temp-file+fsync+rename.
 */
export async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const dir = dirname(filePath);
  const tmpPath = join(dir, `.${basename(filePath)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  const handle = await fs.open(tmpPath, 'w');
  try {
    await handle.writeFile(content, 'utf-8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
}
