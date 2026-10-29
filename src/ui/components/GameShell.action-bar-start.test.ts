// @vitest-environment jsdom
/**
 * A GAME CHOOSES WHETHER THE ACTION BAR STARTS DOWN (#1439).
 *
 * Only the starting value: the player still opens and closes the bar as before,
 * and the bar never goes away, so it stays reachable by keyboard and screen reader.
 * Asserted on the real GameShell, driven by the host's own messages.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { enterIframe, leaveIframe, mountPlatformShell } from './GameShell.platform-mount.test-helper.js';
import { usePlayContext } from '../composables/useGameContext.js';

function post(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { source: window.parent, data: { source: 'shufflewick', ...data } }));
}

/** A board that starts `move` itself, as a board answering its own questions does. */
const AskingBoard = defineComponent({
  setup() {
    const { actionController } = usePlayContext();
    return () => h('button', { 'data-testid': 'ask', onClick: () => actionController.start('move') }, 'Move');
  },
});

// Two actions, so the shell starts neither by itself; `move` asks a question.
const actions = {
  availableActions: ['move', 'pass'],
  actionMetadata: {
    move: { name: 'move', prompt: 'Move', selections: [{ name: 'to', type: 'choice', prompt: 'Where to?', choices: [{ value: 1, display: 'North' }, { value: 2, display: 'South' }] }] },
    pass: { name: 'pass', prompt: 'Pass', selections: [] },
  },
};

async function mountAtTable(props: { actionBarStartsCollapsed?: boolean; actionBarOpensForActions?: boolean } = {}) {
  enterIframe();
  const wrapper = mountPlatformShell({ props, board: AskingBoard });
  await nextTick();
  post({ type: 'init', seat: 0 });
  post({
    type: 'game_state',
    view: {
      flowState: { currentPlayer: 0, awaitingInput: true, availableActions: actions.availableActions },
      state: { view: {}, players: [], currentPlayer: 0, isMyTurn: true, ...actions },
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

describe('GameShell actionBarOpensForActions (#1519)', () => {
  async function askFromTheBoard(wrapper: Awaited<ReturnType<typeof mountAtTable>>): Promise<void> {
    await wrapper.get('[data-testid="ask"]').trigger('click');
    await nextTick();
    await nextTick();
  }

  it('opens the put-down bar for a question when the game says nothing', async () => {
    const wrapper = await mountAtTable({ actionBarStartsCollapsed: true });
    await askFromTheBoard(wrapper);
    expect(barIsDown(wrapper)).toBe(false);
    wrapper.unmount();
  });

  it('keeps the put-down bar down for a question when the game opts out', async () => {
    const wrapper = await mountAtTable({ actionBarStartsCollapsed: true, actionBarOpensForActions: false });
    await askFromTheBoard(wrapper);
    expect(barIsDown(wrapper)).toBe(true);
    expect(wrapper.find('[data-testid="bs-actionbar-attention"]').exists()).toBe(true);
    wrapper.unmount();
  });
});
