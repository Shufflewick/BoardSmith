// @vitest-environment jsdom
/**
 * ONE LOG COMPONENT, TWO CONTENTS (#170 §2.4).
 *
 * A table's log is STATE: re-sent whole on every frame, survives a reload, is
 * the whole history. A world's is a LIVE TAIL: bounded at 200 lines, empty on
 * every mount, gone on reload, and it holds only what was said while this frame
 * was listening.
 *
 * Sharing the component is right; sharing the silence is not. "No activity yet"
 * in a world would be a lie about a log that structurally cannot remember what
 * happened before you arrived, so the empty sentence is the caller's.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import GameHistory from './GameHistory.vue';

describe('the empty sentence belongs to the backend', () => {
  it('keeps the table\'s sentence by default', () => {
    const wrapper = mount(GameHistory, { props: { messages: [] } });
    expect(wrapper.find('.no-messages').text()).toBe('No activity yet');
  });

  it('says what a world\'s silence actually means when asked to', () => {
    const wrapper = mount(GameHistory, {
      props: { messages: [], emptyText: 'Nothing has been said since you arrived' },
    });
    expect(wrapper.find('.no-messages').text()).toBe('Nothing has been said since you arrived');
  });

  it('shows no sentence at all once there is something to read', () => {
    const wrapper = mount(GameHistory, {
      props: { messages: [{ text: 'The fire gutters.' }], emptyText: 'x' },
    });
    expect(wrapper.find('.no-messages').exists()).toBe(false);
  });
});
