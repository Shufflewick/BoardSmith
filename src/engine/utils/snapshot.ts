import type { Game } from '../element/game.js';
import { Player } from '../player/player.js';
import type { SerializedAction } from '../action/types.js';
import type { FlowState } from '../flow/types.js';
import type { ElementJSON } from '../element/types.js';

/**
 * Complete game state snapshot for persistence/transmission
 */
export interface GameStateSnapshot {
  /** Version for compatibility checking */
  version: number;

  /** Game class name for reconstruction */
  gameType: string;

  /** Full element tree state (players are now children in the tree).
   *  This is the exact `game.toJSON()` payload — the same shape consumed by
   *  `loadSerializedState`, so restore is typed end-to-end with no casts. */
  state: ReturnType<Game['toJSON']>;

  /** Flow engine state (if flow is active) */
  flowState?: FlowState;

  /** Action history for replay */
  actionHistory: SerializedAction[];

  /** Random seed for deterministic replay */
  seed?: string;

  /** Element sequence counter (`game._ctx.sequence`) captured at snapshot time.
   *  Restored after the tree is loaded so new-element ids stay aligned between
   *  dev and the executor (mirrors `restoreDevState`). Without this, ids drift
   *  on the next created element and can trip the deletion-detector warning. */
  sequence?: number;

  /** Seeded RNG internal state (`game.getRandomState()`) captured at snapshot
   *  time. Restored via `game.setRandomState()` so the next `game.random()` draw
   *  matches the live game exactly. This is what makes `fromSnapshot` fully
   *  state-authoritative: the RNG position is restored directly instead of being
   *  re-derived by replaying actions. Optional for back-compat with older
   *  snapshots that predate RNG-state capture. */
  randomState?: number;

  /** Original constructor options (for full game restoration including custom options like playerConfigs) */
  gameOptions?: Record<string, unknown>;

  /** Per-action authoritative checkpoints for undo / debug time-travel.
   *  `actionCheckpoints[k]` is the LATEST per-action state observed while `k`
   *  actions were recorded — refreshed on every op so trailing pending/selection
   *  mutations (e.g. `Piece.putInto` inside a completed pending action, recorded
   *  in neither command nor action history) are captured at the right action-count
   *  boundary. Undo/rewind restore `actionCheckpoints[k]` directly (via
   *  `GameRunner.fromCheckpoint`) instead of replaying history — replay loses those
   *  pending mutations and mis-positions the flow.
   *
   *  Each entry is a LEAN `ActionCheckpoint` carrying only the per-action-varying
   *  state (element tree, flow position, sequence, RNG). The snapshot-wide
   *  invariants (`gameType`, `seed`, `gameOptions`) and the action-history PREFIX
   *  are NOT duplicated per entry — they are rehydrated from the enclosing snapshot
   *  by `GameRunner.fromCheckpoint`. This is what keeps a persisted snapshot O(N)
   *  instead of O(N^2): the old design stored a full `createSnapshot` per entry,
   *  each re-embedding an O(k) `actionHistory` copy and a duplicate `gameOptions`,
   *  so a single snapshot carried O(N^2) action entries. Maintained by `GameRunner`,
   *  never nested. */
  actionCheckpoints?: ActionCheckpoint[];
}

/**
 * A lean per-action checkpoint for authoritative undo / debug time-travel.
 *
 * Carries ONLY the state that varies per recorded action; the snapshot-wide
 * invariants (`gameType`, `seed`, `gameOptions`, `version`) and the
 * action-history prefix are reconstructed from the enclosing `GameStateSnapshot`
 * when restoring via `GameRunner.fromCheckpoint`. Storing those per entry would
 * make a single snapshot O(N^2) (see `GameStateSnapshot.actionCheckpoints`).
 */
export interface ActionCheckpoint {
  /** Full element tree state at this action-count boundary (`game.toJSON()`). */
  state: ReturnType<Game['toJSON']>;

  /** Flow engine position at this checkpoint (if flow is active). */
  flowState?: FlowState;

  /** Element sequence counter (`game._ctx.sequence`) at this checkpoint. */
  sequence?: number;

