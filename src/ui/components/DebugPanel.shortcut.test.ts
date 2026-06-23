// @vitest-environment jsdom
/**
 * Keyboard-shortcut guard tests for DebugPanel.vue (102-01-PLAN.md Task 1).
 *
 * Covers:
 *  - Bare 'd' keydown does NOT toggle the panel
 *  - 'd' while target is HTMLInputElement / HTMLTextAreaElement / HTMLSelectElement does NOT toggle
 *  - 'd' while target.isContentEditable is true does NOT toggle
 *  - Ctrl+D toggles the panel and calls preventDefault
 *  - Cmd+D (metaKey) toggles the panel and calls preventDefault
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import DebugPanel from './DebugPanel.vue';

const MIN_PROPS = {
  state: { phase: 'test', round: 1 },
  playerSeat: 1,
  playerCount: 2,
  gameId: 'test-game',
  expanded: false,
};

function makeKeyEvent(
  key: string,
  overrides: Partial<KeyboardEventInit & { target?: EventTarget }> = {},
): KeyboardEvent {
  const { target, ...init } = overrides;
  const evt = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  if (target) {
    Object.defineProperty(evt, 'target', { value: target, writable: false });
  }
  return evt;
}

describe('DebugPanel shortcut guard', () => {
  let wrapper: ReturnType<typeof mount>;

  beforeEach(() => {
    wrapper = mount(DebugPanel, { props: MIN_PROPS, attachTo: document.body });
  });

  afterEach(() => {
    wrapper.unmount();
  });

  function toggleButton(): Element {
    return wrapper.element.querySelector('[aria-label="Toggle debug panel"]')!;
  }

  function isExpanded(): boolean {
    return toggleButton().getAttribute('aria-expanded') === 'true';
  }

  it('bare "d" keydown does NOT toggle the panel', async () => {
    const evt = makeKeyEvent('d');
    window.dispatchEvent(evt);
    await wrapper.vm.$nextTick();
    expect(isExpanded()).toBe(false);
  });

  it('"D" (shifted) bare keydown does NOT toggle the panel', async () => {
    const evt = makeKeyEvent('D');
    window.dispatchEvent(evt);
    await wrapper.vm.$nextTick();
    expect(isExpanded()).toBe(false);
  });

  it('"d" while target is an HTMLInputElement does NOT toggle', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const evt = makeKeyEvent('d', { target: input });
    window.dispatchEvent(evt);
    await wrapper.vm.$nextTick();
    expect(isExpanded()).toBe(false);
    document.body.removeChild(input);
  });

  it('"d" while target is an HTMLTextAreaElement does NOT toggle', async () => {
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    const evt = makeKeyEvent('d', { target: ta });
    window.dispatchEvent(evt);
    await wrapper.vm.$nextTick();
    expect(isExpanded()).toBe(false);
    document.body.removeChild(ta);
  });

  it('"d" while target is an HTMLSelectElement does NOT toggle', async () => {
    const sel = document.createElement('select');
    document.body.appendChild(sel);
    const evt = makeKeyEvent('d', { target: sel });
    window.dispatchEvent(evt);
    await wrapper.vm.$nextTick();
    expect(isExpanded()).toBe(false);
    document.body.removeChild(sel);
  });

  it('"d" while target.isContentEditable is true does NOT toggle', async () => {
    const div = document.createElement('div');
    div.contentEditable = 'true';
    document.body.appendChild(div);
    const evt = makeKeyEvent('d', { target: div });
    window.dispatchEvent(evt);
    await wrapper.vm.$nextTick();
    expect(isExpanded()).toBe(false);
    document.body.removeChild(div);
  });

  it('Ctrl+D toggles the panel (panel opens) and calls preventDefault', async () => {
    const evt = makeKeyEvent('d', { ctrlKey: true });
    const preventDefaultSpy = vi.spyOn(evt, 'preventDefault');
    window.dispatchEvent(evt);
    await wrapper.vm.$nextTick();
    expect(isExpanded()).toBe(true);
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('Cmd+D (metaKey) toggles the panel and calls preventDefault', async () => {
    const evt = makeKeyEvent('d', { metaKey: true });
    const preventDefaultSpy = vi.spyOn(evt, 'preventDefault');
    window.dispatchEvent(evt);
    await wrapper.vm.$nextTick();
    expect(isExpanded()).toBe(true);
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('Ctrl+D on an already-open panel closes it', async () => {
    // First Ctrl+D opens
    window.dispatchEvent(makeKeyEvent('d', { ctrlKey: true }));
    await wrapper.vm.$nextTick();
    expect(isExpanded()).toBe(true);
    // Second Ctrl+D closes
    window.dispatchEvent(makeKeyEvent('d', { ctrlKey: true }));
    await wrapper.vm.$nextTick();
    expect(isExpanded()).toBe(false);
  });
});
