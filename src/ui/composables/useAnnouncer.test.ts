// @vitest-environment jsdom
/**
 * Tests for useAnnouncer composable
 *
 * Uses jsdom (unlike the default node env) because the no-provider fallback
 * case mounts a minimal host component via @vue/test-utils so useAnnouncer()'s
 * inject() runs in a valid component context.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, nextTick, defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import {
  createAnnouncer,
  provideAnnouncer,
  useAnnouncer,
  ANNOUNCER_KEY,
  type UseAnnouncerReturn,
} from './useAnnouncer.js';
import { _clearShownWarnings } from '../../utils/dev.js';

/**
 * Mount a minimal host component that calls the composable in a valid
 * component setup context, exposing the returned announcer for assertions.
 */
function withSetup(composable: () => UseAnnouncerReturn) {
  let result!: UseAnnouncerReturn;
  const Host = defineComponent({
    setup() {
      result = composable();
      return () => h('div');
    },
  });
  const wrapper = mount(Host);
  return { result, wrapper };
}

describe('useAnnouncer', () => {
  describe('provide/inject shape', () => {
    it('ANNOUNCER_KEY is a Symbol', () => {
      expect(typeof ANNOUNCER_KEY).toBe('symbol');
    });

    it('provideAnnouncer, useAnnouncer, createAnnouncer are functions', () => {
      expect(typeof provideAnnouncer).toBe('function');
      expect(typeof useAnnouncer).toBe('function');
      expect(typeof createAnnouncer).toBe('function');
    });
  });

  describe('createAnnouncer routing', () => {
    it('announce(message) writes to politeMessage, not assertiveMessage', async () => {
      const politeMessage = ref('');
      const assertiveMessage = ref('');
      const emitAnnounce = vi.fn();

      const announcer = createAnnouncer({ politeMessage, assertiveMessage, emitAnnounce });
      announcer.announce('Card drawn');
      await nextTick();

      expect(politeMessage.value).toBe('Card drawn');
      expect(assertiveMessage.value).toBe('');
    });

    it('announce(message, { assertive: true }) writes to assertiveMessage, not politeMessage', async () => {
      const politeMessage = ref('');
      const assertiveMessage = ref('');
      const emitAnnounce = vi.fn();

      const announcer = createAnnouncer({ politeMessage, assertiveMessage, emitAnnounce });
      announcer.announce('Invalid move', { assertive: true });
      await nextTick();

      expect(assertiveMessage.value).toBe('Invalid move');
      expect(politeMessage.value).toBe('');
    });

    it('clear-then-set: repeated identical message passes through empty then re-sets', async () => {
      const politeMessage = ref('');
      const assertiveMessage = ref('');
      const emitAnnounce = vi.fn();

      const announcer = createAnnouncer({ politeMessage, assertiveMessage, emitAnnounce });

      announcer.announce('same');
      await nextTick();
      expect(politeMessage.value).toBe('same');

      announcer.announce('same');
      // Synchronously cleared before nextTick resolves.
      expect(politeMessage.value).toBe('');
      await nextTick();
      expect(politeMessage.value).toBe('same');
    });

    it('each announce() call invokes emitAnnounce with matching level and message', () => {
      const politeMessage = ref('');
      const assertiveMessage = ref('');
      const emitAnnounce = vi.fn();

      const announcer = createAnnouncer({ politeMessage, assertiveMessage, emitAnnounce });

      announcer.announce('polite one');
      expect(emitAnnounce).toHaveBeenCalledWith('polite', 'polite one');

      announcer.announce('assertive one', { assertive: true });
      expect(emitAnnounce).toHaveBeenCalledWith('assertive', 'assertive one');

      expect(emitAnnounce).toHaveBeenCalledTimes(2);
    });
  });

  describe('no-provider fallback', () => {
    beforeEach(() => {
      _clearShownWarnings();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('returns a usable no-op announcer and warns exactly once', () => {
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { result: first } = withSetup(() => useAnnouncer());
      expect(typeof first.announce).toBe('function');
      expect(() => first.announce('hello')).not.toThrow();
      expect(consoleWarn).toHaveBeenCalledTimes(1);
      expect(consoleWarn.mock.calls[0][0]).toContain('useAnnouncer');

      // Second unrelated call site does NOT warn again (devWarn dedup by key).
      const { result: second } = withSetup(() => useAnnouncer());
      expect(typeof second.announce).toBe('function');
      expect(consoleWarn).toHaveBeenCalledTimes(1);
    });
  });
});
