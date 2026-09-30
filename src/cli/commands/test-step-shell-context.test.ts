/**
 * The reader behind test-step-check's hand-built shell context finding (#453): a test that
 * provides, by hand, a key only one shell provides.
 */
import { describe, it, expect } from 'vitest';
import { GAME_CONTEXT_KEYS, PLAY_CONTEXT_KEY_NAMES } from '../../ui/composables/useGameContext.js';
import { findHandBuiltShellContext, ONE_SHELL_CONTEXT_FIELDS } from './test-step-shell-context.js';

describe('findHandBuiltShellContext', () => {
  it("finds a table-only key in a mount's global.provide and in a provide() call, at its line", () => {
    const source = `import { mount } from '@vue/test-utils';
import { provide } from 'vue';
const wrapper = mount(Board, {
  global: { provide: { [GAME_CONTEXT_KEYS.gameState as symbol]: ref(null) } },
});
const Host = defineComponent({ setup() { provide(GAME_CONTEXT_KEYS.turnDeadline, computed(() => null)); } });
`;
    expect(findHandBuiltShellContext(source, 'tests/board.test.ts')).toEqual([
      { line: 4, key: 'GAME_CONTEXT_KEYS.gameState' },
      { line: 6, key: 'GAME_CONTEXT_KEYS.turnDeadline' },
    ]);
  });

  it("finds the world's own key, the table's announcer and animation keys, and their provide helpers", () => {
    const source = `provide(WORLD_CONTEXT_KEY, fakeWorld);
const p = { [ANNOUNCER_KEY]: a, [ANIMATION_EVENTS_KEY]: e };
provideAnnouncer(a);
provideAnimationEvents(e);
`;
    expect(findHandBuiltShellContext(source).map((h) => [h.line, h.key])).toEqual([
      [1, 'WORLD_CONTEXT_KEY'],
      [2, 'ANNOUNCER_KEY'],
      [2, 'ANIMATION_EVENTS_KEY'],
      [3, 'provideAnnouncer'],
      [4, 'provideAnimationEvents'],
    ]);
  });

  it('leaves alone a key both shells provide, and one handed to a stub, which checks it itself', () => {
    const source = `provide(BOARD_INTERACTION_KEY, board);
provideBoardInteraction(board);
mount(Panel, { global: { provide: { [GAME_CONTEXT_KEYS.actionController as symbol]: controller } } });
await renderAsSeat(game, 1, { provide: { [GAME_CONTEXT_KEYS.gameState as symbol]: state } });
await tableShellContext(game, 1, { provide: { [ANNOUNCER_KEY as symbol]: announcer } });
await worldShellContext(world, 2, { provide: { [WORLD_CONTEXT_KEY as symbol]: world } });
`;
    expect(findHandBuiltShellContext(source)).toEqual([]);
  });

  it('names exactly the context fields a world never provides', () => {
    const shared: readonly string[] = PLAY_CONTEXT_KEY_NAMES;
    expect([...ONE_SHELL_CONTEXT_FIELDS].sort()).toEqual(Object.keys(GAME_CONTEXT_KEYS).filter((f) => !shared.includes(f)).sort());
  });
});
