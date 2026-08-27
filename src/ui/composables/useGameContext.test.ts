// @vitest-environment jsdom
/**
 * The game context is typed, and says so when it is missing (#39).
 *
 * GameShell used to publish twelve values under bare string keys while the
 * library's own composables used typed InjectionKey symbols. Every consumer had
 * to cast — the shell's own overlays did — and a game author who typed
 * `inject('gameview')` got `undefined` with no error and no type help.
 */
import { describe, it, expect } from 'vitest';
import { defineComponent, h, ref, computed } from 'vue';
import { mount } from '@vue/test-utils';
import {
  useGameContext,
  tryUseGameContext,
  provideGameContext,
  GAME_CONTEXT_KEYS,
  type GameContext,
} from './useGameContext.js';

function fakeContext(): GameContext {
  return {
    gameState: ref(null),
    gameView: computed(() => ({ board: 'here' })),
    players: computed(() => [{ name: 'A', seat: 1 }]),
    myPlayer: computed(() => ({ name: 'A', seat: 1 })),
    playerSeat: ref(1),
    isMyTurn: ref(true),
    availableActions: computed(() => ['move']),
    actionController: { marker: 'controller' } as never,
    timeTravelDiff: ref(null),
    platformRequest: async () => ({}),
    presentation: ref(undefined),
    debugHighlight: ref(null),
  };
}

/** A shell stand-in that publishes the context, then renders its slot. */
const Provider = defineComponent({
  setup(_, { slots }) {
    provideGameContext(fakeContext());
    return () => h('div', slots.default?.());
  },
});

describe('useGameContext inside a shell', () => {
  it('hands back every field the shell publishes', () => {
    let seen: GameContext | undefined;
    const Child = defineComponent({
      setup() {
        seen = useGameContext();
        return () => h('span');
      },
    });
    mount(Provider, { slots: { default: () => h(Child) } });

    expect(Object.keys(seen!).sort()).toEqual(Object.keys(GAME_CONTEXT_KEYS).sort());
    expect(seen!.playerSeat.value).toBe(1);
    expect(seen!.gameView.value).toEqual({ board: 'here' });
    expect(seen!.availableActions.value).toEqual(['move']);
  });

  it('publishes every key the context type declares — none can be forgotten', () => {
    // provideGameContext derives its key list from GAME_CONTEXT_KEYS, so a new
    // field cannot be added to the context without also being published.
    let seen: GameContext | undefined;
    const Child = defineComponent({
      setup() {
        seen = useGameContext();
        return () => h('span');
      },
    });
    mount(Provider, { slots: { default: () => h(Child) } });

    for (const key of Object.keys(GAME_CONTEXT_KEYS)) {
      expect(seen![key as keyof GameContext], key).toBeDefined();
    }
  });
});

describe('useGameContext outside a shell', () => {
  it('throws rather than handing back a bag of undefineds', () => {
    const Orphan = defineComponent({
      setup() {
        useGameContext();
        return () => h('span');
      },
    });
    expect(() => mount(Orphan)).toThrow(/no GameShell above this component/);
  });

  it('names what was missing, so the cause is not a later .value read', () => {
    const Orphan = defineComponent({
      setup() {
        useGameContext();
        return () => h('span');
      },
    });
    expect(() => mount(Orphan)).toThrow(/gameState/);
    expect(() => mount(Orphan)).toThrow(/actionController/);
  });
});

describe('tryUseGameContext', () => {
  it('returns the context inside a shell', () => {
    let seen: GameContext | undefined | null = null;
    const Child = defineComponent({
      setup() {
        seen = tryUseGameContext();
        return () => h('span');
      },
    });
    mount(Provider, { slots: { default: () => h(Child) } });
    expect(seen).toBeDefined();
  });

  it('returns undefined outside one, for a component that renders both ways', () => {
    let seen: GameContext | undefined | null = null;
    const Child = defineComponent({
      setup() {
        seen = tryUseGameContext();
        return () => h('span');
      },
    });
    mount(Child);
    expect(seen).toBeUndefined();
  });
});

describe('the keys themselves', () => {
  it('are symbols, so a string key cannot collide with them', () => {
    for (const key of Object.values(GAME_CONTEXT_KEYS)) {
      expect(typeof key).toBe('symbol');
    }
  });

  it('is exported from the UI barrel, which is where a custom UI reaches it', async () => {
    const ui = await import('../index.js');
    expect(ui.useGameContext).toBeTypeOf('function');
    expect(ui.tryUseGameContext).toBeTypeOf('function');
    expect(ui.GAME_CONTEXT_KEYS).toBeDefined();
  });
});
