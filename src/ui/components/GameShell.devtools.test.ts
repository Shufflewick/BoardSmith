// @vitest-environment jsdom
/**
 * Tests for the GameShell devtools bridge helper (DEV-02).
 *
 * GameShell.vue adds a dev-only watcher that posts
 * `boardsmith:devtools-state-update` to window.parent. The payload-building and
 * guard logic is extracted into `GameShell.devtools.ts` so it can be unit-tested
 * without mounting the full GameShell component.
 *
 * Three behaviors under test:
 *   1. When isDevBuild=true and platformMode=true, maybePostDevtoolsUpdate calls
 *      postMessage with the expected message shape (source, type, payload keys).
 *   2. The boardInteraction field maps validElements to a number[] of IDs,
 *      EXCLUDING any entries whose disabled field is set.
 *   3. When isDevBuild=false OR platformMode=false, no postMessage is sent.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildDevtoolsPayload, maybePostDevtoolsUpdate } from './GameShell.devtools.js';

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
};

// ---------------------------------------------------------------------------
// Test 1: correct message shape when dev + platform
// ---------------------------------------------------------------------------

describe('maybePostDevtoolsUpdate', () => {
  it('calls postMessage with source and type when isDevBuild=true and platformMode=true', () => {
    const mockPost = vi.fn();
    maybePostDevtoolsUpdate({ isDevBuild: true, platformMode: true }, BASE_PARAMS, mockPost);

    expect(mockPost).toHaveBeenCalledOnce();
    const [msg, origin] = mockPost.mock.calls[0];
    expect(msg.source).toBe('shufflewick-game');
    expect(msg.type).toBe('boardsmith:devtools-state-update');
    expect(origin).toBe('*');
  });

  it('includes all required payload keys: seat, state, availableActions, actionMetadata, boardInteraction', () => {
    const mockPost = vi.fn();
    maybePostDevtoolsUpdate({ isDevBuild: true, platformMode: true }, BASE_PARAMS, mockPost);

    const msg = mockPost.mock.calls[0][0];
    expect(msg.seat).toBe(1);
    expect(msg.state).toEqual({ phase: 'play', turn: 2 });
    expect(msg.availableActions).toEqual(['ask', 'goFish']);
    expect(msg.actionMetadata).toEqual({ ask: { label: 'Ask' } });
    expect(msg.boardInteraction).toBeDefined();
    expect(msg.boardInteraction.activeAction).toBe('ask');
    expect(msg.boardInteraction.currentSelectionStep).toBe(0);
    expect(Array.isArray(msg.boardInteraction.validElements)).toBe(true);
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

// ---------------------------------------------------------------------------
// Test 3: guard — no postMessage when isDevBuild=false OR platformMode=false
// ---------------------------------------------------------------------------

describe('maybePostDevtoolsUpdate guard', () => {
  it('does NOT call postMessage when isDevBuild=false', () => {
    const mockPost = vi.fn();
    maybePostDevtoolsUpdate({ isDevBuild: false, platformMode: true }, BASE_PARAMS, mockPost);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('does NOT call postMessage when platformMode=false', () => {
    const mockPost = vi.fn();
    maybePostDevtoolsUpdate({ isDevBuild: true, platformMode: false }, BASE_PARAMS, mockPost);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('does NOT call postMessage when both are false', () => {
    const mockPost = vi.fn();
    maybePostDevtoolsUpdate({ isDevBuild: false, platformMode: false }, BASE_PARAMS, mockPost);
    expect(mockPost).not.toHaveBeenCalled();
  });
});
