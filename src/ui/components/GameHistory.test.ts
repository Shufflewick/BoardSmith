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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

  describe('log header', () => {
    it('has a copy-log button but no clear button (clear lives in DebugPanel)', () => {
      const wrapper = mount(GameHistory, {
        props: { messages: [] },
      });

      expect(wrapper.find('.history-copy').exists()).toBe(true);
      expect(wrapper.find('.clear-btn').exists()).toBe(false);
    });

    it('the copy button is disabled when the log is empty', () => {
      const wrapper = mount(GameHistory, { props: { messages: [] } });
      expect(wrapper.find('.history-copy').attributes('disabled')).toBeDefined();
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

  // -------------------------------------------------------------------------
  // Embedded-clipboard coverage.
  //
  // On the platform this component runs inside a CROSS-ORIGIN iframe, where
  // WebKit refuses navigator.clipboard outright ("NotAllowedError: The request
  // is not allowed by the user agent or the platform in the current context")
  // and ignores the host's allow="clipboard-write" — it does not implement
  // Permissions Policy delegation for the clipboard. The synchronous
  // execCommand path is not permission-gated, so it must be tried FIRST, while
  // the click's user activation is still live.
  // -------------------------------------------------------------------------

  describe('clipboard fallbacks', () => {
    // jsdom ships no execCommand, so each test installs its own and removes it
    // again — a leaked stub would silently change the path other tests take.
    afterEach(() => {
      delete (document as unknown as { execCommand?: unknown }).execCommand;
    });

    function stubExecCommand(result: boolean) {
      const spy = vi.fn().mockReturnValue(result);
      (document as unknown as { execCommand: unknown }).execCommand = spy;
      return spy;
    }

    it('prefers the synchronous selection copy and never touches the async API', async () => {
      const exec = stubExecCommand(true);
      const wrapper = mount(GameHistory, { props: { messages: ['Hello', 'World'] } });
      await nextTick();

      await (wrapper.vm as any).copyHistory();

      expect(exec).toHaveBeenCalledWith('copy');
      // The async API is what WebKit rejects — it must not be needed at all.
      expect(writeTextMock).not.toHaveBeenCalled();
      expect(wrapper.find('.history-copy').attributes('title')).toBe('Copied!');
    });

    it('falls back to the async API when the selection copy is unavailable', async () => {
      stubExecCommand(false);
      const wrapper = mount(GameHistory, { props: { messages: ['Hello'] } });
      await nextTick();

      await (wrapper.vm as any).copyHistory();

      expect(writeTextMock).toHaveBeenCalledOnce();
      expect(wrapper.find('.history-copy').attributes('title')).toBe('Copied!');
    });

    it('reports failure visibly when BOTH paths are refused', async () => {
      stubExecCommand(false);
      writeTextMock.mockRejectedValue(
        new DOMException('The request is not allowed by the user agent', 'NotAllowedError'),
      );
      const wrapper = mount(GameHistory, { props: { messages: ['Hello'] } });
      await nextTick();

      await (wrapper.vm as any).copyHistory();
      await nextTick();

      // The reported bug was a button that did nothing at all on failure.
      const button = wrapper.find('.history-copy');
      expect(button.classes()).toContain('history-copy--failed');
      expect(button.attributes('title')).toContain('Copy failed');
      expect(button.attributes('aria-label')).toContain('Copy failed');
      expect(wrapper.find('[role="status"]').text()).toContain('failed');
    });
  });

});
