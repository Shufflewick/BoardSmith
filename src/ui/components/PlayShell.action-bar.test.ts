// @vitest-environment jsdom
/**
 * THE PLAYER MAY PUT THE ACTION BAR AWAY (#230).
 *
 * The sidebar already collapses to a rail, and the ask is for the same gesture on
 * the bar: a player who wants nothing but the game's own board should be able to
 * push the bar down and get the screen back. So this is deliberately the LEFT
 * PANEL'S IDIOM, applied to the other edge -- one chevron on the surface's
 * board-facing edge, `aria-expanded` on it, the state held by the adapter and
 * relayed with `v-model`, and a collapsed state that keeps an anchor rather than
 * vanishing.
 *
 * ## The half that is not the sidebar's
 *
 * Nothing is ever ASKED of the player through the sidebar, so a collapsed rail
 * cannot strand anybody. The bar is where a question lands, and a bar that
 * stayed down while the game waited on an answer would be actively harmful --
 * the player would be looking at a hidden panel with a live prompt and a live
 * Cancel in it.
 *
 * The rule, therefore:
 *
 *   1. Minimizing is a VIEW PREFERENCE. It never changes what actions exist,
 *      what the controller holds, or what the board offers (CLAUDE.md: the panel
 *      and the custom UI are two representations of ONE state).
 *   2. The bar OPENS ITSELF whenever an action starts, because that is the
 *      moment the bar owns the answer. The preference is remembered, not
 *      discarded, so the bar goes back down when the action resolves.
 *   3. The toggle stays live the whole time: a player may push the bar down
 *      again mid-action, and the NEXT action start brings it back. There is no
 *      state in which the control is dead and no state in which the bar is
 *      stuck down while the game needs something.
 *   4. Collapsed is not empty. It keeps the controls menu (in platform mode that
 *      is the player's ONLY control surface), the seat token, and the sentence
 *      saying what is wanted -- plus an attention mark on the toggle when it is
 *      this seat's move.
 *
 * These assertions drive the REAL `PlayShell` over a REAL `useActionController`,
 * because rule 2 is a controller transition and a stubbed controller never makes
 * one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { h, nextTick, ref, type Ref } from 'vue';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import PlayShell from './PlayShell.vue';
import { GAME_CONTEXT_KEYS } from '../composables/useGameContext.js';
import { useActionController } from '../composables/useActionController.js';
import type { ActionMetadata } from '../composables/useActionControllerTypes.js';
import type { UseActionControllerReturn } from '../composables/useActionControllerTypes.js';

const HERE = dirname(fileURLToPath(import.meta.url));

class PanelResizeObserver {
  disconnect = vi.fn();
  observe = vi.fn();
  unobserve = vi.fn();
}
beforeEach(() => vi.stubGlobal('ResizeObserver', PanelResizeObserver));

/** Mounted shells, torn down between tests because the focus ones live in the
 *  real document and a leftover shell there would answer the next test's
 *  `document.activeElement`. */
const mounted: VueWrapper[] = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.unstubAllGlobals();
});

/** One choice pick, so `start()` leaves the action open and awaiting an answer. */
const MOVE: ActionMetadata = {
  name: 'move',
  prompt: 'Walk one sector',
  selections: [
    {
      name: 'direction',
      type: 'choice',
      prompt: 'Which way?',
      choices: [
        { value: 'north', display: 'North' },
        { value: 'south', display: 'South' },
      ],
    },
  ],
};

/** A second one, to prove the bar re-opens for the NEXT question and not just once. */
const REST: ActionMetadata = {
  name: 'rest',
  prompt: 'Rest here',
  selections: [
    {
      name: 'hours',
      type: 'choice',
      prompt: 'How long?',
      choices: [
        { value: '1', display: 'An hour' },
        { value: '2', display: 'Two hours' },
      ],
    },
  ],
};

