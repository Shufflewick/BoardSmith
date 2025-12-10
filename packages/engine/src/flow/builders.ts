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
 *   prompt: 'Ask another player for cards'
 * })
 * ```
 */
export function actionStep(config: {
  name?: string;
  player?: (context: FlowContext) => Player;
  actions: string[] | ((context: FlowContext) => string[]);
  prompt?: string | ((context: FlowContext) => string);
  repeatUntil?: (context: FlowContext) => boolean;
  skipIf?: (context: FlowContext) => boolean;
  timeout?: number;
}): FlowNode {
  return {
    type: 'action-step',
    config: {
      name: config.name,
      player: config.player,
      actions: config.actions,
      prompt: config.prompt,
      repeatUntil: config.repeatUntil,
      skipIf: config.skipIf,
      timeout: config.timeout,
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
  prompt?: string | ((context: FlowContext) => string);
  repeatUntil?: (context: FlowContext) => boolean;
  skipIf?: (context: FlowContext) => boolean;
}): FlowNode {
  return actionStep({
    name: config.name,
    actions: config.actions,
    prompt: config.prompt,
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
 *   prompt: 'Discard 2 cards to the crib'
 * })
 * ```
 */
export function simultaneousActionStep(config: {
  name?: string;
  players?: (context: FlowContext) => Player[];
  actions: string[] | ((context: FlowContext, player: Player) => string[]);
  prompt?: string | ((context: FlowContext) => string);
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
      prompt: config.prompt,
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
 */
export function defineFlow(config: {
  setup?: (context: FlowContext) => void;
  root: FlowNode;
  isComplete?: (context: FlowContext) => boolean;
  getWinners?: (context: FlowContext) => Player[];
}): FlowDefinition {
  return {
    setup: config.setup,
    root: config.root,
    isComplete: config.isComplete,
    getWinners: config.getWinners,
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
