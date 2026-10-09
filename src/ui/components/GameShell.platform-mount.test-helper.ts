import { mount } from '@vue/test-utils';
import { defineComponent, h, type Component } from 'vue';
import GameShell from './GameShell.vue';
import { defineGameUIs, defaultUI } from '../game-uis.js';

/**
 * MOUNTING THE REAL `GameShell` THE WAY A PLATFORM HOST DOES.
 *
 * The shell talks to a host only when it is in an iframe, read synchronously at setup as
 * `window.parent !== window`, so a test has to redefine `window.parent` BEFORE
 * mounting. That, a `ResizeObserver` jsdom does not ship, and a `matchMedia`
 * jsdom does not ship either are the whole of the arrangement -- and they were
 * written out twice before this file existed, which the duplication gate
 * reported against the second copy.
 *
 * It mounts the SHELL, deliberately, rather than a harness restating what the
 * shell computes. BoardSmith #179 is the record of why: `connectionIndicator`
 * read a prop that did not exist and returned `null` in every game, in every
 * state, and a harness mirroring the computed would have been green throughout.
 */
import { vi } from 'vitest';

// The shell observes panel size for its modal viewport; jsdom has no layout observer.
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });

// jsdom ships no matchMedia; GameShell's compact-tier watch needs one.
if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

const StubBoard = defineComponent({ name: 'StubBoard', setup: () => () => h('div', 'board') });

const realParent = Object.getOwnPropertyDescriptor(window, 'parent');

/**
 * Put the shell in an iframe whose parent RECORDS what is posted to it.
 *
 * Returns the recording, because a boot announcement is only observable there.
 * Callers that only need the iframe can ignore it.
 */
export function enterIframe(): unknown[] {
  const posted: unknown[] = [];
  Object.defineProperty(window, 'parent', {
    configurable: true,
    value: { postMessage: (message: unknown) => posted.push(message) },
  });
  return posted;
}

/** Put `window.parent` back. Bind in `afterEach`, or the next file inherits an iframe. */
export function leaveIframe(): void {
  if (realParent) Object.defineProperty(window, 'parent', realParent);
}

interface PlatformShellOptions {
  /**
   * The board to register as the game's one UI. A test that asserts what a
   * custom UI reads from the context passes a board that reads it; the default
   * draws nothing worth asserting on.
   */
  board?: Component;
  /**
   * Further GameShell props, for a test about what a prop changes, in either
   * form a template writes them (#433).
   */
  props?: { providesOwnGameOverUi?: boolean; 'provides-own-game-over-ui'?: boolean };
}

export function mountPlatformShell(options: PlatformShellOptions = {}) {
  return mount(GameShell, {
    props: {
      uis: defineGameUIs({ Stub: defaultUI(options.board ?? StubBoard) }),
      ...options.props,
    },
  });
}
