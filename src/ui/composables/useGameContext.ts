/**
 * The typed contract between `GameShell` and the components inside it (#39).
 *
 * `GameShell` used to `provide()` all twelve of these under bare string keys,
 * while the library's own composables (`useBoardInteraction`, `useAnnouncer`)
 * used typed `InjectionKey` symbols. The consequence was that every consumer had
 * to cast — the shell's own overlays did — and a game author who typed
 * `inject('gameview')` got `undefined` with no error and no type help. That is
 * the opposite of making invalid states unrepresentable.
 *
 * Three ways in, and all are typed:
 *
 * - `usePlayContext()` for the half both shells publish. A component that is
 *   shared between a table and a world reads this; it works under either.
 * - `useGameContext()` for a table's whole bundle. It THROWS outside a
 *   `GameShell`, with a message saying so, rather than handing back a bag of
 *   `undefined`s.
 * - the individual `InjectionKey`s, for a component that wants one value and
 *   wants to decide for itself what a missing one means.
 *
 * @module
 */
import { inject, type ComputedRef, type InjectionKey, type Ref } from 'vue';
import type { GameState } from '../../client/types.js';
import type { UseActionControllerReturn } from './useActionController.js';
import type { TurnDeadline } from './useTurnDeadline.js';

/** One player as the shell knows them. */
export interface GameContextPlayer {
  name: string;
  seat: number;
  [key: string]: unknown;
}

/** Which element ids a time-travel step added, removed or changed. */
export interface TimeTravelDiff {
  added: number[];
  removed: number[];
  changed: number[];
}

/**
 * Everything `GameShell` makes available to the components it renders.
 *
 * Every field is reactive; read `.value` as usual. The shape is what the shell
 * actually provides — if a field is here, the shell provides it, and if it is
 * not, no amount of guessing at a string key will find it.
 */
/**
 * WHAT BOTH BACKENDS PUBLISH (BoardSmith #170).
 *
 * The half of the context a world can honestly provide, and it is most of it.
 * A world has a seat, an element tree, an enumerated action list and an action
 * controller; what it does not have is a `GameState` — there is no flow, no
 * turn, no per-action snapshot — and therefore no time-travel diff either.
 *
 * Splitting it is what lets `PlayShell`, `ActionPanel` and the board bridge be
 * ONE implementation each. Keeping the table-only fields in the same interface
 * would have forced a world to fabricate a `gameState`, which is exactly the
 * lie `worldProtocol.ts` was written to prevent.
 */
