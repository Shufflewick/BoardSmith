import type { Game } from '../element/game.js';
import type { GameElement } from '../element/game-element.js';
import type {
  FlowNode,
  FlowContext,
  LoopConfig,
  EachPlayerConfig,
  ForEachConfig,
  ActionStepConfig,
  SimultaneousActionStepConfig,
  SwitchConfig,
  IfConfig,
} from './types.js';
import { SWITCH_DEFAULT_KEY } from './flow-navigation.js';

/**
 * Create a sequence of steps executed in order
 *
 * @example
 * ```typescript
 * sequence(
 *   actionStep({ actions: ['draw'] }),
 *   actionStep({ actions: ['play'] })
 * )
 * ```
 */
export function sequence<G extends Game = Game>(...steps: FlowNode<G>[]): FlowNode<G> {
  return {
    type: 'sequence',
    config: { steps },
  };
}

/**
 * Create a named game phase
 *
 * Phases are named sections of the flow that can be displayed in the UI
 * (e.g., "Duel Phase", "Income Phase"). The onEnterPhase/onExitPhase
 * hooks of the flow definition are called when entering/exiting phases.
 *
 * @example
 * ```typescript
 * sequence(
 *   phase('setup', {
 *     do: simultaneousActionStep({ actions: ['chooseCharacter'] })
 *   }),
 *   phase('duel', {
 *     do: eachPlayer({ do: actionStep({ actions: ['attack', 'defend'] }) })
 *   }),
 *   phase('income', {
 *     do: execute({ fn: ctx => ctx.game.distributeIncome() })
 *   })
 * )
 * ```
 */
export function phase<G extends Game = Game>(name: string, config: { do: FlowNode<G> }): FlowNode<G> {
  return {
    type: 'phase',
    config: {
      name,
      do: config.do,
    },
  };
}

/**
 * Create a loop that repeats while a condition is true.
 *
 * A finished game (`game.finish(winners)`, or the game's own `isFinished()`)
 * ends the flow wherever it is, so `while` only needs the
 * loop's own condition.
 *
 * @example
 * ```typescript
 * // Rounds until the deck runs out, or until an action calls game.finish().
 * loop({
 *   maxIterations: 100,
 *   while: (ctx) => ctx.game.deck.count() > 0,
 *   do: eachPlayer({ do: playerTurn })
 * })
 * ```
 */
export function loop<G extends Game = Game>(config: LoopConfig<G>): FlowNode<G> {
  // The type already refuses neither and both; these checks are for rules
  // compiled without the type check, so they read the fields untyped.
  const { name, maxIterations, unbounded } = config as {
    name?: string;
    maxIterations?: number;
    unbounded?: boolean;
  };
  // Fail fast at construction time unless the author has provided a numeric
  // cap OR explicitly opted into `unbounded: true`. A missing cap with no
  // opt-in silently falls back to the engine's DEFAULT_MAX_ITERATIONS (10000),
  // which turns an authoring mistake into a surprise runtime throw deep into
  // a game session instead of an actionable error at flow-definition time.
  if (maxIterations === undefined && !unbounded) {
    throw new Error(
      `loop(${name ? `'${name}'` : ''}) requires maxIterations, or an explicit ` +
      `unbounded: true opt-in for a genuinely unbounded game.\n` +
      `  Bounded:   loop({ maxIterations: 100, while: ..., do: ... })\n` +
      `  Unbounded: loop({ unbounded: true, while: ..., do: ... })\n` +
      `  A high global safety tripwire (10000 whole-flow steps) still applies\n` +
      `  even when unbounded.\n` +
      `  See: https://boardsmith.io/docs/common-pitfalls#loop-safety`
    );
  }

  // IN-02 (164 review): `unbounded: true` combined with an explicit
  // `maxIterations` silently resolves to the bounded behavior --
  // `unbounded` becomes a no-op with no diagnostic. This is confusing enough
  // to be worth failing fast rather than warning: it's ambiguous which the
  // author actually wants (a common cause is leftover `maxIterations` from
  // before adding `unbounded: true`, or vice versa), and BoardSmith's
  // "fail fast at construction, not deep in a render/runtime path" pattern
  // (used for the missing-cap case just above) applies equally here.
  if (unbounded && maxIterations !== undefined) {
    throw new Error(
      `loop(${name ? `'${name}'` : ''}) cannot combine unbounded: true with an ` +
      `explicit maxIterations: ${maxIterations} -- choose one.\n` +
      `  Bounded:   loop({ maxIterations: ${maxIterations}, while: ..., do: ... })\n` +
      `  Unbounded: loop({ unbounded: true, while: ..., do: ... })\n` +
      `  See: https://boardsmith.io/docs/common-pitfalls#loop-safety`
    );
  }

  return { type: 'loop', config };
}

/**
 * Create a loop that repeats a fixed number of times
 *
 * @example
 * ```typescript
 * repeat(3, actionStep({ actions: ['draw'] }))
 * ```
 */
