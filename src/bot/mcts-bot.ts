import type {
  Game,
  GameOptions,
  FlowState,
  ActionDefinition,
  Selection,
  FollowUpAction,
} from '../engine/index.js';
import type { GameStateSnapshot, SeatSnapshot } from '../engine/utils/index.js';
import { canSeatAct, dueSeats, availableActionsForSeat, followUpForSeat } from '../engine/index.js';
import { isElement } from '../engine/element/game-element.js';
import { createSnapshot, createSeatSnapshot, snapshotTree } from '../engine/utils/index.js';
import { enumerateActionMoves } from '../engine/utils/enumerate-moves.js';
import { constructGame } from '../engine/element/game.js';
import type {
  BotConfig, BotMove, BotMoveStats, MCTSNode, BotStrategy, Objective, ThreatResponse,
  DeterminizeSampler,
} from './types.js';
import { DEFAULT_CONFIG } from './types.js';
import { applyDeterminization } from './determinization.js';
import { SeededRandom, mintSeed } from '../utils/random.js';
import { isDevMode } from '../utils/dev.js';

/** Game class constructor type */
type GameClass<G extends Game = Game> = new (options: GameOptions) => G;

/**
 * The most moves the root keeps, and the most arg sets one action contributes
 * below it, to bound the search's branching.
 */
const MAX_SAMPLED_ARGS = 20;

/**
 * The most memory one search's saved copies may hold (#633): 32 MiB, a quarter
 * of a 128 MB Workers isolate, which leaves the rest for the live game, the
 * root snapshot, the search tree and the session around them. A copy of hex
 * 19x19 is 84 KB early in a game, so the budget holds a few hundred of them;
 * chess, checkers and the card games are smaller.
 */
const SAVED_COPY_BUDGET_BYTES = 32 * 1024 * 1024;

/** A move made on a search step, and the seat that made it, for the RAVE table. */
type TreeMove = { move: BotMove; player: number };

/**
 * What became of a move the search made in the world it is in (#421).
 * `refusedAfterChanges` is a refusal that may have changed the game first, so
 * the world matches no position the move sequence can reach.
 */
type SearchMoveOutcome = 'made' | 'refused' | 'refusedAfterChanges';

/**
 * A search's steps (#669): how many it made, how many were scored (the rest
 * were thrown away), whether it chose at random because no root move could be
 * played through, why the first thrown-away step failed, and why the game
 * first refused a move cleanly (#874).
 */
type SearchSteps = { made: number; scored: number; choseAtRandom: boolean; firstFailure?: string; firstRefusal?: string };

/** Add a sub-search's steps into `total`: a parallel bot's move is one search, split. */
function addSearchSteps(total: SearchSteps, sub: SearchSteps): void {
  total.made += sub.made;
  total.scored += sub.scored;
  total.firstFailure ??= sub.firstFailure;
  total.firstRefusal ??= sub.firstRefusal;
  total.choseAtRandom &&= sub.choseAtRandom;
}

/** An object literal, not a class instance: the only objects whose fields a move's args are walked through. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && Object.getPrototypeOf(v) === Object.prototype;
}

/**
 * MCTS (Monte-Carlo Tree Search) Bot
 *
 * Implements the UCT algorithm for game-agnostic bot:
 * 1. SELECT: Walk tree using UCT formula to find promising leaf
 * 2. EXPAND: Try one unexplored action from that leaf
 * 3. PLAYOUT: Random moves until game ends (up to playoutDepth)
 * 4. BACKPROPAGATE: Update win counts up the tree
 *
 * Each iteration restores the search game whole, from the root snapshot or
 * from a saved copy of a node on its path, then the rest of the tree path and
 * the playout moves are applied to it. Moves are never undone. The restore
 * costs time in proportion to the game's element tree, once per iteration;
 * a saved copy spares making the moves above it again (#633).
 */
export class MCTSBot<G extends Game = Game> {
  private game: G;
  private GameClass: GameClass<G>;
  private gameType: string;
  private playerIndex: number;
  private config: BotConfig;
  private objectives?: (game: Game, playerIndex: number) => Record<string, Objective>;
  private threatResponseMoves?: (game: Game, playerIndex: number, availableMoves: BotMove[]) => ThreatResponse;
  private playoutPolicy?: (game: Game, playerIndex: number, availableMoves: BotMove[], rng: () => number) => BotMove;
  private moveOrdering?: (game: Game, playerIndex: number, moves: BotMove[]) => BotMove[];
  private uctConstant?: (game: Game, playerIndex: number) => number;
  /**
   * The game's declared world sampler (#73). Its presence, and nothing else,
   * is what switches this search from "skip what cannot be resolved" to
   * information-set MCTS. Absent for every game without hidden state.
   */
  private determinize?: DeterminizeSampler;
  private rng: SeededRandom;
  private seed?: string;
  /** Cached UCT exploration constant (computed once per move in playSingle) */
  private cachedUctC: number = Math.sqrt(2);
  /** Warn at most once per bot about a truncated seeded search (see below). */
  private warnedSeededTruncation = false;
  /** The last search's steps, for the warning about thrown-away steps (#669). */
  private searchSteps: SearchSteps = { made: 0, scored: 0, choseAtRandom: false };

  /** Live game instance used during search (cloned from original) */
  private searchGame: G | null = null;
  /** Root snapshot for fallback recovery */
  private rootSnapshot: SeatSnapshot | null = null;
  /**
   * Saved copies of the search game at tree nodes (#633): each the JSON of a
   * snapshot of the position the node stands for, so it is restored whole and
   * nothing a later move does can change it. Only kept without a world sampler,
   * and only for positions that no move on the way drew randomness for (see
   * {@link saveCopyOf}). Dropped when the search ends.
   */
  private savedCopies = new Map<MCTSNode, string>();
  /** What the saved copies hold, in bytes as V8 stores the strings. */
  private savedCopyBytes = 0;
  /** At most this many bytes of saved copies; past it, steps make moves again. */
  private savedCopyBudget = SAVED_COPY_BUDGET_BYTES;
  /** Set once a copy did not fit the budget: no more are made this search. */
  private savedCopiesFull = false;
  /** The game's random position when this step's search game was restored. */
  private resumedRandomState?: string;
  /**
   * T-159-07 (bot-02): pre-reveal baseline clone of searchGame, captured the
   * moment a fresh simultaneous step begins (before any co-decider's action
   * mutates the shared searchGame). `resumeSimultaneousAction` applies each
   * co-decider's action to the LIVE game immediately (no deferred reveal),
   * so without this baseline a later co-decider's move enumeration would
   * read an earlier co-decider's already-committed effects. All co-decider
   * enumeration within one simultaneous step reads from this frozen clone
   * instead of the mutating searchGame. Cleared once the step fully
   * resolves (no awaitingPlayers left) so it never leaks into unrelated
   * future steps.
   */
  private simultaneousBaseline?: G;
  /**
   * Root move keys a `threatResponseMoves` hook forced for THIS search (#73).
   * Only set when the game said a block is mandatory; the per-world root
   * refresh must not widen past it. Undefined for every other search.
   */
  private forcedRootMoveKeys?: Set<string>;
  /** RAVE table for move value estimation across all playouts */
  private raveTable: Map<string, { visits: number; value: number }> = new Map();

  constructor(
    game: G,
    GameClass: GameClass<G>,
    gameType: string,
    playerIndex: number,
    config: Partial<BotConfig> = {},
    botStrategy?: BotStrategy
  ) {
    this.game = game;
    this.GameClass = GameClass;
    this.gameType = gameType;
    this.playerIndex = playerIndex;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.objectives = botStrategy?.objectives;
    this.threatResponseMoves = botStrategy?.threatResponseMoves;
    this.playoutPolicy = botStrategy?.playoutPolicy;
    this.moveOrdering = botStrategy?.moveOrdering;
    this.uctConstant = botStrategy?.uctConstant;
    this.determinize = botStrategy?.determinize;
    this.seed = this.config.seed;
    this.rng = new SeededRandom(this.config.seed ?? mintSeed());
  }

  // ============================================================================
  // SECTION: Core Algorithm
  // Purpose: Main MCTS loop implementing SELECT, EXPAND, PLAYOUT, BACKPROPAGATE
  // ============================================================================

  /**
   * Why the last {@link play} returned `null`, or `undefined` when it returned
   * a move. Read this to report a stalled seat rather than infer one (#29).
   */
  lastStallReason?: string;

