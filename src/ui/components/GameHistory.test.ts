// @vitest-environment jsdom
/**
 * GameHistory — DEV-06 coverage
 *
 * Behaviors under test:
 *   1. (un-clear) clearHistory() does not re-add pre-clear messages when
 *      new messages arrive (the silent un-clear bug — GameHistory.vue watcher).
 *   2. (read-only) Sidebar mode renders no Copy or Clear button.
 *   3. (copy) copyHistory() writes the formatted message lines to the clipboard.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import GameHistory from './GameHistory.vue';

// ---------------------------------------------------------------------------
// Clipboard mock — jsdom does not provide navigator.clipboard by default.
// ---------------------------------------------------------------------------
let writeTextMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeTextMock = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: writeTextMock },
    writable: true,
    configurable: true,
  });
});

// ---------------------------------------------------------------------------

describe('GameHistory', () => {

  describe('un-clear fix (DEV-06)', () => {
    it('does not re-add pre-clear messages when new messages arrive', async () => {
      const wrapper = mount(GameHistory, {
        props: { messages: ['a', 'b'] },
      });
      // Watcher fires immediately — two messages should be present.
      await nextTick();
      expect(wrapper.findAll('.message')).toHaveLength(2);

      // Clear via the exposed method.
      (wrapper.vm as any).clearHistory();
      await nextTick();
      expect(wrapper.findAll('.message')).toHaveLength(0);

      // A genuinely new message arrives after the clear.
      await wrapper.setProps({ messages: ['a', 'b', 'c'] });
      await nextTick();

      // Only 'c' should appear — 'a' and 'b' must NOT be re-added.
      expect(wrapper.findAll('.message')).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------

  describe('read-only sidebar (DEV-06)', () => {
    it('renders no Copy button and no Clear button in sidebar mode', () => {
      const wrapper = mount(GameHistory, {
        props: { messages: [], sheet: false, collapsed: false },
      });

      expect(wrapper.find('.copy-btn').exists()).toBe(false);
      expect(wrapper.find('.clear-btn').exists()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------

  describe('copyHistory (exposed)', () => {
    it('calls navigator.clipboard.writeText with the formatted history lines', async () => {
      const wrapper = mount(GameHistory, {
        props: { messages: ['Hello', 'World'] },
      });
      await nextTick();

      // Call the exposed method.
      await (wrapper.vm as any).copyHistory();

      expect(writeTextMock).toHaveBeenCalledOnce();
      const [text] = writeTextMock.mock.calls[0] as [string];
      expect(text).toContain('Hello');
      expect(text).toContain('World');
    });
  });

});
