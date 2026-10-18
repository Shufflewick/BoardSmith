// @vitest-environment jsdom
/**
 * Tests for the GameShell devtools bridge (DEV-02).
 *
 * The shell builds no devtools state per push (#960). It exposes a reader on its
 * own window, and the dev host calls it when `window.__BOARDSMITH_DEVTOOLS` is read.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { nextTick } from 'vue';
import { buildDevtoolsPayload, readDevtoolsSnapshot } from './GameShell.devtools.js';
import { enterIframe, leaveIframe, mountPlatformShell } from './GameShell.platform-mount.test-helper.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_PARAMS = {
  seat: 1,
  state: { phase: 'play', turn: 2 },
  availableActions: ['ask', 'goFish'],
  actionMetadata: { ask: { label: 'Ask' } },
  boardInteraction: {
    currentAction: 'ask',
    currentPickIndex: 0,
    validElements: [
      { id: 10, ref: {} as any },
      { id: 20, ref: {} as any },
    ],
  },
  flowDebugInfo: undefined,
  pendingAction: undefined,
};

// ---------------------------------------------------------------------------
// Test 1: on demand (#960). No post per push; the dev host reads when asked.
// ---------------------------------------------------------------------------

function pushState(availableActions: string[]): void {
  window.dispatchEvent(new MessageEvent('message', {
    source: window.parent,
    data: {
      source: 'shufflewick',
      type: 'game_state',
      view: {
        flowState: { currentPlayer: 1, awaitingInput: true, availableActions },
        state: { view: {}, players: [{ name: 'P1', seat: 1 }], currentPlayer: 1, isMyTurn: true, availableActions },
      },
    },
  }));
}

describe('GameShell devtools snapshot is read on demand (#960)', () => {
  afterEach(leaveIframe);

  it('posts no devtools state on a push, and a read returns the current state', async () => {
    const posted = enterIframe();
    const wrapper = mountPlatformShell();
    await nextTick();
    window.dispatchEvent(new MessageEvent('message', {
      source: window.parent, data: { source: 'shufflewick', type: 'init', seat: 1 },
    }));
    await nextTick();
    const postedBeforePushes = posted.length;
    pushState(['ask']);
    await nextTick();
    pushState(['ask', 'goFish']);
    await nextTick();

    expect(posted.slice(postedBeforePushes)).toEqual([]);
    const snapshot = readDevtoolsSnapshot(window);
    expect(snapshot?.seat).toBe(1);
    expect(snapshot?.availableActions).toEqual(['ask', 'goFish']);

    wrapper.unmount();
    expect(readDevtoolsSnapshot(window)).toBeNull();
  });

  it('reads null from a frame with no shell in it', () => {
    expect(readDevtoolsSnapshot(null)).toBeNull();
    expect(readDevtoolsSnapshot(window)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test 2: validElements — only non-disabled entries; mapped to id numbers only
// ---------------------------------------------------------------------------

describe('buildDevtoolsPayload boardInteraction.validElements', () => {
  it('maps validElements to number[] of ids', () => {
    const payload = buildDevtoolsPayload(BASE_PARAMS);
    expect(payload.boardInteraction.validElements).toEqual([10, 20]);
  });

  it('excludes entries with a disabled field set (truthy string)', () => {
    const params = {
      ...BASE_PARAMS,
      boardInteraction: {
        currentAction: 'ask',
        currentPickIndex: 0,
        validElements: [
          { id: 10, ref: {} as any },
          { id: 20, ref: {} as any, disabled: 'not your card' },
          { id: 30, ref: {} as any },
        ],
      },
    };
    const payload = buildDevtoolsPayload(params);
    // id 20 is disabled — must be excluded
    expect(payload.boardInteraction.validElements).toEqual([10, 30]);
  });

  it('handles empty validElements array', () => {
    const params = {
      ...BASE_PARAMS,
      boardInteraction: { currentAction: null, currentPickIndex: 0, validElements: [] },
    };
    const payload = buildDevtoolsPayload(params);
    expect(payload.boardInteraction.validElements).toEqual([]);
  });
});
