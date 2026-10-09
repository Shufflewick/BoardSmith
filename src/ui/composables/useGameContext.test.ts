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
import { defineComponent, h, ref, computed, provide } from 'vue';
import { mount } from '@vue/test-utils';
import * as ui from '../index.js';
import {
  useGameContext,
  usePlayContext,
  tryUseGameContext,
  gameContextProvisions,
  playContextProvisions,
  GAME_CONTEXT_KEYS,
  PLAY_CONTEXT_KEY_NAMES,
  type GameContext,
  type PlayContext,
} from './useGameContext.js';

function fakeContext(): GameContext {
  return {
    gameState: ref(null),
    dueSeats: computed(() => [1]),
    gameView: computed(() => ({ board: 'here' })),
    players: computed(() => [{ name: 'A', seat: 1 }]),
    myPlayer: computed(() => ({ name: 'A', seat: 1 })),
    playerSeat: ref(1),
    isMyTurn: ref(true),
    isViewingHistory: ref(false),
    availableActions: computed(() => ['move']),
    actionController: { marker: 'controller' } as never,
    timeTravelDiff: ref(null),
    platformRequest: async () => ({}),
    presentation: ref(undefined),
    debugHighlight: ref(null),
    turnDeadline: computed(() => null),
  };
}

/** A shell stand-in that publishes what `provisions` builds, then renders its slot. */
function providerOf(provisions: () => ReturnType<typeof gameContextProvisions>) {
  return defineComponent({
    setup(_, { slots }) {
      for (const [key, value] of provisions()) provide(key, value);
      return () => h('div', slots.default?.());
    },
  });
}

/** A table's shell stand-in: the whole context. */
const Provider = providerOf(() => gameContextProvisions(fakeContext()));

/** What `useGameContext()` hands a component mounted inside the Provider. */
function contextInsideProvider(): GameContext {
  let seen: GameContext | undefined;
  const Child = defineComponent({
    setup() {
      seen = useGameContext();
      return () => h('span');
    },
  });
  mount(Provider, { slots: { default: () => h(Child) } });
  if (!seen) throw new Error('the child inside the Provider never ran setup()');
  return seen;
}

describe('useGameContext inside a shell', () => {
  it('hands back every field the shell publishes', () => {
    const seen = contextInsideProvider();

    expect(Object.keys(seen).sort()).toEqual(Object.keys(GAME_CONTEXT_KEYS).sort());
    expect(seen.playerSeat.value).toBe(1);
    expect(seen.gameView.value).toEqual({ board: 'here' });
    expect(seen.availableActions.value).toEqual(['move']);
  });

  it('publishes every key the context type declares — none can be forgotten', () => {
    // gameContextProvisions derives its key list from GAME_CONTEXT_KEYS, so a new
    // field cannot be added to the context without also being published.
    const seen = contextInsideProvider();

    for (const key of Object.keys(GAME_CONTEXT_KEYS)) {
      expect(seen[key as keyof GameContext], key).toBeDefined();
    }
  });
});

/** A component that reads the whole context, as a table's board does. */
const ReadsTheContext = defineComponent({
  setup() {
    useGameContext();
    return () => h('span');
  },
});

describe('useGameContext outside a shell', () => {
  it('throws rather than handing back a bag of undefineds', () => {
    expect(() => mount(ReadsTheContext)).toThrow(/no GameShell above this component/);
  });

  it('names what was missing, so the cause is not a later .value read', () => {
    expect(() => mount(ReadsTheContext)).toThrow(/gameState/);
    expect(() => mount(ReadsTheContext)).toThrow(/actionController/);
  });

  it("says a test's context comes from the shell stubs, not from keys provided by hand (#453)", () => {
    expect(() => mount(ReadsTheContext)).toThrow(/renderAsSeat.*tableShellContext/s);
    expect(() => mount(ReadsTheContext)).not.toThrow(/provide the pieces it needs/);
  });
});

describe("useGameContext inside a world's shell (#453)", () => {
  /** What a world's shell publishes: the shared half, and none of a table's own keys. */
  const WorldProvider = providerOf(() => playContextProvisions(fakeContext()));

  it('says the component is in a world, which has no table context, and what to read instead', () => {
    expect(() => mount(WorldProvider, { slots: { default: () => h(ReadsTheContext) } })).toThrow(
      /inside a world's shell.*gameState, dueSeats, timeTravelDiff, turnDeadline.*usePlayContext\(\).*useWorld\(\)/s,
    );
  });
});

/** Mount `read` as a child of `parent` (or alone) and hand back what its setup returned. */
function readInside<T>(read: () => T, parent?: ReturnType<typeof providerOf>): T {
  let seen = { ran: false, value: undefined as T };
  const Child = defineComponent({
    setup() {
      seen = { ran: true, value: read() };
      return () => h('span');
    },
  });
  if (parent) mount(parent, { slots: { default: () => h(Child) } });
  else mount(Child);
  if (!seen.ran) throw new Error('the child never ran setup()');
  return seen.value;
}

describe('usePlayContext (#520)', () => {
  const WorldProvider = providerOf(() => playContextProvisions(fakeContext()));

  it("hands a component inside a world's shell every shared field, and nothing table-only", () => {
    const seen = readInside(usePlayContext, WorldProvider);

    expect(Object.keys(seen).sort()).toEqual([...PLAY_CONTEXT_KEY_NAMES].sort());
    expect(seen.playerSeat.value).toBe(1);
    expect(seen.isViewingHistory.value).toBe(false);
    expect(seen.actionController).toEqual({ marker: 'controller' });
  });

  it("hands a component inside a table's shell the same shared fields", () => {
    const seen: PlayContext = readInside(usePlayContext, Provider);

    expect(Object.keys(seen).sort()).toEqual([...PLAY_CONTEXT_KEY_NAMES].sort());
    expect(seen.availableActions.value).toEqual(['move']);
  });

  it('throws outside any shell, naming what was missing', () => {
    expect(() => readInside(usePlayContext)).toThrow(/usePlayContext\(\) found no shell above this component.*actionController/s);
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

  it("returns undefined inside a world's shell, rather than throwing (#520)", () => {
    const WorldProvider = providerOf(() => playContextProvisions(fakeContext()));
    expect(readInside(tryUseGameContext, WorldProvider)).toBeUndefined();
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

  it('is exported from the UI barrel, which is where a custom UI reaches it', () => {
    // Statically imported: see the note in `src/ui/utils/color.test.ts`
    // (ShufflewickPub #385). The barrel's transform is not this test's cost.
    expect(ui.useGameContext).toBeTypeOf('function');
    expect(ui.tryUseGameContext).toBeTypeOf('function');
    expect(ui.usePlayContext).toBeTypeOf('function');
    expect(ui.GAME_CONTEXT_KEYS).toBeDefined();
  });
});
