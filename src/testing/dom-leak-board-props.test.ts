// @vitest-environment jsdom
/**
 * `renderAsSeat` HANDS A BOARD THE SHELL'S WHOLE PROP CONTRACT (#516).
 *
 * A board declares `defineProps<TableBoardProps>()` (or `WorldBoardProps`), and
 * the shell binds every one of those props, built by `tableBoardProps()` /
 * `worldBoardProps()`. `renderAsSeat` builds its props with the same functions,
 * so a board that mounts in the shell mounts in a test without a missing prop.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { MoveGame } from '../session/move-game.test-helper.js';
import { TABLE_BOARD_PROP_NAMES, WORLD_BOARD_PROP_NAMES } from '../ui/board-props.test-helper.js';
import { TestGame } from './test-game.js';
import { createTestWorld, type TestWorld } from './test-world.js';
import { vaultBundle } from './test-world.test-helper.js';
import { preloadSeatRenderer, renderAsSeat } from './dom-leak.js';

await preloadSeatRenderer();

const mounted: Array<{ unmount(): void }> = [];
const worlds: TestWorld[] = [];
afterEach(async () => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  for (const world of worlds.splice(0)) await world.close();
});

/** A board declaring every name in `names`, as `defineProps<...>()` compiles to. */
function boardDeclaring(names: readonly string[]) {
  return defineComponent({ name: 'ContractBoard', props: [...names], setup: () => () => h('div') });
}

/** The props the board was handed that are absent. `myPlayer` and `disabledActions` are optional. */
function missing(props: Record<string, unknown>, names: readonly string[]): string[] {
  const optional = new Set(['myPlayer', 'disabledActions']);
  return names.filter((name) => !optional.has(name) && props[name] === undefined);
}

describe('renderAsSeat hands the board contract (#516)', () => {
  it('gives a table board every TableBoardProps prop', async () => {
    const game = TestGame.create(MoveGame, { playerCount: 2, seed: 'bs516' });
    const wrapper = await renderAsSeat(game, 1, { component: boardDeclaring(TABLE_BOARD_PROP_NAMES) });
    mounted.push(wrapper);
    const props = wrapper.props() as Record<string, unknown>;
    expect(missing(props, TABLE_BOARD_PROP_NAMES)).toEqual([]);
    expect(props.isViewingHistory).toBe(false);
    expect((props.players as unknown[]).length).toBe(2);
    await expect((props.undo as () => Promise<void>)()).rejects.toThrow(/no session to undo against/);
  });

  it('gives a world board every WorldBoardProps prop', async () => {
    const world = await createTestWorld({ definition: vaultBundle() });
    worlds.push(world);
    const wrapper = await renderAsSeat(world, 2, { component: boardDeclaring(WORLD_BOARD_PROP_NAMES) });
    mounted.push(wrapper);
    const props = wrapper.props() as Record<string, unknown>;
    expect(missing(props, WORLD_BOARD_PROP_NAMES).filter((name) => name !== 'worldName')).toEqual([]);
    expect(props.phase).toBe('watching');
  });
});