  /**
   * Run MCTS and return the best move, or `null` when this bot's own
   * information state offers nothing to search.
   *
   * `null` is NOT an error (#29). The search sandbox is built from this seat's
   * REDACTED payload — which is right, a bot must search what it can actually
   * know — so per-seat redaction can empty the very choice list the seat's only
   * action draws from, while the authoritative game offers that seat a full move
   * list. Throwing there escaped through `executeOp` as a raw exception, the
   * dev host logged it and returned, the covered seat never acted, and a
   * simultaneous step could not close its round: one seat's blind spot locked
   * the whole table. A `null` stalls that seat alone, and {@link lastStallReason}
   * says why so the host can report it.
   *
   * The underlying gap — that a bot cannot search a state it cannot see —
   * is #19/#31, and this does not close it.
   */
  async play(): Promise<BotMove | null> {
    // No more sub-searches than iterations, so each runs at least one (#876).
    const subSearches = Math.min(this.config.parallel ?? 1, this.config.iterations);
    if (subSearches > 1) return this.playParallel(subSearches);
    const { move } = await this.runSearch();
    this.warnIfStepsWereDropped(this.searchSteps);
    return move;
  }

  /**
   * Run MCTS and return the best move together with per-candidate evaluation stats.
   *
   * Always runs a single-mode search regardless of the `parallel` config value.
   * Parallel ensemble searches aggregate by vote count across independent trees,
   * which loses per-child stats — forcing single mode is intentional.
   *
   * Stats are captured from root.children BEFORE the post-search cleanup discards
   * the tree, so callers always receive a valid (possibly empty) stats array.
   */
  async playWithStats(): Promise<{ move: BotMove | null; stats: BotMoveStats[] }> {
    // Force single-mode search — parallel mode loses per-child stats.
    const { move, root } = await this.runSearch();
    this.warnIfStepsWereDropped(this.searchSteps);
    if (!move || !root) return { move: null, stats: [] };
    const stats: BotMoveStats[] = root.children.map(child => ({
      move: child.parentMove!,
      visits: child.visits,
      value: child.visits > 0 ? child.value / child.visits : 0,
    }));
    return { move, stats };
  }

  /**
   * Run multiple independent MCTS searches, each with its own random source,
   * then aggregate results by voting on the best move.
   *
   * This provides diversity benefit: each search explores different
   * parts of the game tree due to randomization, reducing blind spots.
   *
   * The move most sub-searches chose wins. A split vote goes to the move the
   * sub-searches visited most in total, and a tie there to a pick from this
   * bot's own random source. Taking the first sub-search's move on a split
   * made every other sub-search's work count only when it agreed, so a
   * `parallel: 2` bot was a single search of half the iterations (#427).
   *
   * The sub-searches run one after another and share the bot's one `timeout`:
   * each gets an equal share of the time still left, so the whole move stays
   * within `timeout` (#634). An infinite timeout stays infinite for each.
   */
  private async playParallel(parallelCount: number): Promise<BotMove | null> {
    const iterationsPerSearch = Math.floor(this.config.iterations / parallelCount);
    const deadline = Date.now() + (this.config.timeout ?? 2000);

    // Votes and summed root visits for each move any sub-search chose or explored.
    const tally = new Map<string, { votes: number; visits: number; move: BotMove }>();
    const entryFor = (move: BotMove) => {
      const key = this.getMoveKey(move);
      let entry = tally.get(key);
      if (!entry) {
        entry = { votes: 0, visits: 0, move };
        tally.set(key, entry);
      }
      return entry;
    };

    // The sub-searches' steps added up: the move is one search, split (#669).
    const steps: SearchSteps = { made: 0, scored: 0, choseAtRandom: true };

    for (let i = 0; i < parallelCount; i++) {
      // Each sub-search needs its own random source for diversity. A seeded
      // bot derives each sub-seed from its own seed, so the ensemble stays
      // reproducible; an unseeded one leaves them unseeded, so each draws a
      // fresh random seed and never warns about a seed nobody set (#329).
      const subConfig: Partial<BotConfig> = {
        ...this.config,
        seed: this.seed === undefined ? undefined : `${this.seed}-parallel-${i}`,
        iterations: iterationsPerSearch,
        timeout: Math.max(0, deadline - Date.now()) / (parallelCount - i),
        parallel: 1, // Prevent recursion
      };

      // Create sub-bot sharing same game instance (read-only root state is fine)
      const subBot = new MCTSBot(
        this.game,
        this.GameClass,
        this.gameType,
        this.playerIndex,
        subConfig,
        {
          objectives: this.objectives,
          threatResponseMoves: this.threatResponseMoves,
          playoutPolicy: this.playoutPolicy,
          moveOrdering: this.moveOrdering,
          uctConstant: this.uctConstant,
          determinize: this.determinize,
        }
      );

      const { move, root } = await subBot.runSearch();
      if (!move || !root) {
        // Every sub-search sees the same information state, so one finding
        // nothing means they all will. Report the stall rather than voting.
        this.lastStallReason = subBot.lastStallReason;
        return null;
      }

      addSearchSteps(steps, subBot.searchSteps);
      entryFor(move).votes++;
      for (const child of root.children) entryFor(child.parentMove!).visits += child.visits;
    }

    this.warnIfStepsWereDropped(steps);
    const entries = [...tally.values()];
    const mostVotes = Math.max(...entries.map(entry => entry.votes));
    const voted = entries.filter(entry => entry.votes === mostVotes);
    const mostVisits = Math.max(...voted.map(entry => entry.visits));
    return this.rng.pick(voted.filter(entry => entry.visits === mostVisits)).move;
  }

