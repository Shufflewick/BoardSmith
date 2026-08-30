// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import WorldShell from './WorldShell.vue';
import { useWorld } from './useWorld.js';
import { WORLD_HOST_SOURCE, WORLD_UI_SOURCE } from './worldProtocol.js';

/**
 * THE SHELL A BUNDLE MOUNTS FOR A RESIDENT WORLD (ShufflewickPub #128).
 *
 * What is proved here is the three states a game must never have to write --
 * a silent host, a refusal, a dropped connection -- and that everything else
 * is the game's own UI with the world in its props.
 */

/** A world UI that renders what it was handed, so the props are visible in the
 *  markup rather than asserted against the component's internals. */
const Rooms = defineComponent({
  props: {
    view: { type: null, required: true },
    seat: { type: null, required: true },
    commands: { type: Array, required: true },
    acting: { type: Boolean, required: true },
    worldName: { type: null, required: true },
  },
  emits: ['act'],
  setup(props, { emit }) {
    return () =>
      h('div', { class: 'rooms' }, [
        h('p', { class: 'seat' }, String(props.seat)),
        h('p', { class: 'title' }, String(props.worldName)),
        h('p', { class: 'verbs' }, props.commands.map((c: any) => c.name).join(',')),
        h('p', { class: 'said' }, String((props.view as any)?.said ?? '')),
        h('button', { class: 'go', onClick: () => emit('act', 'move', { to: 'cellar' }) }, 'go'),
      ]);
  },
});

function stateFrame(over: Record<string, unknown> = {}) {
  return {
    source: WORLD_HOST_SOURCE,
    type: 'world_state',
    phase: 'watching',
    view: { said: 'the fire is low' },
    seat: 4,
    commands: [{ name: 'look', args: [] }, { name: 'move', args: [] }],
    notice: null,
    worldName: 'Gloamhall Rooms',
    ...over,
  };
}

function tell(wrapper: ReturnType<typeof mount>, data: unknown) {
  (wrapper.vm as any).host.handleMessage({ origin: 'https://shufflewick.pub', data });
}

describe('WorldShell', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('says hello to the host on mount so a quiet world still draws', () => {
    const posted: unknown[] = [];
    const spy = vi.spyOn(window.parent, 'postMessage').mockImplementation((m) => posted.push(m));
    const wrapper = mount(WorldShell, { props: { ui: Rooms, displayName: 'Gloamhall' } });
    expect(posted).toContainEqual({ source: WORLD_UI_SOURCE, type: 'world_ready' });
    spy.mockRestore();
    wrapper.unmount();
  });

  it('renders the game\'s own UI with the world in its props', async () => {
    const wrapper = mount(WorldShell, { props: { ui: Rooms, displayName: 'Gloamhall' } });
    tell(wrapper, stateFrame());
    await nextTick();
    expect(wrapper.find('.rooms').exists()).toBe(true);
    expect(wrapper.find('.seat').text()).toBe('4');
    expect(wrapper.find('.title').text()).toBe('Gloamhall Rooms');
    expect(wrapper.find('.verbs').text()).toBe('look,move');
    expect(wrapper.find('.said').text()).toBe('the fire is low');
    wrapper.unmount();
  });

  it('sends a command the game\'s UI emitted', async () => {
    const posted: any[] = [];
    const spy = vi.spyOn(window.parent, 'postMessage').mockImplementation((m) => posted.push(m));
    const wrapper = mount(WorldShell, { props: { ui: Rooms, displayName: 'Gloamhall' } });
    tell(wrapper, stateFrame());
    await nextTick();
    await wrapper.find('.go').trigger('click');
    const command = posted.find((m) => m.type === 'world_command');
    expect(command).toMatchObject({ source: WORLD_UI_SOURCE, command: 'move', args: { to: 'cellar' } });
    spy.mockRestore();
    wrapper.unmount();
  });

  it('shows the refusal the host worded, and no board', async () => {
    const wrapper = mount(WorldShell, { props: { ui: Rooms, displayName: 'Gloamhall' } });
    tell(wrapper, stateFrame({ phase: 'refused', view: null, notice: 'You are not a member of this world.' }));
    await nextTick();
    expect(wrapper.text()).toContain('You are not a member of this world.');
    expect(wrapper.find('.rooms').exists()).toBe(false);
    wrapper.unmount();
  });

  it('keeps the last view on screen when the connection drops, and says so', async () => {
    const wrapper = mount(WorldShell, { props: { ui: Rooms, displayName: 'Gloamhall' } });
    tell(wrapper, stateFrame());
    await nextTick();
    tell(wrapper, stateFrame({ phase: 'lost', notice: 'The connection dropped.' }));
    await nextTick();
    expect(wrapper.text()).toContain('The connection dropped.');
    expect(wrapper.find('.said').text()).toBe('the fire is low');
    wrapper.unmount();
  });

  it('says so when the host never speaks, rather than showing an empty world', async () => {
    vi.useFakeTimers();
    const wrapper = mount(WorldShell, { props: { ui: Rooms, displayName: 'Gloamhall' } });
    vi.advanceTimersByTime(20_000);
    await nextTick();
    expect(wrapper.text()).toContain('has not sent it any state');
    expect(wrapper.find('.rooms').exists()).toBe(false);
    wrapper.unmount();
  });

  it('hands the same world to a nested component through useWorld()', async () => {
    const Nested = defineComponent({
      setup() {
        const world = useWorld();
        return () => h('span', { class: 'nested-seat' }, String(world.seat.value));
      },
    });
    const Outer = defineComponent({
      setup: () => () => h('div', [h(Nested)]),
    });
    const wrapper = mount(WorldShell, { props: { ui: Outer, displayName: 'Gloamhall' } });
    tell(wrapper, stateFrame());
    await nextTick();
    expect(wrapper.find('.nested-seat').text()).toBe('4');
    wrapper.unmount();
  });

  it('refuses to be used outside a shell rather than answering an empty world', () => {
    const Loose = defineComponent({
      setup() {
        useWorld();
        return () => h('div');
      },
    });
    expect(() => mount(Loose)).toThrow(/outside a WorldShell/);
  });
});
