// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { TreeNode } from './TreeNode.js';

function mountNode(props: Record<string, unknown>) {
  return mount(TreeNode, {
    props: { nodeKey: 'phase', value: 'play', path: 'root.phase', expandedPaths: new Set(['root']), ...props },
  });
}

describe('TreeNode row', () => {
  it('shows the key and a summary of the value', () => {
    const text = mountNode({}).text();
    expect(text).toContain('phase');
    expect(text).toContain('"play"');
  });

  it('gives a leaf no arrow to click', () => {
    expect(mountNode({}).text()).not.toContain('▶');
  });

  it('shows a closed arrow for an unopened object', () => {
    expect(mountNode({ value: { a: 1 } }).text()).toContain('▶');
  });

  it('shows an open arrow for an opened object', () => {
    const wrapper = mountNode({ value: { a: 1 }, expandedPaths: new Set(['root.phase']) });
    expect(wrapper.text()).toContain('▼');
  });

  it('offers a labelled copy button', () => {
    const btn = mountNode({}).get('.tree-copy-btn');
    expect(btn.attributes('aria-label')).toBe('Copy JSON to clipboard');
  });
});

describe('TreeNode children', () => {
  it('renders nothing below a closed object', () => {
    const wrapper = mountNode({ value: { a: 1, b: 2 } });
    expect(wrapper.findAll('.tree-row')).toHaveLength(1);
  });

  it('renders one row per property of an open object', () => {
    const wrapper = mountNode({ value: { a: 1, b: 2 }, expandedPaths: new Set(['root.phase']) });
    expect(wrapper.findAll('.tree-row')).toHaveLength(3);
  });

  it('recurses to any depth, following the paths it is given', () => {
    const wrapper = mountNode({
      value: { a: { b: { c: 1 } } },
      expandedPaths: new Set(['root.phase', 'root.phase.a', 'root.phase.a.b']),
    });
    expect(wrapper.findAll('.tree-row')).toHaveLength(4);
    expect(wrapper.text()).toContain('c');
  });

  it('renders array indices as keys', () => {
    const wrapper = mountNode({ value: [10, 20], expandedPaths: new Set(['root.phase']) });
    expect(wrapper.text()).toContain('0');
    expect(wrapper.text()).toContain('1');
  });
});

describe('TreeNode events', () => {
  it('asks to open the row it was clicked on', async () => {
    const wrapper = mountNode({ value: { a: 1 } });
    await wrapper.get('.tree-row').trigger('click');
    expect(wrapper.emitted('toggle')).toEqual([['root.phase']]);
  });

  it('a leaf row asks for nothing when clicked', async () => {
    const wrapper = mountNode({});
    await wrapper.get('.tree-row').trigger('click');
    expect(wrapper.emitted('toggle')).toBeUndefined();
  });

  it('passes a child row toggle up under the CHILD path, so the right row opens', async () => {
    const wrapper = mountNode({ value: { a: { b: 1 } }, expandedPaths: new Set(['root.phase']) });
    await wrapper.findAll('.tree-row')[1].trigger('click');
    expect(wrapper.emitted('toggle')).toEqual([['root.phase.a']]);
  });

  it('the copy button copies the row value without also toggling the row', async () => {
    const wrapper = mountNode({ value: { a: 1 } });
    await wrapper.get('.tree-copy-btn').trigger('click');
    expect(wrapper.emitted('copy')).toEqual([[{ a: 1 }]]);
    expect(wrapper.emitted('toggle')).toBeUndefined();
  });

  it('reveals the copy button on hover and hides it again', async () => {
    const wrapper = mountNode({});
    const row = wrapper.get('.tree-row');
    const btn = wrapper.get('.tree-copy-btn').element as HTMLElement;
    expect(btn.style.opacity).toBe('0');
    await row.trigger('mouseenter');
    expect(btn.style.opacity).toBe('1');
    await row.trigger('mouseleave');
    expect(btn.style.opacity).toBe('0');
  });
});

describe('TreeNode search visibility (#153)', () => {
  const OPEN = new Set(['root.phase', 'root.phase.a', 'root.phase.b']);

  it('renders every row when no visible set is given', () => {
    const wrapper = mountNode({ value: { a: { x: 1 }, b: 2 }, expandedPaths: OPEN });
    expect(wrapper.findAll('.tree-row').length).toBeGreaterThan(2);
  });

  it('renders nothing at all when its own path is not visible', () => {
    const wrapper = mountNode({
      value: { a: 1 },
      expandedPaths: OPEN,
      visiblePaths: new Set(['root.other']),
    });
    expect(wrapper.findAll('.tree-row')).toHaveLength(0);
  });

  it('drops the children that are not visible and keeps the ones that are', () => {
    const wrapper = mountNode({
      value: { a: 1, b: 2 },
      expandedPaths: OPEN,
      visiblePaths: new Set(['root.phase', 'root.phase.b']),
    });
    const text = wrapper.text();
    expect(text).toContain('b');
    expect(wrapper.findAll('.tree-row')).toHaveLength(2);
  });

  it('passes the visible set on down, so deep rows are filtered too', () => {
    const wrapper = mountNode({
      value: { a: { x: 1, y: 2 } },
      expandedPaths: new Set(['root.phase', 'root.phase.a']),
      visiblePaths: new Set(['root.phase', 'root.phase.a', 'root.phase.a.y']),
    });
    expect(wrapper.text()).toContain('y');
    expect(wrapper.findAll('.tree-row')).toHaveLength(3);
  });
});
