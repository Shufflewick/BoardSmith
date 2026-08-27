// @vitest-environment jsdom
/**
 * THE ELEMENTS TAB (#157).
 *
 * Moved here whole from `DebugPanel.characterization.test.ts` when the tab became
 * its own component: the concern moved, so its tests moved with it, and they
 * mount the ~150 lines they are about rather than the whole panel.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import ElementsTab from './ElementsTab.vue';

const VIEW = {
  id: 1,
  className: 'Board',
  children: [
    {
      id: 2,
      className: 'MainDeck',
      name: 'Draw',
      $type: 'deck',
      children: [
        { id: 10, className: 'Card', name: 'Ace', notation: 'AS' },
        { id: 11, className: 'Card', name: 'King' },
      ],
    },
    {
      id: 3,
      className: 'Hand',
      name: 'My Hand',
      children: [{ id: 12, className: 'Card', name: 'Queen' }],
    },
    { id: 4, className: 'Piece', notation: 'a1', attributes: { color: 'red' } },
  ],
};

interface Vm { [key: string]: any }

const copied: unknown[] = [];

function mountElements() {
  const wrapper = mount(ElementsTab, {
    props: {
      view: VIEW,
      customDebugData: { seed: 42 },
      copy: (value: unknown) => { copied.push(value); },
    },
    attachTo: document.body,
  });
  return { wrapper, vm: wrapper.vm as unknown as Vm };
}

const mounted: Array<{ unmount: () => void }> = [];
function track<T extends { wrapper: { unmount: () => void } }>(m: T): T {
  mounted.push(m.wrapper);
  return m;
}

afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  copied.length = 0;
  vi.restoreAllMocks();
});

describe('ElementsTab', () => {
  it('groups every element with a numeric id by class name', async () => {
    const { vm } = track(mountElements());
    expect(Object.keys(vm.groupedElements).sort()).toEqual(['Board', 'Card', 'Hand', 'MainDeck', 'Piece']);
    expect(vm.groupedElements.Card.map((e: any) => e.id).sort()).toEqual([10, 11, 12]);
  });
  it('filters element groups by name, notation, class and id', async () => {
    const { vm } = track(mountElements());
    vm.elementSearchQuery = 'a1';
    await nextTick();
    expect(Object.keys(vm.filteredElementGroups)).toEqual(['Piece']);
    vm.elementSearchQuery = '12';
    await nextTick();
    expect(Object.keys(vm.filteredElementGroups)).toEqual(['Card']);
  });
  it('selecting an element highlights it and selecting it again clears it', async () => {
    const { wrapper, vm } = track(mountElements());
    const piece = vm.groupedElements.Piece[0];
    vm.selectElement(piece);
    await nextTick();
    expect(vm.selectedElementId).toBe(4);
    expect((vm.selectedElement as { id: number }).id).toBe(4);
    vm.selectElement(piece);
    expect(vm.selectedElementId).toBeNull();
    expect(wrapper.emitted('highlight-element')).toEqual([[4], [null]]);
  });
  it('prefers notation, then name, then id for an element label', async () => {
    const { vm } = track(mountElements());
    expect(vm.getElementDisplayName({ id: 4, notation: 'a1', name: 'x' })).toBe('a1');
    expect(vm.getElementDisplayName({ id: 4, name: 'x' })).toBe('x');
    expect(vm.getElementDisplayName({ id: 4 })).toBe('#4');
  });
  it('copies an element without its children', async () => {
    const { vm } = track(mountElements());
    await vm.copyElementToClipboard(vm.groupedElements.MainDeck[0]);
    const written = copied.at(-1) as Record<string, unknown>;
    expect(written.children).toBeUndefined();
    expect(written.id).toBe(2);
  });

  it('renders whatever the game published as custom debug data', () => {
    const { wrapper } = track(mountElements());
    expect(wrapper.get('.custom-debug-section').text()).toContain('seed');
  });

  it('re-derives from a new view, which is what time travel hands it', async () => {
    const { wrapper, vm } = track(mountElements());
    await wrapper.setProps({
      view: { id: 90, className: 'Board', children: [{ id: 91, className: 'Token' }] },
    });
    expect(Object.keys(vm.groupedElements).sort()).toEqual(['Board', 'Token']);
  });
});