  /** Seeded RNG internal state (`game.getRandomState()`) at this checkpoint. */
  randomState?: number;
}

/**
 * Per-player view of the game state
 */
export interface PlayerStateView {
  /** Player position */
  player: number;

  /** Filtered state (hidden elements obscured) */
  state: ElementJSON;

  /** Flow state relevant to this player */
  flowState?: {
    awaitingInput: boolean;
    isMyTurn: boolean;
    availableActions?: string[];
  };

  /** Messages visible to this player */
  messages: Array<{ text: string; data?: Record<string, unknown> }>;

  /** Game phase */
  phase: string;

  /** Is game complete? */
  complete: boolean;

  /** Winners (if game is complete) */
  winners?: number[];

  /** Static action metadata for the player's available actions (embed/platform
   *  consumers read this; the dev server builds its own via buildPlayerState).
   *  Populated by the executor, not by createPlayerView. */
  actionMetadata?: Record<string, unknown>;
}

/**
 * Create a complete game state snapshot
 */
export function createSnapshot(
  game: Game,
  gameType: string,
  actionHistory: SerializedAction[] = [],
  seed?: string
): GameStateSnapshot {
  const flowState = game.getFlowState();

  return {
    version: 1,
    gameType,
    state: game.toJSON(),
    flowState: flowState ?? undefined,
    actionHistory: [...actionHistory],
    seed,
    sequence: game._ctx.sequence,
    randomState: game.getRandomState(),
    gameOptions: game.getConstructorOptions(),
  };
}

/**
 * Create a lean per-action checkpoint for authoritative undo / debug time-travel.
 *
 * Captures ONLY the per-action-varying state (element tree, flow position,
 * sequence counter, RNG position). The snapshot-wide invariants and the
 * action-history prefix are rehydrated from the enclosing snapshot by
 * `GameRunner.fromCheckpoint`, so retaining one of these per action stays O(N)
 * rather than the O(N^2) a full `createSnapshot` per entry would cost.
 */
export function createActionCheckpoint(game: Game): ActionCheckpoint {
  const flowState = game.getFlowState();

  return {
    state: game.toJSON(),
    flowState: flowState ?? undefined,
    sequence: game._ctx.sequence,
    randomState: game.getRandomState(),
  };
}

/**
 * Create a player-specific view of the game state
 */
export function createPlayerView(
  game: Game,
  playerPosition: number
): PlayerStateView {
  const flowState = game.getFlowState();

  // Resolve this player's turn status and available actions, handling BOTH
  // sequential action steps (flowState.currentPlayer / flowState.availableActions)
  // and simultaneous action steps (flowState.awaitingPlayers[].availableActions).
  // Mirrors buildPlayerState() and GameShell so host-embedded views (which read
  // this PlayerStateView) match the BoardSmith dev server. Without the
  // awaitingPlayers branch, simultaneous steps (e.g. a "choose your landing"
  // phase) report zero available actions and no action buttons render.
  let isMyTurn = false;
  let availableActions: string[] | undefined;
  if (flowState) {
    const awaiting = flowState.awaitingPlayers;
    if (awaiting && awaiting.length > 0) {
      const entry = awaiting.find(
        (p) => p.playerIndex === playerPosition && !p.completed
      );
      isMyTurn = entry !== undefined;
      availableActions = entry?.availableActions;
    } else {
      isMyTurn = flowState.currentPlayer === playerPosition;
      availableActions =
        flowState.awaitingInput && isMyTurn
          ? flowState.availableActions
          : undefined;
    }
  }

  return {
    player: playerPosition,
    state: game.toJSONForPlayer(playerPosition),
    flowState: flowState ? {
      awaitingInput: flowState.awaitingInput,
      isMyTurn,
      availableActions,
    } : undefined,
    messages: game.getFormattedMessages().map(text => ({ text })),
    phase: game.phase,
    complete: flowState?.complete ?? false,
    winners: flowState?.complete ? game.getWinners().map(p => p.seat) : undefined,
  };
}

/**
 * Create views for all players
 */
export function createAllPlayerViews(game: Game): PlayerStateView[] {
  return (game.all(Player as any) as Player[]).map((p) => createPlayerView(game, p.seat));
}