export function repeat<G extends Game = Game>(times: number, body: FlowNode<G>): FlowNode<G> {
  if (!Number.isInteger(times) || times < 0) {
    throw new Error(`repeat() needs a whole number of times, 0 or more, but got ${times}.`);
  }
  return {
    type: 'repeat',
    config: {
      times,
      do: body,
    },
  };
}

/**
 * Iterate through each player
 *
 * @example
 * ```typescript
 * eachPlayer({
 *   do: actionStep({ actions: ['takeTurn'] })
 * })
 * ```
 */
export function eachPlayer<G extends Game = Game>(config: EachPlayerConfig<G>): FlowNode<G> {
  return {
    type: 'each-player',
    config: {
      name: config.name,
      filter: config.filter,
      direction: config.direction,
      startingPlayer: config.startingPlayer,
      do: config.do,
    },
  };
}

/**
 * Iterate through a collection of items
 *
 * The collection is snapshotted once on loop entry, so a body that mutates the
 * source collection (moves items, adds items) still visits exactly the original
 * items. Two restrictions follow from that snapshot round-tripping through
 * checkpoint/restore:
 *
 * - Items must be `GameElement` instances or JSON primitives
 *   (`string | number | boolean | null`). Other object shapes throw at loop entry.
 * - A loop body must not permanently delete an element it iterates over (moving
 *   it — including to the pile via `remove()` — is fine); a deleted element throws
 *   when its iteration is reached.
 *
 * @example
 * ```typescript
 * forEach({
 *   collection: (ctx) => ctx.game.all(Card),
 *   as: 'card',
 *   do: actionStep({ ... })
 * })
 * ```
 */
export function forEach<
  T extends GameElement | string | number | boolean | null,
  G extends Game = Game,
>(config: ForEachConfig<T, G>): FlowNode<G> {
  return {
    type: 'for-each',
    config: {
      name: config.name,
      collection: config.collection,
      as: config.as,
      do: config.do,
    },
  };
}

/**
 * Pause for player action
 *
 * @example
 * ```typescript
 * actionStep({
 *   actions: ['ask'],
 * })
 * ```
 *
 * @example
 * ```typescript
 * // With move limits (action points)
 * actionStep({
 *   actions: ['move', 'attack', 'heal'],
 *   minMoves: 1,  // Must take at least 1 action
 *   maxMoves: 3,  // Can take at most 3 actions
 * })
 * ```
 */
export function actionStep<G extends Game = Game>(config: ActionStepConfig<G>): FlowNode<G> {
  return {
    type: 'action-step',
    config: {
      name: config.name,
      player: config.player,
      actions: config.actions,
      repeatUntil: config.repeatUntil,
      skipIf: config.skipIf,
      minMoves: config.minMoves,
      maxMoves: config.maxMoves,
      turnScope: config.turnScope,
      undo: config.undo,
      handoffUndo: config.handoffUndo,
      timed: config.timed,
    },
  };
}

/**
 * Pause for multiple players to act simultaneously.
 *
 * All specified players can take actions in any order until each has completed.
 *
 * ## The default `allDone` only counts seats that could act when the step opened
 *
 * On entry the step builds an AWAITING SET: every seat with at least one
 * available action. A seat with none is not added. The default completion rule
 * is "every AWAITING seat is done" — so a seat whose action is *temporarily*
 * unavailable was never in the set, is never waited for, and is skipped
 * silently. The step ends early rather than erroring.
 *
 * That is correct for a discard step ("no legal discard" means "nothing to
 * do"). It is wrong for any design where a seat can have no legal move for a
 * moment and must still act before the round ends.
 *
 * **If seats in your game can temporarily have no legal move, pass an explicit
 * `allDone`** stating the condition the round really ends on:
 *
 * ```typescript
 * simultaneousActionStep({
 *   actions: ['submitOrder'],
 *   allDone: (ctx) => ctx.game.all(Player, p => p.isActive)
 *     .every(p => p.order !== undefined),
 * })
 * ```
 *
 * A custom `allDone` is authoritative: the step stays open while it returns
 * `false` even with no eligible actor (the engine warns in dev, because that
 * state is indistinguishable from a deadlock).
 *
 * Every seat's offer is worked out again whenever any seat's action settles
 * (#1551), so a seat another seat's move gives a legal action joins the set,
 * and one whose action another seat's move ended is no longer offered it. A
 * change made outside any action admits nobody until
 * `game.refreshAwaitingActions()` (`resume` for a seat outside the set is
 * rejected with "Player N is not awaiting action"), so there `allDone` turns a
 * silent wrong answer into a visible stall. To let the seat act, keep its
 * action AVAILABLE and enforce "not yet" via `playerDone` (preferred — the
 * participant list then matches the round's real membership), or re-enter the
 * step (e.g. inside a `loop`), which rebuilds the list.
 *
 * @param config.playerDone - Per-seat completion.
 * @param config.skipPlayer - Exclude a seat from the step entirely.
 * @param config.allDone - Round-level completion. Defaults to "every awaiting
 *   seat is done" — see above before relying on it.
 * @param config.timed - The host closes the step when the table's time per
 *   turn runs out, with the game's `idleAction`; see {@link ActionStepConfig.timed}.
 *
 * @example
 * ```typescript
 * simultaneousActionStep({
 *   actions: ['discard'],
 *   playerDone: (ctx, player) => player.hand.count() <= 4,
 * })
 * ```
 */