  /**
   * Run a single MCTS search and return the best move together with the root node.
   * The root node reference is returned BEFORE cleanup nulls the bot's own
   * snapshot fields — callers can safely read root.children after this returns.
   * Called by both play() and playWithStats().
   */
  private async runSearch(): Promise<{ move: BotMove | null; root: MCTSNode | null }> {
    // Turn-legality checks read only structural flow state (awaitingInput /
    // currentPlayer / awaitingPlayers), never opponent hidden attributes, so
    // checking them against the live `this.game` before the redacted clone
    // exists is safe.
    const liveFlowState = this.game.getFlowState();
    if (!liveFlowState?.awaitingInput) {
      throw new Error('Game is not awaiting input');
    }

    // Check if this is our turn (either currentPlayer matches or we're in awaitingPlayers)
    if (!canSeatAct(liveFlowState, this.playerIndex)) {
      throw new Error(`Not bot's turn (player ${this.playerIndex})`);
    }
    this.searchSteps = { made: 0, scored: 0, choseAtRandom: false };

    // CR-01 (159): build the redacted search sandbox FIRST, then enumerate/
    // threat-check/UCT-weight from it -- never from `this.game` (full truth).
    // `movesFor` -> `getSelectionChoices` and the game-supplied
    // `threatResponseMoves`/`uctConstant` hooks can read arbitrary game state;
    // running them against `this.game` would leak opponents' hidden info into
    // the bot's ROOT decision even though the search tree below it was
    // redacted. Doing this unconditionally (including the allMoves.length===1
    // fast path below) closes that leak for every code path, not just the
    // full-search one. For perfect-information games (no hidden zones) the
    // redacted view is byte-identical to the full view, so this is a no-op.
    this.rootSnapshot = this.captureSnapshot();
    this.searchGame = this.restoreGame(this.rootSnapshot) as G;
    this.dropSavedCopies();
    // #73: the first world. Every later iteration gets its own from
    // `restoreSearchGameToRoot`, so the tree's statistics average over worlds
    // rather than describing the one this root happened to draw.
    this.sampleWorld();
    const flowState = this.searchGame.getFlowState() ?? liveFlowState;

    // Cache UCT constant once per move (not per selectChild call)
    this.cachedUctC = this.uctConstant?.(this.searchGame, this.playerIndex)
      ?? this.config.uctC
      ?? Math.sqrt(2);

    // Get every available move first (without sampling) for threat response
    // analysis; an action with more moves than enumeration lists gives a
    // random sample of them instead (#691).
    const allMoves = this.movesFor(this.searchGame, flowState, this.playerIndex, { sample: false });
    if (allMoves.length === 0) {
      // See play()'s doc comment: a stall for this seat, not a session lock.
      this.lastStallReason =
        `Seat ${this.playerIndex} has no move it can search from its own information state. ` +
        `The authoritative game may well offer this seat moves — per-seat redaction can empty ` +
        `the choice list the seat's only action draws from, and the bot searches the redacted ` +
        `view by design. This seat is stalled; the rest of the table is not.`;
      return { move: null, root: null };
    }
    this.lastStallReason = undefined;

    // If only one move, skip MCTS search entirely.
    // Return a minimal root with no children — playWithStats() callers get empty stats,
    // which is correct: there is nothing meaningful to evaluate for a forced move.
    // #73: under determinization one world offering a single move says nothing
    // about the others, so the fast path is only sound without a sampler.
    if (allMoves.length === 1 && !this.determinize) {
      const root = this.createNode(flowState, null, null, allMoves, this.playerIndex);
      return { move: allMoves[0], root };
    }

    // Check for threats BEFORE sampling - this is critical!
    // The threat response needs to see ALL possible moves to find blocking cells
    let moves: BotMove[];
    this.forcedRootMoveKeys = undefined;

    if (this.threatResponseMoves) {
      const threatResponse = this.threatResponseMoves(this.searchGame, this.playerIndex, allMoves);
      if (threatResponse.moves.length > 0) {
        // FORCE blocking when threat is detected - no half measures!
        // If threat response finds blocking moves, the bot MUST use them
        moves = threatResponse.moves;
        // #73: a forced block stays forced under determinization. Without this
        // the per-world root refresh would widen the root straight back to
        // every move, quietly undoing the game's "you MUST block" ruling.
        this.forcedRootMoveKeys = new Set(moves.map(m => this.getMoveKey(m)));
      } else {
        moves = this.sampleRootMoves(allMoves);
      }
    } else {
      moves = this.sampleRootMoves(allMoves);
    }

    // Clear the RAVE table for a fresh search
    this.raveTable.clear();

    // Create root node with moves (blocking-only when threatened, sampled otherwise)
    const root = this.createNode(flowState, null, null, moves, this.playerIndex);

    // Run MCTS iterations with timeout failsafe
    const startTime = Date.now();
    const timeout = this.config.timeout ?? 2000;
    // Track truncation so a SEEDED search can tell the caller its result was
    // not actually reproducible (see warnIfSeededSearchWasTruncated).
    let completedIterations = 0;

    for (let i = 0; i < this.config.iterations; i++) {
      // Check timeout before each iteration
      if (Date.now() - startTime > timeout) {
        break;
      }
      completedIterations = i + 1;

      // SELECT: Position searchGame for this step, walk down the tree applying
      // moves to it, and collect the tree moves for RAVE
      const selection = this.selectWithPath(root);

      // EXPAND: Try one unexplored move, creating child
      const child = selection.spoiled ? null : this.expandIncremental(selection.leaf, selection.onTurn);

      // PLAYOUT: Random simulation from current state, collect playout moves for RAVE
      const playout = child ? this.playoutIncremental() : null;

      if (child && playout) {
        // Add expanded move to treeMoves for RAVE if expansion created a new node
        const { leaf, treeMoves } = selection;
        if (child !== leaf && child.parentMove) {
          treeMoves.push({ move: child.parentMove, player: leaf.currentPlayer });
        }

        // BACKPROPAGATE: Update stats and RAVE table
        this.backpropagate(child, playout.score, playout.playoutMoves, treeMoves);
        this.searchSteps.scored++;
      }
      // Otherwise a refused move changed part of this world before it was
      // refused (#421), so the position no longer describes any node, and
      // nothing from this iteration is scored.
      //
      // Under a world sampler the next step starts from a fresh world drawn at
      // the root now, as it always has (#73). Without one, the next step's
      // selection restores the search game itself, from the deepest saved copy
      // on its path (#633).
      if (this.determinize) this.restoreSearchGameToRoot();

      // Yield to the event loop in async mode (every iteration). Prefer the
      // Scheduler API when present: inside a Cloudflare Worker, Date.now() is
      // frozen during synchronous execution and is NOT advanced by setTimeout(0),
      // so the timeout failsafe above can never fire -- a heavy search then runs
      // its full iteration budget and blows the Worker's CPU limit. Awaiting
      // scheduler.wait(0) advances the clock by the real elapsed time (including
      // CPU spent since the last yield), which lets the timeout bound each move
      // as intended. Outside Workers (e.g. Node) the clock advances normally, so
      // the setImmediate/setTimeout fallback works there.
      if (this.config.async) {
        const sched = (globalThis as { scheduler?: { wait?: (ms: number) => Promise<void> } }).scheduler;
        if (sched?.wait) {
          await sched.wait(0);
        } else {
          const schedule = typeof setImmediate !== 'undefined'
            ? setImmediate
            : (fn: () => void) => setTimeout(fn, 0);
          await new Promise(resolve => schedule(resolve));
        }
      }
    }

    this.warnIfSeededSearchWasTruncated(completedIterations, timeout);
    this.searchSteps.made = completedIterations;
    this.searchSteps.choseAtRandom = root.children.length === 0;

    // Cleanup search state — null the bot's own snapshot fields.
    // The local `root` reference is returned to callers so they can read
    // root.children AFTER this point (cleanup only nulls instance fields).
    this.searchGame = null;
    this.rootSnapshot = null;
    this.dropSavedCopies();

    // Select best child (most visits for robustness)
    if (root.children.length === 0) {
      // No children explored, pick random from initial moves
      return { move: this.rng.pick(moves), root };
    }

    // Debug logging for proof number analysis
    if (this.config.debug) {
      const proven = root.children.filter(c => c.isProven).length;
      const disproven = root.children.filter(c => c.isDisproven).length;
      const unknown = root.children.length - proven - disproven;
      console.log(`[MCTS] Move selection: ${proven} proven, ${disproven} disproven, ${unknown} unknown of ${root.children.length} children`);
    }

    // When PNS is enabled, use proof status in final move selection
    if (this.config.usePNS !== false) {
      // Look for proven win (guaranteed victory) - require visits >= 5 to trust proof status
      const provenWin = root.children.find(c => c.isProven && c.visits >= 5);
      if (provenWin) {
        if (this.config.debug) {
          console.log(`[MCTS] Selecting proven win!`);
        }
        return { move: provenWin.parentMove!, root };
      }

      // Check if all children are disproven (all moves lead to loss)
      const allDisproven = root.children.every(c => c.isDisproven && c.visits >= 5);
      if (allDisproven) {
        // Select most-visited to delay loss (might find opponent mistake)
        const best = root.children.reduce((a, b) => a.visits > b.visits ? a : b);
        return { move: best.parentMove!, root };
      }

      // Filter out disproven children (known losses) for final selection
      const validChildren = root.children.filter(c => !c.isDisproven || c.visits < 5);
      if (validChildren.length > 0) {
        const best = validChildren.reduce((a, b) => a.visits > b.visits ? a : b);
        return { move: best.parentMove!, root };
      }
    }

    // Fall back to most visits (standard MCTS selection)
    const best = root.children.reduce((a, b) =>
      a.visits > b.visits ? a : b
    );

    return { move: best.parentMove!, root };
  }

  // ============================================================================
  // SECTION: Tree Operations
  // Purpose: SELECT and EXPAND phases - navigate and grow the search tree
  // ============================================================================

  /**
   * SELECTION with path tracking: Walk down tree using UCT, applying moves to searchGame.
   * Without a world sampler it first restores searchGame from the deepest saved
   * copy on the path (#633); under one, searchGame is already at the root of a
   * fresh world. After this completes, searchGame is positioned at the returned
   * leaf node's state. Returns the leaf node and the tree moves traversed (for RAVE).
   *
   * The walk stops at a node whose turn is not the one this world is on
   * (#421): below it, every child is a move for a seat that is not to move
   * here. `spoiled` means a refused move changed this world before it was
   * refused, so it matches no node and the iteration has to be dropped.
   * `onTurn` says whether this world is on the leaf's turn, so expansion
   * need not list the world's moves again to ask.
   */
  private selectWithPath(root: MCTSNode): {
    leaf: MCTSNode;
    treeMoves: TreeMove[];
    spoiled: boolean;
    onTurn: boolean;
  } {
    const treeMoves: TreeMove[] = [];
    let node = root;
    if (!this.determinize) {
      const resumed = this.deepestSavedCopy(root);
      node = resumed.node;
      treeMoves.push(...resumed.treeMoves);
      this.resumeSearchGame(resumed.copy);
    }

    let onTurn = this.turnMatchesWorld(node);
    while (onTurn) {
      this.saveCopyOf(node);
      const eligible = this.eligibleChildrenForWorld(node);
      if (node.untriedMoves.length > 0 || eligible.length === 0) break;
      const child = this.selectChild(node, eligible);
      // Apply the child's move to searchGame to descend
      const outcome = this.applyMoveToSearchGame(child);
      if (outcome === 'refusedAfterChanges') return { leaf: node, treeMoves, spoiled: true, onTurn: false };
      // A clean refusal left the world at `node`, so the walk ends there.
      if (outcome === 'refused') break;
      // Track tree path move for RAVE (player is from parent node where move was made)
      treeMoves.push({ move: child.parentMove!, player: node.currentPlayer });
      node = child;
      onTurn = this.turnMatchesWorld(node);
    }
    return { leaf: node, treeMoves, spoiled: false, onTurn };
  }

