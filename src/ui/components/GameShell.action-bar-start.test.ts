// @vitest-environment jsdom
/**
 * A GAME CHOOSES WHETHER THE ACTION BAR STARTS DOWN (#1439).
 *
 * Only the starting value: the player still opens and closes the bar as before,
 * and the bar never goes away, so it stays reachable by keyboard and screen reader.
 * Asserted on the real GameShell, driven by the host's own messages.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { nextTick } from 'vue';
import { enterIframe, leaveIframe, mountPlatformShell } from './GameShell.platform-mount.test-helper.js';

function post(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { source: window.parent, data: { source: 'shufflewick', ...data } }));
}

async function mountAtTable(props: { actionBarStartsCollapsed?: boolean } = {}) {
  enterIframe();
  const wrapper = mountPlatformShell({ props });
  await nextTick();
  post({ type: 'init', seat: 0 });
  post({
    type: 'game_state',
    view: {
      flowState: { currentPlayer: 0, awaitingInput: true, availableActions: [] },
      state: { view: {}, players: [], currentPlayer: 0, isMyTurn: true },
    },
    winners: [],
  });
  await nextTick();
  await nextTick();
  return wrapper;
}

const barIsDown = (wrapper: Awaited<ReturnType<typeof mountAtTable>>) =>
  wrapper.get('[data-testid="bs-actionbar"]').classes().includes('collapsed');

afterEach(leaveIframe);

describe('GameShell actionBarStartsCollapsed (#1439)', () => {
  it('starts open when the game says nothing', async () => {
    const wrapper = await mountAtTable();
    expect(barIsDown(wrapper)).toBe(false);
    wrapper.unmount();
  });

  it('starts down when the game asks, and the player can still open it', async () => {
    const wrapper = await mountAtTable({ actionBarStartsCollapsed: true });
    expect(barIsDown(wrapper)).toBe(true);
    const toggle = wrapper.get('[data-testid="bs-actionbar-toggle"]');
    expect(toggle.attributes('aria-expanded')).toBe('false');
    await toggle.trigger('click');
    expect(barIsDown(wrapper)).toBe(false);
    wrapper.unmount();
  });
});
