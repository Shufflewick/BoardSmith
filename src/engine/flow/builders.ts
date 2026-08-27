import type { Game, PlayerOf } from '../element/game.js';
import type { GameElement } from '../element/game-element.js';
import type {
  FlowNode,
  FlowContext,
  SequenceConfig,
  LoopConfig,
  EachPlayerConfig,
  ForEachConfig,
  ActionStepConfig,
  SimultaneousActionStepConfig,
  SwitchConfig,
  IfConfig,
  FlowDefinition,
  PhaseConfig,
  TurnScope,
} from './types.js';

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
 * (e.g., "Combat Phase", "Income Phase"). The onEnterPhase/onExitPhase
 * hooks in defineFlow will be called when entering/exiting phases.
 *
 * @example
 * ```typescript
 * sequence(
 *   phase('setup', {
 *     do: simultaneousActionStep({ actions: ['chooseCharacter'] })
 *   }),
 *   phase('combat', {
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
 * Create a loop that repeats while a condition is true
 *
 * @example
 * ```typescript
 * loop({
 *   while: (ctx) => !ctx.game.isFinished(),
 *   do: eachPlayer({ do: playerTurn })
 * })
 * ```
 */
export function loop<G extends Game = Game>(config: {
  name?: string;
  while?: (context: FlowContext<G>) => boolean;
  maxIterations?: number;
  /**
   * Opt-in for a genuinely unbounded game — makes `maxIterations` optional.
   * The global whole-flow safety tripwire still applies even when set.
   */
  unbounded?: boolean;
  do: FlowNode<G>;
}): FlowNode<G> {
  // Fail fast at construction time unless the author has provided a numeric
  // cap OR explicitly opted into `unbounded: true`. A missing cap with no
  // opt-in silently falls back to the engine's DEFAULT_MAX_ITERATIONS (10000),
  // which turns an authoring mistake into a surprise runtime throw deep into
  // a game session instead of an actionable error at flow-definition time.
  if (config.maxIterations === undefined && !config.unbounded) {
    throw new Error(
      `loop(${config.name ? `'${config.name}'` : ''}) requires maxIterations, or an explicit ` +
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
  if (config.unbounded && config.maxIterations !== undefined) {
    throw new Error(
      `loop(${config.name ? `'${config.name}'` : ''}) cannot combine unbounded: true with an ` +
      `explicit maxIterations: ${config.maxIterations} -- choose one.\n` +
      `  Bounded:   loop({ maxIterations: ${config.maxIterations}, while: ..., do: ... })\n` +
      `  Unbounded: loop({ unbounded: true, while: ..., do: ... })\n` +
      `  See: https://boardsmith.io/docs/common-pitfalls#loop-safety`
    );
  }

  return {
    type: 'loop',
    config: {
      name: config.name,
      while: config.while,
      maxIterations: config.maxIterations,
      unbounded: config.unbounded,
      do: config.do,
    },
  };
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
export function eachPlayer<G extends Game = Game>(config: {
  name?: string;
  filter?: (player: PlayerOf<G>, context: FlowContext<G>) => boolean;
  direction?: 'forward' | 'backward';
  startingPlayer?: (context: FlowContext<G>) => PlayerOf<G>;
  do: FlowNode<G>;
}): FlowNode<G> {
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
>(config: {
  name?: string;
  collection: T[] | ((context: FlowContext<G>) => T[]);
  as: string;
  do: FlowNode<G>;
}): FlowNode<G> {
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
export function actionStep<G extends Game = Game>(config: {
  name?: string;
  player?: (context: FlowContext<G>) => PlayerOf<G>;
  actions: string[] | ((context: FlowContext<G>) => string[]);
  repeatUntil?: (context: FlowContext<G>) => boolean;
  skipIf?: (context: FlowContext<G>) => boolean;
  minMoves?: number;
  maxMoves?: number;
  turnScope?: TurnScope;
}): FlowNode<G> {
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
    },
  };
}

/**
 * Shorthand for a single repeating action step
 *
 * @example
 * ```typescript
 * playerActions({
 *   actions: ['ask'],
 *   repeatUntil: (ctx) => ctx.get('turnEnded')
 * })
 * ```
 */