const ACTIONS = ['move', 'rest'];
const METADATA: Record<string, ActionMetadata> = { move: MOVE, rest: REST };

async function flush(n = 8): Promise<void> {
  for (let i = 0; i < n; i++) {
    await nextTick();
    await Promise.resolve();
  }
}

interface Mounted {
  wrapper: VueWrapper;
  controller: UseActionControllerReturn;
  /** What the backend enumerated for this seat, as the controller reads it. */
  enumerated: Ref<string[]>;
  /** The preference as the adapter would hold it, re-fed on every emit. */
  minimized: () => boolean;
}

/** `attach` puts the shell in the real document, which focus needs to move. */
function mountDock(props: Record<string, unknown> = {}, attach = false): Mounted {
  const enumerated = ref([...ACTIONS]);
  const controller = useActionController({
    sendAction: async () => ({ success: true }),
    availableActions: enumerated,
    actionMetadata: ref(METADATA),
    isMyTurn: ref(true),
  });
  const wrapper = mount(PlayShell, {
    props: {
      players: [{ seat: 0, name: 'Ivy' }, { seat: 1, name: 'Rook' }],
      playerSeat: 0,
      messages: [],
      mayAct: true,
      availableActions: ACTIONS,
      actionMetadata: METADATA,
      panelToken: { name: 'Ivy', seat: 0 },
      actionBarMinimized: false,
      // The adapter owns the preference; relay every emit straight back, exactly
      // as `v-model:action-bar-minimized` does.
      'onUpdate:actionBarMinimized': (value: boolean) => wrapper.setProps({ actionBarMinimized: value }),
      ...props,
    },
    slots: {
      board: () => h('div', { class: 'my-board' }, 'board'),
      controls: () => h('button', { class: 'my-controls' }, 'More'),
    },
    ...(attach ? { attachTo: document.body } : {}),
    global: { provide: { [GAME_CONTEXT_KEYS.actionController as symbol]: controller } },
  });
  mounted.push(wrapper);
  return {
    wrapper,
    controller,
    enumerated,
    minimized: () => wrapper.props('actionBarMinimized') as boolean,
  };
}

const toggle = (wrapper: VueWrapper) => wrapper.get('[data-testid="bs-actionbar-toggle"]');
const collapsed = (wrapper: VueWrapper) =>
  wrapper.get('[data-testid="bs-actionbar"]').classes().includes('collapsed');
/** Every action the panel is offering to start, in the order it offers them. */
const offered = (wrapper: VueWrapper) =>
  wrapper.findAll('[data-bs-action]').map((button) => button.attributes('data-bs-action'));

