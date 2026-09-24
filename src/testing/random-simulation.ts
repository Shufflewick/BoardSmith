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
import { enumerateActionMoves } from '../engine/utils/enumerate-moves.js';
import { createTestGame, type TestGame } from './test-game.js';
import { SeededRandom } from '../utils/random.js';

/**
 * One enumerated selection, reported to {@link SimulateRandomGamesOptions.onSelectionChoices}
 * as the simulator builds a move.
 *
 * A choice step's candidate count only exists while a game is running, so this
 * is the one place a build-time tool can learn it without re-implementing move
 * enumeration. `boardsmith validate` uses it for the choice-cardinality audit
 * (#172).
 */
export interface SelectionChoicesObservation {
  /** Name of the action being enumerated. */
  action: string;
  /** The selection definition, verbatim — carries boardRef/boardRefs/dependsOn. */
  selection: Selection;
  /** How many ENABLED candidates the step offered at this moment. */
  candidateCount: number;
}

/** Stop a single game after this many consecutive rejected actions. */
const MAX_CONSECUTIVE_FAILURES = 10;

/**
 * Says whether a game that stopped because no seat has an enabled action is
 * stopped where it is meant to rest: return the reason it rests there, or
 * `false` when it is not meant to stop there. It is handed the stopped game, so
 * it can check the final state as well as name it.
 *
 * A game built chunk by chunk has no ending until a later chunk adds one, so
 * every random game of it stops with no move left. Without this that stop is
 * `stuck`, the same verdict a flow deadlock gets (#317).
 */
export type IsResting<G extends Game> = (game: G) => string | false;

/**
 * Options for {@link simulateRandomGames}.
 */
export interface SimulateRandomGamesOptions<G extends Game = Game> {
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
  /**
   * Game-specific options forwarded to every simulated game's constructor —
   * the same values a preset or a `--game-option` flag would supply.
   *
   * Without these the harness can only ever measure a game's DEFAULT
   * configuration, so a game whose longest or heaviest mode sits behind an
   * option gets a green result that says nothing about that mode.
   *
   * The harness owns `playerCount`, `playerNames`, `seed` and `autoStart`;
   * naming one of them here throws rather than being silently overridden.
   */
  gameOptions?: Record<string, unknown>;
  /**
   * Called for every choice / element / elements selection the simulator
   * enumerates, with the count of candidates it found. An action with a
   * repeating selection is not reported: its moves are found on a scratch copy
   * of the game, where each pick's `onEach` has run. Purely observational —
   * it cannot affect the run, so a seeded simulation produces the same games
   * with or without it.
   */
  onSelectionChoices?: (observation: SelectionChoicesObservation) => void;
  /**
   * Declares where the game is meant to rest. A game that stops because no
   * seat has an enabled action is `resting` when this returns a reason, and
   * `stuck` when it returns `false` or is not given. Only that stop is
   * referred to it: a crash, a timeout, a rejected move or a move the
   * simulator cannot build stays a failure whatever this returns.
   */
  isResting?: IsResting<G>;
}

/**
 * Options for {@link replayRandomGame}.
 */
