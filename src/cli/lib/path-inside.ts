import { isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * Whether `path` is `folder` or lies under it, by whole segments (`src/rules` does not hold
 * `src/rules-old`) and exact names (#1053). Use it wherever "inside" means skipped or trusted.
 */
export function isSameOrInside(folder: string, path: string): boolean {
  const rel = relative(folder, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * Whether some disk could open `candidate` as `folder` or under it: a case-insensitive one (macOS,
 * Windows) opens `SRC/` as `src/`, and may fold a non-ASCII name such as `ſrc` to `src`, a fold no
 * check can be sure of, so a candidate segment with a non-ASCII letter counts as a match (#841, #1053).
 * Wider than `isSameOrInside`, so only for checks where "inside" adds a finding or a refusal.
 */
export function mayBeSameOrInside(folder: string, candidate: string): boolean {
  const outer = resolve(folder).split(sep).filter(Boolean);
  const inner = resolve(candidate).split(sep).filter(Boolean);
  return (
    outer.length <= inner.length &&
    outer.every((name, i) => name.toLowerCase() === inner[i].toLowerCase() || /[^\x00-\x7f]/.test(inner[i]))
  );
}
