// @vitest-environment jsdom
/**
 * A NEW STATE KEEPS WHAT DID NOT CHANGE (#1616).
 *
 * The host posts each seat's whole view, structured-cloned, so every push used
 * to hand the board a new object for every part of the game and re-render all
 * of it. The shell keeps each part that did not change as the object it already
 * holds, so a component handed only that part is not rendered again.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { enterIframe, leaveIframe, mountPlatformShell } from './GameShell.platform-mount.test-helper.js';

function fromHost(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { source: window.parent, data: { source: 'shufflewick', ...data } }));
}

function frame(scores: [number, number]): Record<string, unknown> {
  return {
    type: 'game_state',
    view: {
      flowState: { currentPlayer: 1, awaitingInput: true, availableActions: [] },
      state: {
        view: { children: scores.map((score, i) => ({ id: i + 1, attributes: { score } })) },
        players: [{ name: 'P1', seat: 1 }, { name: 'P2', seat: 2 }],
        currentPlayer: 1,
        isMyTurn: true,
        availableActions: [],
      },
    },
    winners: [],
  };
}

const renders = new Map<number, number>();
const views: Array<{ children: Array<{ id: number }> }> = [];

const Mat = defineComponent({
  props: { mat: { type: Object, required: true } },
  setup(props) {
    return () => {
      renders.set(props.mat.id, (renders.get(props.mat.id) ?? 0) + 1);
      return h('div', String(props.mat.attributes.score));
    };
  },
});

const Board = defineComponent({
  props: { gameView: { type: Object, default: null } },
  setup(props) {
    return () => {
      if (props.gameView) views.push(props.gameView as (typeof views)[number]);
      return h('div', (props.gameView?.children ?? []).map((mat: { id: number }) => h(Mat, { key: mat.id, mat })));
    };
  },
});

afterEach(() => leaveIframe());

describe('GameShell keeps the parts of a new state that did not change', () => {
  it('hands the board the same object for an unchanged part, so a component reading only it does not render again', async () => {
    enterIframe();
    const wrapper = mountPlatformShell({ board: Board });
    await nextTick();
    fromHost({ type: 'init', seat: 1 });
    fromHost(frame([3, 5]));
    await flushPromises();
    fromHost(frame([3, 6]));
    await flushPromises();

    const [first, second] = [views[0], views.at(-1)!];
    expect(second).not.toBe(first);
    expect(second.children[0]).toBe(first.children[0]);
    expect(second.children[1]).not.toBe(first.children[1]);
    expect(renders.get(1)).toBe(1);
    expect(renders.get(2)).toBe(2);
    expect(wrapper.text()).toContain('6');
    wrapper.unmount();
  });
});
