// @vitest-environment jsdom
/**
 * A BOARD SHOWS EACH ANIMATION EVENT OVER THE VIEW IT ARRIVED WITH (#1807).
 *
 * The shell hands the board the latest frame at once, while the queue still
 * plays earlier events, so a board drawing only `gameView` animates the first
 * hit over a frame where the second hit already removed the unit. A board that
 * draws `useAnimatedView` instead, as `docs/custom-ui-guide.md` § "Keeping the
 * Board in Step with Queued Animations" teaches, draws each event's own frame;
 * this runs it on the real GameShell (#1815).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { defineComponent, h, nextTick, type PropType } from 'vue';
import { useAnimatedView, useAnimationEvents } from '../composables/useAnimationEvents.js';
import { findElements } from '../composables/useGameViewHelpers.js';
import type { GameRootView } from '../types.js';
import { enterIframe, leaveIframe, mountPlatformShell, postFromHost } from './GameShell.platform-mount.test-helper.js';

/** The first hit's handler waits on this, so the test can look at the board while it plays. */
let releaseFirstHit: () => void = () => {};
/** What the board drew each time a handler started, after the view it set had rendered. */
const drawnWhilePlaying: string[] = [];

const PlaybackBoard = defineComponent({
  name: 'PlaybackBoard',
  props: {
    gameView: { type: Object as PropType<GameRootView | null>, default: null },
    isViewingHistory: { type: Boolean, default: false },
  },
  setup(props) {
    const animations = useAnimationEvents();
    const shown = useAnimatedView(props);

    animations?.registerHandler('hit', async (event) => {
      await nextTick();
      drawnWhilePlaying.push(document.querySelector('[data-testid="units"]')!.textContent!);
      if (event.data.shot === 1) await new Promise<void>((resolve) => { releaseFirstHit = resolve; });
    }, { skip: 'drop' });

    return () => h('ul', { 'data-testid': 'units' },
      (shown.value ? findElements(shown.value, { className: 'Unit' }) : []).map((unit) =>
        h('li', `${unit.name} ${String(unit.attributes?.hp)}hp`)));
  },
});

function frame(hp: number | null, events: Array<{ id: number; shot: number }>, { restoreEpoch = 0, round = 1 } = {}) {
  postFromHost({
    type: 'game_state',
    view: {
      flowState: { currentPlayer: 1, awaitingInput: true, availableActions: ['pass'] },
      state: {
        view: {
          id: 0, className: 'Game', attributes: { round },
          children: hp === null ? [] : [{ id: 7, className: 'Unit', name: 'scout', attributes: { hp } }],
        },
        players: [{ name: 'P1', seat: 1 }], currentPlayer: 1, isMyTurn: true,
        availableActions: ['pass'], actionMetadata: { pass: { name: 'pass', prompt: 'Pass', selections: [] } },
        animationEvents: events.map(({ id, shot }) => ({ id, type: 'hit', data: { shot }, timestamp: id })),
        gameInstanceId: 'battle', restoreEpoch, viewerSeat: 1,
      },
    },
    winners: [],
  });
}

let wrapper: ReturnType<typeof mountPlatformShell> | undefined;
const units = () => wrapper!.get('[data-testid="units"]').text();

async function mountAtThreeHp() {
  enterIframe();
  wrapper = mountPlatformShell({ board: PlaybackBoard, attachTo: document.body });
  await nextTick();
  postFromHost({ type: 'init', seat: 1 });
  frame(3, []);
  await flushPromises();
}

/** Three hits take the scout from 3hp to gone, each frame landing while the first hit still plays. */
async function threeHitsArrive() {
  frame(2, [{ id: 1, shot: 1 }]);
  await nextTick();
  frame(1, [{ id: 2, shot: 2 }]);
  await nextTick();
  frame(null, [{ id: 3, shot: 3 }]);
  await flushPromises();
}

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  drawnWhilePlaying.length = 0;
  leaveIframe();
  document.body.innerHTML = '';
});

describe('a board plays each queued event over the view it arrived with (#1807)', () => {
  it('draws each hit over its own frame while later frames have already arrived', async () => {
    await mountAtThreeHp();
    await threeHitsArrive();

    expect(drawnWhilePlaying).toEqual(['scout 2hp']);
    expect(units()).toBe('scout 2hp');

    releaseFirstHit();
    await flushPromises();

    expect(drawnWhilePlaying).toEqual(['scout 2hp', 'scout 1hp', '']);
    expect(units()).toBe('');
  });

  it('goes back to the latest view when the player skips the animations', async () => {
    await mountAtThreeHp();
    await threeHitsArrive();
    expect(units()).toBe('scout 2hp');

    await wrapper!.get('.action-panel-pending .skip-btn').trigger('click');
    await nextTick();

    expect(units()).toBe('');
  });

  it('draws a replayed event over its new frame after a restore, not a frame of the old timeline', async () => {
    await mountAtThreeHp();
    frame(2, [{ id: 1, shot: 1 }]);
    await flushPromises();
    releaseFirstHit();
    await flushPromises();
    // The next frame, before any new action, carries the played event again.
    frame(2, [{ id: 1, shot: 1 }], { round: 2 });
    await flushPromises();

    frame(3, [{ id: 1, shot: 9 }], { restoreEpoch: 1 });
    await flushPromises();

    expect(drawnWhilePlaying).toEqual(['scout 2hp', 'scout 3hp']);
  });
});
