/**
 * ONE SEAT OF A REAL TABLE, WIRED THE WAY GAMESHELL WIRES IT.
 *
 * `useTableActionWiring` over a live `GameSession`, with the transport
 * build/test.md shows a game: actions go to `session.performAction`, pick lists
 * come from `session.getPickChoices`. Tests of the wiring itself (#378, #384)
 * and tests that drive an action's picks through it (#392, #407) share this, so
 * a test wired here is wired the way production is.
 *
 * Call it from a test body; it mounts a host component, so unmount the returned
 * wrapper when the test is done. `mountLiveSeat` does the common case (seat 1 of
 * a fresh two-player session) in one call.
 */
import { computed, defineComponent, h, nextTick, ref, type Ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import type { Game, GameClass } from '../../engine/index.js';
import { GameSession } from '../../session/game-session.js';
import type { PlayerGameState } from '../../session/types.js';
import { createBoardInteraction, type BoardInteraction } from './useBoardInteraction.js';
import { useTableActionWiring, type TableActionWiring } from './useTableActionWiring.js';

/** Let the controller's awaited fetches, sends and watchers run to rest. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

interface TableWiringOptions<G extends Game> {
  /** The live session. A getter, so a test may replace the game under the seat. */
  session: () => GameSession<G>;
  seat: number;
  /** This seat's published state; the test decides when a broadcast lands in it. */
  seatState: Ref<PlayerGameState>;
  boardInteraction: BoardInteraction;
  autoEndTurn: boolean;
  /** Runs after the session applied an action and before its reply returns. */
  afterPerform?: () => void;
  /**
   * Wire the selection-step transport too (`session.processSelectionStep`), as
   * GameShell does: a follow-up's picks travel through it.
   */
  withPickStep?: boolean;
}

export function mountTableWiring<G extends Game>(
  options: TableWiringOptions<G>,
): { wiring: TableActionWiring; wrapper: VueWrapper } {
  const { session, seat, seatState, boardInteraction, afterPerform } = options;
  let wiring: TableActionWiring | undefined;
  const Host = defineComponent({
    setup() {
      wiring = useTableActionWiring({
        seatState,
        availableActions: computed(() => seatState.value.availableActions ?? []),
        isMyTurn: computed(() => seatState.value.isMyTurn),
        playerSeat: ref(seat),
        boardInteraction,
        autoEndTurn: ref(options.autoEndTurn),
        isViewingHistory: ref(false),
        sendAction: async (name, args) => {
          const result = await session().performAction(name, seat, args);
          afterPerform?.();
          return result;
        },
        fetchPickChoices: async (action, pick, player, args) =>
          session().getPickChoices(action, pick, player, args),
        ...(options.withPickStep
          ? {
              pickStep: async (player: number, selectionName: string, value: unknown, actionName: string, initialArgs?: Record<string, unknown>) =>
                session().processSelectionStep(player, selectionName, value, actionName, initialArgs),
              cancelPendingAction: async (player: number) => session().cancelPendingAction(player),
            }
          : {}),
      });
      return () => h('div');
    },
  });
  const wrapper = mount(Host);
  return { wiring: wiring!, wrapper };
}

/** Seat 1 of a live table, as `mountLiveSeat` returns it. */
interface LiveSeat<G extends Game> {
  session: GameSession<G>;
  wiring: TableActionWiring;
  board: BoardInteraction;
  /** This seat's published state, re-read after every action the seat takes. */
  seatState: Ref<PlayerGameState>;
}

/**
 * Seat 1 of a new two-player `GameSession`, wired with auto mode off and its
 * state re-published as soon as each of its actions is applied. The wrapper is
 * pushed onto `mounted` for the test's `afterEach` to unmount.
 */
export function mountLiveSeat<G extends Game>(
  GameClass: GameClass<G>,
  seed: string,
  mounted: VueWrapper[],
): LiveSeat<G> {
  const board = createBoardInteraction();
  const session = GameSession.create<G>({
    GameClass,
    gameType: seed,
    seed,
    playerCount: 2,
    playerNames: ['Alice', 'Bob'],
  });
  const seatState = ref(session.buildPlayerState(1)) as Ref<PlayerGameState>;
  const { wiring, wrapper } = mountTableWiring({
    seat: 1,
    session: () => session,
    boardInteraction: board,
    seatState,
    autoEndTurn: false,
    afterPerform: () => { seatState.value = session.buildPlayerState(1); },
  });
  mounted.push(wrapper);
  return { session, wiring, board, seatState };
}
