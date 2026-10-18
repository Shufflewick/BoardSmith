/**
 * The one game loop of the simulator (#556): plays one seeded game to its end,
 * asking each seat's policy for its moves. `simulateRandomGames` and
 * `boardsmith simulate` both play every game through {@link playGame}.
 *
 * @module
 */
import type { Game, FlowState, PublishedFollowUp } from '../engine/index.js';
import { dueSeats, availableActionsForSeat, followUpForSeat } from '../engine/index.js';
import { refuseChangeSince } from '../engine/element/state-version.js';
import { encodeValue } from '../engine/element/game-element.js';
import { endOfGameRecords, type GameMetrics, type MetricRecord, type MetricSink } from '../engine/metrics.js';
import { createTestGame, type TestGame } from '../testing/test-game.js';
import { SeededRandom } from '../utils/random.js';
import type { Policy, SimulatedGame } from './policies.js';

/** The move's args as the action history would write them, or a plain note when they cannot be written. */
function describeMove(args: Record<string, unknown>, game: Game, action: string): string {
  try {
    return `the move ${JSON.stringify(encodeValue(args, game._ctx, `action '${action}'`, 'args'))}`;
  } catch {
    return 'a move that could not be shown';
  }
}

/**
 * Says whether a game has reached the place it is meant to rest: return the
 * reason it rests there, or `false` when it is not there. The simulator asks it
 * after every move it applies to a game that has not ended, handing it the game
 * as that move left it, and stops the game as `resting` the first time it
 * returns a reason. So it can check the resting state as well as name it.
 *
 * A game built chunk by chunk has no ending until a later chunk adds one. Its
 * random games either stop with no move left, which without this is `stuck`,
 * the same verdict a flow deadlock gets (#317), or keep acting forever, which
 * without this runs to `timeout` or `maxActions` (#383).
 */
export type IsResting<G extends Game> = (game: G) => string | false;

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
   * or the game rejected a move a policy chose. See {@link SingleGameResult.error}.
   */
  stuck: boolean;
  /**
   * Whether the game stopped at a rest its `isResting` declared, after the
   * move that reached it. See {@link SingleGameResult.restReason}.
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
  /**
   * The game's author metrics, totalled: the records of its construction and
   * the flow's start, of each committed action, and (when the game completed)
   * the end-of-game reads, once per player.
   */
  metrics: GameMetricSummary;
}


/**
 * The seats a flow state is waiting on, each with the actions it offers them,
 * answered by the engine's one rule for who may act (`dueSeats`). @internal
 */
function offeredSeats(flowState: FlowState): Array<{ seat: number; actionNames: string[] }> {
  return dueSeats(flowState).map((seat) => ({
    seat,
    actionNames: availableActionsForSeat(flowState, seat),
  }));
}

/**
 * The seats that can act right now (with an ENABLED action or a held
 * follow-up, #911), each with its enabled actions, plus why every refused
 * action is refused.
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
): { seats: Array<{ seat: number; actionNames: string[]; followUp?: PublishedFollowUp }>; refused: string[] } {
  const seats: Array<{ seat: number; actionNames: string[]; followUp?: PublishedFollowUp }> = [];
  const refused: string[] = [];
  for (const { seat, actionNames } of offeredSeats(flowState)) {
    const disabled = game.getDisabledActions(seat);
    const enabled = actionNames.filter((name) => !(name in disabled));
    const blocked = actionNames.filter((name) => name in disabled);
    refused.push(...blocked.map((name) => `player ${seat}'s '${name}' (${disabled[name].replace(/\.$/, '')})`));
    const followUp = followUpForSeat(flowState, seat);
    if (enabled.length > 0 || followUp) seats.push({ seat, actionNames: enabled, followUp });
  }
  return { seats, refused };
}

/**
 * Whether the game is waiting on input that no seat can give: every seat it
 * waits on has each offered action refused. This is the stop the simulator
 * reports as "no player has an enabled action to take".
 */
