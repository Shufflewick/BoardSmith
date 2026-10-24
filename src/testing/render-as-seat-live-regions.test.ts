// @vitest-environment jsdom
/**
 * A BOARD TEST HEARS WHAT ITS BOARD ANNOUNCES (#1468): `renderAsSeat` draws the
 * shell's live regions beside the board, for a table seat and a world seat
 * alike, and `watchLiveRegion` reads them as it reads a shell's.
 */
import { describe, it, expect } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';

// From the entry point, as a game's board test imports them.
import { renderAsSeat, preloadSeatRenderer, watchLiveRegion } from 'boardsmith/testing';
import { makeSecretHandGame } from './dom-leak.test-helper.js';
import { createTestWorld } from './test-world.js';
import { vaultBundle } from './test-world.test-helper.js';
import { useAnnouncer } from '../ui/composables/useAnnouncer.js';

await preloadSeatRenderer();

/** A board that says something politely or urgently when its buttons are pressed. */
const AnnouncingBoard = defineComponent({
  name: 'AnnouncingBoard',
  setup() {
    const { announce } = useAnnouncer();
    return () =>
      h('div', [
        h('button', { class: 'polite', onClick: () => announce('Your turn') }, 'polite'),
        h('button', { class: 'urgent', onClick: () => announce('That space is taken', { assertive: true }) }, 'urgent'),
      ]);
  },
});

describe('renderAsSeat draws the live regions the announcer writes (#1468)', () => {
  it('a table seat hears its board, politely and urgently, a repeat included', async () => {
    const wrapper = await renderAsSeat(makeSecretHandGame('live-regions'), 1, { component: AnnouncingBoard });
    const polite = watchLiveRegion(wrapper, 'polite');
    const assertive = watchLiveRegion(wrapper, 'assertive');

    await wrapper.find('.polite').trigger('click');
    await wrapper.find('.urgent').trigger('click');
    await wrapper.find('.urgent').trigger('click');

    expect(await polite()).toEqual(['Your turn']);
    expect(await assertive()).toEqual(['That space is taken', 'That space is taken']);
    wrapper.unmount();
  });

  it('a world seat hears its board', async () => {
    const world = await createTestWorld({ definition: vaultBundle() });
    const wrapper = await renderAsSeat(world, 2, { component: AnnouncingBoard });
    const assertive = watchLiveRegion(wrapper, 'assertive');

    await wrapper.find('.urgent').trigger('click');

    expect(await assertive()).toEqual(['That space is taken']);
    wrapper.unmount();
  });

  it("draws the regions outside the board's own element, whatever its root shape (#1468 review F2)", async () => {
    const TwoRootBoard = defineComponent({
      name: 'TwoRootBoard',
      setup() {
        const { announce } = useAnnouncer();
        return () => [h('button', { class: 'urgent', onClick: () => announce('Two roots', { assertive: true }) }, 'urgent'), h('p', 'second root')];
      },
    });
    for (const component of [AnnouncingBoard, TwoRootBoard]) {
      const wrapper = await renderAsSeat(makeSecretHandGame('root-shape'), 1, { component });
      expect(wrapper.element.querySelector('[data-bs-live-region]')).toBeNull();
      wrapper.unmount();
    }
    const wrapper = await renderAsSeat(makeSecretHandGame('two-roots'), 1, { component: TwoRootBoard });
    const assertive = watchLiveRegion(wrapper, 'assertive');
    await wrapper.find('.urgent').trigger('click');
    expect(await assertive()).toEqual(['Two roots']);
    wrapper.unmount();
  });

  it('refuses a board mounted with no live regions, saying how to get them', () => {
    const wrapper = mount(AnnouncingBoard);
    expect(() => watchLiveRegion(wrapper, 'polite')).toThrow(/found no polite live region.*renderAsSeat/);
    wrapper.unmount();
  });
});
