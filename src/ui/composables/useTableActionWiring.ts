/**
 * useTableActionWiring — the one way a table's action controller and board
 * bridge are wired together.
 *
 * GameShell calls it (through `useTableSeat`, which builds the rest of what the
 * board is given), and so should anything else that mounts a board against a
 * live game without the whole shell: a game's a11y or keyboard test above all
 * (build/test.md, "The A11y Floor" item 1). Hand it this seat's latest published
 * state (`PlayerGameState`, or the client's `PlayerState` for the same seat) and
 * the transport, and it reads everything else the controller and the bridge need
 * off that state: action metadata, disabled reasons, the tutorial step, and which
 * game tree the state came from.
 *
 * Why it exists (#378): games used to call `useActionController` and
 * `useBoardActionBridge` themselves, so they had to know which state fields the
 * bridge reads. When #356 replaced its `restoreEpoch` option with
 * `runnerIdentity`, every game test wired that way stopped type-checking. Now
 * that knowledge lives here, the shell uses it too, and a test wired with it is
 * wired the way production is.
 *
 * Call it inside a component's `setup` or an `effectScope`, like any composable
 * that registers watchers. Then call {@link provideTableActionWiring} in the
 * `setup` of the component that renders the board (#1462): it gives the board
 * the board interaction and the action holds, so a board's `useActionHolds`
 * reaches this wiring even inside a real GameShell, whose own provides are
 * farther away. The controller is not among them: it is part of the game
 * context, which a shell provides whole.
 */
import { computed, provide, type ComputedRef, type InjectionKey, type Ref } from 'vue';
import type { FollowUpOffer, TutorialStepView } from '../../engine/index.js';
import type { ActionMetadata as WireActionMetadata } from '../../types/protocol.js';
import { BOARD_INTERACTION_KEY, type BoardInteraction } from './useBoardInteraction.js';
import type {
  EnrichedActionMetadata,
  UseActionControllerOptions,
  UseActionControllerReturn,
} from './useActionControllerTypes.js';
import { useActionController } from './useActionController.js';
import { useBoardActionBridge, type RunnerIdentity } from './useBoardActionBridge.js';
import { ACTION_HOLDS_KEY, createActionHolds, withHolds } from './actionHolds.js';

/**
 * The fields of a seat's published state this wiring reads. Both
 * `PlayerGameState` (what the host publishes to a seat) and the
 * client's `PlayerState` satisfy it.
 */
export interface TableSeatState {
  actionMetadata?: Record<string, WireActionMetadata>;
  /** The follow-up the server holds for this seat (see `UseActionControllerOptions.heldFollowUp`). */
  followUp?: FollowUpOffer;
  disabledActions?: Record<string, string>;
  tutorial?: TutorialStepView;
  gameInstanceId?: string;
  restoreEpoch?: number;
}

/**
 * The controller options that are not read off the seat state. `autoFill` and
 * `autoExecute` are not among them: a table fills single choices when auto mode
 * is on (`autoEndTurn`) and always executes once every pick is filled.
 */
type ControllerTransportOptions = Omit<
  UseActionControllerOptions,
  'actionMetadata' | 'heldFollowUp' | 'disabledActions' | 'tutorialStep' | 'autoFill' | 'autoExecute' | 'isViewingHistory' | 'isMyTurn' | 'playerSeat' | 'availableActions'
>;

export interface TableActionWiringOptions extends ControllerTransportOptions {
  /** This seat's latest published state. `null`/`undefined` until the first one arrives. */
  seatState: Ref<TableSeatState | null | undefined>;
  /** Reactive: the action names this seat may take now. */
  availableActions: Ref<string[]> | ComputedRef<string[]>;
  /** Reactive: is it this seat's turn. */
  isMyTurn: Ref<boolean | undefined> | ComputedRef<boolean | undefined>;
  /** This seat's player number (1-indexed). */
  playerSeat: Ref<number>;
  /** The board substrate the bridge feeds. Created with `createBoardInteraction()`. */
  boardInteraction: BoardInteraction;
  /** Auto mode: auto-fill single choices, auto-start a lone action, auto-execute a no-pick action. */
  autoEndTurn: Ref<boolean>;
  /** True while a debug view shows historical state; nothing commits to the live game then. */
  isViewingHistory: Ref<boolean>;
}

export interface TableActionWiring {
  controller: UseActionControllerReturn;
  /** Read off the seat state: an empty record until an action has metadata. Feed the Action Panel this. */
  actionMetadata: ComputedRef<Record<string, EnrichedActionMetadata>>;
  /** Read off the seat state, with the board's holds added: action name to the reason it is disabled. Feed the Action Panel this. */
  disabledActions: ComputedRef<Record<string, string> | undefined>;
  /** What the board injects from this wiring: the board interaction and the action holds. Publish with {@link provideTableActionWiring}. */
  provisions: readonly Provision[];
}

/** One value a board below can inject, under its key. */
export type Provision = readonly [key: InjectionKey<unknown>, value: unknown];

export function useTableActionWiring(opts: TableActionWiringOptions): TableActionWiring {
  const { seatState, boardInteraction, autoEndTurn, isViewingHistory, availableActions, isMyTurn, playerSeat, ...transport } = opts;

  // "No metadata" is an EMPTY RECORD, never `undefined`: every consumer only
  // ever looks an action name up in it.
  const actionMetadata = computed<Record<string, EnrichedActionMetadata>>(() => seatState.value?.actionMetadata ?? {});
  const actionHolds = createActionHolds();
  const disabledActions = withHolds(computed(() => seatState.value?.disabledActions), actionHolds);
  const tutorialStep = computed(() => seatState.value?.tutorial);
  const heldFollowUp = computed(() => seatState.value?.followUp);
  // A change in either field means every element id the client holds is stale:
  // see BoardActionBridgeOptions.runnerIdentity.
  const runnerIdentity = computed<RunnerIdentity | undefined>(() => {
    const published = seatState.value;
    if (published?.gameInstanceId === undefined || published.restoreEpoch === undefined) return undefined;
    return { gameInstanceId: published.gameInstanceId, restoreEpoch: published.restoreEpoch };
  });

  const controller = useActionController({
    ...transport,
    actionMetadata,
    heldFollowUp,
    disabledActions,
    heldActions: actionHolds.held,
    tutorialStep,
    availableActions,
    isMyTurn,
    playerSeat,
    autoFill: autoEndTurn,
    autoExecute: true,
    isViewingHistory,
  });

  useBoardActionBridge({
    controller,
    boardInteraction,
    isMyTurn,
    autoEndTurn,
    actionMetadata,
    availableActions,
    disabledActions,
    isViewingHistory,
    // The controller's commit gate, handed to the board's mutators too.
    completed: transport.completed,
    runnerIdentity,
  });

  const provisions: Provision[] = [
    [BOARD_INTERACTION_KEY, boardInteraction],
    [ACTION_HOLDS_KEY, actionHolds],
  ];

  return { controller, actionMetadata, disabledActions, provisions };
}

/** Provide a wiring's {@link TableActionWiring.provisions} to the board below. Call it in `setup`. */
export function provideTableActionWiring(wiring: TableActionWiring): void {
  for (const [key, value] of wiring.provisions) provide(key, value);
}
