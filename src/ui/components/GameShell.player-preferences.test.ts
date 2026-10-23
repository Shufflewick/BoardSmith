// @vitest-environment jsdom
/**
 * A GAME'S PLAYER PREFERENCES, FROM DECLARATION TO THE BOARD (#1440).
 *
 * The game declares them, the real GameShell lists them in its controls menu,
 * and a board reading one re-renders when the player changes it. Nothing about
 * them is posted to the host, so they never reach the server.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { enterIframe, leaveIframe, mountPlatformShell } from './GameShell.platform-mount.test-helper.js';
import { definePlayerPreferences } from '../player-preferences.js';

function post(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { source: window.parent, data: { source: 'shufflewick', ...data } }));
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});
afterEach(leaveIframe);

async function mountWithPreferences() {
  const preferences = definePlayerPreferences('windup', {
    battleEffects: { label: 'Battle effects', description: 'Bursts and explosions', default: true },
    'screen shake': { label: 'Screen shake', description: 'Shake on hits', default: false },
    flicker: { label: 'Flicker', options: [{ value: 'full', label: 'Full' }, { value: 'slow', label: 'Slow' }], default: 'full' },
  });
  const Board = defineComponent({
    setup() {
      const effects = preferences.use('battleEffects');
      const flicker = preferences.use('flicker');
      return () => h('div', { 'data-testid': 'board' }, `effects:${effects.value} flicker:${flicker.value}`);
    },
  });
  const posted = enterIframe();
  const wrapper = mountPlatformShell({ board: Board, props: { preferences }, attachTo: document.body });
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
  await wrapper.get('button[aria-label="Game controls"]').trigger('click');
  return { wrapper, posted };
}

const menuItem = (role: string, text: string) =>
  Array.from(document.body.querySelectorAll<HTMLElement>(`[role="${role}"]`)).find((el) => el.textContent?.includes(text));

/** The text aria-describedby points at, read as the space-separated id list it is. */
const describedBy = (el: Element) => (el.getAttribute('aria-describedby') ?? '').split(/\s+/)
  .map((id) => document.getElementById(id)?.textContent ?? '').join(' ');

describe('GameShell player preferences (#1440)', () => {
  it('lists each preference in the controls menu with its state and description', async () => {
    const { wrapper } = await mountWithPreferences();
    const toggle = menuItem('menuitemcheckbox', 'Battle effects')!;
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(describedBy(toggle)).toContain('Bursts and explosions');
    expect(describedBy(menuItem('menuitemcheckbox', 'Screen shake')!)).toContain('Shake on hits');
    expect(menuItem('menuitemradio', 'Full')!.getAttribute('aria-checked')).toBe('true');
    expect(menuItem('menuitemradio', 'Slow')!.getAttribute('aria-checked')).toBe('false');
    wrapper.unmount();
  });

  it('updates the board live and saves the choice, without telling the host', async () => {
    const { wrapper, posted } = await mountWithPreferences();
    menuItem('menuitemcheckbox', 'Battle effects')!.click();
    menuItem('menuitemradio', 'Slow')!.click();
    await nextTick();
    expect(wrapper.get('[data-testid="board"]').text()).toBe('effects:false flicker:slow');
    expect(localStorage.getItem('boardsmith-preference:windup:flicker')).toBe('"slow"');
    expect(JSON.stringify(posted)).not.toMatch(/battleEffects|flicker/);
    wrapper.unmount();
  });
});
