// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import WorldShell from './WorldShell.vue';
import { useWorld, type WorldContext } from './useWorld.js';
import { WORLD_HOST_SOURCE, WORLD_UI_SOURCE } from './worldProtocol.js';
import { defineGameUIs, defaultUI } from '../game-uis.js';
import { useToast } from '../composables/useToast.js';

/**
 * THE SHELL A BUNDLE MOUNTS FOR A RESIDENT WORLD (ShufflewickPub #128).
 *
 * What is proved here is the three states a game must never have to write --
 * a silent host, a refusal, a dropped connection -- and that everything else
 * is the game's own UI with the world in its props.
 */

/**
 * A world BOARD that renders what it was handed, so the props are visible in
 * the markup rather than asserted against the component's internals.
 *
 * Since #170 a world board is reached through the registry, exactly as a
 * table's is, and it declares the SHARED board-area props rather than the
 * hand-rolled prop bag `WorldShell` used to pass. Everything it used to draw
 * for itself -- the world's name, the seat, presence, the log, the refusal --
 * is the shell's now, which is the whole point of the ticket. What it still
 * gets are the world-only props no table has.
 */
const Rooms = defineComponent({
  props: {
    gameView: { type: null, required: true },
    playerSeat: { type: Number, required: true },
    availableActions: { type: Array, required: true },
    worldName: { type: null, required: true },
    presence: { type: null, required: true },
    events: { type: Array, required: true },
    phase: { type: String, required: true },
  },
  setup(props) {
    const world = useWorld();
    return () =>
      h('div', { class: 'rooms' }, [
        h('p', { class: 'seat' }, String(props.playerSeat)),
        h(
          'p',
          { class: 'narration' },
          props.events.map((event: any) => `${event.scope}:${JSON.stringify(event.payload)}`).join('|'),
        ),
        h('p', { class: 'awake' }, ((props.presence as number[] | null) ?? []).join(',')),
        h('p', { class: 'title' }, String(props.worldName)),
        h('p', { class: 'verbs' }, (props.availableActions as string[]).join(',')),
        h('p', { class: 'said' }, String((props.gameView as any)?.said ?? '')),
        h('button', { class: 'go', onClick: () => void world.act('move', { to: 'cellar' }) }, 'go'),
      ]);
  },
});

const ROOMS_REGISTRY = defineGameUIs({ Rooms: defaultUI(Rooms) });

/** Mount the shell over the registry, the way a bundle's `world.html` does. */
function mountShell() {
  return mount(WorldShell, { props: { uis: ROOMS_REGISTRY, displayName: 'Gloamhall' } });
}

function stateFrame(over: Record<string, unknown> = {}) {
  return {
    source: WORLD_HOST_SOURCE,
    type: 'world_state',
    phase: 'watching',
    // `viewFor` returns `{player, state, phase}` and `state` is the serialized
    // element tree -- the SAME call a table's `PlayerState.view` carries, which
    // is what lets AutoUI be a world's default board.
    view: { player: 4, phase: 'watching', state: { said: 'the fire is low' } },
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
  return mount(WorldShell, {
    props: { uis: defineGameUIs({ Outer: defaultUI(Outer) }), displayName: 'Gloamhall' },
  });
}

describe('WorldShell', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('says hello to the host on mount so a quiet world still draws', () => {
    const posted: unknown[] = [];
    const spy = vi.spyOn(window.parent, 'postMessage').mockImplementation((m) => posted.push(m));
    const wrapper = mountShell();
    expect(posted).toContainEqual({ source: WORLD_UI_SOURCE, type: 'world_ready' });
    spy.mockRestore();
    wrapper.unmount();
  });

  it('renders the game\'s own UI with the world in its props', async () => {
    const wrapper = mountShell();
    tell(wrapper, stateFrame());
    await nextTick();
    expect(wrapper.find('.rooms').exists()).toBe(true);
    expect(wrapper.find('.seat').text()).toBe('4');
    expect(wrapper.find('.title').text()).toBe('Gloamhall Rooms');
    expect(wrapper.find('.verbs').text()).toBe('look,move');
    // The world's name, the seat list and the log are the SHELL's now — the
    // board no longer has to draw any of them, and no longer can lose them.
    expect(wrapper.find('[data-testid="bs-seats"]').text()).toContain('Seat 4');
    expect(wrapper.find('[data-testid="bs-actionbar"]').exists()).toBe(true);
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
    const wrapper = mountShell();
    tell(wrapper, stateFrame());
    await nextTick();
    await wrapper.find('.go').trigger('click');
    const command = posted.find((m) => m.type === 'world_command');
    expect(command).toMatchObject({ source: WORLD_UI_SOURCE, action: 'move', args: { to: 'cellar' } });
    spy.mockRestore();
    wrapper.unmount();
  });

  it('shows the refusal the host worded, and no board', async () => {
    const wrapper = mountShell();
    tell(wrapper, stateFrame({ phase: 'refused', view: null, notice: 'You are not a member of this world.' }));
    await nextTick();
    expect(wrapper.text()).toContain('You are not a member of this world.');
    expect(wrapper.find('.rooms').exists()).toBe(false);
    wrapper.unmount();
  });

  it('keeps the last view on screen when the connection drops, and says so', async () => {
    const wrapper = mountShell();
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
    const wrapper = mountShell();
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
    const wrapper = mountShell();
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
    const wrapper = mountShell();
    narrate(wrapper, [{ scope: 'world', payload: { dawn: true } }]);
    await nextTick();

    expect(wrapper.find('.rooms').exists()).toBe(false);
    expect(wrapper.text()).toContain('Looking around');
    wrapper.unmount();
  });
});