  /**
   * Whether the world loaded into `searchGame` has the same seat to move at
   * `node`, and the same end-of-game answer, as the world `node` was grown in
   * (#421).
   *
   * A node is reached by a sequence of moves, but who moves next is a fact
   * about the world those moves were made in. Under determinization each
   * iteration samples a new one, and the same Go Fish ask keeps the asker's
   * turn in a world where the target held the rank and passes it in one where
   * they did not. A game whose moves draw on randomness diverges the same way
   * without a sampler. When the seat differs, the node's children are moves
   * for a seat that is not to move here, so none of them may be made, and no
   * move for the other seat may be added under a node that scores its
   * children for this one.
   *
   * The root is the bot's own decision, so it matches any world where the
   * bot's seat may act, wherever the step lists it (#522).
   */
  private turnMatchesWorld(node: MCTSNode): boolean {
    const live = this.worldFlowState();
    if (Boolean(live.complete) !== Boolean(node.flowState.complete)) return false;
    if (live.complete) return true;
    if (node.parent === null) return canSeatAct(live, node.currentPlayer);
    // A world held open with no seat to move matches only a node held open the same way,
    // which is a node grown with no moves: `node.flowState` is not loaded, so it cannot be enumerated.
    const next = this.seatToMove(live);
    return next.seat === node.currentPlayer && (next.moves.length > 0) === (node.allMoves.length > 0);
  }

  /**
   * The flow state of the world loaded into `searchGame`, which is the only
   * account of whose turn it is that holds in this iteration (#421).
   */
  private worldFlowState(): FlowState {
    const state = this.searchGame?.getFlowState();
    if (!state) {
      throw new Error(
        'The bot has no game position to search: its search copy of the game has no flow. ' +
          'This is a BoardSmith bug; please report it with the game that triggered it.',
      );
    }
    return state;
  }

  /**
   * The children of `node` whose move is legal in the world currently loaded
   * into `searchGame`, refreshing what the node knows about this world (#73).
   *
   * Without a sampler there is only ever one world, node move sets never go
   * stale, and this is `node.children` unchanged.
   *
   * With one, legality is a property of the sample: a move enumerated three
   * iterations ago may be unavailable now, and a move nothing had offered yet
   * may have just appeared. Selection must choose among what THIS world allows,
   * and each eligible child records that it was on offer so the exploration
   * term can divide by availability rather than by parent visits.
   */
  private eligibleChildrenForWorld(node: MCTSNode): MCTSNode[] {
    if (!this.determinize) return node.children;
    const legal = this.refreshNodeForWorld(node);
    const eligible = node.children.filter(
      (child) => child.parentMove && legal.has(this.getMoveKey(child.parentMove)),
    );
    for (const child of eligible) child.availability++;
    return eligible;
  }

  /**
   * Re-derive `node`'s move sets against the world now loaded into
   * `searchGame`, and report which moves that world makes legal (#73).
   *
   * `allMoves` becomes the UNION over every world sampled so far — that union
   * is the seat's actual option set across its information set, and a move only
   * one world in ten offers still deserves a place in the tree. `untriedMoves`
   * is narrowed to the moves this world allows and no child has yet, so
   * expansion never tries a move the current world would refuse.
   *
   * A root under a forced threat response is left alone: the game said MUST.
   */
  private refreshNodeForWorld(node: MCTSNode): Set<string> {
    // The world's own flow state, not the one `node` was grown in (#421).
    const live = this.worldFlowState();
    const enumerated = live.complete
      ? []
      : this.movesFor(this.searchGame!, live, node.currentPlayer, { sample: true });

    const forced = node.parent === null ? this.forcedRootMoveKeys : undefined;
    const legalMoves = forced
      ? enumerated.filter((move) => forced.has(this.getMoveKey(move)))
      : enumerated;
    const legal = new Set(legalMoves.map((move) => this.getMoveKey(move)));

    if (!forced) {
      const known = new Set(node.allMoves.map((move) => this.getMoveKey(move)));
      for (const move of legalMoves) {
        const key = this.getMoveKey(move);
        if (known.has(key)) continue;
        known.add(key);
        node.allMoves.push(move);
      }
    }

    const explored = new Set(
      node.children.map((child) => this.getMoveKey(child.parentMove!)),
    );
    node.untriedMoves = node.allMoves.filter((move) => {
      const key = this.getMoveKey(move);
      return legal.has(key) && !explored.has(key) && !node.refusedMoveKeys.has(key);
    });

    return legal;
  }

  /**
   * Select the most promising child node using the UCT-RAVE formula.
   * Blends UCT (tree statistics) with RAVE (global move statistics):
   *   score = (1 - beta) * mean + beta * RAVE + exploration
   *   beta = sqrt(k / (3*visits + k))  // decreases as visits increase
   *
   * Early in search, beta is high so RAVE dominates (fast learning from all playouts).
   * As visits accumulate, beta decreases so the child's own mean dominates.
   *
   * When PNS is enabled, solved children are set aside first: a proven loss is
   * never chosen on the bot's turn, and a proven win never on the opponent's.
   * Proof numbers play no other part in selection (#316). Until something below
   * a child is solved they only count its expanded leaves, and blending a rank
   * of those into the score let that count outweigh the evaluation.
   */
  private selectChild(node: MCTSNode, candidates: MCTSNode[] = node.children): MCTSNode {
    const C = this.cachedUctC; // Exploration constant (cached per move)
    const k = this.config.raveK ?? 500; // RAVE decay constant
    const usePNS = this.config.usePNS !== false;
    const isBotTurn = node.currentPlayer === this.playerIndex;

    // Filter out proven/disproven children with sufficient visits (solver enhancement)
    let eligibleChildren = candidates;
    if (usePNS) {
      eligibleChildren = candidates.filter(child => {
        // Allow selection if visits < 5 to confirm solver result
        if (child.visits < 5) return true;
        // Don't select isProven children when it's opponent's turn (opponent won't help us)
        if (!isBotTurn && child.isProven) return false;
        // Don't select isDisproven children when it's our turn (avoid known losses)
        if (isBotTurn && child.isDisproven) return false;
        return true;
      });
      // Fallback if all children filtered out
      if (eligibleChildren.length === 0) {
        eligibleChildren = candidates;
      }
    }

    let best = eligibleChildren[0];
    let bestScore = -Infinity;

    for (const child of eligibleChildren) {
      const visits = child.visits + 1e-6; // Avoid division by zero
      const exploitation = child.value / visits;
      // #73: under determinization, explore against how often this move was
      // ON OFFER, not how often its parent was visited. A move only some worlds
      // make legal is otherwise permanently starved by moves every world offers.
      const offered = this.determinize ? child.availability : node.visits;
      const exploration = C * Math.sqrt(Math.log(offered + 1) / visits);

      // RAVE blends into the value only; exploration stays whole so one unlucky sample cannot starve a move (#732)
      let value = exploitation;
      if (this.config.useRAVE !== false && child.parentMove) {
        const raveEntry = this.raveTable.get(this.getMoveKey(child.parentMove));
        if (raveEntry && raveEntry.visits > 0) {
          // RAVE value is already stored from correct perspective (move-maker's perspective)
          // But here we need it from the parent's perspective (who made the move to this child)
          // The move was made by node.currentPlayer, so:
          // - If node.currentPlayer === this.playerIndex, RAVE value is from our perspective (use as-is)
          // - If node.currentPlayer !== this.playerIndex, RAVE value is from opponent's perspective (flip it)
          const raveValue = node.currentPlayer === this.playerIndex
            ? raveEntry.value
            : (1 - raveEntry.value);

          // Beta decreases as node visits increase (trust UCT more with more data)
          const beta = Math.sqrt(k / (3 * visits + k));
          value = (1 - beta) * exploitation + beta * raveValue;
        }
      }
      const score = value + exploration;

      if (score > bestScore) {
        bestScore = score;
        best = child;
      }
    }
    return best;
  }

  /**
   * Apply a node's parent move to searchGame.
   * Used during selection to descend the tree.
   */
  private applyMoveToSearchGame(node: MCTSNode): SearchMoveOutcome {
    // T-159-07 / F-07: capture the pre-reveal simultaneous baseline during
    // SELECT descent too (not only in expand/playout). `searchGame` is currently
    // at `node.parent`'s state; if that is the START of a fresh simultaneous
    // step (nobody completed), snapshot it BEFORE this move commits a co-decider
    // pick. Without this, descending past 2+ already-committed co-deciders left
    // the baseline undefined, so the 3rd+ co-decider re-enumerated against the
    // live (reveal-leaking) state — the sequentialized-reveal defect for ≥3
    // co-deciders. The `every(!completed)` guard makes it idempotent mid-step.
    this.maybeCaptureSimultaneousBaseline(this.worldFlowState());
    return this.makeSearchMove(node.parentMove!, node.parent!.currentPlayer).outcome;
  }

