// @vitest-environment jsdom
/**
 * THE HOST'S DEADLINE REACHES A CUSTOM UI AND THE ACTION PANEL (#301).
 *
 * Asserted on the REAL GameShell, driven by the same `game_state` postMessage a
 * platform host sends, and read back through `useGameContext()` from inside a
 * registered board -- which is exactly where a game's countdown reads it. The
 * Action Panel is asserted in the same mount, because the two must agree.
 *
 * The frame's contract: `deadlineAt` (host clock, or null), `serverNow` (host
 * clock when sent) and `receivedAt` (page clock when the parent page took the
 * frame off its socket), all three at the top level of the message beside
 * `winners` and `isDraw`.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { useGameContext } from '../composables/useGameContext.js';
import {
  enterIframe,
  leaveIframe,
  mountPlatformShell,
} from './GameShell.platform-mount.test-helper.js';

const T0 = 1_700_000_000_000;

/** A custom UI that draws the context's deadline, the way a game would. */
const CountdownBoard = defineComponent({
  name: 'CountdownBoard',
  setup() {
    const { turnDeadline } = useGameContext();
    return () =>
      h('div', { 'data-testid': 'board-deadline' },
        turnDeadline.value === null ? 'none' : String(turnDeadline.value.remainingMs));
  },
});

function post(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { data: { source: 'shufflewick', ...data } }));
}

function gameState(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'game_state',
    view: {
      // The viewer's turn, so the action bar -- and the panel in it -- is up.
      flowState: { currentPlayer: 0, awaitingInput: true, availableActions: [] },
      state: { view: {}, players: [], currentPlayer: 0, isMyTurn: true },
    },
    winners: [],
    ...extra,
  };
}

async function mountAtTable() {
  enterIframe();
  const wrapper = mountPlatformShell({ board: CountdownBoard });
  await nextTick();
  post({ type: 'init', seat: 0 });
  await nextTick();
  await nextTick();
  return wrapper;
}

const boardText = (wrapper: Awaited<ReturnType<typeof mountAtTable>>) =>
  wrapper.find('[data-testid="board-deadline"]').text();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
  leaveIframe();
});

describe('GameShell turnDeadline (#301)', () => {
  it.each([
    ['a frame that carries none of the fields (a host that sends no deadlines)', {}],
    ['a frame whose host says there is no deadline', { deadlineAt: null, serverNow: T0, receivedAt: T0 }],
  ])('is null for %s, and the panel draws no countdown', async (_label, fields) => {
    const wrapper = await mountAtTable();
    post(gameState(fields));
    await nextTick();

    expect(boardText(wrapper)).toBe('none');
    expect(wrapper.find('[data-testid="bs-turn-deadline"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('reads remaining time on the host clock, and the panel shows the same countdown', async () => {
    const wrapper = await mountAtTable();
    post(gameState({ deadlineAt: T0 + 40_000, serverNow: T0 + 10_000, receivedAt: T0 }));
    await nextTick();

    expect(boardText(wrapper)).toBe('30000');
    expect(wrapper.find('[data-testid="bs-turn-deadline"]').text()).toContain('0:30');
    wrapper.unmount();
  });

  it('gives a past deadline zero remaining, not a negative one', async () => {
    const wrapper = await mountAtTable();
    post(gameState({ deadlineAt: T0 - 1_000, serverNow: T0, receivedAt: T0 }));
    await nextTick();

    expect(boardText(wrapper)).toBe('0');
    wrapper.unmount();
  });

  it('drops the deadline when the next frame carries none', async () => {
    const wrapper = await mountAtTable();
    post(gameState({ deadlineAt: T0 + 5_000, serverNow: T0, receivedAt: T0 }));
    await nextTick();
    expect(boardText(wrapper)).toBe('5000');

    post(gameState({ deadlineAt: null, serverNow: T0, receivedAt: T0 }));
    await nextTick();
    expect(boardText(wrapper)).toBe('none');
    wrapper.unmount();
  });

  it('says loudly when a host sends a deadline without the stamps it is measured by', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const wrapper = await mountAtTable();
    post(gameState({ deadlineAt: T0 + 5_000, serverNow: T0 }));
    await nextTick();

    expect(boardText(wrapper)).toBe('none');
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/receivedAt/));
    error.mockRestore();
    wrapper.unmount();
  });
});
