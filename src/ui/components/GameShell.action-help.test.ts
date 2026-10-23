// @vitest-environment jsdom
/**
 * SHOW ACTION HELP, FROM THE CONTROLS MENU TO THE PANEL'S "?" (#1452).
 *
 * The real GameShell reads the shared action help preference (#1449): with it
 * on, an action with help text shows its "?" in the Action Panel; turning
 * "Show action help" off in the controls menu hides it and saves the choice
 * for every game in this browser.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { enterIframe, leaveIframe, mountPlatformShell } from './GameShell.platform-mount.test-helper.js';

const Board = defineComponent({ setup: () => () => h('div') });

function post(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { source: window.parent, data: { source: 'shufflewick', ...data } }));
}

afterEach(() => {
  leaveIframe();
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('GameShell Show action help (#1452)', () => {
  it('shows an action\'s "?" with the preference on, hides it once turned off in the menu, and saves the choice', async () => {
    enterIframe();
    const wrapper = mountPlatformShell({ board: Board, attachTo: document.body });
    await nextTick();
    post({ type: 'init', seat: 0 });
    // Two actions, so the shell does not start the only one by itself and hide its button (#1455).
    const availableActions = ['move', 'pass'];
    post({
      type: 'game_state',
      view: {
        flowState: { currentPlayer: 0, awaitingInput: true, availableActions },
        state: {
          view: {}, players: [], currentPlayer: 0, isMyTurn: true, availableActions,
          actionMetadata: {
            move: { name: 'move', prompt: 'Move', help: 'Slide one piece to an empty square.', selections: [] },
            pass: { name: 'pass', prompt: 'Pass', selections: [] },
          },
        },
      },
      winners: [],
    });
    await nextTick();
    await nextTick();
    expect(wrapper.findAll('.action-help-btn')).toHaveLength(1);

    await wrapper.get('button[aria-label="Game controls"]').trigger('click');
    const item = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]'))
      .find((el) => el.textContent?.includes('Show action help'));
    expect(item, 'the controls menu has no Show action help item').toBeDefined();
    expect(item!.getAttribute('aria-checked')).toBe('true');

    item!.click();
    await nextTick();

    expect(item!.getAttribute('aria-checked')).toBe('false');
    expect(wrapper.find('.action-help-btn').exists()).toBe(false);
    expect(localStorage.getItem('boardsmith-preference:boardsmith:actionHelp')).toBe('false');
    wrapper.unmount();
  });
});