export function noSeatHasEnabledAction(game: Game): boolean {
  const flowState = game.getFlowState();
  return game.isAwaitingInput() && flowState !== undefined && enabledSeats(game, flowState).seats.length === 0;
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


/**
 * Ask the game's `isResting` about the game a move just left.
 * Returns the rest reason, or `undefined` when the game is not at a declared rest.
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
 * The seed of game `index` at `playerCount` in a run seeded `baseSeed`.
 * Re-running with the same base seed reproduces the game, and the seed alone
 * replays it.
 */
export function gameSeed(baseSeed: string, playerCount: number, index: number): string {
  return `${baseSeed}-${playerCount}-${index}`;
}

/**
 * One game's author metrics, totalled as it is played: what the report needs
 * and nothing more.
 */
export interface GameMetricSummary {
  /** Count or category -> key ('' when not keyed) -> its total. */
  totals: Record<string, Record<string, number>>;
  /** Sample -> every value, in the order kept; finalScore -> each seat's score, seat 1 first. */
  values: Record<string, number[]>;
  /** Segment -> each seat's label, seat 1 first. */
  labels: Record<string, string[]>;
}

/** Fold kept records into a game's summary, by each metric's kind. */
function addRecords(summary: GameMetricSummary, metrics: GameMetrics, records: MetricRecord[]): void {
  for (const { metric, key, value } of records) {
    const kind = metrics[metric].kind;
    if (kind === 'count' || kind === 'category') {
      const totals = (summary.totals[metric] ??= {});
      totals[key] = (totals[key] ?? 0) + value;
    } else if (kind === 'segment') {
      (summary.labels[metric] ??= [])[value - 1] = key;
    } else {
      (summary.values[metric] ??= []).push(value);
    }
  }
}

/**
 * The author metrics of one simulated game. Only the live game gets the sink,
 * through its constructor options (`sink`), which no copy or restore inherits.
 * A definition with no metrics (`simulateRandomGames`) records nothing, as in
 * real play.
 */
function metricRecorder(metrics: GameMetrics | undefined) {
  const sink: MetricSink = { declared: metrics ?? {}, pending: [] };
  const summary: GameMetricSummary = { totals: {}, values: {}, labels: {} };
  /** A refused record ends the game, even when game code caught the throw. */
  const check = () => {
    if (sink.refused) throw sink.refused;
  };
  return {
    summary,
    sink: metrics === undefined ? undefined : sink,
    check,
    /** Refuse records made outside a step the simulator plays: only a policy's turn runs between steps. */
    refuseStray: (who: string) => {
      const [stray] = sink.pending;
      if (stray === undefined) return;
      throw new Error(`${who}: metric '${stray.metric}' was recorded on the simulated game while it chose a move. A policy must only read the game.`);
    },
    /** Drop the records of a refused or rolled-back action. */
    discard: () => {
      sink.pending = [];
    },
    /** Keep the records of the step that just committed. */
    keep: () => {
      check();
      if (metrics) addRecords(summary, metrics, sink.pending);
      sink.pending = [];
    },
    /** Add the end-of-game reads. */
    end: (game: Game) => {
      if (metrics) addRecords(summary, metrics, endOfGameRecords(metrics, game));
    },
  };
}

/** What one simulated game is played with. */
export interface PlayGameConfig<G extends Game> {
  playerCount: number;
  /** The game's own seed. The seat-to-move and per-seat policy generators are derived from it. */
  seed: string;
  /** One policy per seat, seat 1 first. */
  policies: readonly Policy[];
  /** Stop the game as hung after this many actions. */
  maxActions: number;
  /** Stop the game as timed out after this many milliseconds. Without it, only `maxActions` stops a game. */
  timeout?: number;
  gameOptions?: Record<string, unknown>;
  isResting?: IsResting<G>;
}

/**
 * Refuse a player count outside the game's declared range, and a policy list
 * that does not give one policy per seat.
 */
function assertSeatsMatch<G extends Game>(definition: SimulatedGame<G>, config: PlayGameConfig<G>): void {
  const { playerCount, policies } = config;
  const { minPlayers = playerCount, maxPlayers = playerCount } = definition;
  if (playerCount < minPlayers || playerCount > maxPlayers) {
    throw new Error(
      `Cannot simulate ${playerCount} players: the game is for ${minPlayers} to ${maxPlayers} players.`,
    );
  }
  if (policies.length !== playerCount) {
    throw new Error(
      `A game of ${playerCount} seats needs one policy per seat, but ${policies.length} policies were given.`,
    );
  }
}

/**
 * Play one seeded game to its end. The game draws from `seed`; which of
 * several due seats moves is drawn from its own generator; and each seat's
 * policy draws from that seat's own generator, so changing one seat's policy
 * does not change another seat's draws. A policy whose work changes the game
 * ends the game as crashed, naming the policy.
 *
 * A bad player count, policy list or `gameOptions` throws; everything the game
 * or a policy does is reported on the result.
 */
export async function playGame<G extends Game>(
  definition: SimulatedGame<G>,
  config: PlayGameConfig<G>,
): Promise<SingleGameResult> {
  const { playerCount, seed, policies, timeout = Infinity, maxActions, gameOptions, isResting } = config;
  assertSeatsMatch(definition, config);
  assertGameOptionsAreGameSpecific(gameOptions);
  const startTime = Date.now();
  const mover = new SeededRandom(`${seed}:mover`);
  const seatRandom = policies.map((_, i) => new SeededRandom(`${seed}:seat-${i + 1}`));

  let testGame: TestGame<G>;
  let actionCount = 0;
  let timedOut = false;
  let exceededMaxActions = false;
  let stuck = false;
  let stuckReason: string | undefined;
  let restReason: string | undefined;
  const recorder = metricRecorder(definition.metrics);

  try {
    testGame = createTestGame(definition.gameClass, {
      // Game-specific options first: the four keys the harness owns are
      // refused up front, so nothing here can shadow them.
      ...gameOptions,
      playerCount,
      seed,
      autoStart: false,
      metricSink: recorder.sink,
    });
    testGame.start();
    recorder.keep();

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
        stuck = true;
        stuckReason =
          'Game is awaiting input but no player has an enabled action to take.' +
          (refused.length > 0 ? ` Refused: ${refused.join('; ')}.` : '') +
          ' If the game is meant to rest here until a rule not built yet ends it, declare that ' +
          'with isResting in a simulateRandomGames test; otherwise the flow is deadlocked.';
        break;
      }
      const actor = mover.pick(seats);
      const policy = policies[actor.seat - 1];
      const version = testGame.game._ctx._stateVersion;
      const choice = await policy.choose({
        game: testGame.game,
        seat: actor.seat,
        actions: actor.actionNames,
        followUp: actor.followUp,
        random: seatRandom[actor.seat - 1],
        definition,
      });
      recorder.check();
      refuseChangeSince(
        testGame.game._ctx,
        version,
        `policy '${policy.name}'`,
        'a policy picks a move and the simulator plays it.',
      );
      if ('noMove' in choice) {
        stuck = true;
        stuckReason = choice.noMove;
        break;
      }

      // tryAction (not doAction) so a rejection below is reported as stuck, not a crash.
      recorder.refuseStray(`policy '${policy.name}'`);
      const result = testGame.tryAction(actor.seat, choice.action, choice.args);
      recorder.check();

      if (result.success) {
        recorder.keep();
        actionCount++;
        if (!testGame.isComplete()) {
          restReason = declaredRest(isResting, testGame.game);
          if (restReason !== undefined) break;
        }
        continue;
      }

      // The game rejected the move a policy chose: fail the game on the first one (#910).
      recorder.discard();
      stuck = true;
      stuckReason =
        `Action '${choice.action}' rejected ${describeMove(choice.args, testGame.game, choice.action)}, chosen by policy '${policy.name}': ` +
        `${(result.error ?? 'unknown error').replace(/\.$/, '')}. A simulated game fails on its first rejected move: ` +
        'an action must accept every move its enabled choices offer, and a policy must choose only from them.';
      break;
    }

    const duration = Date.now() - startTime;
    const completed = testGame.isComplete();
    if (completed) recorder.end(testGame.game);

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
      metrics: recorder.summary,
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
      metrics: recorder.summary,
    };
  }
}
