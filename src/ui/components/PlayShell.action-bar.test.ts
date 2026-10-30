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
 *   4. Collapsed is a thin line, not nothing (#1439). It keeps the controls menu
 *      (in the hosted shell that is the player's ONLY control surface) and the
 *      toggle, with an attention mark on it when it is this seat's move, which
 *      is then the hint that the game is waiting.
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
import type { EnrichedActionMetadata } from '../composables/useActionControllerTypes.js';
import type { UseActionControllerReturn } from '../composables/useActionControllerTypes.js';

// Links the files this check reads, so `vitest run --changed` runs it when only one changes; nothing loads (#1504).
import.meta.glob(['/src/ui/components/GameShell.vue', '/src/ui/world/WorldShell.vue']);

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
const MOVE: EnrichedActionMetadata = {
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
const REST: EnrichedActionMetadata = {
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
const METADATA: Record<string, EnrichedActionMetadata> = { move: MOVE, rest: REST };

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
      boardFailed: false,
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

  it('keeps the controls menu and nothing else on the thin line (#1439)', async () => {
    const { wrapper } = mountDock({ actionBarMinimized: true, prompt: 'Walk one sector' });
    await flush();
    // In the hosted shell the controls menu is the player's ONLY control surface, so
    // minimizing the bar must never take it away.
    expect(wrapper.find('.my-controls').exists()).toBe(true);
    expect(wrapper.find('[data-testid="bs-actionbar"] .turn-token').exists()).toBe(false);
    expect(wrapper.get('[data-testid="bs-actionbar"]').text()).not.toContain('Walk one sector');
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
  /**
   * A minimized bar with `move` open: the state every assertion below starts
   * from. It ASSERTS the opening, because a helper that quietly left the bar
   * down would make the rest of these vacuous.
   */
  async function asked(): Promise<Mounted> {
    const shell = mountDock({ actionBarMinimized: true });
    await flush();
    expect(collapsed(shell.wrapper), 'the bar did not start down').toBe(true);
    await shell.controller.start('move');
    await flush();
    expect(collapsed(shell.wrapper), 'the bar stayed down while a question was open').toBe(false);
    return shell;
  }

  it('opens itself when an action starts, without forgetting the preference', async () => {
    const { wrapper, minimized } = await asked();
    expect(wrapper.find('[data-testid="bs-action-panel"]').exists()).toBe(true);
    // The player's own choice survives the interruption.
    expect(minimized()).toBe(true);
  });

  it('goes back down of its own accord when the action resolves', async () => {
    const { wrapper, controller } = await asked();
    controller.cancel();
    await flush();
    expect(collapsed(wrapper)).toBe(true);
  });

  /** The player pushing the bar down again with a question still open. */
  async function pushDownAgain(wrapper: VueWrapper): Promise<void> {
    await toggle(wrapper).trigger('click');
    await flush();
    expect(collapsed(wrapper), 'the toggle was dead while a question was open').toBe(true);
  }

  it('keeps the toggle live mid-action, so the control is never dead', async () => {
    const { wrapper, controller } = await asked();
    await pushDownAgain(wrapper);
    // Still mid-action: the bar went down because the player said so, not
    // because the question went away.
    expect(controller.currentAction.value).toBe('move');
  });

  it('opens again for the NEXT question, not just the first', async () => {
    const { wrapper, controller } = await asked();
    await pushDownAgain(wrapper);

    controller.cancel();
    await flush();
    await controller.start('rest');
    await flush();
    expect(collapsed(wrapper)).toBe(false);
  });

  it('opens again when the SAME action starts again inside one flush (#384)', async () => {
    const { wrapper, controller } = await asked();
    await pushDownAgain(wrapper);

    // A reply that lands after the new state: the finished `move` clears and the
    // auto-start opens `move` again before Vue flushes, so the name never
    // changes between two runs of a watcher.
    controller.cancel();
    await controller.start('move');
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

describe('a game may keep a put-down bar down when an action starts (#1519)', () => {
  it('leaves the bar down for a question, with the mark saying it is this seat\'s move', async () => {
    const { wrapper, controller } = mountDock({ actionBarMinimized: true, actionBarOpensForActions: false });
    await flush();
    await controller.start('move');
    await flush();
    expect(collapsed(wrapper), 'the bar opened itself over the game\'s opt-out').toBe(true);
    expect(wrapper.find('[data-testid="bs-actionbar-attention"]').exists()).toBe(true);
    expect(controller.currentAction.value).toBe('move');
  });

  it('follows the game changing its mind with a question already open', async () => {
    const { wrapper, controller } = mountDock({ actionBarMinimized: true, actionBarOpensForActions: false });
    await flush();
    await controller.start('move');
    await flush();
    await wrapper.setProps({ actionBarOpensForActions: true });
    await flush();
    expect(collapsed(wrapper), 'the open question stayed hidden after the game let the bar open').toBe(false);
    await wrapper.setProps({ actionBarOpensForActions: false });
    await flush();
    expect(collapsed(wrapper), 'the bar stayed up after the game asked it to stay down').toBe(true);
  });

  it('opens when the player opens it, and stays down once they put it down again', async () => {
    const { wrapper, controller } = mountDock({ actionBarMinimized: true, actionBarOpensForActions: false });
    await flush();
    await controller.start('move');
    await flush();
    await toggle(wrapper).trigger('click');
    await flush();
    expect(wrapper.find('[data-testid="bs-action-panel"]').exists()).toBe(true);
    await toggle(wrapper).trigger('click');
    controller.cancel();
    await controller.start('rest');
    await flush();
    expect(collapsed(wrapper)).toBe(true);
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

describe('the board region reserves the line only for the player\'s own toggle (#1518)', () => {
  it('follows the preference, not a question opening the bar over it', async () => {
    const { wrapper, controller } = mountDock({ actionBarMinimized: true });
    await flush();
    expect(wrapper.classes()).toContain('action-bar-minimized');
    await controller.start('move');
    await flush();
    expect(collapsed(wrapper)).toBe(false);
    expect(wrapper.classes(), 'a question opening the bar changed the reserve, which refits the board').toContain('action-bar-minimized');
    await toggle(wrapper).trigger('click');
    await flush();
    expect(collapsed(wrapper)).toBe(true);
    expect(wrapper.classes(), 'pushing down a bar opened for a question lost the preference').toContain('action-bar-minimized');
    await toggle(wrapper).trigger('click');
    await flush();
    expect(wrapper.classes()).not.toContain('action-bar-minimized');
  });
});

describe('the board ends in scroll room only while the bar can float over it (#1525)', () => {
  it('drops it for a bar kept down, and keeps it while a question may bring the bar up', async () => {
    const { wrapper, controller } = mountDock({ actionBarMinimized: true, actionBarOpensForActions: false });
    await flush();
    expect(wrapper.classes()).toContain('action-bar-stays-down');
    await controller.start('move');
    await flush();
    expect(wrapper.classes(), 'a question changed the scroll room, which can move a scrolled board').toContain('action-bar-stays-down');
    await wrapper.setProps({ actionBarOpensForActions: true });
    expect(wrapper.classes(), 'a bar that may come up for a question would cover the board with no room to scroll it clear').not.toContain('action-bar-stays-down');
    await wrapper.setProps({ actionBarOpensForActions: false, actionBarMinimized: false });
    expect(wrapper.classes(), 'a bar the player left up covers the board with its second row').not.toContain('action-bar-stays-down');
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

  it('holds it in its own ref, seeded from the game\'s starting choice (#1439)', () => {
    expect(source).toContain('const actionBarMinimized = ref(props.actionBarStartsCollapsed)');
  });

  it('relays it to the shared chrome with v-model', () => {
    expect(source).toContain('v-model:action-bar-minimized="actionBarMinimized"');
  });

  it('does not persist it, because the sidebar rail does not either', () => {
    expect(source).not.toMatch(/localStorage[\s\S]{0,80}actionBarMinimized/);
    expect(source).not.toMatch(/actionBarMinimized[\s\S]{0,80}localStorage/);
  });
});
