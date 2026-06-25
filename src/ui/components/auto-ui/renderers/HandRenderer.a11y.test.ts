// @vitest-environment jsdom
/**
 * HandRenderer a11y test — A11Y-01 + A11Y-04
 *
 * Verifies:
 *   1. Container is role="group" with a dynamic aria-label naming the live card count.
 *   2. When the whole hand is action-selectable, the container has tabindex="0" so
 *      keyboard users can Tab to it and activate it.
 *   3. keydown Enter on the selectable container fires exactly one triggerElementSelect
 *      (whole-hand activation path — closes warning-3 sampling gap for the hand path).
 *
 * Mount strategy: wrap HandRenderer in a defineComponent parent that calls
 * provideBoardInteraction so the InjectionKey is satisfied without needing to
 * import the unexported Symbol.
 */

import { describe, it, expect, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { mount } from '@vue/test-utils';
import HandRenderer from './HandRenderer.vue';
import {
  createBoardInteraction,
  provideBoardInteraction,
} from '../../../composables/useBoardInteraction.js';
import type { BoardInteraction } from '../../../composables/useBoardInteraction.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface GameElement {
  id: number;
  name?: string;
  className: string;
  attributes?: Record<string, unknown>;
  children?: GameElement[];
  childCount?: number;
  __hidden?: boolean;
}

function buildHandElement(children: GameElement[] = []): GameElement {
  return {
    id: 10,
    name: 'hand',
    className: 'Hand',
    attributes: {},
    children,
  };
}

function buildCardElement(id: number): GameElement {
  return { id, name: `card-${id}`, className: 'Card', attributes: {} };
}

/**
 * Mount HandRenderer inside a parent component that provides a mock
 * BoardInteraction via the injection key, so tryUseBoardInteraction()
 * returns the mock instead of undefined.
 */
function mountWithInteraction(
  element: GameElement,
  interaction: BoardInteraction,
  extraProvides: Record<string, unknown> = {},
) {
  const Parent = defineComponent({
    setup() {
      provideBoardInteraction(interaction);
    },
    render() {
      return h(HandRenderer, { element, depth: 0 });
    },
  });

  return mount(Parent, {
    global: {
      provide: {
        playerSeat: 0,
        ...extraProvides,
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HandRenderer a11y — role=group container', () => {
  it('hand container has role="group"', () => {
    const bi = createBoardInteraction();
    const wrapper = mountWithInteraction(buildHandElement([buildCardElement(1)]), bi);
    const container = wrapper.find('.hand-container');
    expect(container.exists()).toBe(true);
    expect(container.attributes('role')).toBe('group');
  });

  it('aria-label includes the live card count (1 card)', () => {
    const bi = createBoardInteraction();
    const wrapper = mountWithInteraction(buildHandElement([buildCardElement(1)]), bi);
    const label = wrapper.find('.hand-container').attributes('aria-label');
    expect(label).toMatch(/1\s+card/i);
  });

  it('aria-label reflects count when there are 3 cards', () => {
    const bi = createBoardInteraction();
    const cards = [buildCardElement(1), buildCardElement(2), buildCardElement(3)];
    const wrapper = mountWithInteraction(buildHandElement(cards), bi);
    const label = wrapper.find('.hand-container').attributes('aria-label');
    expect(label).toMatch(/3\s+cards/i);
  });

  it('aria-label reflects count when hand is empty (0 cards)', () => {
    const bi = createBoardInteraction();
    const wrapper = mountWithInteraction(buildHandElement([]), bi);
    const label = wrapper.find('.hand-container').attributes('aria-label');
    expect(label).toMatch(/0\s+cards/i);
  });
});

describe('HandRenderer a11y — selectable slot', () => {
  it('container has tabindex="0" when the whole hand is action-selectable', () => {
    const bi = createBoardInteraction();
    // Mark the hand element (id: 10) as selectable
    bi.setValidElements([{ ref: { id: 10 }, role: 'target' }], () => {});
    const wrapper = mountWithInteraction(buildHandElement([buildCardElement(1)]), bi);
    const container = wrapper.find('.hand-container');
    expect(container.attributes('tabindex')).toBe('0');
  });

  it('container has tabindex="-1" when hand is not action-selectable', () => {
    const bi = createBoardInteraction();
    // No valid elements → not selectable
    const wrapper = mountWithInteraction(buildHandElement([buildCardElement(1)]), bi);
    const container = wrapper.find('.hand-container');
    expect(container.attributes('tabindex')).toBe('-1');
  });
});

describe('HandRenderer a11y — keyboard activation (Enter fires triggerElementSelect)', () => {
  it('keydown Enter on selectable container fires exactly one triggerElementSelect', async () => {
    const bi = createBoardInteraction();
    bi.setValidElements([{ ref: { id: 10 }, role: 'target' }], () => {});
    const triggerSpy = vi.spyOn(bi, 'triggerElementSelect');

    const wrapper = mountWithInteraction(buildHandElement([buildCardElement(1)]), bi);
    const container = wrapper.find('.hand-container');

    await container.trigger('keydown', { key: 'Enter' });

    expect(triggerSpy).toHaveBeenCalledTimes(1);
    expect(triggerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 10 }),
    );
  });

  it('keydown Space on selectable container fires exactly one triggerElementSelect', async () => {
    const bi = createBoardInteraction();
    bi.setValidElements([{ ref: { id: 10 }, role: 'target' }], () => {});
    const triggerSpy = vi.spyOn(bi, 'triggerElementSelect');

    const wrapper = mountWithInteraction(buildHandElement([buildCardElement(1)]), bi);
    const container = wrapper.find('.hand-container');

    await container.trigger('keydown', { key: ' ' });

    expect(triggerSpy).toHaveBeenCalledTimes(1);
  });

  it('keydown Enter when not selectable does NOT fire triggerElementSelect', async () => {
    const bi = createBoardInteraction();
    const triggerSpy = vi.spyOn(bi, 'triggerElementSelect');

    const wrapper = mountWithInteraction(buildHandElement([buildCardElement(1)]), bi);
    const container = wrapper.find('.hand-container');

    await container.trigger('keydown', { key: 'Enter' });

    expect(triggerSpy).not.toHaveBeenCalled();
  });
});

describe('HandRenderer — anchor attributes (105-02 structural-parity blocker fix)', () => {
  it('.hand-container carries data-bs-el-id matching the hand element id', () => {
    const bi = createBoardInteraction();
    // id:10 from buildHandElement → anchorAttrs emits data-bs-el-id="10"
    const wrapper = mountWithInteraction(buildHandElement([buildCardElement(1)]), bi);
    const container = wrapper.find('.hand-container');
    expect(container.attributes('data-bs-el-id')).toBe('10');
  });

  it('.hand-container carries data-bs-el-name matching the hand element name', () => {
    const bi = createBoardInteraction();
    const wrapper = mountWithInteraction(buildHandElement([buildCardElement(1)]), bi);
    const container = wrapper.find('.hand-container');
    expect(container.attributes('data-bs-el-name')).toBe('hand');
  });

  it('anchor does not collide with existing :data-zone-id attribute', () => {
    const bi = createBoardInteraction();
    const wrapper = mountWithInteraction(buildHandElement([buildCardElement(1)]), bi);
    const container = wrapper.find('.hand-container');
    // Both must coexist on the same element
    expect(container.attributes('data-bs-el-id')).toBe('10');
    expect(container.attributes('data-zone-id')).toBe('10');
  });
});