  /**
   * Make `move` in `searchGame` for `seat`, the seat it was listed for, and say
   * whether the engine took it (#421). The caller passes the seat of the node
   * the move was listed at; recomputing it here once let a move listed for one
   * seat be made as another (#522).
   *
   * A refused move does not throw: the flow stays where it was and reports the
   * refusal on the state it returns. The search used to read that state as the
   * position the move led to, so every refused move became a child that scored
   * the unchanged position as if the move had been played.
   */
  private makeSearchMove(move: BotMove, seat: number): { outcome: SearchMoveOutcome; flowState: FlowState } {
    const game = this.searchGame!;
    let flowState: FlowState;
    try {
      flowState = game.continueFlow(move.action, this.rebindArgs(move.args), seat);
    } catch (error) {
      // The flow itself threw, possibly after the move changed the game.
      this.searchSteps.firstFailure ??= error instanceof Error ? error.message : String(error);
      return { outcome: 'refusedAfterChanges', flowState: this.worldFlowState() };
    }
    if (flowState.actionError === undefined) return { outcome: 'made', flowState };
    if (!flowState.actionPartiallyApplied) {
      this.searchSteps.firstRefusal ??= flowState.actionError;
      return { outcome: 'refused', flowState };
    }
    this.searchSteps.firstFailure ??= flowState.actionError;
    return { outcome: 'refusedAfterChanges', flowState };
  }

  /**
   * EXPAND with incremental state: Apply one unexplored move to searchGame.
   * The searchGame is already positioned at the node's state from selection.
   * `onTurn` is selection's answer to whether this world is on the node's turn.
   * Returns the new child node, the node itself when there is nothing to grow
   * here or the move was refused, or null when a refused move changed the
   * world first (the iteration is spoiled, #421).
   */
  private expandIncremental(node: MCTSNode, onTurn: boolean): MCTSNode | null {
    if (node.untriedMoves.length === 0 || node.flowState.complete || !onTurn) {
      return node;
    }

    // T-159-07: if the world is at the start of a fresh simultaneous step (no
    // co-decider has acted yet), snapshot searchGame now -- BEFORE this move
    // mutates it -- so later co-deciders' enumeration in this step reads the
    // pre-reveal state, not this move's committed effects.
    this.maybeCaptureSimultaneousBaseline(this.worldFlowState());

    // Pick first untried move (ordering determined at node creation by moveOrdering hook)
    const move = node.untriedMoves.shift()!;

    const { outcome, flowState } = this.makeSearchMove(move, node.currentPlayer);
    if (outcome !== 'made') {
      // Not a move this node can make: never offer it here again.
      node.refusedMoveKeys.add(this.getMoveKey(move));
      return outcome === 'refused' ? node : null;
    }

    // The moves of the seat that moves next, which is the seat the child records.
    // A finished game, or a step held open with no seat to move, has none.
    const next = this.seatToMove(flowState);

    // Create child node (no snapshot needed: every step restores the search
    // game whole, from the root or a saved copy, before it walks the tree)
    const child = this.createNode(flowState, node, move, next.moves, next.seat);
    node.children.push(child);

    return child;
  }

  // ============================================================================
  // SECTION: Simulation
  // Purpose: PLAYOUT phase - random rollout to estimate position value
  // ============================================================================

  /**
   * PLAYOUT with incremental state: Simulate from searchGame's current position.
   * The searchGame is already positioned at the node's state.
   * Plays random moves (or uses playoutPolicy if available) until the game ends or playoutDepth is reached.
   * Returns a score in [0,1] and the moves played during playout with player info (for RAVE),
   * or null when a refused move changed the world before it was refused (#421), which leaves
   * a position that is no position the game can reach.
   */
  private playoutIncremental(): { score: number; playoutMoves: Array<{ move: BotMove; player: number }> } | null {
    const playoutMoves: Array<{ move: BotMove; player: number }> = [];

    if (!this.searchGame) {
      return { score: 0.5, playoutMoves };
    }

    // The world's own flow state: the node the playout starts from may have
    // been grown in a world where another seat was to move (#421).
    let flowState = this.worldFlowState();
    let depth = 0;

    while (!flowState.complete && depth < this.config.playoutDepth) {
      // T-159-07: same pre-reveal baseline capture as expandIncremental --
      // must run before this iteration's move mutates searchGame.
      this.maybeCaptureSimultaneousBaseline(flowState);

      // One seat lists the moves and makes the one chosen (#522). With no seat
      // to move, the step is held open from outside: score the position as it stands.
      const { seat: currentPlayer, moves } = this.seatToMove(flowState);
      if (moves.length === 0) {
        break;
      }

      // Select move: use playoutPolicy if available, otherwise random
      let move: BotMove;

      if (this.playoutPolicy) {
        // Use game-specific playout policy for smarter move selection
        move = this.playoutPolicy(this.searchGame, currentPlayer, moves, () => this.rng.next());
      } else {
        // Default to random move selection
        move = this.rng.pick(moves);
      }

      const made = this.makeSearchMove(move, currentPlayer);
      if (made.outcome === 'refusedAfterChanges') return null;
      // A clean refusal changed nothing: evaluate the position as it stands.
      if (made.outcome === 'refused') break;
      flowState = made.flowState;

      // Track move for RAVE update
      playoutMoves.push({ move, player: currentPlayer });
      depth++;
    }

    // Evaluate the position the playout reached. There is no evaluation cache
    // (#315): a key correct for every game has to cover the whole board, and
    // building one cost more than the evaluations it saved in every example game.
    const score = this.evaluateTerminalFromGame(this.searchGame, flowState);
    return { score, playoutMoves };
  }

  // ============================================================================
  // SECTION: Backpropagation
  // Purpose: BACKPROPAGATE phase - update visit counts and values up the tree
  // ============================================================================

  /**
   * BACKPROPAGATE: Update statistics and the RAVE table up the tree. It never
   * touches `searchGame`: the next step restores that whole (see runSearch).
   *
   * @param node - The leaf node to start backpropagation from
   * @param result - The playout score (0=loss, 0.5=draw, 1=win for bot)
   * @param playoutMoves - Moves played during playout with player info (for RAVE)
   * @param treeMoves - Moves from tree path with player info (for RAVE)
   */
  private backpropagate(
    node: MCTSNode | null,
    result: number,
    playoutMoves: TreeMove[] = [],
    treeMoves: TreeMove[] = []
  ): void {
    // Update RAVE table with all moves from this playout (if enabled)
    if (this.config.useRAVE !== false) {
      // Combine tree moves and playout moves for RAVE update
      const allMoves = [...treeMoves, ...playoutMoves];
      for (const { move, player } of allMoves) {
        const key = this.getMoveKey(move);

        // RAVE value is from perspective of the player who made the move
        // If bot made the move: good result is good for RAVE
        // If opponent made the move: good result for bot is bad for that move
        const moveValue = player === this.playerIndex ? result : (1 - result);

        const entry = this.raveTable.get(key);
        if (entry) {
          // Running average update
          entry.visits++;
          entry.value = entry.value + (moveValue - entry.value) / entry.visits;
        } else {
          this.raveTable.set(key, { visits: 1, value: moveValue });
        }
      }
    }

    // Backpropagate up the tree, updating pure node bookkeeping (visits, value,
    // proof numbers).
    while (node !== null) {
      node.visits++;
      // Value is from perspective of player who just moved to reach this node
      // If it's our player's turn at parent, result is good for us
      // If it's opponent's turn at parent, result is bad for them (good for us)
      const isOurPerspective = node.parent === null ||
        node.parent.currentPlayer === this.playerIndex;
      node.value += isOurPerspective ? result : (1 - result);

      // Update proof numbers from children (if PNS enabled)
      if (this.config.usePNS !== false) {
        this.updateProofNumbers(node);
      }

      node = node.parent;
    }
  }

  /**
   * Walk down from the root the way selection will, through every chosen child
   * that has a saved copy, and say which node the deepest such copy is at
   * (#633). With no copy on the path, that is the root and no copy.
   *
   * Only without a world sampler, where selection reads the tree alone
   * (`eligibleChildrenForWorld` is every child), so this walk chooses the
   * children selection would; and a copy exists only where the turn matched the
   * world all the way down, which it still does, as nothing on the way drew
   * randomness (see {@link saveCopyOf}).
   */
  private deepestSavedCopy(root: MCTSNode): { node: MCTSNode; treeMoves: TreeMove[]; copy?: string } {
    const treeMoves: TreeMove[] = [];
    let node = root;
    let copy: string | undefined;
    while (node.untriedMoves.length === 0 && node.children.length > 0) {
      const child = this.selectChild(node);
      const childCopy = this.savedCopies.get(child);
      if (childCopy === undefined) break;
      treeMoves.push({ move: child.parentMove!, player: node.currentPlayer });
      node = child;
      copy = childCopy;
    }
    return { node, treeMoves, copy };
  }

