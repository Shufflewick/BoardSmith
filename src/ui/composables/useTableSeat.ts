/**
 * useTableSeat — everything a table's board is given, built from one seat's
 * state, and the one place that list is written down (#406).
 *
 * A board mounted by `GameShell` can inject five things: board interaction, the
 * game context (`useGameContext()`), the announcer (`useAnnouncer()`),
 * animation events (`useAnimationEvents()`) and the game-over hold
 * (`holdGameOverUntil()`). They used to be built and
 * provided one by one inside the shell, so anything else that mounts a board --
 * `renderAsSeat` in `boardsmith/testing` above all -- had to restate the list,
 * and when it did not, a board that worked in the shell threw in its test.
 *
 * GameShell and `renderAsSeat` both call this, then publish what it returns:
 * the shell with {@link provideTableSeat}, and `renderAsSeat` by handing
 * `provisions` to its mount. So a value added here reaches both, and a board
 * that mounts in one mounts in the other.
 *
 * Call it inside a component's `setup` or an `effectScope`: it registers
 * watchers (the controller's, the board bridge's and the animation queue's).
 */
import { computed, provide, ref, type ComputedRef, type InjectionKey, type Ref } from 'vue';
import type { GameState } from '../../client/types.js';
import { dueSeats as dueSeatsOf } from '../../engine/flow/seat-activity.js';
import type { GameViewElement } from '../types.js';
import { BOARD_INTERACTION_KEY, type BoardInteraction } from './useBoardInteraction.js';
import { ANIMATION_EVENTS_KEY, createAnimationEvents, animationTimeline, type UseAnimationEventsReturn } from './useAnimationEvents.js';
import { ANNOUNCER_KEY, createAnnouncer, type UseAnnouncerReturn } from './useAnnouncer.js';
import { GAME_OVER_HOLDS_KEY, createGameOverReveal } from './useGameOverReveal.js';
import { gameContextProvisions, type GameContextPlayer, type TimeTravelDiff } from './useGameContext.js';
import type { TurnDeadline } from './useTurnDeadline.js';
import { useTableActionWiring, type TableActionWiring, type TableActionWiringOptions } from './useTableActionWiring.js';

/** One value a board below can inject, under its key. */
type Provision = readonly [key: InjectionKey<unknown>, value: unknown];

/** How the seat reaches the game: taking an action, fetching a pick's choices, and the rest. */
type SeatTransport = Omit<
  TableActionWiringOptions,
  | 'seatState'
  | 'boardInteraction'
  | 'autoEndTurn'
  | 'isViewingHistory'
  | 'availableActions'
  | 'isMyTurn'
  | 'playerSeat'
  | 'gameView'
  | 'completed'
  | 'animationEvents'
>;

