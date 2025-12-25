import type { Player } from '../player/player.js';
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
export function sequence(...steps: FlowNode[]): FlowNode {
  return {
    type: 'sequence',
    config: { steps },
  };
}

/**
 * Create a sequence with a name
 */
export function namedSequence(name: string, ...steps: FlowNode[]): FlowNode {
  return {
    type: 'sequence',
    config: { name, steps },
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
export function phase(name: string, config: { do: FlowNode }): FlowNode {
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
export function loop(config: {
  name?: string;
  while?: (context: FlowContext) => boolean;
  maxIterations?: number;
  do: FlowNode;
}): FlowNode {
  return {
    type: 'loop',
    config: {
      name: config.name,
      while: config.while,
      maxIterations: config.maxIterations,
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
export function repeat(times: number, body: FlowNode): FlowNode {
  let count = 0;
  return loop({
    while: () => {
      count++;
      return count <= times;
    },
    maxIterations: times,
    do: body,
  });
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
export function eachPlayer(config: {
  name?: string;
  filter?: (player: Player, context: FlowContext) => boolean;
  direction?: 'forward' | 'backward';
  startingPlayer?: (context: FlowContext) => Player;
  do: FlowNode;
}): FlowNode {
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
 * @example
 * ```typescript
 * forEach({
 *   collection: (ctx) => ctx.game.all(Card),
 *   as: 'card',
 *   do: actionStep({ ... })
 * })
 * ```
 */
export function forEach<T>(config: {
  name?: string;
  collection: T[] | ((context: FlowContext) => T[]);
  as: string;
  do: FlowNode;
}): FlowNode {
  return {
    type: 'for-each',
    config: {
      name: config.name,
      collection: config.collection as unknown[] | ((context: FlowContext) => unknown[]),
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
export function actionStep(config: {
  name?: string;
  player?: (context: FlowContext) => Player;
  actions: string[] | ((context: FlowContext) => string[]);
  repeatUntil?: (context: FlowContext) => boolean;
  skipIf?: (context: FlowContext) => boolean;
  timeout?: number;
  minMoves?: number;
  maxMoves?: number;
}): FlowNode {
  return {
    type: 'action-step',
    config: {
      name: config.name,
      player: config.player,
      actions: config.actions,
      repeatUntil: config.repeatUntil,
      skipIf: config.skipIf,
      timeout: config.timeout,
      minMoves: config.minMoves,
      maxMoves: config.maxMoves,
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
export function playerActions(config: {
  name?: string;
  actions: string[] | ((context: FlowContext) => string[]);
  repeatUntil?: (context: FlowContext) => boolean;
  skipIf?: (context: FlowContext) => boolean;
}): FlowNode {
  return actionStep({
    name: config.name,
    actions: config.actions,
    repeatUntil: config.repeatUntil,
    skipIf: config.skipIf,
  });
}

/**
 * Pause for multiple players to act simultaneously
 *
 * All specified players can take actions in any order until each has completed.
 * The step completes when all players have finished (determined by playerDone or allDone).
 *
 * @example
 * ```typescript
 * simultaneousActionStep({
 *   actions: ['discard'],
 *   playerDone: (ctx, player) => player.hand.count() <= 4,
 * })
 * ```
 */
export function simultaneousActionStep(config: {
  name?: string;
  players?: (context: FlowContext) => Player[];
  actions: string[] | ((context: FlowContext, player: Player) => string[]);
  playerDone?: (context: FlowContext, player: Player) => boolean;
  allDone?: (context: FlowContext) => boolean;
  skipPlayer?: (context: FlowContext, player: Player) => boolean;
  timeout?: number;
}): FlowNode {
  return {
    type: 'simultaneous-action-step',
    config: {
      name: config.name,
      players: config.players,
      actions: config.actions,
      playerDone: config.playerDone,
      allDone: config.allDone,
      skipPlayer: config.skipPlayer,
      timeout: config.timeout,
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
export function switchOn(config: {
  name?: string;
  on: (context: FlowContext) => unknown;
  cases: Record<string, FlowNode>;
  default?: FlowNode;
}): FlowNode {
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
export function ifThen(config: {
  name?: string;
  condition: (context: FlowContext) => boolean;
  then: FlowNode;
  else?: FlowNode;
}): FlowNode {
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
export function defineFlow(config: {
  setup?: (context: FlowContext) => void;
  root: FlowNode;
  isComplete?: (context: FlowContext) => boolean;
  getWinners?: (context: FlowContext) => Player[];
  onEnterPhase?: (phaseName: string, context: FlowContext) => void;
  onExitPhase?: (phaseName: string, context: FlowContext) => void;
}): FlowDefinition {
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
export function noop(): FlowNode {
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
 */
export function execute(fn: (context: FlowContext) => void): FlowNode {
  return {
    type: 'execute',
    config: { fn },
  };
}

/**
 * Set a flow variable
 *
 * @example
 * ```typescript
 * setVar('turnCount', (ctx) => (ctx.get('turnCount') ?? 0) + 1)
 * ```
 */
export function setVar(
  name: string,
  value: unknown | ((context: FlowContext) => unknown)
): FlowNode {
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
export function turnLoop(config: {
  /** Optional name for debugging */
  name?: string;
  /** Actions available during the loop */
  actions: string[] | ((context: FlowContext) => string[]);
  /** Continue looping while this returns true. Game.isFinished() is checked automatically. */
  while?: (context: FlowContext) => boolean;
  /** Safety limit to prevent infinite loops (default: 100) */
  maxIterations?: number;
}): FlowNode {
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
    maxIterations: config.maxIterations ?? 100,
    do: actionStep({
      actions: config.actions,
    }),
  });
}
