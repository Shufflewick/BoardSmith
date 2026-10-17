/**
 * `read(path)`, or `undefined` when nothing is at `path` (it, or a folder on the way to it, is
 * absent: `ENOENT`, `ENOTDIR`). Any other failure (a folder in the
 * file's place, no permission, a disk error) is thrown naming the file, never read as "missing".
 */
export async function readIfExists<T>(path: string, read: (path: string) => Promise<T>): Promise<T | undefined> {
  try {
    return await read(path);
  } catch (error) {
    const { code, message } = error as NodeJS.ErrnoException;
    if (code === 'ENOENT' || code === 'ENOTDIR') return undefined;
    throw new Error(
      `Could not read ${path} (${code ?? message}). Check that it is a file you can read, then run the command again.`,
      { cause: error },
    );
  }
}
