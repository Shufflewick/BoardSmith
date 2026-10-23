// @vitest-environment jsdom
/**
 * THE REDUCE MOTION ITEM, FROM THE CONTROLS MENU TO A BOARD THAT STOPS MOVING (#1442).
 *
 * The real GameShell lists the built-in Reduce motion item whether or not the
 * game declares preferences of its own. Turning it on stops a board's FLIP
 * animation, puts the `bs-reduce-motion` class on `<html>` for the CSS rules,
 * and is saved for every game in this browser.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { enterIframe, leaveIframe, mountPlatformShell } from './GameShell.platform-mount.test-helper.js';
import { createFLIPSnapshot } from '../composables/useFLIP.js';

let animateCalls = 0;
let moved = false;
const card = ref<HTMLElement | null>(null);

const Board = defineComponent({
  setup: () => () => h('div', { ref: card }, [h('div', { 'data-card-id': 'card' })]),
});

/** Snapshot the board, move its card, animate, and report whether anything animated. */
async function cardAnimates(): Promise<boolean> {
  const snapshot = createFLIPSnapshot(card);
  moved = true;
  const before = animateCalls;
  await snapshot.animate();
  moved = false;
  return animateCalls > before;
}

function post(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { source: window.parent, data: { source: 'shufflewick', ...data } }));
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  (HTMLElement.prototype as unknown as { animate: unknown }).animate = () => {
    animateCalls += 1;
    return { finished: Promise.resolve() } as unknown as Animation;
  };
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => {
    const left = moved ? 100 : 0;
    return { left, top: 0, right: left, bottom: 0, width: 0, height: 0, x: left, y: 0, toJSON: () => ({}) } as DOMRect;
  });
});
afterEach(() => {
  leaveIframe();
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
});

async function openMenu() {
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
  await wrapper.get('button[aria-label="Game controls"]').trigger('click');
  const item = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]'))
    .find((el) => el.textContent?.includes('Reduce motion'));
  return { wrapper, item };
}

describe('GameShell Reduce motion (#1442)', () => {
  it('stops the board animating, marks <html> for CSS, and saves the choice for every game', async () => {
    const { wrapper, item } = await openMenu();
    expect(item, 'the controls menu has no Reduce motion item').toBeDefined();
    expect(item!.getAttribute('aria-checked')).toBe('false');
    expect(await cardAnimates()).toBe(true);
    expect(document.documentElement.classList.contains('bs-reduce-motion')).toBe(false);

    item!.click();
    await nextTick();

    expect(item!.getAttribute('aria-checked')).toBe('true');
    expect(await cardAnimates()).toBe(false);
    expect(document.documentElement.classList.contains('bs-reduce-motion')).toBe(true);
    expect(localStorage.getItem('boardsmith-preference:boardsmith:reduceMotion')).toBe('true');

    item!.click();
    wrapper.unmount();
    expect(document.documentElement.classList.contains('bs-reduce-motion')).toBe(false);
  });
});