  /**
   * Restore `searchGame` whole from a saved copy, or from the root snapshot
   * when there is none, while PRESERVING the game's random position so
   * successive steps draw differently.
   *
   * A full restore is the only rollback there is (v4.8 F-01): element moves
   * (`Piece.putInto` -> `moveToInternal`) splice `_t.children` directly and
   * custom-property mutations are plain assignments, so nothing short of
   * adopting a serialized state again undoes a move. The stored tree-node move
   * args resolve by element id, and ids are stable across restore, so making
   * the tree path's moves on the fresh instance is sound (see `rebindArgs`).
   */
  private resumeSearchGame(copy?: string): void {
    if (!this.rootSnapshot || !this.searchGame) return;
    const rngState = this.searchGame.getRandomState();
    this.searchGame = this.restoreGame(copy === undefined ? this.rootSnapshot : JSON.parse(copy)) as G;
    this.searchGame.setRandomState(rngState);
    this.resumedRandomState = rngState;
    // F-07: drop any baseline captured last iteration — it was cloned from the
    // now-discarded searchGame instance. It is re-captured fresh during this
    // iteration's descent/expand when a fresh simultaneous step is reached.
    this.simultaneousBaseline = undefined;
  }

  /**
   * Reset `searchGame` to the root and draw a fresh world into it. Only under
   * a world sampler, after every step (see runSearch).
   */
  private restoreSearchGameToRoot(): void {
    this.resumeSearchGame();
    // #73: a fresh world for the next iteration. Re-sampling HERE — per
    // playout, not per move — is what makes the tree's statistics describe the
    // seat's uncertainty instead of one hypothesis it happened to draw.
    this.sampleWorld();
  }

  /**
   * Save a copy of `searchGame`, which stands at `node`, for later steps to
   * resume from (#633), unless one cannot stand for `node` in every step:
   *
   * - under a world sampler, each step's position belongs to its own world;
   * - when a move on the way here drew from the game's random source, the
   *   position depends on the draw, and the next step draws differently. A move
   *   that drew nothing this time draws nothing ever: it is the same code on
   *   the same position, and only the draw could have differed;
   * - inside a step every seat takes at once, the moves below read the
   *   pre-reveal baseline captured on the way here, which a copy does not carry.
   *
   * Copies fill the budget first come, first kept, and the walk down the tree
   * reaches the shallow, most-visited nodes first.
   */
  private saveCopyOf(node: MCTSNode): void {
    if (!this.shouldSaveCopyOf(node)) return;
    const copy = JSON.stringify(createSnapshot(this.searchGame!, this.gameType, [], this.seed));
    // V8 keeps a string of Latin-1 characters at one byte each, and any other at two.
    const bytes = /[^\x00-\xff]/.test(copy) ? copy.length * 2 : copy.length;
    if (this.savedCopyBytes + bytes > this.savedCopyBudget) {
      this.savedCopiesFull = true;
      return;
    }
    this.savedCopies.set(node, copy);
    this.savedCopyBytes += bytes;
  }

  /** Whether {@link saveCopyOf} should save a copy at `node`: see its rules. */
  private shouldSaveCopyOf(node: MCTSNode): boolean {
    if (this.determinize || this.savedCopiesFull || node.parent === null || this.savedCopies.has(node)) return false;
    if (this.searchGame!.getRandomState() !== this.resumedRandomState) return false;
    const flow = this.worldFlowState();
    // A finished game has no moves below it to spare.
    return !flow.complete && !flow.awaitingPlayers?.length;
  }

  /** Forget every saved copy, at the start and the end of a search. */
  private dropSavedCopies(): void {
    this.savedCopies.clear();
    this.savedCopyBytes = 0;
    this.savedCopiesFull = false;
  }

  /**
   * Draw one world consistent with this seat's information set into
   * `searchGame`, if the game declared a sampler (#73).
   *
   * No-op for every game without one, which is why a game with no hidden state
   * pays nothing for this feature existing.
   */
  private sampleWorld(): void {
    if (!this.determinize || !this.searchGame) return;
    applyDeterminization(
      this.searchGame,
      this.playerIndex,
      this.determinize,
      () => this.rng.next(),
    );
  }

