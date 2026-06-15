/**
 * Random game simulation for BoardSmith games.
 *
 * Run many random games to verify game completeness, find bugs,
 * and check for edge cases.
 *
 * @module
 */

import type {
  Game,
  GameOptions,
  FlowState,
  ActionDefinition,
  Selection,
  NumberSelection,
  ChoiceSelection,
  ElementsSelection,
  Player,
  GameElement,
} from '../engine/index.js';
import { createTestGame, type TestGame } from './test-game.js';
import { SeededRandom } from '../utils/random.js';

/** Stop a single game after this many consecutive rejected actions. */
const MAX_CONSECUTIVE_FAILURES = 10;

/**
 * Options for {@link simulateRandomGames}.
 */
export interface SimulateRandomGamesOptions {
  /** Number of games to simulate */
  count: number;
  /** Player counts to test (will run games with each count) */
  playerCounts: number[];
  /**
   * Base seed for the whole run. Per-game seeds are derived deterministically
   * from it, so re-running with the same base seed reproduces the same games.
   * When omitted, a random base seed is generated and returned on
   * {@link SimulationResults.seed} so a run can still be replayed.
   */
  seed?: string;
  /** Timeout per game in milliseconds */
  timeout?: number;
  /** Maximum actions per game before considering it hung */
  maxActions?: number;
  /** Called after each game completes (for progress reporting) */
  onGameComplete?: (result: SingleGameResult, progress: { completed: number; total: number }) => void;
}

/**
 * Options for {@link replayRandomGame}.
 */
export interface ReplayRandomGameOptions {
  /** The exact per-game seed to replay (from {@link SingleGameResult.seed}) */
  seed: string;
  /** Player count the game was run with */
  playerCount: number;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Maximum actions before considering the game hung */
  maxActions?: number;
}

/**
 * Result of a single simulated game.
 */
export interface SingleGameResult {
  /** Whether the game completed successfully */
  completed: boolean;
  /** Whether the game crashed with an error */
  crashed: boolean;
  /** Whether the game timed out */
  timedOut: boolean;
  /** Whether the game exceeded max actions */
  exceededMaxActions: boolean;
  /**
   * Whether the simulation got stuck: it could not produce a valid move
   * (e.g. an action requires input the random simulator cannot generate),
   * or generated moves were repeatedly rejected. See {@link SingleGameResult.error}.
   */
  stuck: boolean;
  /** Error message if crashed, or the reason the simulation got stuck */
  error?: string;
  /** Number of actions taken */
  actionCount: number;
  /** Time taken in milliseconds */
  duration: number;
  /** Player count for this game */
  playerCount: number;
  /** Seed used for this game (feed back into {@link replayRandomGame} to reproduce) */
  seed: string;
  /** Winner indices (if completed) */
  winners?: number[];
}

/**
 * Aggregated results from random game simulation.
 */
export interface SimulationResults {
  /** Number of games that completed successfully */
  completed: number;
  /** Number of games that crashed */
  crashed: number;
  /** Number of games that timed out */
  timedOut: number;
  /** Number of games that exceeded max actions */
  exceededMaxActions: number;
  /** Number of games that got stuck (no generatable move / repeated rejections) */
  stuck: number;
  /** Total games run */
  total: number;
  /** Individual game results */
  games: SingleGameResult[];
  /** Average actions per completed game */
  averageActions: number;
  /** Average duration per completed game */
  averageDuration: number;
  /** Errors encountered (deduplicated) */
  errors: string[];
  /** Base seed used for this run (re-run with this to reproduce all games) */
  seed: string;
}

/**
 * Picks the player who should act and the actions available to them.
 * Handles both single-player action steps and simultaneous-action steps.
 * @internal
 */
function chooseActor(
  flowState: FlowState,
  rng: SeededRandom
): { seat: number; actionNames: string[] } | undefined {
  if (
    flowState.currentPlayer !== undefined &&
    flowState.availableActions &&
    flowState.availableActions.length > 0
  ) {
    return { seat: flowState.currentPlayer, actionNames: flowState.availableActions };
  }

  if (flowState.awaitingPlayers && flowState.awaitingPlayers.length > 0) {
    const candidates = flowState.awaitingPlayers.filter(
      p => !p.completed && p.availableActions.length > 0
    );
    if (candidates.length > 0) {
      const chosen = rng.pick(candidates);
      return { seat: chosen.playerIndex, actionNames: chosen.availableActions };
    }
  }

  return undefined;
}

