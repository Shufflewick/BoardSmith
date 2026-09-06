// @vitest-environment jsdom
/**
 * #172 — the floor beneath the panel→board handoff.
 *
 * AutoUI's boards move focus onto a real candidate themselves. This is what
 * catches a CUSTOM board that has not wired anything up, so pressing "Choose on
 * the board" can never leave focus on <body>.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { defineComponent, nextTick, ref, h } from 'vue';
import { mount } from '@vue/test-utils';
import { focusFirstBoardTarget, useBoardFocusHandoff } from './useBoardFocusHandoff.js';
import { createBoardInteraction } from './useBoardInteraction.js';

describe('focusFirstBoardTarget', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => {
    host.remove();
  });

  it('focuses the first tab stop and reports success', () => {
    host.innerHTML = `<div tabindex="-1" id="skip"></div><div tabindex="0" id="first"></div><div tabindex="0" id="second"></div>`;
    expect(focusFirstBoardTarget(host)).toBe(true);
    expect(document.activeElement?.id).toBe('first');
  });

  it('skips cells parked out of the tab order', () => {
    host.innerHTML = `<div tabindex="-1"></div><div tabindex="-1"></div>`;
    expect(focusFirstBoardTarget(host)).toBe(false);
  });

  it('reports failure rather than throwing when there is no container', () => {
    expect(focusFirstBoardTarget(null)).toBe(false);
  });
});

describe('useBoardFocusHandoff', () => {
  const mounted: Array<{ unmount: () => void }> = [];
  afterEach(() => {
    while (mounted.length) mounted.pop()!.unmount();
    (document.activeElement as HTMLElement | null)?.blur?.();
  });

  function mountBoard(innerHTML: string) {
    const bi = createBoardInteraction();
    const Host = defineComponent({
      setup() {
        const container = ref<HTMLElement | null>(null);
        useBoardFocusHandoff(bi, container);
        return () => h('div', { ref: container, innerHTML });
      },
    });
    const wrapper = mount(Host, { attachTo: document.body });
    mounted.push(wrapper);
    return { bi, wrapper };
  }

  async function settle() {
    await nextTick();
    await nextTick();
    await nextTick();
  }

  it('puts focus in the board when the panel hands the choice over', async () => {
    const { bi } = mountBoard('<div tabindex="0" id="cell0"></div><div tabindex="-1"></div>');
    expect(document.activeElement).toBe(document.body);

    bi.requestBoardFocus();
    await settle();

    expect((document.activeElement as HTMLElement).id).toBe('cell0');
  });

  it('does not steal focus a board has already placed itself', async () => {
    const { bi, wrapper } = mountBoard('<div tabindex="0" id="cell0"></div><div tabindex="0" id="cell7"></div>');
    const chosen = wrapper.element.querySelector('#cell7') as HTMLElement;
    chosen.focus();

    bi.requestBoardFocus();
    await settle();

    expect((document.activeElement as HTMLElement).id).toBe('cell7');
  });

  it('does nothing until a handoff is actually requested', async () => {
    mountBoard('<div tabindex="0" id="cell0"></div>');
    await settle();
    expect(document.activeElement).toBe(document.body);
  });
});
