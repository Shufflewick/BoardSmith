// @vitest-environment jsdom
/**
 * The inject* helpers are gone (#512).
 *
 * injectActionController() looked for a string key that no shell provides, so it
 * threw inside a GameShell. injectPickStepFn() read a key nothing provides, and
 * injectBoardInteraction() was an alias for useBoardInteraction(). The way in is
 * usePlayContext().actionController (both shells) or useBoardInteraction().
 */
import { describe, it, expect } from 'vitest';
import { defineComponent, h, provide, computed, ref } from 'vue';
import { mount } from '@vue/test-utils';
import * as ui from './index.js';
import { useBoardInteraction } from './composables/useBoardInteraction.js';
import { gameContextProvisions, playContextProvisions, usePlayContext, type GameContext } from './composables/useGameContext.js';

describe('boardsmith/ui exports', () => {
  it.each(['injectActionController', 'injectPickStepFn', 'injectBoardInteraction', 'ACTION_CONTROLLER_KEY'])(
    'no longer exports %s',
    (name) => {
      expect(name in ui).toBe(false);
    },
  );
});

describe('the documented way to reach the action controller', () => {
  const controller = { marker: 'controller' } as never;
  const context: GameContext = {
    gameState: ref(null),
    dueSeats: computed(() => [1]),
    gameView: computed(() => ({})),
    players: computed(() => []),
    myPlayer: computed(() => undefined),
    playerSeat: ref(1),
    isMyTurn: ref(true),
    isViewingHistory: ref(false),
    availableActions: computed(() => []),
    actionController: controller,
    timeTravelDiff: ref(null),
    platformRequest: async () => ({}),
    presentation: ref(undefined),
    debugHighlight: ref(null),
    turnDeadline: computed(() => null),
  } as unknown as GameContext;

  for (const [shell, provisions] of [
    ["a table's shell", gameContextProvisions],
    ["a world's shell", playContextProvisions],
  ] as const) {
    it(`usePlayContext().actionController is the shell's controller inside ${shell}`, () => {
      let seen: unknown;
      const Child = defineComponent({
        setup() {
          seen = usePlayContext().actionController;
          return () => h('span');
        },
      });
      const Shell = defineComponent({
        setup(_, { slots }) {
          for (const [key, value] of provisions(context)) provide(key, value);
          return () => h('div', slots.default?.());
        },
      });
      mount(Shell, { slots: { default: () => h(Child) } });
      expect(seen).toBe(controller);
    });
  }
});

describe('useBoardInteraction outside a shell', () => {
  it('throws an actionable error instead of returning undefined', () => {
    const Child = defineComponent({
      setup() {
        useBoardInteraction();
        return () => h('span');
      },
    });
    expect(() => mount(Child)).toThrow(/must be called inside a <GameShell>/);
  });
});
