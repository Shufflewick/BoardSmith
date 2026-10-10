/**
 * WHAT A BOARD COMPONENT RECEIVES, AS ONE TYPE A GAME CAN IMPORT (#516).
 *
 * A board is the component a game names in `defineGameUIs()`. `GameShell`
 * mounts it for a table and `WorldShell` for a world, and each shell builds the
 * object it binds with the function below for its kind, so a shell's template
 * cannot drift from the type a board declares:
 *
 * ```vue
 * <script setup lang="ts">
 * import type { TableBoardProps } from 'boardsmith/ui';
 * const props = defineProps<TableBoardProps>();
 * </script>
 * ```
 *
 * A board that renders in both declares {@link BoardBaseProps}. A board may
 * declare a subset with `Pick<TableBoardProps, ...>`; anything it leaves out
 * falls through onto its root element as an attribute.
 *
 * @module
 */
import type { GameState, PublicFlowState } from '../client/types.js';
import type { GameViewElement } from './types.js';
import type { GameContextPlayer } from './composables/useGameContext.js';
import type { UseActionControllerReturn } from './composables/useActionControllerTypes.js';
import type { TableSeat } from './composables/useTableSeat.js';
import type { WorldSeat } from './world/useWorldSeat.js';
import type { WorldSeatHost } from './world/useWorldHost.js';
import type { WorldNarration, WorldPhase } from './world/worldProtocol.js';

/** What both shells give a board. The same fields `usePlayContext()` publishes, as plain values. */
export interface BoardBaseProps {
  /** The element tree to draw. During time travel, the historical one. */
  gameView: GameViewElement | null;
  /** Every player, in seat order. During time travel, the historical snapshot's. */
  players: GameContextPlayer[];
  /** The viewing player, or undefined for a spectator. During time travel, the historical snapshot's. */
  myPlayer?: GameContextPlayer;
  /** The viewer's seat; -1 before one is assigned. */
  playerSeat: number;
  /** Whether the viewer may act now. False while a table shows history. */
  isMyTurn: boolean;
  /** The action names the viewer may take now. Empty while a table shows history. */
  availableActions: string[];
  /** The one write path for taking an action: start, fill, execute, cancel. */
  actionController: UseActionControllerReturn;
  /** Action name to the reason it is disabled. None while a table shows history. */
  disabledActions?: Record<string, string>;
}

/**
 * A table seat's frame as the board is handed it. During time travel `state` is
 * the historical seat state and `flowState` is null, because there is no
 * historical flow position to show.
 */
export type DisplayedGameState = Omit<GameState, 'flowState'> & { flowState: PublicFlowState | null };

/** What `GameShell` gives a table's board. */
export interface TableBoardProps extends BoardBaseProps {
  /** This seat's frame, `{ flowState, state }`, for the position shown; null before the first. */
  state: DisplayedGameState | null;
  /** True while the debug panel shows a past position. Nothing on the board is live then. */
  isViewingHistory: boolean;
  /** Whether this seat may undo now. False while a table shows history. */
  canUndo: boolean;
  /** Undo back to the start of this seat's turn. Refused while a table shows history. */
  undo: () => Promise<void>;
  /**
   * Replace the action bar's prompt with the board's own text, or pass null to
   * give it back. WorldShell does not let a board replace its prompt, so a
   * world board is not given a setter.
   */
  setBoardPrompt: (prompt: string | null) => void;
}

/** What `WorldShell` gives a world's board. */
export interface WorldBoardProps extends BoardBaseProps {
  /** The seats awake in this world, or null before the host has said. */
  presence: readonly number[] | null;
  /** The narration the host has sent since this page mounted, oldest first. */
  events: readonly WorldNarration[];
  /** The world's own name, or null before the host has said it. */
  worldName: string | null;
  /** Where the attachment to the world stands. */
  phase: WorldPhase;
}

/** What a table's shell knows that its seat does not. */
interface TableShellBoardInput {
  state: DisplayedGameState | null;
  players: GameContextPlayer[];
  myPlayer: GameContextPlayer | undefined;
  gameView: GameViewElement | null;
  playerSeat: number;
  isViewingHistory: boolean;
  undo: () => Promise<void>;
  setBoardPrompt: (prompt: string | null) => void;
}

/**
 * The object `GameShell` binds onto a table's board. Every actionability signal
 * is the seat's gated value, the same instance the chrome and the Action Panel
 * are handed, so the board cannot offer what the panel withholds.
 */
export function tableBoardProps(seat: TableSeat, shell: TableShellBoardInput): TableBoardProps {
  return {
    gameView: shell.gameView,
    players: shell.players,
    myPlayer: shell.myPlayer,
    playerSeat: shell.playerSeat,
    isMyTurn: seat.gatedIsMyTurn.value,
    availableActions: seat.gatedAvailableActions.value,
    actionController: seat.controller,
    disabledActions: seat.gatedDisabledActions.value,
    state: shell.state,
    isViewingHistory: shell.isViewingHistory,
    canUndo: seat.gatedCanUndo.value,
    undo: shell.undo,
    setBoardPrompt: shell.setBoardPrompt,
  };
}

/** The object `WorldShell` binds onto a world's board. */
export function worldBoardProps(
  seat: WorldSeat,
  host: Pick<WorldSeatHost, 'presence' | 'events' | 'worldName' | 'phase'>,
): WorldBoardProps {
  const { play } = seat;
  return {
    gameView: play.gameView.value,
    players: play.players.value,
    myPlayer: play.myPlayer.value,
    playerSeat: seat.playerSeat.value,
    isMyTurn: play.mayAct.value,
    availableActions: play.availableActions.value,
    actionController: seat.controller,
    disabledActions: play.disabledActions.value,
    presence: host.presence.value,
    events: host.events.value,
    worldName: host.worldName.value,
    phase: host.phase.value,
  };
}
