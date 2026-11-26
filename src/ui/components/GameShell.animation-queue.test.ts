// @vitest-environment jsdom
/**
 * THE ANIMATION QUEUE ON THE REAL GAMESHELL, BY EVERY ROUTE A PLAYER CAN TAKE (#1820).
 *
 * A frame lands, an undo or a change of seat replaces the timeline, the dev
 * host's UI switcher (or a phone crossing the compact breakpoint) swaps the
 * board while its handler plays, and the shell unmounts. In each, the Action
 * Panel is gated exactly while the queue plays, and a handler whose board is
 * gone has its signal aborted and holds up nothing.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import { useAnimationEvents } from '../composables/useAnimationEvents.js';
import { defineGameUIs, defaultUI, devUI } from '../game-uis.js';
import { enterIframe, leaveIframe, mountPlatformShell, postFromHost } from './GameShell.platform-mount.test-helper.js';

interface Play { board: string; id: number; epoch: unknown; skipped: boolean; signal: AbortSignal }

/** Every event a board was handed. A handler ignores its signal and never settles, as a board awaiting a removed element's animation would. */
const plays: Play[] = [];

function playingBoard(name: string, skip: 'run' | 'drop') {
  return defineComponent({
    name,
    setup() {
      useAnimationEvents()?.registerHandler('hit', (event, { signal }) => {
        plays.push({ board: name, id: event.id, epoch: event.data.epoch, skipped: signal.aborted, signal });
        return new Promise<void>(() => {});
      }, { skip });
      return () => h('div', { class: name }, name);
    },
  });
}

const First = playingBoard('first', 'run');
const Second = playingBoard('second', 'drop');

function frame(ids: number[], restoreEpoch = 0): void {
  postFromHost({
    type: 'game_state',
    view: {
      flowState: { currentPlayer: 1, awaitingInput: true, availableActions: ['pass'] },
      state: {
        view: { id: 0, className: 'Game', attributes: {}, children: [] },
        players: [{ name: 'P1', seat: 1 }], currentPlayer: 1, isMyTurn: true,
        availableActions: ['pass'], actionMetadata: { pass: { name: 'pass', prompt: 'Pass', selections: [] } },
        animationEvents: ids.map((id) => ({ id, type: 'hit', data: { epoch: restoreEpoch }, timestamp: id })),
        gameInstanceId: 'battle', restoreEpoch, viewerSeat: 1,
      },
    },
    winners: [],
  });
}

let wrapper: ReturnType<typeof mountPlatformShell> | undefined;

async function mountShell() {
  enterIframe();
  wrapper = mountPlatformShell({
    uis: defineGameUIs({ First: defaultUI(First), Second: devUI(async () => ({ __esModule: true, default: Second })) }),
  });
  await nextTick();
  postFromHost({ type: 'init', seat: 1 });
  frame([]);
  await flushPromises();
}

const gated = () => wrapper!.find('.action-panel-pending').exists();
const passOffered = () => wrapper!.find('[data-bs-action="pass"]').exists();

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  plays.length = 0;
  leaveIframe();
});

describe('the animation queue on GameShell (#1820)', () => {
  it('gates the Action Panel from the render a frame with events lands in, never showing its choices first', async () => {
    await mountShell();
    expect(passOffered()).toBe(true);

    frame([1]);
    await nextTick();
    expect(gated()).toBe(true);
    expect(passOffered()).toBe(false);
    await flushPromises();
    expect(plays.map((p) => p.id)).toEqual([1]);
  });

  it('aborts the playing handler and ungates the panel when an undo replaces the timeline', async () => {
    await mountShell();
    frame([1, 2]);
    await flushPromises();

    frame([], 1);
    await flushPromises();
    expect(plays.map((p) => [p.id, p.skipped, p.signal.aborted])).toEqual([[1, false, true], [2, true, true]]);
    expect(gated()).toBe(false);
    expect(passOffered()).toBe(true);
  });

  it('runs the old timeline\'s skip: run handlers in order and keeps the panel gated when an undo brings a new event', async () => {
    await mountShell();
    frame([1, 2, 3]);
    await flushPromises();

    frame([1], 1);
    await nextTick();
    expect(gated()).toBe(true);
    await flushPromises();
    expect(plays.map((p) => [p.epoch, p.id, p.skipped, p.signal.aborted])).toEqual([
      [0, 1, false, true],
      [0, 2, true, true],
      [0, 3, true, true],
      [1, 1, false, false],
    ]);
    expect(gated()).toBe(true);
    expect(passOffered()).toBe(false);
  });

  it('aborts the handler of a board the UI switcher replaces mid-play, and plays the next event on the new board', async () => {
    await mountShell();
    frame([1, 2]);
    await flushPromises();
    expect(plays.map((p) => p.board)).toEqual(['first']);

    postFromHost({ type: 'dev-ui-select', name: 'Second' });
    await flushPromises();
    expect(wrapper!.find('.second').exists()).toBe(true);
    expect(plays.map((p) => [p.board, p.id, p.signal.aborted])).toEqual([['first', 1, true], ['second', 2, false]]);
  });

  it('aborts the playing handler when the shell unmounts', async () => {
    await mountShell();
    frame([1]);
    await flushPromises();

    wrapper!.unmount();
    wrapper = undefined;
    expect(plays.map((p) => p.signal.aborted)).toEqual([true]);
  });
});
