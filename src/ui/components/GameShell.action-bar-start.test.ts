// @vitest-environment jsdom
/**
 * A GAME CHOOSES WHETHER THE ACTION BAR STARTS DOWN (#1439).
 *
 * Only the starting value: the player still opens and closes the bar as before,
 * and the bar never goes away, so it stays reachable by keyboard and screen reader.
 * Asserted on the real GameShell, driven by the host's own messages.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { enterIframe, leaveIframe, mountPlatformShell, type BoardComponent } from './GameShell.platform-mount.test-helper.js';
import { usePlayContext } from '../composables/useGameContext.js';
import { definePlayerPreferences } from '../player-preferences.js';
import AutoUI from './auto-ui/AutoUI.vue';

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

const preferences = () => definePlayerPreferences('windup', {});

interface TableOptions {
  actionBarStartsCollapsed?: boolean;
  actionBarOpensForActions?: boolean;
  sidebarStartsCollapsed?: boolean;
  /** Extra fields on the host's init message. */
  init?: Record<string, unknown>;
  board?: BoardComponent;
}

async function mountAtTable({ init, board, ...props }: TableOptions = {}) {
  enterIframe();
  const wrapper = mountPlatformShell({ props: { ...props, preferences: preferences() }, board: board ?? AskingBoard, attachTo: document.body });
  await nextTick();
  post({ type: 'init', seat: 0, ...init });
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

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});
afterEach(leaveIframe);

async function openMenu(wrapper: Awaited<ReturnType<typeof mountAtTable>>): Promise<void> {
  await wrapper.get('button[aria-label="Game controls"]').trigger('click');
}
const panelChoice = (label: 'Open' | 'Closed') =>
  Array.from(document.body.querySelectorAll<HTMLElement>('[role="group"][aria-label="Action panel"] [role="menuitemradio"]'))
    .find((el) => el.textContent?.trim() === label);

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

describe('GameShell sidebarStartsCollapsed (#1529)', () => {
  const sidebarIsRail = (wrapper: Awaited<ReturnType<typeof mountAtTable>>) =>
    wrapper.get('[data-testid="bs-seats"]').classes().includes('rail');

  it('starts open when the game says nothing', async () => {
    const wrapper = await mountAtTable();
    expect(sidebarIsRail(wrapper)).toBe(false);
    wrapper.unmount();
  });

  it('starts as the rail when the game asks, and the player can still open it', async () => {
    const wrapper = await mountAtTable({ sidebarStartsCollapsed: true });
    expect(sidebarIsRail(wrapper)).toBe(true);
    const toggle = wrapper.get('[data-testid="bs-seats"] .side-edge');
    expect(toggle.attributes('aria-expanded')).toBe('false');
    await toggle.trigger('click');
    expect(sidebarIsRail(wrapper)).toBe(false);
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

describe('GameShell action panel start preference (#1826)', () => {
  it('lets the player prefer open where the game starts closed, and remembers it for this game', async () => {
    const first = await mountAtTable({ actionBarStartsCollapsed: true });
    await openMenu(first);
    expect(panelChoice('Closed')!.getAttribute('aria-checked')).toBe('true');
    panelChoice('Open')!.click();
    await nextTick();
    expect(barIsDown(first)).toBe(false);
    first.unmount();
    leaveIframe();

    const later = await mountAtTable({ actionBarStartsCollapsed: true });
    expect(barIsDown(later)).toBe(false);
    later.unmount();
  });

  it('starts as the host says until the player has chosen', async () => {
    const seeded = await mountAtTable({ actionBarStartsCollapsed: true, init: { actionPanel: 'open' } });
    expect(barIsDown(seeded)).toBe(false);
    await openMenu(seeded);
    panelChoice('Closed')!.click();
    await nextTick();
    seeded.unmount();
    leaveIframe();

    const chosen = await mountAtTable({ actionBarStartsCollapsed: true, init: { actionPanel: 'open' } });
    expect(barIsDown(chosen)).toBe(true);
    chosen.unmount();
  });

  it('never starts closed, or offers the choice, where the game starts open', async () => {
    const wrapper = await mountAtTable({ init: { actionPanel: 'closed' } });
    expect(barIsDown(wrapper)).toBe(false);
    await openMenu(wrapper);
    expect(panelChoice('Closed')).toBeUndefined();
    wrapper.unmount();
  });

  it('always starts open on the automatic UI, whose panel is the only way to act', async () => {
    const wrapper = await mountAtTable({ actionBarStartsCollapsed: true, init: { actionPanel: 'closed' }, board: AutoUI });
    expect(barIsDown(wrapper)).toBe(false);
    await openMenu(wrapper);
    expect(panelChoice('Closed')).toBeUndefined();
    wrapper.unmount();
  });

  it('labels the closed bar\'s toggle "Actions" in visible text', async () => {
    const wrapper = await mountAtTable({ actionBarStartsCollapsed: true });
    expect(wrapper.get('[data-testid="bs-actionbar-toggle"]').text()).toBe('Actions');
    await wrapper.get('[data-testid="bs-actionbar-toggle"]').trigger('click');
    expect(wrapper.get('[data-testid="bs-actionbar-toggle"]').text()).toBe('');
    wrapper.unmount();
  });

  it('refuses to start closed without the game\'s preferences to save the choice under', () => {
    enterIframe();
    expect(() => mountPlatformShell({ props: { actionBarStartsCollapsed: true } }))
      .toThrow(/actionBarStartsCollapsed.*definePlayerPreferences/);
  });
});
