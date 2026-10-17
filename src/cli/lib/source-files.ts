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

const isFileOrLinkToFile = (entry: Dirent, path: string): boolean =>
  entry.isFile() || (entry.isSymbolicLink() && statSync(path, { throwIfNoEntry: false })?.isFile() === true);

/**
 * Every file under `dir`, depth first, or none if `dir` does not exist (#1048). A link to a file
 * counts as that file; a link to a folder is never followed, so a link loop cannot trap the walk.
 * Not `readdirSync`'s own `recursive` option: on Node 22 that follows folder links, loops included.
 */
export function listFiles(dir: string, { sourceTree, suffixes }: ListFilesOptions): string[] {
  const skipped = (name: string) => sourceTree && (name === 'node_modules' || name.startsWith('.') || /\.d\.[mc]?ts$/.test(name));
  const wanted = (name: string) => !suffixes || suffixes.some((suffix) => name.endsWith(suffix));
  const files: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (skipped(entry.name)) continue;
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (wanted(entry.name) && isFileOrLinkToFile(entry, fullPath)) files.push(fullPath);
    }
  };
  if (existsSync(dir)) walk(dir);
  return files;
}

/** Every game source file under `dir` with one of `extensions`. */
export function collectSourceFiles(dir: string, extensions: readonly string[] = SOURCE_EXTENSIONS): string[] {
  return listFiles(dir, { sourceTree: true, suffixes: extensions.map((ext) => `.${ext}`) });
}
