// @vitest-environment jsdom
/**
 * A GAME'S OWN COMMANDS IN THE CONTROLS MENU, FROM THE BOARD THAT OWNS THEM (#1448).
 *
 * The board registers them with `useMenuCommands`, the real GameShell lists them
 * in its controls menu, and pressing one runs the board's function, closes the
 * menu and hands focus back to the menu button.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { enterIframe, leaveIframe, mountPlatformShell } from './GameShell.platform-mount.test-helper.js';
import { useMenuCommands } from '../composables/menuCommands.js';

function post(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { source: window.parent, data: { source: 'shufflewick', ...data } }));
}

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(leaveIframe);

async function mountWithCommandBoard() {
  const Board = defineComponent({
    setup() {
      const lastBattle = ref<string | null>(null);
      const replays = ref(0);
      useMenuCommands(() => [
        { label: 'Watch the last battle', enabled: lastBattle.value !== null, run: () => replays.value++ },
      ]);
      return () => h('div', { 'data-testid': 'board' }, [
        h('button', { 'data-testid': 'fight', onClick: () => { lastBattle.value = 'ridge'; } }, 'Fight'),
        `replays:${replays.value}`,
      ]);
    },
  });
  enterIframe();
  const wrapper = mountPlatformShell({ board: Board, attachTo: document.body });
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

const trigger = () => document.body.querySelector<HTMLButtonElement>('button[aria-label="Game controls"]')!;
const menu = () => document.body.querySelector('[role="menu"]');
const command = (text: string) =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitem"]')).find((el) => el.textContent?.includes(text));

async function openMenu() {
  trigger().focus();
  trigger().click();
  await nextTick();
  await nextTick();
}

describe('GameShell game menu commands (#1448)', () => {
  it("lists a board's command in a group of its own, disabled until the board says it can run", async () => {
    const wrapper = await mountWithCommandBoard();
    await openMenu();
    const item = command('Watch the last battle')!;
    expect(item.disabled).toBe(true);
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(menu()!.textContent).toContain('Game');

    trigger().click();
    await nextTick();
    await wrapper.get('[data-testid="fight"]').trigger('click');
    await openMenu();
    expect(command('Watch the last battle')!.disabled).toBe(false);
    wrapper.unmount();
  });

  it('runs the command, closes the menu and returns focus to the menu button', async () => {
    const wrapper = await mountWithCommandBoard();
    await wrapper.get('[data-testid="fight"]').trigger('click');
    await openMenu();
    command('Watch the last battle')!.click();
    await nextTick();
    expect(wrapper.get('[data-testid="board"]').text()).toContain('replays:1');
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    wrapper.unmount();
  });
});
