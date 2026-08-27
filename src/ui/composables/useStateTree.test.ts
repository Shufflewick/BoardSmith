import { describe, it, expect } from 'vitest';
import { useStateTree } from './useStateTree.js';

describe('useStateTree', () => {
  it('starts with only the root open', () => {
    const tree = useStateTree();
    expect([...tree.expandedPaths.value]).toEqual(['root']);
    expect(tree.isNodeExpanded('root')).toBe(true);
    expect(tree.isNodeExpanded('root.state')).toBe(false);
  });

  it('toggles a path on and off', () => {
    const tree = useStateTree();
    tree.toggleExpand('root.state');
    expect(tree.isNodeExpanded('root.state')).toBe(true);
    tree.toggleExpand('root.state');
    expect(tree.isNodeExpanded('root.state')).toBe(false);
  });

  it('hands out a new Set on every change, so rows given it as a prop re-render', () => {
    const tree = useStateTree();
    const before = tree.expandedPaths.value;
    tree.toggleExpand('root.state');
    expect(tree.expandedPaths.value).not.toBe(before);
    expect([...before]).toEqual(['root']);
  });

  it('opens every object path in a value, addressed from the root', () => {
    const tree = useStateTree();
    tree.expandAll({ a: { b: { c: 1 } }, d: [{ e: 2 }] });
    expect([...tree.expandedPaths.value].sort()).toEqual([
      'root', 'root.a', 'root.a.b', 'root.d', 'root.d.0',
    ]);
  });

  it('opens nothing beyond the root for a value with no objects in it', () => {
    const tree = useStateTree();
    tree.expandAll({ a: 1, b: 'two', c: null });
    expect([...tree.expandedPaths.value]).toEqual(['root']);
  });

  it('copes with no value at all', () => {
    const tree = useStateTree();
    tree.expandAll(null);
    expect([...tree.expandedPaths.value]).toEqual(['root']);
  });

  it('closes everything back to the root', () => {
    const tree = useStateTree();
    tree.expandAll({ a: { b: 1 } });
    tree.collapseAll();
    expect([...tree.expandedPaths.value]).toEqual(['root']);
  });

  it('replaces what was open rather than adding to it', () => {
    const tree = useStateTree();
    tree.toggleExpand('root.gone');
    tree.expandAll({ a: { b: 1 } });
    expect(tree.isNodeExpanded('root.gone')).toBe(false);
    expect(tree.isNodeExpanded('root.a')).toBe(true);
  });
});
