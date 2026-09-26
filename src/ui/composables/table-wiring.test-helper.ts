/**
 * ONE SEAT OF A REAL TABLE, WIRED THE WAY GAMESHELL WIRES IT.
 *
 * `useTableActionWiring` over a live `GameSession`, with the transport
 * build/test.md shows a game: actions go to `session.performAction`, pick lists
 * come from `session.getPickChoices`. Tests of the wiring itself (#378, #384)
 * and tests that drive an action's picks through it (#392) share this, so a
 * test wired here is wired the way production is.
 *
 * Call it from a test body; it mounts a host component, so unmount the returned
 * wrapper when the test is done.
 */
import { computed, defineComponent, h, nextTick, ref, type Ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import type { Game } from '../../engine/index.js';
import type { GameSession } from '../../session/game-session.js';
import type { PlayerGameState } from '../../session/types.js';
import type { BoardInteraction } from './useBoardInteraction.js';
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
      });
      return () => h('div');
    },
  });
  const wrapper = mount(Host);
  return { wiring: wiring!, wrapper };
}