export function simultaneousActionStep<G extends Game = Game>(config: SimultaneousActionStepConfig<G>): FlowNode<G> {
  return {
    type: 'simultaneous-action-step',
    config: {
      name: config.name,
      players: config.players,
      actions: config.actions,
      playerDone: config.playerDone,
      allDone: config.allDone,
      skipPlayer: config.skipPlayer,
      timed: config.timed,
      seatUndo: config.seatUndo,
    },
  };
}

/**
 * Branch based on a value
 *
 * @example
 * ```typescript
 * switchOn({
 *   on: (ctx) => ctx.get('phase'),
 *   cases: {
 *     'draw': drawPhase,
 *     'play': playPhase
 *   },
 *   default: endTurn
 * })
 * ```
 */
export function switchOn<G extends Game = Game>(config: SwitchConfig<G>): FlowNode<G> {
  if (Object.prototype.hasOwnProperty.call(config.cases, SWITCH_DEFAULT_KEY)) {
    const label = config.name ? `switchOn "${config.name}"` : 'switchOn';
    throw new Error(
      `${label} has a case named "${SWITCH_DEFAULT_KEY}", the name a save uses for the default branch, ` +
      `so a save in that case could not be told apart from one in the default branch. Rename the case.`
    );
  }
  return {
    type: 'switch',
    config: {
      name: config.name,
      on: config.on,
      cases: config.cases,
      default: config.default,
    },
  };
}

/**
 * Conditional execution
 *
 * @example
 * ```typescript
 * ifThen({
 *   condition: (ctx) => ctx.player.hand.isEmpty(),
 *   then: drawCards,
 *   else: playCard
 * })
 * ```
 */
export function ifThen<G extends Game = Game>(config: IfConfig<G>): FlowNode<G> {
  return {
    type: 'if',
    config: {
      name: config.name,
      condition: config.condition,
      then: config.then,
      else: config.else,
    },
  };
}

/**
 * Execute a function during flow (for side effects)
 *
 * @example
 * ```typescript
 * sequence(
 *   execute((ctx) => ctx.game.message('Starting turn')),
 *   actionStep({ actions: ['play'] })
 * )
 * ```
 *
 * ## Undo (UNDO-02)
 *
 * By default this step is UNDO-TRANSPARENT: undo and rewind may cross it,
 * because everything it touches is game state and a checkpoint restore
 * reproduces that state exactly.
 *
 * Pass `{ irreversible: true }` when the step commits something a restore
 * cannot honestly take back — above all, information reaching a human (dealing
 * or revealing hidden cards, showing a secret role). That FENCES undo/rewind:
 * no restore may target an action before it.
 *
 * @example
 * ```typescript
 * // Bookkeeping — undo may cross it (the default).
 * execute((ctx) => ctx.set('turnComplete', true))
 *
 * // The hand is now in a player's eyes. Undo must not reach behind this.
 * execute((ctx) => ctx.game.deck.deal(ctx.game.players, 7), { irreversible: true })
 * ```
 *
 * @param fn - The side effect to run
 * @param options.irreversible - Fence undo/rewind at this point. Default false.
 *   See {@link ExecuteConfig.irreversible} for how to decide.
 */
export function execute<G extends Game = Game>(
  fn: (context: FlowContext<G>) => void,
  options?: { irreversible?: boolean }
): FlowNode<G> {
  return {
    type: 'execute',
    config: { fn, ...(options?.irreversible ? { irreversible: true } : {}) },
  };
}

/**
 * Set a flow variable
 *
 * Initialize a variable (e.g. in flow setup) before reading it. Reading a
 * variable that was never set returns undefined and a `?? default` fallback
 * would silently mask a typo, so `ctx.get` warns in dev mode for unset keys.
 *
 * @example
 * ```typescript
 * // Initialize once, then increment — no `?? default` needed
 * sequence(
 *   setVar('turnCount', 0),
 *   loop({
 *     maxIterations: 100,
 *     do: setVar('turnCount', (ctx) => ctx.get<number>('turnCount')! + 1),
 *   })
 * )
 * ```
 */
export function setVar<G extends Game = Game>(
  name: string,
  value: unknown | ((context: FlowContext<G>) => unknown)
): FlowNode<G> {
  return execute((ctx) => {
    const resolvedValue = typeof value === 'function' ? (value as Function)(ctx) : value;
    ctx.set(name, resolvedValue);
  });
}
