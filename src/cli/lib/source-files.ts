import { type Dirent, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Every extension TypeScript bundler resolution and Vite load game code from (#848). */
export const SOURCE_EXTENSIONS = ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'vue'];

export interface ListFilesOptions {
  /** A game source tree: leave out `node_modules`, dot entries and declaration files. */
  sourceTree: boolean;
  /** Keep only names ending in one of these (`'.css'`, `'.test.ts'`); every file when omitted. */
  suffixes?: readonly string[];
}

/**
 * A link counts as the file it points to. A link to a folder is an error: the build follows it (#1112).
 * A link to nothing is skipped in a source tree and an error elsewhere.
 */
function isFileOrLinkToFile(entry: Dirent, path: string, sourceTree: boolean): boolean {
  if (!entry.isSymbolicLink()) return entry.isFile();
  const target = statSync(path, { throwIfNoEntry: false });
  if (target?.isFile()) return true;
  if (sourceTree && !target) return false;
  throw new Error(
    `${path} is a link to ${target ? 'a folder' : 'nothing'}, and links are followed only to files. ` +
      'Replace the link with a copy of what it should point to.',
  );
}

/** The entries of `dir`, or an error that names it and says what to do. */
function readEntries(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOTDIR') throw new Error(`${dir} is a file, not a folder. Move it aside or rename it.`, { cause: err });
    if (code === 'EACCES' || code === 'EPERM') {
      throw new Error(`${dir} cannot be read: permission denied. Give your user read access to it.`, { cause: err });
    }
    throw new Error(`${dir} cannot be read (${code ?? String(err)}).`, { cause: err });
  }
}

/**
 * Every file under `dir`, depth first, or none if `dir` does not exist (#1048). A link to a file
 * counts as that file; a link to a folder stops the walk, so a link loop cannot trap it.
 * Not `readdirSync`'s own `recursive` option: on Node 22 that follows folder links, loops included.
 */
export function listFiles(dir: string, { sourceTree, suffixes }: ListFilesOptions): string[] {
  const skipped = (name: string) => sourceTree && (name === 'node_modules' || name.startsWith('.') || /\.d\.[mc]?ts$/.test(name));
  const wanted = (name: string) => !suffixes || suffixes.some((suffix) => name.endsWith(suffix));
  const files: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readEntries(current)) {
      if (skipped(entry.name)) continue;
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (isFileOrLinkToFile(entry, fullPath, sourceTree) && wanted(entry.name)) files.push(fullPath);
    }
  };
  if (existsSync(dir)) walk(dir);
  return files;
}

/** Every game source file under `dir` with one of `extensions`. */
export function collectSourceFiles(dir: string, extensions: readonly string[] = SOURCE_EXTENSIONS): string[] {
  return listFiles(dir, { sourceTree: true, suffixes: extensions.map((ext) => `.${ext}`) });
}
