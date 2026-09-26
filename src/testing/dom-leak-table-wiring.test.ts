// @vitest-environment jsdom
/**
 * `renderAsSeat` GIVES A TABLE'S BOARD THE SEAT'S REAL ACTIONS (#390).
 *
 * It used to read `availableActions` and `isMyTurn` off the top level of
 * `testGame.getPlayerView(seat)`, but a table's player view carries both under
 * `flowState`, so every table board it mounted was told it had no actions and
 * that it was not its turn, whatever the seat could do. Its controller was an
 * inert stand-in, so a board that starts an action to draw its targets drew
 * nothing either.
 *
 * Now a table seat is mounted the way GameShell mounts it: the seat's state is
 * the one a session publishes (`buildPlayerState`), and the controller and the
 * board bridge come from `useTableActionWiring`, the one function GameShell
 * wires them with (#378). These drive the one-pawn move game: seat 1 moves the
 * pawn, seat 2 never acts.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, nextTick, type PropType } from 'vue';
import type { VueWrapper } from '@vue/test-utils';
import { MoveGame } from '../session/move-game.test-helper.js';
import type { UseActionControllerReturn } from '../ui/composables/useActionControllerTypes.js';
import {
  BOARD_INTERACTION_KEY,
  createBoardInteraction,
  useBoardInteraction,
} from '../ui/composables/useBoardInteraction.js';
import { TestGame } from './test-game.js';
import { preloadSeatRenderer, renderAsSeat } from './dom-leak.js';

await preloadSeatRenderer();

/** A board declaring the scaffold contract, drawing what it was handed. */
const SeatBoard = defineComponent({
  name: 'SeatBoard',
  props: {
    gameView: { type: Object as PropType<object | null>, default: null },
    playerSeat: { type: Number, required: true },
    isMyTurn: { type: Boolean, required: true },
    availableActions: { type: Array as PropType<string[]>, required: true },
    actionController: { type: Object as PropType<UseActionControllerReturn>, required: true },
    disabledActions: { type: Object as PropType<Record<string, string>>, default: undefined },
  },
  setup(props) {
    const board = useBoardInteraction();
    return () =>
      h('div', {
        class: 'board',
        'data-my-turn': String(props.isMyTurn),
        'data-actions': props.availableActions.join(','),
        'data-disabled': JSON.stringify(props.disabledActions ?? {}),
        'data-targets': board.validElements.map((target) => target.id).sort((a, b) => a - b).join(','),
      });
  },
});

type Board = VueWrapper<InstanceType<typeof SeatBoard>>;

const mounted: Board[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

function moveGame(): TestGame<MoveGame> {
  return TestGame.create(MoveGame, { playerCount: 2, seed: 'bs390' });
}

async function render(game: TestGame<MoveGame>, seat: number): Promise<Board> {
  const wrapper = await renderAsSeat(game, seat, { component: SeatBoard });
  mounted.push(wrapper);
  return wrapper;
}

/** Lets the controller's pick fetch and the bridge's watchers land. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("renderAsSeat mounts a table's board with the seat's own actions (#390)", () => {
  it('tells the seat on move its actions and that it is its turn', async () => {
    const board = (await render(moveGame(), 1)).find('.board');

    expect(board.attributes('data-actions')).toBe('move');
    expect(board.attributes('data-my-turn')).toBe('true');
  });

  it('gives a seat that is not on move no actions (#408)', async () => {
    const board = (await render(moveGame(), 2)).find('.board');

    expect(board.attributes('data-actions')).toBe('');
    expect(board.attributes('data-my-turn')).toBe('false');
  });

  it("hands the board the reasons the seat's actions are disabled", async () => {
    const game = moveGame();
    game.game.tired = true;

    const board = (await render(game, 1)).find('.board');

    expect(JSON.parse(board.attributes('data-disabled') as string)).toEqual({ move: 'The crew is resting' });
  });

  it("wires a real controller: starting an action draws the game's own targets on the board", async () => {
    const game = moveGame();
    const wrapper = await render(game, 1);
    const controller = wrapper.props('actionController');

    await controller.start('move');
    await settle();

    expect(wrapper.find('.board').attributes('data-targets')).toBe(game.game.roomIds('engine', 'hold').join(','));
  });

  it("feeds a caller's own interaction, which is then the one the board draws from", async () => {
    const game = moveGame();
    const interaction = createBoardInteraction();
    const wrapper = await renderAsSeat(game, 1, {
      component: SeatBoard,
      provide: { [BOARD_INTERACTION_KEY]: interaction },
    });
    mounted.push(wrapper);

    await wrapper.props('actionController').start('move');
    await settle();

    expect(interaction.validElements.map((target) => target.id).sort((a, b) => a - b)).toEqual(
      game.game.roomIds('engine', 'hold'),
    );
  });

  it('never takes a move itself: completing one is refused, says how, and leaves the game as it was', async () => {
    const game = moveGame();
    const wrapper = await render(game, 1);
    const controller = wrapper.props('actionController');

    await controller.start('move');
    await settle();
    await controller.fill('destination', game.game.roomIds('hold')[0]);
    await settle();

    expect(game.game.pawnRoom()).toBe('bridge');
    expect(controller.lastError.value).toMatch(/testGame\.doAction\(1, 'move'/);
  });
});
