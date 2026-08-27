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
 * Two ways in, and both are typed:
 *
 * - `useGameContext()` for the whole bundle. It THROWS outside a `GameShell`,
 *   with a message saying so, rather than handing back a bag of `undefined`s.
 * - the individual `InjectionKey`s, for a component that wants one value and
 *   wants to decide for itself what a missing one means.
 *
 * @module
 */
import { inject, provide, type ComputedRef, type InjectionKey, type Ref } from 'vue';
import type { GameState } from '../../client/types.js';
import type { UseActionControllerReturn } from './useActionController.js';

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
export interface GameContext {
  /** The whole server state for this seat, or null before the first frame. */
  gameState: Ref<GameState | null>;
  /** The game's own player view — what a board component renders. */
  gameView: ComputedRef<unknown>;
  /** Every player at the table. */
  players: ComputedRef<GameContextPlayer[]>;
  /** The viewing player, or undefined for a spectator. */
  myPlayer: ComputedRef<GameContextPlayer | undefined>;
  /** The viewer's seat; -1 before a seat is assigned (spectator). */
  playerSeat: Ref<number>;
  /** Whether the viewer may act right now. */
  isMyTurn: Ref<boolean> | ComputedRef<boolean>;
  /** Action names available to the viewer this step. */
  availableActions: ComputedRef<string[]>;
  /** The action controller — the one write path for taking an action. */
  actionController: UseActionControllerReturn;
  /** What a time-travel step changed, or null when not time travelling. */
  timeTravelDiff: Ref<TimeTravelDiff | null>;
  /** Issue a host op (dev/debug surfaces). */
  platformRequest: (op: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /** The presentation overlay, if the host supplied one. */
  presentation: Ref<unknown>;
  /** Element id the debug panel is highlighting, or null. */
  debugHighlight: Ref<number | null>;
}

/** One typed key per field of {@link GameContext}. */
export const GAME_CONTEXT_KEYS: { [K in keyof GameContext]: InjectionKey<GameContext[K]> } = {
  gameState: Symbol('bs:gameState'),
  gameView: Symbol('bs:gameView'),
  players: Symbol('bs:players'),
  myPlayer: Symbol('bs:myPlayer'),
  playerSeat: Symbol('bs:playerSeat'),
  isMyTurn: Symbol('bs:isMyTurn'),
  availableActions: Symbol('bs:availableActions'),
  actionController: Symbol('bs:actionController'),
  timeTravelDiff: Symbol('bs:timeTravelDiff'),
  platformRequest: Symbol('bs:platformRequest'),
  presentation: Symbol('bs:presentation'),
  debugHighlight: Symbol('bs:debugHighlight'),
};

/**
 * Publish the context. Called by `GameShell` and by nothing else — a second
 * provider would give the components below it two different answers.
 *
 * @internal
 */
export function provideGameContext(context: GameContext): void {
  for (const key of Object.keys(GAME_CONTEXT_KEYS) as Array<keyof GameContext>) {
    provide(GAME_CONTEXT_KEYS[key] as InjectionKey<unknown>, context[key]);
  }
}

/**
 * Read the whole game context inside a `GameShell`.
 *
 * Throws when there is no shell above this component, which is the only honest
 * answer: every field would be `undefined`, and the first `.value` read would
 * fail somewhere far from the cause.
 *
 * @example
 * ```typescript
 * const { gameView, playerSeat, actionController } = useGameContext();
 * ```
 */
export function useGameContext(): GameContext {
  const context = {} as GameContext;
  const missing: string[] = [];

  for (const key of Object.keys(GAME_CONTEXT_KEYS) as Array<keyof GameContext>) {
    const value = inject(GAME_CONTEXT_KEYS[key] as InjectionKey<unknown>, undefined);
    if (value === undefined) missing.push(key);
    (context as unknown as Record<string, unknown>)[key] = value;
  }

  if (missing.length > 0) {
    throw new Error(
      `useGameContext() found no GameShell above this component (missing: ${missing.join(', ')}).\n` +
      `  The game context is published by GameShell, so a component that reads it must be ` +
      `rendered inside one — as a board component, a custom UI, or an overlay.\n` +
      `  In a test, mount the component inside GameShell, or provide the pieces it needs ` +
      `via GAME_CONTEXT_KEYS.`
    );
  }

  return context;
}

/**
 * Read the context if there is one, or `undefined` outside a `GameShell`.
 *
 * For a component that legitimately renders both inside and outside the shell.
 * Prefer {@link useGameContext} otherwise — a component that needs the context
 * should say so by failing.
 */
export function tryUseGameContext(): GameContext | undefined {
  const actionController = inject(GAME_CONTEXT_KEYS.actionController, undefined);
  if (actionController === undefined) return undefined;
  return useGameContext();
}
