// @vitest-environment jsdom
/**
 * BOTH SHELLS RENDER A GAME'S PHONE UI AT THE COMPACT SIZE, AND HAND EVERY
 * BOARD THE LAYOUT SIZE (#1610).
 *
 * Driven on the real shells over a viewport the test sets: the phone UI shows
 * only below `BREAKPOINTS.compact`, a game without one shows its default at
 * every size, and the board's `formFactor` and `orientation` props follow a
 * resize or rotation.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import WorldShell from './world/WorldShell.vue';
import { WORLD_HOST_SOURCE } from './world/worldProtocol.js';
import { defineGameUIs, defaultUI, phoneUI, type GameUIRegistry } from './game-uis.js';
import { enterIframe, leaveIframe, mountPlatformShell } from './components/GameShell.platform-mount.test-helper.js';
import { fakeViewport } from './composables/fake-viewport.test-helper.js';

const layoutProps = { formFactor: { type: String, required: true }, orientation: { type: String, required: true } };
const Board = defineComponent({
  name: 'Board',
  props: layoutProps,
  setup: (props) => () => h('div', { class: 'board' }, `${props.formFactor} ${props.orientation}`),
});
const Phone = defineComponent({
  name: 'Phone',
  props: layoutProps,
  setup: (props) => () => h('div', { class: 'phone' }, `${props.formFactor} ${props.orientation}`),
});

const withPhone = () => defineGameUIs({ Board: defaultUI(Board), Pocket: phoneUI(Phone) });
const withoutPhone = () => defineGameUIs({ Board: defaultUI(Board) });

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

let viewport: ReturnType<typeof fakeViewport> | null = null;
afterEach(() => {
  viewport?.restore();
  viewport = null;
  leaveIframe();
  document.body.innerHTML = '';
});

async function table(uis: GameUIRegistry, size: { width: number; height: number }) {
  viewport = fakeViewport(size);
  enterIframe();
  const wrapper = mountPlatformShell({ uis });
  await flushPromises();
  return wrapper;
}

async function world(uis: GameUIRegistry, size: { width: number; height: number }) {
  viewport = fakeViewport(size);
  const wrapper = mount(WorldShell, { props: { uis, displayName: 'Gloamhall' } });
  (wrapper.vm as unknown as { host: { handleMessage(e: unknown): void } }).host.handleMessage({
    source: window.parent,
    origin: 'https://shufflewick.pub',
    data: {
      source: WORLD_HOST_SOURCE, type: 'world_state', phase: 'watching',
      view: { phase: 'watching', state: {} }, placeholders: [], seat: 1, revision: 1, notice: null,
    },
  });
  await flushPromises();
  return wrapper;
}

/** The one board drawn, by class, and what it was told about the layout. */
function drawn(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper.findAll('.board, .phone').map((board) => `${board.classes()[0]}: ${board.text()}`);
}

describe.each([['GameShell', table], ['WorldShell', world]] as const)('%s and the layout size (#1610)', (_shell, open) => {
  it('renders the phone UI at 390x844 and the default at 1440x900', async () => {
    const phone = await open(withPhone(), PHONE);
    expect(drawn(phone)).toEqual(['phone: compact portrait']);
    phone.unmount();
    viewport!.restore();

    const desktop = await open(withPhone(), DESKTOP);
    expect(drawn(desktop)).toEqual(['board: wide landscape']);
    desktop.unmount();
  });

  it('renders the default at both sizes for a game without a phone UI', async () => {
    const phone = await open(withoutPhone(), PHONE);
    expect(drawn(phone)).toEqual(['board: compact portrait']);
    phone.unmount();
    viewport!.restore();

    const desktop = await open(withoutPhone(), DESKTOP);
    expect(drawn(desktop)).toEqual(['board: wide landscape']);
    desktop.unmount();
  });

  it('updates the board on rotation and resize, swapping to the default once past compact', async () => {
    const wrapper = await open(withPhone(), PHONE);
    viewport!.resize({ width: 844, height: 390 });
    await nextTick();
    expect(drawn(wrapper)).toEqual(['board: medium landscape']);
    viewport!.resize({ width: 600, height: 900 });
    await nextTick();
    expect(drawn(wrapper)).toEqual(['phone: compact portrait']);
    wrapper.unmount();
    expect(viewport!.listening()).toBe(0);
  });
});
