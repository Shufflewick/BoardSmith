/**
 * The State tab's search, as a pure function of the tree and the query (#153).
 *
 * The tab renders an arbitrarily deep object as rows keyed by dotted path. This
 * decides which of those paths a search term should leave on screen, and which
 * of them have to be opened for the reader to see the match at all.
 *
 * It returns paths rather than a pruned copy of the tree on purpose. A pruned
 * copy would have to lie: an array with two of its seven entries removed still
 * renders as `Array(2)`, and every index below a removed one shifts. Filtering
 * by path leaves the data exactly as the host sent it, so every summary, index
 * and count the tab shows is still the truth about the real state.
 *
 * @module
 */
import { formatValue, isExpandable } from './debug-format.js';

export interface StateTreeSearch {
  /**
   * The paths that survive the search, or `null` when there is no query and
   * everything survives. An empty set means the term matched nothing.
   */
  visiblePaths: Set<string> | null;
  /**
   * Paths the tab has to open for the matches to be reachable: every ancestor
   * of a match, and every container inside a matched subtree. Empty when there
   * is no query, so an idle search box never touches what the reader opened.
   */
  expandedPaths: Set<string>;
  /** How many rows matched the term themselves. */
  matchCount: number;
}

/** Does this row match on its own, ignoring its children? */
function rowMatches(key: string, value: unknown, lowerQuery: string): boolean {
  if (key.toLowerCase().includes(lowerQuery)) return true;
  // Only leaves are compared by value: an object's summary is `{3 keys}`, which
  // says nothing about the state and would match on stray terms like "keys".
  if (isExpandable(value)) return false;
  return formatValue(value).toLowerCase().includes(lowerQuery);
}

/**
 * Find the rows of `root` that match `query`.
 *
 * @param root - The object the tab renders, or null/undefined when there is no
 *   state to search.
 * @param query - What the reader typed. Blank means no search at all.
 * @param rootPath - The path prefix the tab renders its top-level rows under.
 */
export function searchStateTree(
  root: unknown,
  query: string,
  rootPath: string = 'root',
): StateTreeSearch {
  const lowerQuery = query.trim().toLowerCase();
  const visiblePaths = new Set<string>();
  const expandedPaths = new Set<string>();
  let matchCount = 0;

  if (!lowerQuery) {
    return { visiblePaths: null, expandedPaths, matchCount: 0 };
  }
  if (!isExpandable(root)) {
    return { visiblePaths, expandedPaths, matchCount: 0 };
  }

  // A view tree can hold the same object twice, and a state under construction
  // can hold itself. Seen-tracking is per branch, so a repeated sibling is still
  // searched; only an actual cycle is cut.
  const keepWholeSubtree = (value: unknown, path: string, seen: Set<object>): void => {
    visiblePaths.add(path);
    if (!isExpandable(value) || seen.has(value as object)) return;
    expandedPaths.add(path);
    const branch = new Set(seen).add(value as object);
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      keepWholeSubtree(child, `${path}.${key}`, branch);
    }
  };

  /** Walk one row. Returns true when it, or anything under it, matched. */
  const walk = (key: string, value: unknown, path: string, seen: Set<object>): boolean => {
    if (rowMatches(key, value, lowerQuery)) {
      matchCount++;
      // The reader searched for this row, so everything it holds is what they
      // asked to see.
      keepWholeSubtree(value, path, seen);
      return true;
    }

    if (!isExpandable(value) || seen.has(value as object)) return false;

    const branch = new Set(seen).add(value as object);
    let descendantMatched = false;
    for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
      if (walk(childKey, child, `${path}.${childKey}`, branch)) descendantMatched = true;
    }

    if (descendantMatched) {
      // Kept only to lead the reader down to the match, so it must be open.
      visiblePaths.add(path);
      expandedPaths.add(path);
    }
    return descendantMatched;
  };

  const seen = new Set<object>([root as object]);
  let anyMatched = false;
  for (const [key, value] of Object.entries(root as Record<string, unknown>)) {
    if (walk(key, value, `${rootPath}.${key}`, seen)) anyMatched = true;
  }
  if (anyMatched) expandedPaths.add(rootPath);

  return { visiblePaths, expandedPaths, matchCount };
}
