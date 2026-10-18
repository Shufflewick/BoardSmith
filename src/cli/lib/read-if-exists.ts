import { promises as fs } from 'node:fs';

/**
 * `read(path)`, or `undefined` when nothing is at `path`: `ENOENT`, or `ENOTDIR` (a file stands
 * where a folder on the path should be). Any other failure (a folder in the file's place, no
 * permission, a link loop, a disk error) is thrown naming the path, never read as "missing".
 */
export async function readIfExists<T>(path: string, read: (path: string) => Promise<T>): Promise<T | undefined> {
  try {
    return await read(path);
  } catch (error) {
    const { code, message } = error as NodeJS.ErrnoException;
    if (code === 'ENOENT' || code === 'ENOTDIR') return undefined;
    throw new Error(`Could not read ${path} (${code ?? message}). Check that you can read it, then run the command again.`, {
      cause: error,
    });
  }
}

/**
 * The text of a path git lists, or `undefined` when it is gone, a folder (a submodule, a link to a
 * folder, which holds no text of its own) or a binary file. Any other failure is thrown as by {@link readIfExists}.
 */
export async function readListedText(path: string): Promise<string | undefined> {
  const buffer = await readIfExists(path, async (file) => ((await fs.stat(file)).isFile() ? fs.readFile(file) : undefined));
  return buffer === undefined || buffer.includes(0) ? undefined : buffer.toString('utf-8');
}
