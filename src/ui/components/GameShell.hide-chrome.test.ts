// @vitest-environment jsdom
/**
 * A BOARD HIDES THE SHELL'S CHROME WHILE ITS PLAYER WANTS THE FIELD (#1538).
 *
 * The board registers with `useHideChrome`; the real GameShell hides the players
 * panel (the phone strip with it) and the action bar while the board asks, and
 * shows them again when it stops asking or unmounts.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { enterIframe, leaveIframe, mountPlatformShell, mountTableWithDebugPanel, DEBUG_TABLE_PLAYERS } from './GameShell.platform-mount.test-helper.js';
import { useHideChrome } from '../composables/hideChrome.js';

function post(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { source: window.parent, data: { source: 'shufflewick', ...data } }));
}

// Module-level, so a test can hide the chrome without the click moving focus to the board.
const fieldOnly = ref(false);
const FieldBoard = defineComponent({
  setup() {
    useHideChrome(() => fieldOnly.value);
    return () => h('button', { 'data-testid': 'eye', onClick: () => { fieldOnly.value = !fieldOnly.value; } }, 'Hide controls');
  },
});

async function mountAtTable() {
  enterIframe();
  const wrapper = mountPlatformShell({ board: FieldBoard, attachTo: document.body });
  await nextTick();
  post({ type: 'init', seat: 0 });
  post({
    type: 'game_state',
    view: {
      flowState: { currentPlayer: 0, awaitingInput: true, availableActions: ['pass'] },
      state: {
        view: {}, players: [], currentPlayer: 0, isMyTurn: true,
        availableActions: ['pass'], actionMetadata: { pass: { name: 'pass', prompt: 'Pass', selections: [] } },
      },
    },
    winners: [],
  });
  await nextTick();
  await nextTick();
  return wrapper;
}

type Shell = Awaited<ReturnType<typeof mountAtTable>>;
const chromeShows = (wrapper: Shell) => ({
  seats: wrapper.get('[data-testid="bs-seats"]').isVisible(),
  actionBar: wrapper.get('[data-testid="bs-actionbar"]').isVisible(),
  toggle: wrapper.get('[data-testid="bs-actionbar-toggle"]').isVisible(),
});

afterEach(() => {
  fieldOnly.value = false;
  leaveIframe();
});

describe('GameShell useHideChrome (#1538)', () => {
  it('hides the players panel and the action bar while the board asks, and shows them when it stops', async () => {
    const wrapper = await mountAtTable();
    expect(chromeShows(wrapper)).toEqual({ seats: true, actionBar: true, toggle: true });

    await wrapper.get('[data-testid="eye"]').trigger('click');
    expect(chromeShows(wrapper)).toEqual({ seats: false, actionBar: false, toggle: false });

    await wrapper.get('[data-testid="eye"]').trigger('click');
    expect(chromeShows(wrapper)).toEqual({ seats: true, actionBar: true, toggle: true });
    wrapper.unmount();
  });

  it('hands focus that was in the hidden chrome to the board region', async () => {
    const wrapper = await mountAtTable();
    (wrapper.get('[data-testid="bs-actionbar-toggle"]').element as HTMLElement).focus();
    fieldOnly.value = true;
    await nextTick();
    await nextTick();
    expect(document.activeElement).toBe(wrapper.get('[data-testid="bs-board"]').element);
    wrapper.unmount();
  });

  it('keeps the action bar, and its time-travel banner, while the player browses history', async () => {
    const { wrapper, debugPanel } = await mountTableWithDebugPanel(FieldBoard);
    fieldOnly.value = true;
    debugPanel.vm.$emit('time-travel', { view: {}, players: DEBUG_TABLE_PLAYERS }, 3, null);
    await nextTick();
    await nextTick();
    expect(wrapper.find('.time-travel-banner').exists()).toBe(true);
    expect((wrapper.get('[data-testid="bs-actionbar"]').element.parentElement as HTMLElement).style.display).toBe('');
    wrapper.unmount();
  });
});