/**
 * Resolve a selection's multiSelect config into concrete {min, max}, or null
 * if the selection is single-valued.
 * @internal
 */
function resolveMultiSelect(
  raw: unknown,
  ctx: { game: Game; player: Player; args: Record<string, unknown> }
): { min: number; max: number } | null {
  const value = typeof raw === 'function' ? (raw as (c: typeof ctx) => unknown)(ctx) : raw;
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return { min: 1, max: value };
  const cfg = value as { min?: number; max?: number };
  return { min: cfg.min ?? 1, max: cfg.max ?? Infinity };
}

/**
 * Convert in-progress arg values (element objects kept for dependent filters)
 * into the wire form the engine expects (element IDs).
 * @internal
 */
function serializeArgs(
  working: Record<string, unknown>,
  selections: Selection[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(working)) {
    const sel = selections.find(s => s.name === key);
    if (sel?.type === 'element') {
      out[key] = (value as GameElement).id;
    } else if (sel?.type === 'elements') {
      out[key] = (value as GameElement[]).map(e => e.id);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Build one random, valid set of arguments for an action using the engine's
 * own choice introspection. Returns the buildable args, or a reason the action
 * cannot be randomly driven (so the caller can surface it instead of spinning).
 * @internal
 */
function buildRandomArgs(
  game: Game,
  actionDef: ActionDefinition,
  player: Player,
  rng: SeededRandom
): { ok: true; args: Record<string, unknown> } | { ok: false; reason: string } {
  // Keep element objects in `working` so dependent selections receive proper
  // objects; serialize to IDs only at the end.
  const working: Record<string, unknown> = {};

  for (const sel of actionDef.selections) {
    const optional = sel.optional !== undefined && sel.optional !== false;
    const ctx = { game, player, args: working };

    if (sel.type === 'text') {
      if (optional) continue;
      return {
        ok: false,
        reason: `action '${actionDef.name}' requires text input '${sel.name}', which the random simulator cannot generate`,
      };
    }

    if (sel.type === 'number') {
      const ns = sel as NumberSelection;
      if (ns.min === undefined || ns.max === undefined) {
        if (optional) continue;
        return {
          ok: false,
          reason: `action '${actionDef.name}' requires number input '${sel.name}' without both min and max bounds, which the random simulator cannot generate`,
        };
      }
      const lo = ns.integer ? Math.ceil(ns.min) : ns.min;
      const hi = ns.integer ? Math.floor(ns.max) : ns.max;
      if (hi < lo) {
        if (optional) continue;
        return {
          ok: false,
          reason: `action '${actionDef.name}' number input '${sel.name}' has an empty range [${ns.min}, ${ns.max}]`,
        };
      }
      working[sel.name] = ns.integer ? lo + rng.nextInt(hi - lo + 1) : lo + rng.next() * (hi - lo);
      continue;
    }

    // choice / element / elements -- driven by engine-provided choices
    const annotated = game.getSelectionChoices(actionDef.name, sel.name, player, working);
    const choices = annotated.filter(c => c.disabled === false).map(c => c.value);

    const multiSelectRaw =
      sel.type === 'choice'
        ? (sel as ChoiceSelection).multiSelect
        : sel.type === 'elements'
          ? (sel as ElementsSelection).multiSelect
          : undefined;
    // 'elements' selections always yield an array; default to "any non-empty subset".
    const multi =
      resolveMultiSelect(multiSelectRaw, ctx) ?? (sel.type === 'elements' ? { min: 1, max: Infinity } : null);

    if (multi) {
      if (choices.length < multi.min) {
        if (optional) continue;
        return {
          ok: false,
          reason: `action '${actionDef.name}' selection '${sel.name}' needs at least ${multi.min} choice(s) but only ${choices.length} are available`,
        };
      }
      const maxPick = Math.min(multi.max === Infinity ? choices.length : multi.max, choices.length);
      const minPick = Math.max(multi.min, 0);
      const count = minPick + rng.nextInt(maxPick - minPick + 1);
      working[sel.name] = rng.shuffle(choices).slice(0, count);
      continue;
    }

    if (choices.length === 0) {
      if (optional) continue;
      return {
        ok: false,
        reason: `action '${actionDef.name}' selection '${sel.name}' has no selectable choices`,
      };
    }
    working[sel.name] = rng.pick(choices);
  }

  return { ok: true, args: serializeArgs(working, actionDef.selections) };
}

/**
 * Build the set of fully-specified random moves available to a player by
 * driving the engine's action/choice introspection. Returns the buildable
 * moves and, separately, the reasons any actions could not be built (used to
 * produce an actionable "stuck" message rather than silently spinning).
 * @internal
 */
function buildRandomMoves<G extends Game>(
  testGame: TestGame<G>,
  seat: number,
  actionNames: string[],
  rng: SeededRandom
): { moves: Array<{ name: string; args: Record<string, unknown> }>; reasons: string[] } {
  const game = testGame.game;
  const player = game.getPlayer(seat);
  if (!player) {
    return { moves: [], reasons: [`player ${seat} not found`] };
  }

  const moves: Array<{ name: string; args: Record<string, unknown> }> = [];
  const reasons: string[] = [];

  for (const name of actionNames) {
    const actionDef = game.getAction(name);
    if (!actionDef) {
      reasons.push(`action '${name}' is not registered on the game`);
      continue;
    }
    const built = buildRandomArgs(game, actionDef, player, rng);
    if (built.ok) {
      moves.push({ name, args: built.args });
    } else {
      reasons.push(built.reason);
    }
  }

  return { moves, reasons };
}

/**
 * Run a single random game simulation.
 * @internal
 */
async function simulateSingleGame<G extends Game>(
  GameClass: new (options: GameOptions) => G,
  playerCount: number,
  seed: string,
  timeout: number,
  maxActions: number
): Promise<SingleGameResult> {
  const startTime = Date.now();
  const rng = new SeededRandom(seed);

  let testGame: TestGame<G>;
  let actionCount = 0;
  let timedOut = false;
  let exceededMaxActions = false;
  let stuck = false;
  let stuckReason: string | undefined;
  let consecutiveFailures = 0;

  try {
    testGame = createTestGame(GameClass, {
      playerCount,
      seed,
      autoStart: true,
    });

    // Run game until complete or limits reached
    while (!testGame.isComplete()) {
      if (Date.now() - startTime > timeout) {
        timedOut = true;
        break;
      }

      if (actionCount >= maxActions) {
        exceededMaxActions = true;
        break;
      }

      // Not complete and not awaiting input: the flow is stuck.
      if (!testGame.isAwaitingInput()) {
        stuck = true;
        stuckReason =
          'Game is neither complete nor awaiting input -- the flow stalled without a terminal state.';
        break;
      }

      const flowState = testGame.getFlowState();
      if (!flowState) {
        stuck = true;
        stuckReason = 'Game is awaiting input but exposes no flow state.';
        break;
      }

      const actor = chooseActor(flowState, rng);
      if (!actor) {
        stuck = true;
        stuckReason =
          'Game is awaiting input but no player has any available action to take.';
        break;
      }

      const { moves, reasons } = buildRandomMoves(testGame, actor.seat, actor.actionNames, rng);
      if (moves.length === 0) {
        stuck = true;
        stuckReason =
          `No playable move for player ${actor.seat}. ` +
          (reasons.length > 0 ? `Reasons: ${reasons.join('; ')}. ` : '') +
          'The random simulator generates valid arguments from action choices; ' +
          'actions needing free-form input (text, unbounded numbers) must be made optional ' +
          'or driven by a custom harness.';
        break;
      }

      const move = rng.pick(moves);
      const result = testGame.doAction(actor.seat, move.name, move.args);

      if (result.success) {
        actionCount++;
        consecutiveFailures = 0;
        continue;
      }

      // A move built from the engine's own choices was rejected. That is a real
      // inconsistency between availability and validation -- surface it loudly
      // rather than retrying forever.
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        stuck = true;
        stuckReason =
          `${consecutiveFailures} consecutive actions generated from valid choices were rejected. ` +
          `Last: action '${move.name}' failed with: ${result.error ?? 'unknown error'}. ` +
          'This indicates the action\'s reported choices disagree with its validation.';
        break;
      }
    }

    const duration = Date.now() - startTime;
    const completed = testGame.isComplete();

    return {
      completed,
      crashed: false,
      timedOut,
      exceededMaxActions,
      stuck,
      error: stuckReason,
      actionCount,
      duration,
      playerCount,
      seed,
      winners: completed ? testGame.getWinners().map(p => p.seat) : undefined,
    };
  } catch (error) {
    return {
      completed: false,
      crashed: true,
      timedOut: false,
      exceededMaxActions: false,
      stuck: false,
      error: error instanceof Error ? error.message : String(error),
      actionCount,
      duration: Date.now() - startTime,
      playerCount,
      seed,
    };
  }
}

/**
 * Replay a single game by its exact seed.
 *
 * Use this to reproduce a failure found by {@link simulateRandomGames}: pass the
 * `seed` and `playerCount` from the failing {@link SingleGameResult}.
 *
 * @example
 * ```typescript
 * const results = await simulateRandomGames(GoFishGame, { count: 100, playerCounts: [2] });
 * const failure = results.games.find(g => g.crashed || g.stuck);
 * if (failure) {
 *   // Deterministically reproduce the exact game that failed.
 *   const repro = await replayRandomGame(GoFishGame, {
 *     seed: failure.seed,
 *     playerCount: failure.playerCount,
 *   });
 * }
 * ```
 */
export async function replayRandomGame<G extends Game>(
  GameClass: new (options: GameOptions) => G,
  options: ReplayRandomGameOptions
): Promise<SingleGameResult> {
  const { seed, playerCount, timeout = 5000, maxActions = 10000 } = options;
  return simulateSingleGame(GameClass, playerCount, seed, timeout, maxActions);
}

/**
 * Simulate multiple random games to verify game completeness.
 *
 * Runs many games with random (but valid) moves to find bugs, verify all games
 * can complete, and check for edge cases across different player counts. Moves
 * and their arguments are generated from each action's own choice introspection,
 * so games whose actions take arguments are exercised correctly.
 *
 * Per-game seeds are derived deterministically from {@link SimulateRandomGamesOptions.seed}
 * (or a generated base seed, surfaced on {@link SimulationResults.seed}). Any failing
 * game can be reproduced with {@link replayRandomGame} using its reported `seed`.
 *
 * @param GameClass - The game class constructor
 * @param options - Simulation configuration
 * @returns Aggregated results including completion rate, errors, and timing
 *
 * @example
 * ```typescript
 * const results = await simulateRandomGames(GoFishGame, {
 *   count: 100,
 *   playerCounts: [2, 3, 4],
 *   timeout: 5000,
 * });
 *
 * expect(results.completed).toBe(100);
 * expect(results.crashed).toBe(0);
 * expect(results.stuck).toBe(0);
 * ```
 */
export async function simulateRandomGames<G extends Game>(
  GameClass: new (options: GameOptions) => G,
  options: SimulateRandomGamesOptions
): Promise<SimulationResults> {
  const {
    count,
    playerCounts,
    seed: baseSeed = crypto.randomUUID(),
    timeout = 5000,
    maxActions = 10000,
    onGameComplete,
  } = options;

  const games: SingleGameResult[] = [];
  const errors = new Set<string>();
  let total = 0;

  // Distribute games across player counts
  const gamesPerPlayerCount = Math.ceil(count / playerCounts.length);

  for (const playerCount of playerCounts) {
    for (let i = 0; i < gamesPerPlayerCount && total < count; i++) {
      // Deterministic per-game seed: re-running with the same base seed
      // reproduces this exact game; the seed is also replayable on its own.
      const seed = `${baseSeed}-${playerCount}-${i}`;

      const result = await simulateSingleGame(
        GameClass,
        playerCount,
        seed,
        timeout,
        maxActions
      );

      games.push(result);
      total++;

      if (result.error) {
        errors.add(result.error);
      }

      if (onGameComplete) {
        onGameComplete(result, { completed: total, total: count });
      }
    }
  }

  // Calculate aggregates
  const completed = games.filter(g => g.completed).length;
  const crashed = games.filter(g => g.crashed).length;
  const timedOut = games.filter(g => g.timedOut).length;
  const exceededMaxActions = games.filter(g => g.exceededMaxActions).length;
  const stuck = games.filter(g => g.stuck).length;

  const completedGames = games.filter(g => g.completed);
  const averageActions = completedGames.length > 0
    ? completedGames.reduce((sum, g) => sum + g.actionCount, 0) / completedGames.length
    : 0;
  const averageDuration = completedGames.length > 0
    ? completedGames.reduce((sum, g) => sum + g.duration, 0) / completedGames.length
    : 0;

  return {
    completed,
    crashed,
    timedOut,
    exceededMaxActions,
    stuck,
    total,
    games,
    averageActions,
    averageDuration,
    errors: [...errors],
    seed: baseSeed,
  };
}