describe('the bar carries the sidebar rail\'s own gesture', () => {
  it('offers one toggle, on the bar, saying the bar is open', () => {
    const { wrapper } = mountDock();
    expect(wrapper.findAll('[data-testid="bs-actionbar-toggle"]')).toHaveLength(1);
    expect(toggle(wrapper).attributes('aria-expanded')).toBe('true');
    expect(toggle(wrapper).attributes('aria-label')).toBe('Collapse action bar');
  });

  it('hands the preference to the adapter rather than keeping it', async () => {
    const { wrapper } = mountDock();
    await toggle(wrapper).trigger('click');
    expect(wrapper.emitted('update:actionBarMinimized')).toEqual([[true]]);
  });

  it('collapses the bar when the adapter says the player minimized it', async () => {
    const { wrapper } = mountDock({ actionBarMinimized: true });
    await flush();
    expect(collapsed(wrapper)).toBe(true);
    expect(wrapper.classes()).toContain('action-bar-collapsed');
    expect(toggle(wrapper).attributes('aria-expanded')).toBe('false');
    expect(toggle(wrapper).attributes('aria-label')).toBe('Expand action bar, your move');
  });

  it('takes the panel away when collapsed and puts it back when expanded', async () => {
    const { wrapper } = mountDock({ actionBarMinimized: true });
    await flush();
    expect(wrapper.find('[data-testid="bs-action-panel"]').exists()).toBe(false);
    await wrapper.setProps({ actionBarMinimized: false });
    await flush();
    expect(wrapper.find('[data-testid="bs-action-panel"]').exists()).toBe(true);
  });

  it('keeps the controls menu, the seat token and what is wanted', async () => {
    const { wrapper } = mountDock({ actionBarMinimized: true, prompt: 'Walk one sector' });
    await flush();
    // In platform mode the controls menu is the player's ONLY control surface, so
    // minimizing the bar must never take it away.
    expect(wrapper.find('.my-controls').exists()).toBe(true);
    expect(wrapper.find('[data-testid="bs-actionbar"] .turn-token').exists()).toBe(true);
    expect(wrapper.get('[data-testid="bs-actionbar-summary"]').text()).toBe('Walk one sector');
  });

  it('marks the toggle when the game is waiting on this seat, and not otherwise', async () => {
    const waiting = mountDock({ actionBarMinimized: true });
    await flush();
    expect(waiting.wrapper.find('[data-testid="bs-actionbar-attention"]').exists()).toBe(true);

    const idle = mountDock({ actionBarMinimized: true, mayAct: false });
    await flush();
    expect(idle.wrapper.find('[data-testid="bs-actionbar-attention"]').exists()).toBe(false);
    expect(toggle(idle.wrapper).attributes('aria-label')).toBe('Expand action bar');
  });

  it('marks nothing while the bar is open', async () => {
    const { wrapper } = mountDock();
    await flush();
    expect(wrapper.find('[data-testid="bs-actionbar-attention"]').exists()).toBe(false);
  });
});

describe('a minimized bar never strands the player', () => {
  it('opens itself when an action starts, without forgetting the preference', async () => {
    const { wrapper, controller, minimized } = mountDock({ actionBarMinimized: true });
    await flush();
    expect(collapsed(wrapper)).toBe(true);

    await controller.start('move');
    await flush();
    expect(collapsed(wrapper)).toBe(false);
    expect(wrapper.find('[data-testid="bs-action-panel"]').exists()).toBe(true);
    // The player's own choice survives the interruption.
    expect(minimized()).toBe(true);
  });

  it('goes back down of its own accord when the action resolves', async () => {
    const { wrapper, controller } = mountDock({ actionBarMinimized: true });
    await flush();
    await controller.start('move');
    await flush();
    expect(collapsed(wrapper)).toBe(false);

    controller.cancel();
    await flush();
    expect(collapsed(wrapper)).toBe(true);
  });

  it('keeps the toggle live mid-action, so the control is never dead', async () => {
    const { wrapper, controller } = mountDock({ actionBarMinimized: true });
    await flush();
    await controller.start('move');
    await flush();
    expect(collapsed(wrapper)).toBe(false);

    await toggle(wrapper).trigger('click');
    await flush();
    expect(collapsed(wrapper)).toBe(true);
    // Still mid-action: the bar went down because the player said so, not
    // because the question went away.
    expect(controller.currentAction.value).toBe('move');
  });

  it('opens again for the NEXT question, not just the first', async () => {
    const { wrapper, controller } = mountDock({ actionBarMinimized: true });
    await flush();
    await controller.start('move');
    await flush();
    await toggle(wrapper).trigger('click');
    await flush();
    expect(collapsed(wrapper)).toBe(true);

    controller.cancel();
    await flush();
    await controller.start('rest');
    await flush();
    expect(collapsed(wrapper)).toBe(false);
  });

  it('leaves the bar alone when the player never minimized it', async () => {
    const { wrapper, controller, minimized } = mountDock();
    await flush();
    await controller.start('move');
    await flush();
    expect(collapsed(wrapper)).toBe(false);
    controller.cancel();
    await flush();
    expect(collapsed(wrapper)).toBe(false);
    expect(minimized()).toBe(false);
  });
});