export interface PlayContext {
  /** The game's own player view — what a board component renders. */
  gameView: ComputedRef<unknown>;
  /** Every player at the table. */
  players: ComputedRef<GameContextPlayer[]>;
  /** The viewing player, or undefined for a spectator. */
  myPlayer: ComputedRef<GameContextPlayer | undefined>;
  /** The viewer's seat; -1 before a seat is assigned (spectator). */
  playerSeat: Ref<number>;
  /**
   * Whether the viewer may act right now. False while {@link isViewingHistory}
   * is true, exactly as the board's `isMyTurn` prop is, so a component under the
   * board never offers a control the action controller would refuse.
   */
  isMyTurn: Ref<boolean> | ComputedRef<boolean>;
  /**
   * True while the debug panel shows a historical position: `gameView` is that
   * position, and nothing commits to the live game. A world has no history, so
   * it is always false there.
   */
  isViewingHistory: Ref<boolean> | ComputedRef<boolean>;
  /** Action names available to the viewer this step. Empty while {@link isViewingHistory} is true. */
  availableActions: ComputedRef<string[]>;
  /** The action controller — the one write path for taking an action. */
  actionController: UseActionControllerReturn;
  /** Issue a host op (dev/debug surfaces). */
  platformRequest: (op: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /** The presentation overlay, if the host supplied one. */
  presentation: Ref<unknown>;
  /** Element id the debug panel is highlighting, or null. */
  debugHighlight: Ref<number | null>;
}

/**
 * Everything `GameShell` makes available — the shared context plus the three
 * fields only a table has.
 *
 * Every field is reactive; read `.value` as usual. The shape is what the shell
 * actually provides — if a field is here, the shell provides it, and if it is
 * not, no amount of guessing at a string key will find it.
 */
export interface GameContext extends PlayContext {
  /** The whole server state for this seat, or null before the first frame. */
  gameState: Ref<GameState | null>;
  /**
   * Every seat that has to act right now, the viewer's own included: the one
   * seat of a turn-based step, or every seat a simultaneous step is still
   * waiting on (a seat leaves the list when it commits). Empty when nobody is
   * due. The shell's players panel, its Action Panel and its screen-reader
   * announcements read this same list, so a custom UI that shows who is acting
   * from it agrees with them. It stays LIVE during time travel, as the players
   * panel does: history changes the board, not whose move it is. So outside
   * history `isMyTurn` is `dueSeats.includes(playerSeat)`, and during it
   * `isMyTurn` is false. A world has no turn, so this is a table-only field.
   */
  dueSeats: ComputedRef<number[]>;
  /** What a time-travel step changed, or null when not time travelling. */
  timeTravelDiff: Ref<TimeTravelDiff | null>;
  /**
   * The host's deadline for the current step, or null when the host has set
   * none. `remainingMs` is measured on the host's clock, floors at zero and
   * updates while there is time left. The host closes the step at zero; a UI
   * draws the countdown and never disables actions on its own.
   */
  turnDeadline: ComputedRef<TurnDeadline | null>;
}

/**
 * The keys both backends publish: a world's shell publishes these and no
 * others of {@link GAME_CONTEXT_KEYS}.
 *
 * @internal
 */
export const PLAY_CONTEXT_KEY_NAMES = [
  'gameView', 'players', 'myPlayer', 'playerSeat', 'isMyTurn', 'isViewingHistory', 'availableActions',
  'actionController', 'platformRequest', 'presentation', 'debugHighlight',
] as const satisfies readonly (keyof PlayContext)[];

/** One typed key per field of {@link GameContext}. */
export const GAME_CONTEXT_KEYS: { [K in keyof GameContext]: InjectionKey<GameContext[K]> } = {
  gameState: Symbol('bs:gameState'),
  dueSeats: Symbol('bs:dueSeats'),
  gameView: Symbol('bs:gameView'),
  players: Symbol('bs:players'),
  myPlayer: Symbol('bs:myPlayer'),
  playerSeat: Symbol('bs:playerSeat'),
  isMyTurn: Symbol('bs:isMyTurn'),
  isViewingHistory: Symbol('bs:isViewingHistory'),
  availableActions: Symbol('bs:availableActions'),
  actionController: Symbol('bs:actionController'),
  timeTravelDiff: Symbol('bs:timeTravelDiff'),
  platformRequest: Symbol('bs:platformRequest'),
  presentation: Symbol('bs:presentation'),
  debugHighlight: Symbol('bs:debugHighlight'),
  turnDeadline: Symbol('bs:turnDeadline'),
};

/**
 * The context as key/value pairs, for `useTableSeat` to publish with the rest
 * of what a table's board is given. It is the only caller: a second provider
 * would give the components below it two different answers.
 *
 * @internal
 */
export function gameContextProvisions(context: GameContext): Array<readonly [InjectionKey<unknown>, unknown]> {
  return (Object.keys(GAME_CONTEXT_KEYS) as Array<keyof GameContext>).map(
    (key) => [GAME_CONTEXT_KEYS[key] as InjectionKey<unknown>, context[key]] as const,
  );
}

/**
 * The shared half as key/value pairs, for `useWorldSeat` to publish with the
 * rest of what a world's board is given. It is the only caller.
 *
 * The table-only keys are deliberately left UNPROVIDED rather than filled with
 * nulls: a component that reads `gameState` inside a world is asking a question
 * a world cannot answer, and `useGameContext()`'s error naming the missing
 * fields and pointing at `usePlayContext()` is a better answer than a `null` that reads as "the game has not
 * started yet".
 *
 * @internal
 */
export function playContextProvisions(context: PlayContext): Array<readonly [InjectionKey<unknown>, unknown]> {
  return PLAY_CONTEXT_KEY_NAMES.map(
    (key) => [GAME_CONTEXT_KEYS[key] as InjectionKey<unknown>, context[key]] as const,
  );
}

/**
 * Inject `keys` and say which no shell provided. The one read both
 * `usePlayContext()` and `useGameContext()` make, so they cannot disagree about
 * what "provided" means.
 */
function injectContext<K extends keyof GameContext>(keys: readonly K[]): { context: Pick<GameContext, K>; missing: K[] } {
  const context = {} as Pick<GameContext, K>;
  const missing: K[] = [];
  for (const key of keys) {
    const value = inject(GAME_CONTEXT_KEYS[key] as InjectionKey<unknown>, undefined);
    if (value === undefined) missing.push(key);
    (context as Record<string, unknown>)[key] = value;
  }
  return { context, missing };
}

const ALL_CONTEXT_KEY_NAMES = Object.keys(GAME_CONTEXT_KEYS) as Array<keyof GameContext>;

/** What a test does to give a component the context it reads. */
const TEST_CONTEXT_ADVICE =
  `  In a test, mount the component with renderAsSeat, or pass tableShellContext(...).provide ` +
  `(both from boardsmith/testing) as the mount's global.provide.`;

/**
 * Why `useGameContext()` cannot answer, given the fields no shell provided. A
 * world's shell provides the shared half and never a table's own fields, so
 * when only those are missing the component is in a world, and saying "no
 * GameShell" would send its author looking for a shell that is right there.
 */
function missingContextMessage(missing: readonly string[]): string {
  const shared: readonly string[] = PLAY_CONTEXT_KEY_NAMES;
  if (missing.every((field) => !shared.includes(field))) {
    return (
      `useGameContext() reads a table's whole game context, and this component is inside a world's shell, ` +
      `which never provides a table's own fields (missing: ${missing.join(', ')}).\n` +
      `  A component that renders in a world reads the shared half with usePlayContext(), ` +
      `and the world itself with useWorld().`
    );
  }
  return (
    `useGameContext() found no GameShell above this component (missing: ${missing.join(', ')}).\n` +
    `  The game context is published by GameShell, so a component that reads it must be ` +
    `rendered inside one: as a board component, a custom UI, or an overlay.\n` +
    TEST_CONTEXT_ADVICE
  );
}

/**
 * Read the half of the context both shells publish: a table's `GameShell` and
 * a world's shell alike.
 *
 * For a component that renders in both, such as a panel a game shares between
 * its table and its world, or one that only needs the seat and the action
 * controller. Throws when neither shell is above this component.
 *
 * @example
 * ```typescript
 * const { playerSeat, isMyTurn, actionController } = usePlayContext();
 * ```
 */
export function usePlayContext(): PlayContext {
  const { context, missing } = injectContext(PLAY_CONTEXT_KEY_NAMES);
  if (missing.length > 0) {
    throw new Error(
      `usePlayContext() found no shell above this component (missing: ${missing.join(', ')}).\n` +
      `  The play context is published by a table's GameShell and by a world's shell, so a component ` +
      `that reads it must be rendered inside one.\n` +
      TEST_CONTEXT_ADVICE,
    );
  }
  return context;
}

/**
 * Read a table's whole game context inside a `GameShell`.
 *
 * Throws when there is no shell above this component, which is the only honest
 * answer: every field would be `undefined`, and the first `.value` read would
 * fail somewhere far from the cause. Throws inside a world's shell too, which
 * has no table fields; a component that renders there reads
 * {@link usePlayContext} instead.
 *
 * @example
 * ```typescript
 * const { gameView, playerSeat, actionController } = useGameContext();
 * ```
 */
export function useGameContext(): GameContext {
  const { context, missing } = injectContext(ALL_CONTEXT_KEY_NAMES);
  if (missing.length > 0) throw new Error(missingContextMessage(missing));
  return context;
}

/**
 * Read a table's whole context if there is one, or `undefined` anywhere else:
 * outside any shell, and inside a world's shell, which has no table fields.
 * It never throws.
 *
 * For a component that legitimately renders both inside and outside a table.
 * Prefer {@link useGameContext} otherwise — a component that needs the context
 * should say so by failing.
 */
export function tryUseGameContext(): GameContext | undefined {
  const { context, missing } = injectContext(ALL_CONTEXT_KEY_NAMES);
  return missing.length > 0 ? undefined : context;
}

/**
 * The viewing seat as a plain number, for a renderer that only ever reads it.
 *
 * The context carries a `Ref<number>`; the AutoUI renderers want the value.
 * `0` outside a shell, matching the default they carried when they injected
 * under a bare string key.
 */
export function injectPlayerSeat(): number {
  const seat = inject(GAME_CONTEXT_KEYS.playerSeat, undefined);
  return seat?.value ?? 0;
}
