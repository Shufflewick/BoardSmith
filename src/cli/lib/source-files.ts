import { existsSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

/** Every extension TypeScript bundler resolution and Vite load game code from (#848). */
export const SOURCE_EXTENSIONS = ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'vue'];

/** Every game source file under `dir`, skipping `node_modules`, dot entries and declaration files. */
export function collectSourceFiles(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) return files;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;

    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(fullPath, files);
      continue;
    }
    if (/\.d\.[mc]?ts$/.test(entry.name)) continue;
    if (SOURCE_EXTENSIONS.includes(extname(entry.name).slice(1))) {
      files.push(fullPath);
    }
  }

  return files;
}
