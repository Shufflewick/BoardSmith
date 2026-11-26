// @vitest-environment jsdom
/**
 * A BOARD DRAWS EACH QUEUED BEAT FROM ITS EVENT'S DATA (#1807, #1818).
 *
 * The shell hands the board the latest frame at once, while the queue still
 * plays earlier events, so a frame cannot show an earlier beat. A board draws
 * `gameView` and shows each beat from what its event carries, as
 * `docs/custom-ui-guide.md` § "Keeping the Board in Step with Queued
 * Animations" teaches; this runs it on the real GameShell.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { defineComponent, h, nextTick, shallowRef, type PropType } from 'vue';
import { useAnimationEvents } from '../composables/useAnimationEvents.js';
import { findElements } from '../composables/useGameViewHelpers.js';
import type { GameRootView } from '../types.js';
import { enterIframe, leaveIframe, mountPlatformShell, postFromHost } from './GameShell.platform-mount.test-helper.js';

/** The playing hit's handler waits on this, so the test can look at the board while it plays. */
let releaseHit: () => void = () => {};

const PlaybackBoard = defineComponent({
  name: 'PlaybackBoard',
  props: {
    gameView: { type: Object as PropType<GameRootView | null>, default: null },
  },
  setup(props) {
    const beat = shallowRef<string>();
    useAnimationEvents()?.registerHandler('hit', async (event) => {
      beat.value = `scout ${String(event.data.hp)}hp`;
      await new Promise<void>((resolve) => { releaseHit = resolve; });
      beat.value = undefined;
    }, { skip: 'drop' });

    return () => h('div', [
      h('p', { 'data-testid': 'beat' }, beat.value ?? ''),
      h('ul', { 'data-testid': 'units' },
        (props.gameView ? findElements(props.gameView, { className: 'Unit' }) : []).map((unit) =>
          h('li', `${unit.name} ${String(unit.attributes?.hp)}hp`))),
    ]);
  },
});

function frame(hp: number | null, events: Array<{ id: number; hp: number }>) {
  postFromHost({
    type: 'game_state',
    view: {
      flowState: { currentPlayer: 1, awaitingInput: true, availableActions: ['pass'] },
      state: {
        view: {
          id: 0, className: 'Game', attributes: {},
          children: hp === null ? [] : [{ id: 7, className: 'Unit', name: 'scout', attributes: { hp } }],
        },
        players: [{ name: 'P1', seat: 1 }], currentPlayer: 1, isMyTurn: true,
        availableActions: ['pass'], actionMetadata: { pass: { name: 'pass', prompt: 'Pass', selections: [] } },
        animationEvents: events.map(({ id, hp: hpLeft }) => ({ id, type: 'hit', data: { hp: hpLeft }, timestamp: id })),
        gameInstanceId: 'battle', restoreEpoch: 0, viewerSeat: 1,
      },
    },
    winners: [],
  });
}

let wrapper: ReturnType<typeof mountPlatformShell> | undefined;
const text = (testId: string) => wrapper!.get(`[data-testid="${testId}"]`).text();

/** Three hits take the scout from 3hp to gone, each frame landing while the first hit still plays. */
async function threeHitsArrive() {
  enterIframe();
  wrapper = mountPlatformShell({ board: PlaybackBoard, attachTo: document.body });
  await nextTick();
  postFromHost({ type: 'init', seat: 1 });
  frame(3, []);
  await flushPromises();
  frame(2, [{ id: 1, hp: 2 }]);
  await nextTick();
  frame(1, [{ id: 2, hp: 1 }]);
  await nextTick();
  frame(null, [{ id: 3, hp: 0 }]);
  await flushPromises();
}

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  leaveIframe();
  document.body.innerHTML = '';
});

describe('a board draws each queued beat from its event data (#1807, #1818)', () => {
  it('shows each hit from its event while the board draws the latest frame', async () => {
    await threeHitsArrive();
    expect(text('units')).toBe('');
    expect(text('beat')).toBe('scout 2hp');

    releaseHit();
    await flushPromises();
    expect(text('beat')).toBe('scout 1hp');
    releaseHit();
    await flushPromises();
    expect(text('beat')).toBe('scout 0hp');
  });

  it('ends playback when the player skips the animations in the Action Panel', async () => {
    await threeHitsArrive();
    await wrapper!.get('.action-panel-pending .skip-btn').trigger('click');
    await flushPromises();

    expect(wrapper!.find('.action-panel-pending').exists()).toBe(false);
    releaseHit();
    await flushPromises();
    expect(text('beat')).toBe('');
  });
});
