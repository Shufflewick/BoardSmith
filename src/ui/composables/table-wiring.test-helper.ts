/**
 * ONE SEAT OF A REAL TABLE, WIRED THE WAY GAMESHELL WIRES IT.
 *
 * `useTableActionWiring` over the live session host (`createHeadlessSession`),
 * with the transport build/test.md shows a game: actions go to the host as
 * `action` ops, pick lists come from `resolveChoices` ops. Every op passes
 * through `toCloneablePayload`, as GameShell's transport sends it: reactivity
 * stripped, and stamped with the boundary of the flow state the seat rendered
 * (#568). Tests of the wiring
 * itself (#378, #384) and tests that drive an action's picks through it (#392,
 * #407) share this, so a test wired here is wired the way production is.
 *
 * Call it from a test body; it mounts a host component, so unmount the returned
 * wrapper when the test is done. `mountLiveSeat` does the common case (seat 1 of
 * a fresh two-player table) in one call.
 */
import { computed, defineComponent, h, nextTick, ref, toRaw, type Ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import type { Game, GameClass } from '../../engine/index.js';
import type { BoundaryKeyState } from '../../engine/flow/boundary-key.js';
import { createHeadlessSession, type HeadlessOp, type HeadlessSession } from '../../session/headless-session.js';
import type { PlayerGameState } from '../../session/types.js';
import { toCloneablePayload } from '../components/platformRequestClone.js';
import { createBoardInteraction, type BoardInteraction } from './useBoardInteraction.js';
import { useTableActionWiring, type TableActionWiring } from './useTableActionWiring.js';

/** Let the controller's awaited fetches, sends and watchers run to rest. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** A started two-player table of `GameClass`, seeded with `seed`. */
export async function startTable<G extends Game>(GameClass: GameClass<G>, seed: string): Promise<HeadlessSession<G>> {
  const session = createHeadlessSession(
    { gameClass: GameClass, gameType: seed, minPlayers: 2, maxPlayers: 2 },
    { playerCount: 2, seed, playerNames: ['Alice', 'Bob'] },
  );
  await session.start();
  return session;
}

interface TableWiringOptions<G extends Game> {
  /** The live table. A getter, so a test may replace the game under the seat. */
  session: () => HeadlessSession<G>;
  seat: number;
  /** This seat's published state; the test decides when a broadcast lands in it. */
  seatState: Ref<PlayerGameState>;
  boardInteraction: BoardInteraction;
  autoEndTurn: boolean;
  /** Runs after the table applied an action and before its reply returns. */
  afterPerform?: () => void;
  /**
   * Wire the selection-step transport too (`selectionStep` and `cancelAction`
   * ops), as GameShell does: a follow-up's picks travel through it.
   */
  withPickStep?: boolean;
}

export function mountTableWiring<G extends Game>(
  options: TableWiringOptions<G>,
): { wiring: TableActionWiring; wrapper: VueWrapper } {
  const { session, seat, seatState, boardInteraction, afterPerform } = options;

  /**
   * The flow state published with the seat state the test let land, which is
   * what GameShell stamps: the round the seat was looking at, not the host's.
   */
  function renderedFlowState(): BoundaryKeyState | null {
    const rendered = toRaw(seatState.value);
    const published = session().broadcasts as Array<Array<{ state: PlayerGameState; flowState?: BoundaryKeyState }>>;
    for (let i = published.length - 1; i >= 0; i--) {
      const view = published[i][seat - 1];
      if (view?.state === rendered) return view.flowState ?? null;
    }
    throw new Error(
      `Seat ${seat}'s seatState is not a state this table published. ` +
      `Set it from session.playerState(${seat}), as a broadcast would deliver it.`,
    );
  }

  /** `op` as GameShell's transport sends it. */
  const cloneable = <T extends { type: HeadlessOp['type'] }>(op: T) =>
    toCloneablePayload(op.type, op, renderedFlowState());

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
        sendAction: async (actionName, args) => {
          const result = await session().send(seat, cloneable({ type: 'action', actionName, player: seat, args }));
          afterPerform?.();
          return result;
        },
        fetchPickChoices: async (actionName, selectionName, player, args) =>
          session().send(player, cloneable({ type: 'resolveChoices', actionName, selectionName, player, args })),
        ...(options.withPickStep
          ? {
              pickStep: async (player: number, selectionName: string, value: unknown, actionName: string, initialArgs?: Record<string, unknown>) =>
                session().send(player, cloneable({ type: 'selectionStep', player, selectionName, value, actionName, initialArgs })),
              cancelPendingAction: async (player: number) => {
                await session().send(player, cloneable({ type: 'cancelAction', player }));
              },
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
  session: HeadlessSession<G>;
  wiring: TableActionWiring;
  board: BoardInteraction;
  /** This seat's published state, re-read after every action the seat takes. */
  seatState: Ref<PlayerGameState>;
}

/**
 * Seat 1 of a new two-player table, wired with auto mode off and its state
 * re-read as soon as each of its actions is applied. The wrapper is pushed onto
 * `mounted` for the test's `afterEach` to unmount. Pass `withPickStep` for a
 * game whose picks travel through the selection-step transport (a repeating
 * pick, a pick with `onSelect`).
 */
export async function mountLiveSeat<G extends Game>(
  GameClass: GameClass<G>,
  seed: string,
  mounted: VueWrapper[],
  options: { withPickStep?: boolean } = {},
): Promise<LiveSeat<G>> {
  const board = createBoardInteraction();
  const session = await startTable(GameClass, seed);
  const seatState = ref(session.playerState(1)) as Ref<PlayerGameState>;
  const { wiring, wrapper } = mountTableWiring({
    seat: 1,
    session: () => session,
    boardInteraction: board,
    seatState,
    autoEndTurn: false,
    withPickStep: options.withPickStep,
    afterPerform: () => { seatState.value = session.playerState(1); },
  });
  mounted.push(wrapper);
  return { session, wiring, board, seatState };
}