  /**
   * Re-resolve any element-valued args to the CURRENT `searchGame`'s live
   * element objects by id (v4.8 F-01). Tree-node moves store in-process element
   * OBJECTS captured on a PRIOR searchGame instance; because
   * every step restores the search game whole (`resumeSearchGame`), those stored
   * objects go stale. Feeding a stale (foreign-tree) element into
   * `continueFlow` -> `Piece.putInto` would splice a wrong-instance object into
   * the live tree and duplicate its id. Element ids are stable across restore,
   * so we canonicalize by id here, wherever the element sits: inside arrays and
   * plain objects too, since the engine matches a plain choice against the
   * current world's offer by its JSON (#1038). Everything else, including a
   * plain choice's own `id` (#873), passes through untouched; already-live
   * elements resolve to themselves (no-op).
   */
  private rebindArgs(args: Record<string, unknown>): Record<string, unknown> {
    const game = this.searchGame;
    if (!game) return args;
    const rebind = (v: unknown): unknown => {
      if (isElement(v)) return game.getElementById(v.id) ?? v;
      if (Array.isArray(v)) return v.map(rebind);
      if (isPlainObject(v)) {
        return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rebind(x)]));
      }
      return v;
    };
    return Object.fromEntries(Object.entries(args).map(([k, v]) => [k, rebind(v)]));
  }

  // ============================================================================
  // SECTION: Utility
  // Purpose: Helper methods for bot turn detection and position evaluation
  // ============================================================================

  /**
   * Generate a unique key for a move (used for RAVE table lookup). An element,
   * wherever it sits in the args, is keyed by its id, not its subtree, so the
   * move keeps one key in every sampled world (#876).
   */
  private getMoveKey(move: BotMove): string {
    const keyOf = (v: unknown): unknown => {
      if (isElement(v)) return { elementId: v.id };
      if (Array.isArray(v)) return v.map(keyOf);
      if (isPlainObject(v)) {
        return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, keyOf(x)]));
      }
      return v;
    };
    return `${move.action}:${JSON.stringify(keyOf(move.args))}`;
  }

  // ============================================================================
  // SECTION: Move Enumeration
  // Purpose: One seat rule and one move enumerator for every node (#522)
  // ============================================================================

  /**
   * The seat that moves next below the root, with its moves: the first due
   * seat with at least one move to make, from {@link movesFor}. A seat holding
   * a follow-up is listed with no actions, so it comes first in its own right
   * rather than being skipped (#522); a seat offered only disabled actions
   * has no move, so it is skipped for the next due seat (#1133).
   *
   * Only for the flow state of the world loaded into `searchGame`, which is
   * what the moves are enumerated against. The root's seat is always the
   * bot's own, whatever order the step lists its seats in.
   *
   * No moves, with the bot's seat standing in, when the game is over or no
   * due seat has a move: a simultaneous step whose seats are all done (or
   * offered only disabled actions) but whose `allDone` is still false waits
   * for something outside the step to close it (the engine's external-gate
   * pattern). The search has no move to make there, so such a node is a
   * leaf, scored as it stands.
   */
  private seatToMove(flowState: FlowState): { seat: number; moves: BotMove[] } {
    const due = flowState.complete ? [] : dueSeats(flowState);
    for (const seat of due) {
      const moves = this.movesFor(this.searchGame!, flowState, seat, { sample: true });
      if (moves.length > 0) return { seat, moves };
    }
    return { seat: this.playerIndex, moves: [] };
  }

  /**
   * Every move `seat` may make in `flowState`: its listed actions with every
   * legal set of args, then the follow-up it holds, if any. Args are in wire
   * form (element ids). With `sample`, each action contributes at most 20 arg
   * sets, drawn from the bot's own random source, to bound the branching. An
   * action with more moves than enumeration lists contributes 20 drawn at
   * random, with or without `sample` (#691).
   *
   * This is the bot's only enumerator, and the seat it is given is the seat
   * the moves are later made for (#522). Each action's args come from the
   * engine's own gated enumerator, `enumerateActionMoves`, so the bot never
   * reaches a move `enumerateLegalMoves` would refuse (#19).
   *
   * Within a simultaneous step, args are drawn from the pre-reveal baseline
   * when one was captured (T-159-07): a co-decider's moves must not depend on
   * what an earlier co-decider already picked. The action list and follow-up
   * still come from `flowState`, the world's own position.
   */
  private movesFor(game: G, flowState: FlowState, seat: number, options: { sample: boolean }): BotMove[] {
    const enumerationGame: G =
      flowState.awaitingPlayers && flowState.awaitingPlayers.length > 0 && this.simultaneousBaseline
        ? this.simultaneousBaseline
        : game;
    // The player and action definitions come from the SAME game instance the
    // args are enumerated against: their closures are bound to it.
    const player = enumerationGame.getPlayer(seat);
    if (!player) {
      throw new Error(
        `The bot was asked for the moves of seat ${seat}, which this game does not have. ` +
          'This is a BoardSmith bug; please report it with the game that triggered it.',
      );
    }

    const moves: BotMove[] = [];
    const add = (actionDef: ActionDefinition, followUp?: FollowUpAction) => {
      // An action with more moves than enumeration lists gives a random
      // sample of them, drawn from the bot's own seeded source (#691).
      const sampleAboveBudget = { count: MAX_SAMPLED_ARGS, random: this.rng };
      const serialized = enumerateActionMoves(enumerationGame, actionDef, player, { followUp, sampleAboveBudget })
        .map((args) => this.serializeArgs(args, actionDef.selections));
      const kept = options.sample && serialized.length > MAX_SAMPLED_ARGS
        ? this.rng.shuffle(serialized).slice(0, MAX_SAMPLED_ARGS)
        : serialized;
      for (const args of kept) moves.push({ action: actionDef.name, args });
    };

    for (const actionName of availableActionsForSeat(flowState, seat)) {
      const actionDef = enumerationGame.getAction(actionName);
      if (actionDef) add(actionDef);
    }
    // While the step offers the seat nothing else, its follow-up is its only
    // move, so a search that skipped it would stall the step.
    const followUp = followUpForSeat(flowState, seat);
    const followUpDef = followUp && enumerationGame.getAction(followUp.action);
    if (followUp && followUpDef) add(followUpDef, followUp);

    return moves;
  }

  /** The root's moves, sampled down to {@link MAX_SAMPLED_ARGS} when there are more. */
  private sampleRootMoves(moves: BotMove[]): BotMove[] {
    return moves.length > MAX_SAMPLED_ARGS ? this.rng.shuffle(moves).slice(0, MAX_SAMPLED_ARGS) : moves;
  }

  /**
   * T-159-07: detect the start of a fresh simultaneous step and snapshot
   * searchGame BEFORE any co-decider's move mutates it. A step is "fresh"
   * when every awaiting player is still not-completed (nobody has acted
   * yet). Mid-step (some completed, some not) the existing baseline is kept
   * unchanged. Outside a simultaneous step, any stale baseline is cleared so
   * it can't leak into an unrelated future step.
   */
  private maybeCaptureSimultaneousBaseline(flowState: FlowState): void {
    const awaiting = flowState.awaitingPlayers;
    if (!awaiting || awaiting.length === 0) {
      this.simultaneousBaseline = undefined;
      return;
    }
    if (awaiting.every(p => !p.completed) && this.searchGame) {
      this.simultaneousBaseline = this.cloneSearchGame(this.searchGame);
    }
  }

  /**
   * Clone the given game's CURRENT state into an independent Game instance.
   * Used to freeze the T-159-07 pre-reveal baseline. No redaction is applied
   * here -- `game` is already the bot's own redacted search sandbox (cloned
   * from `toJSONForPlayer(botSeat)` at the root), so this just needs a plain
   * state-authoritative copy, reusing the same restore path as the root.
   */
  private cloneSearchGame(game: G): G {
    const snapshot = createSnapshot(game, this.gameType, [], this.seed);
    return this.restoreGame(snapshot) as G;
  }


  /**
   * Serialize a choice value for action args
   */
  private serializeChoice(choice: unknown, selection: Selection): unknown {
    // Use the public .id getter for both element types — consistent and immune to
    // internal tree-node (_t) renames. GameElement.id returns this._t.id but the
    // public surface is stable.
    if (selection.type === 'element') {
      return (choice as { id: number }).id;
    }
    // For 'elements' type (chooseElements), choices are GameElement objects with id property
    if (selection.type === 'elements') {
      return (choice as { id: number }).id;
    }
    return choice;
  }

  /**
   * Serialize all args at once after enumeration is complete.
   * This ensures element objects are available during recursion for dependent filters,
   * and only converted to IDs when returning final results.
   *
   * Elements become bare numeric ids, not `elementsAsIds`' `{ id, className }`,
   * on purpose (#685): `BotMove.args` is public, and game bot hooks
   * (`playoutPolicy`, `moveOrdering`, `threatResponseMoves`,
   * `hintTargetFromMove`) and the hint and heatmap fallbacks in
   * session/stateless-ops.ts read element args as numbers. Do not merge the two.
   */
  private serializeArgs(
    args: Record<string, unknown>,
    selections: Selection[]
  ): Record<string, unknown> {
    const serialized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(args)) {
      const selection = selections.find(s => s.name === key);
      if (!selection) {
        serialized[key] = value;
        continue;
      }

      if (Array.isArray(value)) {
        serialized[key] = value.map(v => this.serializeChoice(v, selection));
      } else {
        serialized[key] = this.serializeChoice(value, selection);
      }
    }

    return serialized;
  }

  // ============================================================================
  // SECTION: State Management
  // Purpose: Incremental state management with snapshot fallback for recovery
  // ============================================================================

  /**
   * Capture current game state as snapshot.
   *
   * T-159-06 (bot-02): uses `createSeatSnapshot` for `this.playerIndex`, which
   * clones the bot's per-seat REDACTED view (`toJSONForPlayer`) instead of
   * the full un-redacted truth. The search sandbox must never see opponents'
   * hidden info -- reusing the existing redaction, not inventing one. Its
   * random source is reseeded from the bot's own generator, so the search
   * samples chance instead of reading the real game's next draws (#776).
   */
  private captureSnapshot(): SeatSnapshot {
    return createSeatSnapshot(this.game, this.gameType, this.seed, { forSeat: this.playerIndex, reseed: String(this.rng.next()) });
  }

  /**
   * Restore a game from a snapshot — fully STATE-AUTHORITATIVE, NO replay.
   *
   * Mirrors `GameRunner.fromSnapshot`: the snapshot carries the complete
   * authoritative state (element tree, flow position, sequence counter, seeded
   * RNG), so we adopt those directly instead of replaying action history.
   * Replay was unsound for the search root: selection-step /
   * pending-completed actions mutate the tree via `Piece.putInto` and are not
   * recorded in action history, so a root carrying such a mutation lost it on
   * every clone and the bot searched from a wrong position. Adopting the
   * serialized tree keeps those mutations.
   */
  private restoreGame(snapshot: GameStateSnapshot): Game {
    // The game's own constructor options, custom ones (playerConfigs) and its
    // element id key included, with the search game's own seed (#776). Every
    // snapshot this bot restores is one it captured itself, and
    // `createSeatSnapshot` and `createSnapshot` always record them. They are required: element ids are
    // minted under the game's own key (#447), which only these options carry,
    // and `snapshot.seed` is the BOT's search seed, not the search game's.
    const gameOptions = snapshot.gameOptions;
    if (gameOptions === undefined) {
      throw new Error(
        'MCTS bot cannot restore a snapshot without gameOptions: the search game must be built ' +
          "with the game's own options and seed. Capture it with createSeatSnapshot, which records them.",
      );
    }

    const game = constructGame(this.GameClass, gameOptions as any);

    // Adopt the authoritative element tree (clears + rebuilds children, re-points
    // the game's own serialized refs, resolves element references).
    //
    // The message log rides beside the tree, not in it. The search game gets it
    // so a game whose rules read `game.messages` evaluates the same way inside
    // the search as it does outside — a silently empty log there would make the
    // bot reason over a different world than the one it is playing in. On a
    // seat clone `createSeatSnapshot` has already filtered it to that seat's
    // audience, so the sandbox cannot see private lines the seat may not.
    game.loadSerializedState(snapshotTree(snapshot), { messageLog: snapshot.messageLog ?? [] });

    // Restore the element id sequence so newly created elements don't drift.
    if (snapshot.sequence !== undefined) {
      game._ctx.sequence = snapshot.sequence;
    }

    // Restore the snapshot's RNG position: the search game's own, never the live game's (#776).
    game.setRandomState(snapshot.randomState);

    // Restore the authoritative flow position. Every element the flow holds
    // (flow variables and frame data, `forEach` items included) was written as
    // a marker by getPosition; restoreFlowState relinks it to the freshly
    // loaded tree. `hiddenIdRemap` (CR-02, 159) is only ever present on a
    // redacted (`forSeat`) snapshot: it lets a marker that pointed at a
    // now-anonymized hidden-zone child relink to its redacted placeholder, and
    // passing it is what allows a missing element to relink to its concealing
    // zone at all (#947); a restore with no map refuses instead. A
    // DESCENDANT clone's snapshot is written from the already-redacted search
    // game, whose markers hold its own ids, so it needs no remap.
    if (snapshot.flowState) {
      game.restoreFlowState(snapshot.flowState, snapshot.hiddenIdRemap);
    }

    return game;
  }

  /**
   * Create an MCTS node (path-based, no snapshot)
   * allMoves is cached at creation time - enumerated once per node
   * If moveOrdering is available, untriedMoves are sorted by priority (explore best first)
   */
  private createNode(
    flowState: FlowState,
    parent: MCTSNode | null,
    parentMove: BotMove | null,
    allMoves: BotMove[],
    currentPlayer: number,
  ): MCTSNode {
    // Order moves if moveOrdering hook is available
    // This determines exploration order: first moves are tried first
    let untriedMoves: BotMove[];
    if (this.moveOrdering && this.searchGame) {
      untriedMoves = this.moveOrdering(this.searchGame, this.playerIndex, [...allMoves]);
    } else {
      untriedMoves = [...allMoves];
    }

    return {
      flowState,
      parent,
      parentMove,
      children: [],
      allMoves: allMoves,
      untriedMoves,
      visits: 0,
      value: 0,
      // The seat whose moves this node lists and makes (#522), from the caller: the bot's own
      // at the root, `seatToMove` below it (not `flowState.currentPlayer`, which a simultaneous
      // step never advances, #321), and the bot's seat for a node with no moves.
      currentPlayer,
      ...this.terminalProof(flowState),
      availability: 0,
      refusedMoveKeys: new Set(),
    };
  }

  /**
   * A new node's proof numbers: solved only for a finished game whose result
   * is certain (#720). A draw is neither win nor loss, and a result reached
   * through a sampled world or a random draw this step is one outcome of many.
   */
  private terminalProof(flowState: FlowState): Pick<MCTSNode, 'proofNumber' | 'disproofNumber' | 'isProven' | 'isDisproven'> {
    const unsolved = { proofNumber: 1, disproofNumber: 1, isProven: false, isDisproven: false };
    if (!flowState.complete || !this.searchGame || this.determinize) return unsolved;
    if (this.searchGame.getRandomState() !== this.resumedRandomState) return unsolved;
    const winners = this.searchGame.getWinners().map(p => p.seat);
    if (winners.includes(this.playerIndex)) return { proofNumber: 0, disproofNumber: Infinity, isProven: true, isDisproven: false };
    if (winners.length > 0) return { proofNumber: Infinity, disproofNumber: 0, isProven: false, isDisproven: true };
    return unsolved;
  }

  /**
   * Update proof numbers for a node based on its children.
   * Uses perspective-aware propagation:
   * - OR nodes (bot's turn): pn = min(children), dpn = sum(children)
   * - AND nodes (opponent's turn): pn = sum(children), dpn = min(children)
   */
  private updateProofNumbers(node: MCTSNode): void {
    if (node.children.length === 0) {
      // Leaf node - keep initialized values
      return;
    }

    const isBotTurn = node.currentPlayer === this.playerIndex;

    if (isBotTurn) {
      // OR node: bot picks best move, so pn = min(child pn), dpn = sum(child dpn)
      let minPn = Infinity;
      let sumDpn = 0;

      for (const child of node.children) {
        minPn = Math.min(minPn, child.proofNumber);
        // Handle Infinity: sum of any Infinity is Infinity
        if (child.disproofNumber === Infinity) {
          sumDpn = Infinity;
        } else if (sumDpn !== Infinity) {
          sumDpn += child.disproofNumber;
        }
      }

      node.proofNumber = minPn;
      node.disproofNumber = sumDpn;
    } else {
      // AND node: opponent picks best for them, so pn = sum(child pn), dpn = min(child dpn)
      let sumPn = 0;
      let minDpn = Infinity;

      for (const child of node.children) {
        minDpn = Math.min(minDpn, child.disproofNumber);
        // Handle Infinity: sum of any Infinity is Infinity
        if (child.proofNumber === Infinity) {
          sumPn = Infinity;
        } else if (sumPn !== Infinity) {
          sumPn += child.proofNumber;
        }
      }

      node.proofNumber = sumPn;
      node.disproofNumber = minDpn;
    }

    // Update solved status
    node.isProven = node.proofNumber === 0;
    node.isDisproven = node.disproofNumber === 0;
  }

  /**
   * Evaluate terminal position directly from game instance (faster, no snapshot needed)
   */
  private evaluateTerminalFromGame(game: Game, flowState: FlowState): number {
    if (!flowState.complete) {
      // Game didn't complete - use objectives if available
      if (this.objectives) {
        const objectives = this.objectives(game, this.playerIndex);
        let totalScore = 0;
        let maxPossibleScore = 0;
        let minPossibleScore = 0;

        for (const [name, obj] of Object.entries(objectives)) {
          if (obj.weight > 0) {
            maxPossibleScore += obj.weight;
          } else {
            minPossibleScore += obj.weight;
          }
          // Gradient evaluation: multiply weight by achievement level (0.0-1.0)
          const achieved = obj.checker(game, this.playerIndex);
          totalScore += obj.weight * achieved;
        }

        // Normalize to [0.1, 0.9] range based on possible score range
        // This preserves discrimination between different objective achievements
        const scoreRange = maxPossibleScore - minPossibleScore;
        if (scoreRange === 0) return 0.5;

        // Map totalScore from [minPossibleScore, maxPossibleScore] to [0.1, 0.9]
        const normalized = (totalScore - minPossibleScore) / scoreRange;
        const result = 0.1 + normalized * 0.8;

        return result;
      }
      return 0.5; // Draw/unknown
    }

    // The winners the game declares (#503)
    const winners = game.getWinners().map(p => p.seat);
    if (winners.length === 0) {
      return 0.5; // Draw
    }

    if (winners.includes(this.playerIndex)) {
      return 1; // Win
    }

    return 0; // Loss
  }

  /**
   * Warn (dev-only, once per bot) when the wall-clock `timeout` cut a SEEDED
   * search short.
   *
   * Passing a `seed` means the caller is asking for a reproducible search — but
   * `timeout` is wall-clock, so a truncated run silently returns whatever the
   * machine had time for. The same seed then yields different moves on a
   * different machine, under different load, or in CI, and the symptom is an
   * intermittently-failing tactical test with no visible cause. Warning here is
   * the whole fix for discoverability: the run still succeeds (truncation is a
   * legitimate responsiveness failsafe in production), it just stops being
   * silent about having broken the reproducibility the seed implied.
   *
   * Unseeded searches are not warned about: they never promised determinism.
   */
  private warnIfSeededSearchWasTruncated(completedIterations: number, timeout: number): void {
    if (this.warnedSeededTruncation) return;
    if (this.seed === undefined) return;
    if (completedIterations >= this.config.iterations) return;

    this.warnedSeededTruncation = true;
    console.warn(
      `[BoardSmith] MCTS bot (seed "${this.seed}") ran ${completedIterations} of `
      + `${this.config.iterations} requested iterations before hitting its ${timeout}ms `
      + 'timeout, so this move is NOT reproducible — the same seed will pick a different '
      + 'move on a faster/slower machine. Pass `timeout: Infinity` to bound the search by '
      + 'iterations alone, or lower `iterations` so the search finishes within the timeout.',
    );
  }

  /**
   * In development mode, warn when at least half of this search's steps were
   * thrown away (#669). A step is thrown away when a move it made changed the
   * game and then failed, which is what a game's flow reading a card this seat
   * cannot see does when the game declares no `determinize` sampler: the
   * search then quietly rests its choice on a few steps, or on none. Once per
   * move: a parallel bot adds its sub-searches' steps up and warns once. The
   * warning changes nothing about which move is chosen.
   *
   * A clean refusal changes nothing, so it is scored, not thrown away; when the
   * game refused every move at the root the search still chose at random, and
   * that gets its own warning (#874).
   */
  private warnIfStepsWereDropped({ made, scored, choseAtRandom, firstFailure, firstRefusal }: SearchSteps): void {
    const dropped = made - scored;
    if (!isDevMode() || made === 0) return;
    if (dropped * 2 < made) {
      if (choseAtRandom && firstRefusal !== undefined) {
        console.warn(
          `[BoardSmith] MCTS bot for seat ${this.playerIndex}: the game refused every move the bot tried, `
          + 'so the bot chose its move at random. The first refusal said:\n\n'
          + `  ${firstRefusal}\n\n`
          + 'The game offered these moves and then refused them when they were made. When an action\'s '
          + '`execute` returns `success: false` for a choice it offers, move that rule into the action\'s '
          + '`validate` or its choices, so the move is never offered.',
        );
      }
      return;
    }
    console.warn(
      `[BoardSmith] MCTS bot for seat ${this.playerIndex}: ${dropped} of ${made} search steps were thrown away, `
      + 'because a move changed the game and then failed. The first one failed with:\n\n'
      + `  ${firstFailure}\n\n`
      + (choseAtRandom ? 'No move at the root could be played through, so the bot chose its move at random.\n\n' : '')
      + 'When the game reads state this seat cannot see (an opponent\'s hand, a face-down deck), declare a '
      + '`determinize` sampler in the game\'s bot strategy so the search can play those moves in a supposed '
      + 'world. See docs/bot-system.md, "Determinization".',
    );
  }
}
