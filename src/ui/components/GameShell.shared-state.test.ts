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
import { diffPushedView, stampRev } from '../../session/view-patch.js';

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

// #1629: a host page relays the patch the socket carried, not the whole view it rebuilt.
describe('GameShell applies a posted view patch', () => {
  const view = (scores: [number, number]) => stampRev((frame(scores) as { view: unknown }).view);
  const patchFrame = (from: ReturnType<typeof view>, to: ReturnType<typeof view>) => ({
    type: 'game_state',
    patch: { base: from.rev, ops: diffPushedView(from, to) },
    winners: [],
  });

  it('applies each patch to the view it holds, keeping the parts that did not change', async () => {
    enterIframe();
    const wrapper = mountPlatformShell({ board: Board });
    await nextTick();
    const [v1, v2, v3] = [view([3, 5]), view([3, 6]), view([4, 6])];
    fromHost({ type: 'init', seat: 1 });
    fromHost({ type: 'game_state', view: v1, winners: [] });
    await flushPromises();
    const first = views.at(-1)!;
    fromHost(patchFrame(v1, v2));
    await flushPromises();
    const second = views.at(-1)!;
    expect(second.children[0]).toBe(first.children[0]);
    expect(wrapper.text()).toContain('6');
    fromHost(patchFrame(v2, v3));
    await flushPromises();
    expect(views.at(-1)!.children[1]).toBe(second.children[1]);
    expect(wrapper.text()).toContain('4');
    wrapper.unmount();
  });

  it('asks the host for the whole view when the patch is against a view it does not hold', async () => {
    const posted = enterIframe();
    const wrapper = mountPlatformShell({ board: Board });
    await nextTick();
    const [v1, v2, v3] = [view([3, 5]), view([3, 6]), view([9, 9])];
    fromHost({ type: 'init', seat: 1 });
    fromHost({ type: 'game_state', view: v1, winners: [] });
    await flushPromises();
    posted.length = 0;
    fromHost(patchFrame(v2, v3));
    await flushPromises();
    expect(posted).toEqual([{ source: 'shufflewick-game', type: 'request-state' }]);
    expect(wrapper.text()).not.toContain('9');
    fromHost({ type: 'game_state', view: v3, winners: [] });
    await flushPromises();
    expect(wrapper.text()).toContain('9');
    wrapper.unmount();
  });

  it('asks the host for the whole view when a patch on the right base cannot be applied', async () => {
    const posted = enterIframe();
    const wrapper = mountPlatformShell({ board: Board });
    await nextTick();
    const v1 = view([3, 5]);
    fromHost({ type: 'init', seat: 1 });
    fromHost({ type: 'game_state', view: v1, winners: [] });
    await flushPromises();
    posted.length = 0;
    fromHost({ type: 'game_state', patch: { base: v1.rev, ops: [['set', ['state', 'view', 'children', 0, 'attributes', 'score', 'x'], 1]] }, winners: [] });
    await flushPromises();
    expect(posted).toEqual([{ source: 'shufflewick-game', type: 'request-state' }]);
    wrapper.unmount();
  });

  it('refuses a change in place to the view it holds, so the base a patch applies to is the view its rev names', async () => {
    enterIframe();
    const wrapper = mountPlatformShell({ board: Board });
    await nextTick();
    const [v1, v2] = [view([3, 5]), view([3, 6])];
    fromHost({ type: 'init', seat: 1 });
    fromHost({ type: 'game_state', view: v1, winners: [] });
    await flushPromises();
    expect(() => ((views.at(-1)!.children[1] as { attributes: { score: number } }).attributes.score = 99)).toThrow(TypeError);
    fromHost(patchFrame(v1, v2));
    await flushPromises();
    expect(() => ((views.at(-1)!.children[1] as { attributes: { score: number } }).attributes.score = 99)).toThrow(TypeError);
    expect(() => views.at(-1)!.children.push({ id: 3 })).toThrow(TypeError);
    wrapper.unmount();
  });
});