/**
 * #170: A WORLD GETS THE TABLE'S CHROME, AND THE GAME SUPPLIES THE BOARD.
 *
 * Four bundles were each hand-writing the same masthead, the same refusal line
 * and the same "waiting for your projection" panel against an untyped prop bag
 * that did not even match. These are the surfaces they no longer have to.
 */
describe('WorldShell — the shared chrome (#170)', () => {
  it('draws the seat list, the log and the action bar the table draws', async () => {
    const wrapper = mountShell();
    tell(wrapper, stateFrame());
    await nextTick();
    expect(wrapper.find('[data-testid="bs-seats"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="bs-log"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="bs-action-panel"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('offers the seat its enumerated actions in the shared panel', async () => {
    const wrapper = mountShell();
    tell(wrapper, stateFrame());
    await nextTick();
    expect(wrapper.find('[data-testid="bs-action-panel"]').text().toLowerCase()).toContain('look');
    wrapper.unmount();
  });

  it('names the seats when the host says who they are, and numbers them when it does not', async () => {
    const numbered = mountShell();
    tell(numbered, stateFrame());
    await nextTick();
    expect(numbered.find('[data-testid="bs-seats"]').text()).toContain('Seat 4');
    numbered.unmount();

    const named = mountShell();
    tell(named, stateFrame({ players: [{ seat: 4, name: 'Ivy' }, { seat: 2, name: 'Rook' }] } as never));
    await nextTick();
    expect(named.find('[data-testid="bs-seats"]').text()).toContain('Ivy');
    named.unmount();
  });

  it('marks who is here on the seat rows rather than in a list of its own', async () => {
    const wrapper = mountShell();
    tell(wrapper, stateFrame({ players: [{ seat: 2, name: 'Rook' }, { seat: 4, name: 'Ivy' }] } as never));
    await nextTick();
    // presence is [2, 4]: both here.
    expect(wrapper.findAll('[data-testid="bs-seats"] .conn-status.is-online').length).toBe(2);
    wrapper.unmount();
  });

  it('puts a narration line in the log ONLY when the game wrote one', async () => {
    const wrapper = mountShell();
    tell(wrapper, stateFrame());
    tell(wrapper, {
      source: WORLD_HOST_SOURCE,
      type: 'world_events',
      events: [
        { scope: 'room:hall', payload: { said: 'hello' } },
        { scope: 'room:hall', payload: { said: 'hello' }, text: 'Rook says hello.' },
      ],
    });
    await nextTick();
    const log = wrapper.find('[data-testid="bs-log"]').text();
    expect(log).toContain('Rook says hello.');
    expect(log).not.toContain('{');
    wrapper.unmount();
  });

  it('says what an empty world log means, which is not what an empty table log means', async () => {
    const wrapper = mountShell();
    tell(wrapper, stateFrame());
    await nextTick();
    expect(wrapper.find('[data-testid="bs-log"]').text()).toContain('since you arrived');
    wrapper.unmount();
  });

  it('greys an offered-but-refused action with its reason rather than hiding it', async () => {
    const wrapper = mountShell();
    tell(wrapper, stateFrame({
      actions: [{ name: 'look', selections: [] }, { name: 'move', selections: [], disabled: 'the door is barred' }],
    }));
    await nextTick();
    expect(wrapper.find('[data-testid="bs-action-panel"]').html()).toContain('the door is barred');
    wrapper.unmount();
  });

  /**
   * PRESS SOMETHING, HAVE THE WORLD REFUSE IT, AND ANSWER WHAT THE PLAYER WAS
   * TOLD.
   *
   * One helper for both roads into a refusal because the two tests below differ
   * only in WHICH CONTROL is pressed -- everything after the press is the same
   * frame answered the same way, and writing it twice would let one copy drift
   * into proving something the other does not.
   */
  async function refusedAfter(
    press: (wrapper: ReturnType<typeof mountShell>) => Promise<void>,
    sentence: string,
  ): Promise<{ messages: unknown[]; types: unknown[] }> {
    const posted: any[] = [];
    const spy = vi.spyOn(window.parent, 'postMessage').mockImplementation((m) => posted.push(m));
    const { toasts } = useToast();
    const before = toasts.value.length;
    const wrapper = mountShell();
    tell(wrapper, stateFrame());
    await nextTick();

    await press(wrapper);
    await nextTick();

    const command = posted.find((m) => m.type === 'world_command');
    expect(command, 'pressing it sends the world a command').toBeTruthy();
    // The host answers the request that press just sent.
    tell(wrapper, {
      source: WORLD_HOST_SOURCE,
      type: 'world_response',
      requestId: command.requestId,
      ok: false,
      message: sentence,
    });
    // A panel submit is several awaits deep in the controller before the
    // refusal lands, so drain the queue rather than counting ticks.
    await flushPromises();

    const said = toasts.value.slice(before);
    spy.mockRestore();
    wrapper.unmount();
    return { messages: said.map((t) => t.message), types: said.map((t) => t.type) };
  }

  it('speaks a post-hoc refusal through the toast a table refuses through', async () => {
    const said = await refusedAfter(
      // The board's own control, which EMITS through `useWorld().act()`.
      async (wrapper) => void (await wrapper.find('.go').trigger('click')),
      'Your holding is bare.',
    );
    expect(said.messages).toContain('Your holding is bare.');
    expect(said.types).toContain('error');
  });

  /**
   * THE OTHER HALF OF #169.
   *
   * #169 fixed the board that EMITS: `useWorld().act()` used to drop its
   * outcome on the floor. But a world with no board of its own -- the supported
   * shape since #170/#181 -- never calls `act()` at all. Its player presses the
   * SHARED ACTION PANEL, which goes through `useActionController`, and a refusal
   * there set `lastError` and bumped `errorTick` with nobody in this shell
   * watching. So on the generic board a refused command was invisible in the
   * DOM: ShufflewickPub's e2e had to read the refusal off the `world_response`
   * frame because the page never said it (its docs/E2E-TESTING.md notes this as
   * a real gap upstream).
   */
  it('speaks a refusal of an action taken through the shared panel, which is all a generic board has', async () => {
    const said = await refusedAfter(async (wrapper) => {
      const look = wrapper
        .findAll('[data-testid="bs-action-panel"] button')
        .find((button) => button.text().toLowerCase().includes('look'));
      expect(look, "the shared panel offers the world's enumerated action").toBeTruthy();
      await look!.trigger('click');
    }, 'It is too dark to see anything.');
    expect(said.messages).toContain('It is too dark to see anything.');
    expect(said.types).toContain('error');
  });

  it('names the fix rather than rendering blank when the registry resolves to nothing', async () => {
    const wrapper = mount(WorldShell, {
      props: {
        uis: { names: ['Broken'], defaultName: 'Broken', entries: { Broken: { component: null, devOnly: false } } },
        displayName: 'Gloamhall',
      },
    });
    tell(wrapper, stateFrame());
    await nextTick();
    expect(wrapper.text()).toContain('defaultUI()');
    wrapper.unmount();
  });
});

/**
 * The shared chrome is drawn in `--bsg-*` tokens, and something has to emit
 * them. `GameShell` calls `applyTheme()` on mount; before #170 a world shell had
 * no chrome of its own so it never needed to, and the first browser pass over a
 * world showed exactly that: a seat list, a log and an action bar with no
 * surface, no lines and no colour, because every token resolved to nothing.
 */
describe('WorldShell — the chrome has tokens to be drawn in', () => {
  it('emits the theme on mount, as the table shell does', async () => {
    document.getElementById('bsg-tokens')?.remove();
    const wrapper = mountShell();
    await nextTick();
    const style = document.getElementById('bsg-tokens');
    expect(style, 'no --bsg-* tokens: the shared chrome would render unstyled').not.toBeNull();
    expect(style!.textContent).toContain('--bsg-bg');
    wrapper.unmount();
  });
});
