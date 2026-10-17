import { resolve, sep } from 'node:path';

const segmentsOf = (path: string): string[] => resolve(path).split(sep).filter(Boolean);

/** A non-ASCII name may fold to an ASCII one on a case-insensitive disk (`ſrc` opens `src/`), and no fold of it is sure (#841). */
const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase() || /[^\x00-\x7f]/.test(a + b);

/**
 * Whether `path` is `folder` or lies under it (#1053). Compared by whole segments, so `src/rules`
 * does not hold `src/rules-old`, and without letter case, since a case-insensitive disk (macOS,
 * Windows) opens `SRC/` as `src/`. Relative paths are taken from the working directory.
 */
export function isSameOrInside(folder: string, path: string): boolean {
  const outer = segmentsOf(folder);
  const inner = segmentsOf(path);
  return outer.length <= inner.length && outer.every((name, i) => sameName(name, inner[i]));
}
