// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import WorldShell from './WorldShell.vue';
import { useWorld, type WorldContext } from './useWorld.js';
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
    actions: { type: Array, required: true },
    acting: { type: Boolean, required: true },
    worldName: { type: null, required: true },
    presence: { type: null, required: true },
    events: { type: Array, required: true },
  },
  emits: ['act'],
  setup(props, { emit }) {
    return () =>
      h('div', { class: 'rooms' }, [
        h('p', { class: 'seat' }, String(props.seat)),
        h(
          'p',
          { class: 'narration' },
          props.events.map((event: any) => `${event.scope}:${JSON.stringify(event.payload)}`).join('|'),
        ),
        h('p', { class: 'awake' }, ((props.presence as number[] | null) ?? []).join(',')),
        h('p', { class: 'title' }, String(props.worldName)),
        h('p', { class: 'verbs' }, props.actions.map((a: any) => a.name).join(',')),
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
    actions: [{ name: 'look', selections: [] }, { name: 'move', selections: [] }],
    notice: null,
    worldName: 'Gloamhall Rooms',
    presence: [2, 4],
    ...over,
  };
}

function tell(wrapper: ReturnType<typeof mount>, data: unknown) {
  (wrapper.vm as any).host.handleMessage({ origin: 'https://shufflewick.pub', data });
}

/**
 * A shell whose UI is a component NESTED inside another, reading the world
 * through `useWorld()` rather than through its props.
 *
 * The nesting is the point: `provide` reaches any depth, which is what saves a
 * world UI from threading `view` and `act` through every component it is made
 * of. `read` is what the nested component prints, so each case asserts on one
 * class name and one value.
 */
function mountNested(className: string, read: (world: WorldContext) => string) {
  const Nested = defineComponent({
    setup() {
      const world = useWorld();
      return () => h('span', { class: className }, read(world));
    },
  });
  const Outer = defineComponent({ setup: () => () => h('div', [h(Nested)]) });
  return mount(WorldShell, { props: { ui: Outer, displayName: 'Gloamhall' } });
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
    expect(wrapper.find('.awake').text()).toBe('2,4');
    wrapper.unmount();
  });

  it('hands presence to a nested component through useWorld()', async () => {
    const wrapper = mountNested('nested-awake', (world) => (world.presence.value ?? []).join(','));
    tell(wrapper, stateFrame());
    await nextTick();
    expect(wrapper.find('.nested-awake').text()).toBe('2,4');
    wrapper.unmount();
  });

  it('sends an action the game\'s UI emitted', async () => {
    const posted: any[] = [];
    const spy = vi.spyOn(window.parent, 'postMessage').mockImplementation((m) => posted.push(m));
    const wrapper = mount(WorldShell, { props: { ui: Rooms, displayName: 'Gloamhall' } });
    tell(wrapper, stateFrame());
    await nextTick();
    await wrapper.find('.go').trigger('click');
    const command = posted.find((m) => m.type === 'world_command');
    expect(command).toMatchObject({ source: WORLD_UI_SOURCE, action: 'move', args: { to: 'cellar' } });
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
    const wrapper = mountNested('nested-seat', (world) => String(world.seat.value));
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

/**
 * ShufflewickPub #331: A WORLD'S NARRATION REACHES THE GAME'S OWN UI.
 *
 * The shell is what turns the wire into props, and until #331 there was no
 * wire to turn: the platform routed every event to the seats that could see
 * it and the host page dropped the payloads. A game could not draw a line of
 * chat, an emote or a blow landing without writing it into its own stored
 * state first.
 */
describe('WorldShell — narration (#331)', () => {
  function narrate(wrapper: ReturnType<typeof mount>, events: unknown[]) {
    tell(wrapper, { source: WORLD_HOST_SOURCE, type: 'world_events', events });
  }

  it('hands the log to the game\'s UI as a prop, oldest first', async () => {
    const wrapper = mount(WorldShell, { props: { ui: Rooms, displayName: 'Gloamhall' } });
    tell(wrapper, stateFrame());
    narrate(wrapper, [{ scope: 'room:hall', payload: { said: 'hello' } }]);
    narrate(wrapper, [{ scope: 'world', payload: { dawn: true } }]);
    await nextTick();

    expect(wrapper.find('.narration').text()).toBe(
      'room:hall:{"said":"hello"}|world:{"dawn":true}',
    );
    wrapper.unmount();
  });

  it('hands it to a nested component through useWorld() as well', async () => {
    const wrapper = mountNested('nested-narration', (world) =>
      world.events.value.map((event) => event.scope).join(','),
    );
    tell(wrapper, stateFrame());
    narrate(wrapper, [
      { scope: 'room:hall', payload: {} },
      { scope: 'world', payload: {} },
    ]);
    await nextTick();

    expect(wrapper.find('.nested-narration').text()).toBe('room:hall,world');
    wrapper.unmount();
  });

  it('does not draw a board on narration alone, because narration is not a view', async () => {
    // A frame that has only been narrated at has been told nothing about what
    // the world IS. Drawing the game's UI over a null view would put an empty
    // room on screen for a world that simply has not answered yet.
    const wrapper = mount(WorldShell, { props: { ui: Rooms, displayName: 'Gloamhall' } });
    narrate(wrapper, [{ scope: 'world', payload: { dawn: true } }]);
    await nextTick();

    expect(wrapper.find('.rooms').exists()).toBe(false);
    expect(wrapper.text()).toContain('Looking around');
    wrapper.unmount();
  });
});