export interface ReplayRandomGameOptions<G extends Game = Game> {
  /** The exact per-game seed to replay (from {@link SingleGameResult.seed}) */
  seed: string;
  /** Player count the game was run with */
  playerCount: number;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Maximum actions before considering the game hung */
  maxActions?: number;
  /**
   * The same `gameOptions` the failing run used. A seed alone does NOT
   * reproduce a game-option-gated configuration — the options are part of the
   * repro.
   */
  gameOptions?: Record<string, unknown>;
  /** The same `isResting` the run used, so the replay gives the same verdict. */
  isResting?: IsResting<G>;
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
   * Whether the simulation got stuck: no seat had an enabled action and the
   * game did not declare that stop a rest, it could not produce a valid move
   * (e.g. an action requires input the random simulator cannot generate),
   * or generated moves were repeatedly rejected. See {@link SingleGameResult.error}.
   */
  stuck: boolean;
  /**
   * Whether the game stopped with no seat holding an enabled action, at a
   * rest its `isResting` declared. See {@link SingleGameResult.restReason}.
   */
  resting: boolean;
  /** The reason `isResting` gave, when the game is resting */
  restReason?: string;
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
  /** Number of games that got stuck (no generatable move / repeated rejections / an undeclared stop) */
  stuck: number;
  /** Number of games that stopped at a rest their `isResting` declared */
  resting: number;
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

/** The seats a flow state is waiting on, each with the actions it offers them. @internal */
function offeredSeats(flowState: FlowState): Array<{ seat: number; actionNames: string[] }> {
  if (flowState.currentPlayer !== undefined && flowState.availableActions) {
    return [{ seat: flowState.currentPlayer, actionNames: flowState.availableActions }];
  }
  return (flowState.awaitingPlayers ?? [])
    .filter((p) => !p.completed)
    .map((p) => ({ seat: p.playerIndex, actionNames: p.availableActions }));
}

/**
 * The seats that can act right now, each with its ENABLED actions, plus why
 * every refused action is refused.
 *
 * An action's `.disabled()` rule (and a tutorial gate) keeps it in the flow's
 * available actions so the panel can grey it out and say why, while the
 * server refuses it. A refused action is not a move, so it is left out here,
 * through `game.getDisabledActions`, the same channel the panel reads (#318).
 * @internal
 */
function enabledSeats(
  game: Game,
  flowState: FlowState
): { seats: Array<{ seat: number; actionNames: string[] }>; refused: string[] } {
  const seats: Array<{ seat: number; actionNames: string[] }> = [];
  const refused: string[] = [];
  for (const { seat, actionNames } of offeredSeats(flowState)) {
    const disabled = game.getDisabledActions(seat);
    const enabled = actionNames.filter((name) => !(name in disabled));
    const blocked = actionNames.filter((name) => name in disabled);
    refused.push(...blocked.map((name) => `player ${seat}'s '${name}' (${disabled[name].replace(/\.$/, '')})`));
    if (enabled.length > 0) seats.push({ seat, actionNames: enabled });
  }
  return { seats, refused };
}

/**
 * Resolve a selection's count config -- a `multiSelect` set or an `orderedList`
 * sequence (#249) -- into concrete {min, max}, or null if the selection is
 * single-valued. Both are written the same three ways (a number, a config, or a
 * function of context), which is why one parser answers for both.
 * @internal
 */
function resolveBounds(
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
    if (sel?.type === 'element' || sel?.type === 'elements') {
      // An array is a chooseElements pick or a repeating selection's picks.
      out[key] = Array.isArray(value)
        ? (value as GameElement[]).map(e => e.id)
        : (value as GameElement).id;
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
  rng: SeededRandom,
  onSelectionChoices?: (observation: SelectionChoicesObservation) => void
): { ok: true; args: Record<string, unknown> } | { ok: false; reason: string } {
  // A repeating selection's picks change the game (`onEach`) as they are made,
  // so what each pick may be is only known by making them. The engine's move
  // enumerator does exactly that on a scratch copy (#325); one of its moves is
  // the random move. Its selections are not reported to `onSelectionChoices`:
  // their candidates exist only on that copy.
  if (game.getActionExecutor().hasRepeatingSelections(actionDef)) {
    const moves = enumerateActionMoves(game, actionDef, player);
    if (moves.length === 0) {
      return {
        ok: false,
        reason: `action '${actionDef.name}' has a repeating selection and no sequence of picks that ends it`,
      };
    }
    return { ok: true, args: serializeArgs(rng.pick(moves), actionDef.selections) };
  }

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
    onSelectionChoices?.({ action: actionDef.name, selection: sel, candidateCount: choices.length });

    // AN ORDERED, REPEATABLE LIST (#249) is sampled WITH replacement: the same
    // identity may fill more than one entry, which is the one thing a set draw
    // cannot produce and therefore the one thing a random game would never
    // exercise if this fell through to the multiSelect path.
    const orderedListRaw =
      sel.type === 'choice' ? (sel as ChoiceSelection).orderedList : undefined;
    if (orderedListRaw !== undefined) {
      const bounds = resolveBounds(orderedListRaw, ctx);
      if (bounds) {
        if (choices.length === 0) {
          if (bounds.min <= 0 || optional) {
            if (bounds.min <= 0) working[sel.name] = [];
            continue;
          }
          return {
            ok: false,
            reason: `action '${actionDef.name}' selection '${sel.name}' needs at least ${bounds.min} entr(y/ies) but no choices are available`,
          };
        }
        const maxEntries = bounds.max === Infinity ? Math.max(bounds.min, choices.length) : bounds.max;
        const count = bounds.min + rng.nextInt(maxEntries - bounds.min + 1);
        working[sel.name] = Array.from({ length: count }, () => rng.pick(choices));
        continue;
      }
    }

    const multiSelectRaw =
      sel.type === 'choice'
        ? (sel as ChoiceSelection).multiSelect
        : sel.type === 'elements'
          ? (sel as ElementsSelection).multiSelect
          : undefined;
    // 'elements' selections always yield an array; default to "any non-empty subset".
    const multi =
      resolveBounds(multiSelectRaw, ctx) ?? (sel.type === 'elements' ? { min: 1, max: Infinity } : null);

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
  rng: SeededRandom,
  onSelectionChoices?: (observation: SelectionChoicesObservation) => void
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
    const built = buildRandomArgs(game, actionDef, player, rng, onSelectionChoices);
    if (built.ok) {
      moves.push({ name, args: built.args });
    } else {
      reasons.push(built.reason);
    }
  }

  return { moves, reasons };
}

/**
 * Options the harness itself supplies to every simulated game. A caller-set
 * `gameOptions` entry with one of these names would be silently overwritten,
 * so it is refused instead.
 * @internal
 */
const HARNESS_OWNED_OPTIONS = ['playerCount', 'playerNames', 'seed', 'autoStart'] as const;

/**
 * Reject a `gameOptions` bundle that names an option the harness controls.
 * @internal
 */
function assertGameOptionsAreGameSpecific(gameOptions: Record<string, unknown> | undefined): void {
  if (!gameOptions) return;
  const clashes = HARNESS_OWNED_OPTIONS.filter((key) => key in gameOptions);
  if (clashes.length > 0) {
    throw new Error(
      `gameOptions cannot set ${clashes.join(', ')} — the simulation harness supplies ` +
        `${HARNESS_OWNED_OPTIONS.join(', ')} itself. ` +
        `Use the playerCounts and seed options to vary those, and keep gameOptions for ` +
        `your game's own options.`,
    );
  }
}

/** What one simulated game is played with. @internal */
interface SingleGameConfig<G extends Game> {
  playerCount: number;
  seed: string;
  timeout: number;
  maxActions: number;
  gameOptions: Record<string, unknown> | undefined;
  onSelectionChoices: ((observation: SelectionChoicesObservation) => void) | undefined;
  isResting: IsResting<G> | undefined;
}

/**
 * Ask the game's `isResting` about a game that stopped with no enabled action.
 * Returns the rest reason, or `undefined` when the stop is not a declared rest.
 * @internal
 */
function declaredRest<G extends Game>(isResting: IsResting<G> | undefined, game: G): string | undefined {
  if (!isResting) return undefined;
  const reason = isResting(game);
  if (reason === false) return undefined;
  if (reason.trim() === '') {
    throw new Error(
      'isResting returned an empty reason. Return a sentence saying why the game rests here, ' +
        'or false when it is not meant to stop here.',
    );
  }
  return reason;
}

/**
 * Run a single random game simulation.
 * @internal
 */
async function simulateSingleGame<G extends Game>(
  GameClass: new (options: GameOptions) => G,
  config: SingleGameConfig<G>,
): Promise<SingleGameResult> {
  const { playerCount, seed, timeout, maxActions, gameOptions, onSelectionChoices, isResting } = config;
  const startTime = Date.now();
  const rng = new SeededRandom(seed);

  let testGame: TestGame<G>;
  let actionCount = 0;
  let timedOut = false;
  let exceededMaxActions = false;
  let stuck = false;
  let stuckReason: string | undefined;
  let restReason: string | undefined;
  let consecutiveFailures = 0;

  try {
    testGame = createTestGame(GameClass, {
      // Game-specific options first: the four keys the harness owns are
      // refused up front, so nothing here can shadow them.
      ...gameOptions,
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

      const { seats, refused } = enabledSeats(testGame.game, flowState);
      if (seats.length === 0) {
        restReason = declaredRest(isResting, testGame.game);
        if (restReason !== undefined) break;
        stuck = true;
        stuckReason =
          'Game is awaiting input but no player has an enabled action to take.' +
          (refused.length > 0 ? ` Refused: ${refused.join('; ')}.` : '') +
          ' If the game is meant to rest here until a rule not built yet ends it, declare that ' +
          'with isResting in a simulateRandomGames test; otherwise the flow is deadlocked.';
        break;
      }
      const actor = rng.pick(seats);

      const { moves, reasons } = buildRandomMoves(
        testGame,
        actor.seat,
        actor.actionNames,
        rng,
        onSelectionChoices,
      );
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
      // Uses tryAction (not doAction) so the consecutiveFailures retry branch
      // below keeps working as a normal control-flow branch, not a throw.
      const result = testGame.tryAction(actor.seat, move.name, move.args);

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
      resting: restReason !== undefined,
      ...(restReason !== undefined ? { restReason } : {}),
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
      resting: false,
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
  options: ReplayRandomGameOptions<G>
): Promise<SingleGameResult> {
  const { seed, playerCount, timeout = 5000, maxActions = 10000, gameOptions, isResting } = options;
  assertGameOptionsAreGameSpecific(gameOptions);
  return simulateSingleGame(GameClass, {
    playerCount,
    seed,
    timeout,
    maxActions,
    gameOptions,
    onSelectionChoices: undefined,
    isResting,
  });
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
  options: SimulateRandomGamesOptions<G>
): Promise<SimulationResults> {
  const {
    count,
    playerCounts,
    seed: baseSeed = crypto.randomUUID(),
    timeout = 5000,
    maxActions = 10000,
    onGameComplete,
    gameOptions,
  } = options;

  assertGameOptionsAreGameSpecific(gameOptions);

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

      const result = await simulateSingleGame(GameClass, {
        playerCount,
        seed,
        timeout,
        maxActions,
        gameOptions,
        onSelectionChoices: options.onSelectionChoices,
        isResting: options.isResting,
      });

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
  const resting = games.filter(g => g.resting).length;

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
    resting,
    total,
    games,
    averageActions,
    averageDuration,
    errors: [...errors],
    seed: baseSeed,
  };
}