export function playerActions<G extends Game = Game>(config: {
  name?: string;
  actions: string[] | ((context: FlowContext<G>) => string[]);
  repeatUntil?: (context: FlowContext<G>) => boolean;
  skipIf?: (context: FlowContext<G>) => boolean;
}): FlowNode<G> {
  return actionStep({
    name: config.name,
    actions: config.actions,
    repeatUntil: config.repeatUntil,
    skipIf: config.skipIf,
  });
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
 * It is not a complete fix on its own, though — the awaiting set never grows
 * within one entry, so a seat outside it still cannot act (`resume` is rejected
 * with "Player N is not awaiting action"). `allDone` converts a silent wrong
 * answer into a visible stall. To let the seat actually act, either keep its
 * action AVAILABLE and enforce "not yet" via `playerDone` (preferred — the
 * participant list then matches the round's real membership), or re-enter the
 * step (e.g. inside a `loop`), which rebuilds the list.
 *
 * @param config.playerDone - Per-seat completion.
 * @param config.skipPlayer - Exclude a seat from the step entirely.
 * @param config.allDone - Round-level completion. Defaults to "every awaiting
 *   seat is done" — see above before relying on it.
 *
 * @example
 * ```typescript
 * simultaneousActionStep({
 *   actions: ['discard'],
 *   playerDone: (ctx, player) => player.hand.count() <= 4,
 * })
 * ```
 */
export function simultaneousActionStep<G extends Game = Game>(config: {
  name?: string;
  players?: (context: FlowContext<G>) => PlayerOf<G>[];
  actions: string[] | ((context: FlowContext<G>, player: PlayerOf<G>) => string[]);
  playerDone?: (context: FlowContext<G>, player: PlayerOf<G>) => boolean;
  allDone?: (context: FlowContext<G>) => boolean;
  skipPlayer?: (context: FlowContext<G>, player: PlayerOf<G>) => boolean;
}): FlowNode<G> {
  return {
    type: 'simultaneous-action-step',
    config: {
      name: config.name,
      players: config.players,
      actions: config.actions,
      playerDone: config.playerDone,
      allDone: config.allDone,
      skipPlayer: config.skipPlayer,
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
export function switchOn<G extends Game = Game>(config: {
  name?: string;
  on: (context: FlowContext<G>) => unknown;
  cases: Record<string, FlowNode<G>>;
  default?: FlowNode<G>;
}): FlowNode<G> {
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
export function ifThen<G extends Game = Game>(config: {
  name?: string;
  condition: (context: FlowContext<G>) => boolean;
  then: FlowNode<G>;
  else?: FlowNode<G>;
}): FlowNode<G> {
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
 * Create a complete flow definition
 *
 * @example
 * ```typescript
 * defineFlow({
 *   setup: (ctx) => {
 *     ctx.game.create(Deck, 'deck');
 *     // ... deal cards
 *   },
 *   root: loop({
 *     while: (ctx) => !ctx.game.isFinished(),
 *     do: eachPlayer({ do: playerTurn })
 *   }),
 *   isComplete: (ctx) => allBooksCollected(ctx),
 *   getWinners: (ctx) => findPlayersWithMostBooks(ctx)
 * })
 * ```
 *
 * @example
 * ```typescript
 * // With phase hooks
 * defineFlow({
 *   root: sequence(
 *     phase('setup', { do: ... }),
 *     phase('main', { do: ... })
 *   ),
 *   onEnterPhase: (phaseName, ctx) => {
 *     ctx.game.message(`Entering ${phaseName} phase`);
 *   },
 *   onExitPhase: (phaseName, ctx) => {
 *     ctx.game.message(`Exiting ${phaseName} phase`);
 *   }
 * })
 * ```
 */
export function defineFlow<G extends Game = Game>(config: {
  setup?: (context: FlowContext<G>) => void;
  root: FlowNode<G>;
  isComplete?: (context: FlowContext<G>) => boolean;
  getWinners?: (context: FlowContext<G>) => PlayerOf<G>[];
  onEnterPhase?: (phaseName: string, context: FlowContext<G>) => void;
  onExitPhase?: (phaseName: string, context: FlowContext<G>) => void;
}): FlowDefinition<G> {
  return {
    setup: config.setup,
    root: config.root,
    isComplete: config.isComplete,
    getWinners: config.getWinners,
    onEnterPhase: config.onEnterPhase,
    onExitPhase: config.onExitPhase,
  };
}

/**
 * Create a "do nothing" node (useful as placeholder or in conditionals)
 */
export function noop<G extends Game = Game>(): FlowNode<G> {
  return sequence();
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

/**
 * A simplified loop for turn-based action sequences.
 *
 * This is syntactic sugar for the common pattern of looping while a condition
 * is true, with automatic game.isFinished() checking. It reduces boilerplate
 * for turn loops that need custom continuation conditions.
 *
 * @example
 * ```typescript
 * // Simple turn loop - continue while player has actions remaining
 * turnLoop({
 *   actions: ['move', 'attack', 'endTurn'],
 *   while: (ctx) => ctx.player.actionsRemaining > 0,
 * })
 * ```
 *
 * @example
 * ```typescript
 * // With all options
 * turnLoop({
 *   name: 'rebel-action-loop',
 *   actions: ['move', 'explore', 'train', 'endTurn'],
 *   while: (ctx) => {
 *     const player = ctx.player as RebelPlayer;
 *     return player.team.some(m => m.actionsRemaining > 0);
 *   },
 *   maxIterations: 30,
 * })
 * ```
 *
 * @example
 * ```typescript
 * // Minimal - just loop until endTurn or game ends
 * turnLoop({
 *   actions: ['playCard', 'drawCard', 'endTurn'],
 * })
 * ```
 *
 * This is equivalent to:
 * ```typescript
 * loop({
 *   while: (ctx) => !ctx.game.isFinished() && customCondition(ctx),
 *   do: actionStep({ actions: [...] }),
 * })
 * ```
 */
export function turnLoop<G extends Game = Game>(config: {
  /** Optional name for debugging */
  name?: string;
  /** Actions available during the loop */
  actions: string[] | ((context: FlowContext<G>) => string[]);
  /** Continue looping while this returns true. Game.isFinished() is checked automatically. */
  while?: (context: FlowContext<G>) => boolean;
  /** Safety limit to prevent infinite loops (default: 100 unless `unbounded`) */
  maxIterations?: number;
  /**
   * LIBX-02 / F-16: opt-in for a genuinely unbounded game, forwarded to
   * `loop()` so the valve is reachable from this convenience builder (not just
   * raw `loop()`). Omits the default 100 cap; the global whole-flow tripwire
   * still applies. Cannot be combined with an explicit `maxIterations`
   * (`loop()` fails fast on that).
   */
  unbounded?: boolean;
  /**
   * Whether a second pass round this loop continues the same seat's turn or
   * starts a new one, forwarded to the action step it builds. Deliberately
   * undefaulted: the name says "turn loop", but the builder is used both for a
   * single seat's multi-action turn (`'continue'`) and as a whole game's turn
   * rotation (`'restart'`), and only the author knows which. See
   * {@link ActionStepConfig.turnScope}.
   */
  turnScope?: TurnScope;
}): FlowNode<G> {
  return loop({
    name: config.name,
    while: (ctx) => {
      // Always stop if game is finished
      if (ctx.game.isFinished()) return false;
      // Check custom condition if provided
      if (config.while) {
        return config.while(ctx);
      }
      // Default: continue forever (until endTurn action or game ends)
      return true;
    },
    // F-16: only apply the default cap when NOT unbounded — loop() throws if
    // `unbounded` is combined with a defined `maxIterations`.
    maxIterations: config.unbounded ? config.maxIterations : (config.maxIterations ?? 100),
    unbounded: config.unbounded,
    do: actionStep({
      actions: config.actions,
      turnScope: config.turnScope,
    }),
  });
}

/**
 * A state-aware loop that checks for pending async game state before exiting.
 *
 * Use this instead of loop() or turnLoop() when your game has async state
 * (like combat resolution) that must complete before the loop can exit.
 *
 * The key insight: A regular loop's `while` condition might become false
 * (e.g., player has no actions left), but there could be pending game state
 * (e.g., active combat) that needs resolution first. This helper ensures
 * the loop continues until all pending states are resolved.
 *
 * @example
 * ```typescript
 * // Combat game - keep looping while combat is pending, even if no actions left
 * stateAwareLoop({
 *   name: 'merc-action-loop',
 *   actions: ['move', 'attack', 'endTurn'],
 *   while: (ctx) => {
 *     const player = ctx.player as MercPlayer;
 *     return player.team.some(m => m.actionsRemaining > 0);
 *   },
 *   pendingStates: (ctx) => [
 *     (ctx.game as MercGame).activeCombat,    // Combat waiting for resolution
 *     (ctx.game as MercGame).pendingCombat,   // Combat about to start
 *   ],
 * })
 * ```
 *
 * @example
 * ```typescript
 * // Simple case - just check one pending state
 * stateAwareLoop({
 *   actions: ['playCard', 'endTurn'],
 *   pendingStates: (ctx) => [ctx.game.pendingAnimation],
 * })
 * ```
 *
 * @example
 * ```typescript
 * // A composite body: act, then drain whatever the action queued (#35). This
 * // is the shape the MERC-style example above actually needs — a bare
 * // actionStep cannot both take the action and resolve what it produced.
 * stateAwareLoop({
 *   name: 'rebel-phase',
 *   while: (ctx) => (ctx.game as MercGame).rebelsHaveActions(),
 *   pendingStates: (ctx) => [(ctx.game as MercGame).pendingCombat],
 *   do: sequence(
 *     actionStep({ actions: ['move', 'attack'], player: (ctx) => ctx.game.getPlayer(1)! }),
 *     execute((ctx) => (ctx.game as MercGame).drainPendingCombat()),
 *   ),
 * })
 * ```
 */
export function stateAwareLoop<G extends Game = Game>(config: {
  /** Optional name for debugging */
  name?: string;
  /**
   * Actions available during the loop — the simple form, which wraps them in an
   * `actionStep` for you. Mutually exclusive with `do`.
   */
  actions?: string[] | ((context: FlowContext<G>) => string[]);
  /**
   * The loop body, for anything an `actionStep` alone cannot express: a
   * sequence that acts and then drains the pending state it produced, a phase
   * with several steps in it (#35).
   *
   * This is the shape the builder's own documented example needs. Without it,
   * a game whose body is a sequence had to hand-roll the entire pending-state
   * guard, which is what this builder exists to remove.
   *
   * Mutually exclusive with `actions`.
   */
  do?: FlowNode<G>;
  /**
   * Who acts, when the body is the built-in `actionStep`. Mirrors
   * `actionStep`'s own `player` (#35). Ignored when `do` is supplied — the body
   * owns its own actors then.
   */
  player?: (context: FlowContext<G>) => PlayerOf<G>;
  /**
   * Skip the body for this iteration. Mirrors `actionStep`'s own `skipIf`
   * (#35), and applies to a composite `do` body too.
   */
  skipIf?: (context: FlowContext<G>) => boolean;
  /** Continue looping while this returns true. Game.isFinished() is checked automatically. */
  while?: (context: FlowContext<G>) => boolean;
  /**
   * Return an array of pending state values to check.
   * If ANY of these are truthy, the loop continues even if `while` returns false.
   * This ensures async game state (like combat) is resolved before the loop exits.
   */
  pendingStates?: (context: FlowContext<G>) => unknown[];
  /** Safety limit to prevent infinite loops (default: 100 unless `unbounded`) */
  maxIterations?: number;
  /**
   * LIBX-02 / F-16: opt-in for a genuinely unbounded game, forwarded to
   * `loop()` (the valve is otherwise unreachable from this convenience
   * builder). Omits the default 100 cap; the global whole-flow tripwire still
   * applies. Cannot be combined with an explicit `maxIterations`.
   */
  unbounded?: boolean;
  /**
   * Whether a second pass round this loop continues the same seat's turn or
   * starts a new one, forwarded to the action step it builds. Ignored when
   * `do` is supplied -- the body owns its own steps then. See
   * {@link ActionStepConfig.turnScope}.
   */
  turnScope?: TurnScope;
}): FlowNode<G> {
  // Two ways to say what the body is, and exactly one must be used. Accepting
  // both would mean silently ignoring one of them.
  if (config.actions !== undefined && config.do !== undefined) {
    throw new Error(
      'stateAwareLoop: pass either `actions` (the built-in action step) or `do` (your own body), not both. ' +
        'With `do`, put the actions in the actionStep inside it.',
    );
  }
  if (config.actions === undefined && config.do === undefined) {
    throw new Error(
      'stateAwareLoop: needs a body — pass `actions` for a single action step, or `do` for a sequence.',
    );
  }

  const body: FlowNode<G> = config.do ?? actionStep({
    actions: config.actions!,
    ...(config.player ? { player: config.player } : {}),
    ...(config.skipIf ? { skipIf: config.skipIf } : {}),
    ...(config.turnScope ? { turnScope: config.turnScope } : {}),
  });

  return loop({
    name: config.name,
    while: (ctx) => {
      // Always stop if game is finished
      if (ctx.game.isFinished()) return false;

      // Keep looping if any pending state exists (even if while() would return false)
      if (config.pendingStates) {
        const pending = config.pendingStates(ctx);
        if (pending.some(state => !!state)) {
          return true; // Must resolve pending state before exiting
        }
      }

      // Check custom condition
      if (config.while) {
        return config.while(ctx);
      }

      // Default: continue forever (until endTurn action or game ends)
      return true;
    },
    // F-16: only apply the default cap when NOT unbounded (see turnLoop).
    maxIterations: config.unbounded ? config.maxIterations : (config.maxIterations ?? 100),
    unbounded: config.unbounded,
    // `skipIf` on a COMPOSITE body cannot ride on the actionStep (there may be
    // several, or none), so it gates the whole iteration here instead.
    do: config.do && config.skipIf
      ? ifThen({ condition: (ctx) => !config.skipIf!(ctx), then: body })
      : body,
  });
}