interface TableSeatOptions extends SeatTransport {
  /** This seat's latest frame, `{ flowState, state }` as a session publishes it; null before the first. */
  state: Ref<GameState | null>;
  /** The tree the board draws. The shell's follows time travel; otherwise it is `state.state.view`. */
  gameView: ComputedRef<GameViewElement | null | undefined>;
  /** The viewer's seat; -1 before one is assigned. */
  playerSeat: Ref<number>;
  /** Whether this seat may act now. */
  isMyTurn: Ref<boolean> | ComputedRef<boolean>;
  /** The board substrate the controller feeds and the board reads. Created with `createBoardInteraction()`. */
  boardInteraction: BoardInteraction;
  /** Auto mode: auto-fill single choices, auto-start a lone action, auto-execute a no-pick action. */
  autoEndTurn: Ref<boolean>;
  /** True while a debug view shows historical state; nothing commits to the live game then. */
  isViewingHistory: Ref<boolean>;
  /** What a time-travel step changed, or null. */
  timeTravelDiff: Ref<TimeTravelDiff | null>;
  /** Issue a host op (the debug surfaces). */
  platformRequest: (op: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /** The presentation overlay the host supplied, if any. */
  presentation: Ref<unknown>;
  /** Element id the debug panel is highlighting, or null. */
  debugHighlight: Ref<number | null>;
  /** The host's deadline for the current step, or null. */
  turnDeadline: ComputedRef<TurnDeadline | null>;
}

export interface TableSeat extends TableActionWiring {
  /** The action names this seat may take now, as the session published them for it. */
  availableActions: ComputedRef<string[]>;
  /** Whether this seat has already committed the current simultaneous step. False outside one. */
  completed: ComputedRef<boolean>;
  /** Every seat that has to act now, this one included. */
  dueSeats: ComputedRef<number[]>;
  /** Every player at the table, in seat order. */
  players: ComputedRef<GameContextPlayer[]>;
  /** The viewing player, or undefined for a spectator. */
  myPlayer: ComputedRef<GameContextPlayer | undefined>;
  /** Plays the frame's animation events to the handlers the board registers. */
  animationEvents: UseAnimationEventsReturn;
  /** Writes to the two live regions below and relays each message to the host page. */
  announcer: UseAnnouncerReturn;
  /** The live-region text the announcer writes: render each in an `aria-live` node. */
  liveRegion: { polite: Ref<string>; assertive: Ref<string> };
  /**
   * Whether the table's ending is on screen: the flow is complete and every board
   * that holds its result back (`holdGameOverUntil`) has shown it. The game-over
   * card and the game-over announcement both read this, never the flow alone (#419).
   */
  gameOverRevealed: ComputedRef<boolean>;
  /** Everything the board can inject, by key. Publish with {@link provideTableSeat} or a mount's `provide`. */
  provisions: readonly Provision[];
}

/**
 * Relay an announcement to the page hosting this frame, so a host can speak it
 * from its own accessible DOM as well.
 */
function relayAnnouncement(level: 'polite' | 'assertive', text: string): void {
  window.postMessage({ source: 'boardsmith-a11y', type: 'announce', level, text }, '*');
}

export function useTableSeat(opts: TableSeatOptions): TableSeat {
  const {
    state,
    gameView,
    playerSeat,
    isMyTurn,
    boardInteraction,
    autoEndTurn,
    isViewingHistory,
    timeTravelDiff,
    platformRequest,
    presentation,
    debugHighlight,
    turnDeadline,
    ...transport
  } = opts;

  const flowState = computed(() => state.value?.flowState);
  /** This seat's own entry in a simultaneous step, or undefined outside one. */
  const myAwaiting = computed(() =>
    flowState.value?.awaitingPlayers?.find((entry) => entry.playerIndex === playerSeat.value),
  );

  // The session's per-seat answer (`buildPlayerState`): none for a seat that is
  // not on move or has committed, and reconciled with `actionMetadata` so every
  // name here can be started (#408). The flow's own list is the acting seat's.
  const availableActions = computed<string[]>(() => state.value?.state.availableActions ?? []);
  const completed = computed(() => (flowState.value?.awaitingPlayers?.length ? !!myAwaiting.value?.completed : false));
  // The engine's `dueSeats` is the one answer to "who may act", so the players
  // panel, the Action Panel, the announcer and a custom UI cannot disagree.
  const dueSeats = computed(() => dueSeatsOf(flowState.value));
  const players = computed<GameContextPlayer[]>(() => state.value?.state.players ?? []);
  const myPlayer = computed(() => players.value.find((player) => player.seat === playerSeat.value));

  // The timeline (this game, how often its runner was restored, and the seat
  // shown) resets the queue's watermark when it changes, so a reconnect into a
  // rewound session still plays the replayed events, and a page that changes
  // seat plays the new seat's events, which are numbered in its own sequence.
  const animationEvents = createAnimationEvents({
    events: () => state.value?.state?.animationEvents,
    timeline: () => animationTimeline(state.value?.state),
  });

  const liveRegion = { polite: ref(''), assertive: ref('') };
  const announcer = createAnnouncer({
    politeMessage: liveRegion.polite,
    assertiveMessage: liveRegion.assertive,
    emitAnnounce: relayAnnouncement,
  });

  const gameOver = createGameOverReveal(() => flowState.value?.complete === true);

  const wiring = useTableActionWiring({
    ...transport,
    seatState: computed(() => state.value?.state),
    boardInteraction,
    autoEndTurn,
    isViewingHistory,
    availableActions,
    isMyTurn,
    // The commit gate: a seat that has committed this simultaneous step cannot
    // submit again, from the Action Panel or any custom UI.
    completed,
    gameView,
    playerSeat,
    // Gates the panel while animations play.
    animationEvents,
  });

  // What the context publishes is gated on history exactly as the board's props
  // are, so a board and a component under it agree that a seat browsing history
  // cannot act. The wiring above takes the live values and `isViewingHistory`
  // itself, which is how it refuses commits during a browse.
  const shownIsMyTurn = computed(() => isMyTurn.value && !isViewingHistory.value);
  const shownAvailableActions = computed(() => (isViewingHistory.value ? [] : availableActions.value));

  const provisions: Provision[] = [
    [BOARD_INTERACTION_KEY, boardInteraction],
    [ANIMATION_EVENTS_KEY, animationEvents],
    [ANNOUNCER_KEY, announcer],
    [GAME_OVER_HOLDS_KEY, gameOver.holds],
    ...gameContextProvisions({
      gameState: state,
      gameView,
      players,
      myPlayer,
      playerSeat,
      isMyTurn: shownIsMyTurn,
      isViewingHistory,
      dueSeats,
      availableActions: shownAvailableActions,
      actionController: wiring.controller,
      timeTravelDiff,
      platformRequest,
      presentation,
      debugHighlight,
      turnDeadline,
    }),
  ];

  return {
    ...wiring,
    availableActions,
    completed,
    dueSeats,
    players,
    myPlayer,
    animationEvents,
    announcer,
    liveRegion,
    gameOverRevealed: gameOver.revealed,
    provisions,
  };
}

/** Provide a seat's {@link TableSeat.provisions} to the components below. Call it in `setup`. */
export function provideTableSeat(seat: TableSeat): void {
  for (const [key, value] of seat.provisions) provide(key, value);
}
