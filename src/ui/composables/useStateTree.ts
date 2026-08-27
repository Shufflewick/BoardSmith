/**
 * Which rows of a JSON tree are open (#41).
 *
 * The debug panel's State tab renders an arbitrarily deep object as a tree of
 * rows, keyed by dotted path. This owns exactly one thing: the set of paths the
 * reader has opened.
 *
 * @module
 */
import { ref, type Ref } from 'vue';

/** The path of the tree's root row. It starts open and never closes. */
const ROOT = 'root';

export interface StateTree {
  /** Every open path, including the root. Handed to the row renderer as-is. */
  expandedPaths: Ref<Set<string>>;
  isNodeExpanded: (path: string) => boolean;
  toggleExpand: (path: string) => void;
  /** Open every object path in `value`, addressed from the root. */
  expandAll: (value: unknown) => void;
  /** Close everything back to the root. */
  collapseAll: () => void;
}

export function useStateTree(): StateTree {
  const expandedPaths = ref<Set<string>>(new Set([ROOT]));

  function isNodeExpanded(path: string): boolean {
    return expandedPaths.value.has(path);
  }

  function toggleExpand(path: string): void {
    const next = new Set(expandedPaths.value);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    // A new Set, because mutating the old one in place does not re-render the
    // rows that were handed it as a prop.
    expandedPaths.value = next;
  }

  function expandAll(value: unknown): void {
    const paths = new Set<string>([ROOT]);
    function traverse(node: unknown, path: string): void {
      if (!node || typeof node !== 'object') return;
      paths.add(path);
      for (const key in node as Record<string, unknown>) {
        traverse((node as Record<string, unknown>)[key], `${path}.${key}`);
      }
    }
    traverse(value, ROOT);
    expandedPaths.value = paths;
  }

  function collapseAll(): void {
    expandedPaths.value = new Set([ROOT]);
  }

  return { expandedPaths, isNodeExpanded, toggleExpand, expandAll, collapseAll };
}
