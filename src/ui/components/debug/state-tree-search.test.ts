import { describe, it, expect } from 'vitest';
import { searchStateTree } from './state-tree-search.js';

const TREE = {
  state: {
    phase: 'play',
    view: {
      id: 1,
      className: 'Board',
      children: [
        { id: 2, className: 'Hand', name: 'My Hand' },
        { id: 3, className: 'Deck', name: 'Draw Pile' },
      ],
    },
  },
  flowState: null,
};

describe('searchStateTree with no query', () => {
  it('hides nothing, so the whole tree renders', () => {
    const result = searchStateTree(TREE, '');
    expect(result.visiblePaths).toBeNull();
  });

  it('opens nothing on its own', () => {
    expect(searchStateTree(TREE, '').expandedPaths.size).toBe(0);
  });

  it('reports no match count to display', () => {
    expect(searchStateTree(TREE, '   ').matchCount).toBe(0);
    expect(searchStateTree(TREE, '   ').visiblePaths).toBeNull();
  });
});

describe('searchStateTree matching', () => {
  it('matches a property name', () => {
    const result = searchStateTree(TREE, 'phase');
    expect(result.matchCount).toBe(1);
    expect(result.visiblePaths).toContain('root.state.phase');
  });

  it('matches a leaf value', () => {
    const result = searchStateTree(TREE, 'Draw Pile');
    expect(result.matchCount).toBe(1);
    expect(result.visiblePaths).toContain('root.state.view.children.1.name');
  });

  it('ignores case on both sides', () => {
    expect(searchStateTree(TREE, 'DRAW pile').matchCount).toBe(1);
  });

  it('matches a number rendered as text', () => {
    const result = searchStateTree({ a: { count: 42 } }, '42');
    expect(result.visiblePaths).toContain('root.a.count');
  });

  it('finds nothing when nothing matches', () => {
    const result = searchStateTree(TREE, 'zzz-no-such-thing');
    expect(result.matchCount).toBe(0);
    expect(result.visiblePaths).toEqual(new Set());
  });
});

describe('searchStateTree visibility', () => {
  it('keeps every ancestor of a match, so the match can be reached', () => {
    const paths = searchStateTree(TREE, 'Draw Pile').visiblePaths!;
    expect(paths).toContain('root.state');
    expect(paths).toContain('root.state.view');
    expect(paths).toContain('root.state.view.children');
    expect(paths).toContain('root.state.view.children.1');
  });

  it('hides the branches that hold no match', () => {
    const paths = searchStateTree(TREE, 'Draw Pile').visiblePaths!;
    expect(paths).not.toContain('root.state.phase');
    expect(paths).not.toContain('root.state.view.children.0');
    expect(paths).not.toContain('root.flowState');
  });

  it('keeps the whole subtree under a matched key, so its contents stay readable', () => {
    const paths = searchStateTree(TREE, 'children').visiblePaths!;
    expect(paths).toContain('root.state.view.children');
    expect(paths).toContain('root.state.view.children.0');
    expect(paths).toContain('root.state.view.children.0.className');
    expect(paths).toContain('root.state.view.children.1.name');
  });
});

describe('searchStateTree expansion', () => {
  it('opens the ancestors of a match, since a shut row hides it', () => {
    const expanded = searchStateTree(TREE, 'Draw Pile').expandedPaths;
    expect(expanded).toContain('root');
    expect(expanded).toContain('root.state');
    expect(expanded).toContain('root.state.view');
    expect(expanded).toContain('root.state.view.children');
    expect(expanded).toContain('root.state.view.children.1');
  });

  it('leaves the matched leaf itself alone, having nothing to open', () => {
    const expanded = searchStateTree(TREE, 'Draw Pile').expandedPaths;
    expect(expanded).not.toContain('root.state.view.children.1.name');
  });
});

describe('searchStateTree edge cases', () => {
  it('treats a missing tree as an empty one', () => {
    expect(searchStateTree(null, 'phase').matchCount).toBe(0);
    expect(searchStateTree(undefined, 'phase').matchCount).toBe(0);
  });

  it('does not recurse forever through a cycle', () => {
    const cyclic: Record<string, unknown> = { name: 'root-node' };
    cyclic.self = cyclic;
    expect(() => searchStateTree(cyclic, 'root-node')).not.toThrow();
    expect(searchStateTree(cyclic, 'root-node').matchCount).toBe(1);
  });

  it('counts every row that matches, not just the first', () => {
    const result = searchStateTree({ a: { id: 1 }, b: { id: 2 } }, 'id');
    expect(result.matchCount).toBe(2);
  });
});