describe('the keyboard keeps its place', () => {
  it('is a real button, so it is tabbable and answers Enter and Space itself', () => {
    const { wrapper } = mountDock();
    const el = toggle(wrapper).element as HTMLButtonElement;
    expect(el.tagName).toBe('BUTTON');
    expect(el.type).toBe('button');
    expect(el.hasAttribute('tabindex')).toBe(false);
    // It names the region it operates, so a screen reader reading the toggle is
    // told what collapsed.
    expect(el.getAttribute('aria-controls')).toBe('bs-actionbar');
    expect(wrapper.get('[data-testid="bs-actionbar"]').attributes('id')).toBe('bs-actionbar');
  });

  it('lands focus on the toggle when the bar closes under a focused control', async () => {
    const { wrapper, controller } = mountDock({ actionBarMinimized: true }, true);
    await flush();
    await controller.start('move');
    await flush();

    // A keyboard player is inside the panel when the action resolves, and the
    // control they are on is about to be removed from the document.
    const inside = wrapper.get('[data-testid="bs-action-panel"] button').element as HTMLElement;
    inside.focus();
    expect(document.activeElement).toBe(inside);

    controller.cancel();
    await flush();
    expect(collapsed(wrapper)).toBe(true);
    expect(document.activeElement).toBe(toggle(wrapper).element);
  });

  it('leaves focus where it is when the bar opens itself', async () => {
    const { wrapper, controller } = mountDock({ actionBarMinimized: true }, true);
    await flush();
    // An action is usually started FROM the board; taking the keyboard off the
    // board at that moment would be worse than leaving it there.
    const board = wrapper.get('.my-board').element as HTMLElement;
    board.tabIndex = -1;
    board.focus();

    await controller.start('move');
    await flush();
    expect(collapsed(wrapper)).toBe(false);
    expect(document.activeElement).toBe(board);
  });
});

describe('minimizing is a view preference and nothing more', () => {
  it('changes neither the enumerated actions nor the action in progress', async () => {
    const { wrapper, controller, enumerated } = mountDock();
    await flush();
    const before = offered(wrapper);
    expect(before).toEqual(ACTIONS);

    await toggle(wrapper).trigger('click');
    await flush();
    expect(enumerated.value).toEqual(ACTIONS);
    expect(controller.currentAction.value).toBeNull();

    // And the panel comes back offering exactly what it offered before.
    await toggle(wrapper).trigger('click');
    await flush();
    expect(offered(wrapper)).toEqual(before);
  });
});

/**
 * BOTH ADAPTERS, OR THE WORLD SILENTLY LOSES IT (#170 R6).
 *
 * The bar is `PlayShell`'s, but the preference is the ADAPTER's ref -- that is
 * where `sidebarRail` lives, and a second home for the same kind of state would
 * be a second idiom for one idea. Which means each adapter has to wire it, and
 * an adapter that forgets loses the feature with every unit test still green.
 */
describe.each([
  ['GameShell.vue', join(HERE, 'GameShell.vue')],
  ['WorldShell.vue', join(HERE, '..', 'world', 'WorldShell.vue')],
])('%s owns the bar preference, exactly as it owns the sidebar rail', (_name, path) => {
  const source = readFileSync(path, 'utf8');

  it('holds it in its own ref', () => {
    expect(source).toMatch(/const actionBarMinimized = ref(?:<boolean>)?\(false\)/);
  });

  it('relays it to the shared chrome with v-model', () => {
    expect(source).toContain('v-model:action-bar-minimized="actionBarMinimized"');
  });

  it('does not persist it, because the sidebar rail does not either', () => {
    expect(source).not.toMatch(/localStorage[\s\S]{0,80}actionBarMinimized/);
    expect(source).not.toMatch(/actionBarMinimized[\s\S]{0,80}localStorage/);
  });
});
