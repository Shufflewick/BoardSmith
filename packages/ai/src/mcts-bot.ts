import type {
  Game,
  GameOptions,
  Player,
  FlowState,
  SerializedAction,
  ActionDefinition,
  Selection,
  GameStateSnapshot,
} from '@boardsmith/engine';
import { createSnapshot, deserializeAction } from '@boardsmith/engine';
import type { BotConfig, BotMove, MCTSNode, AIConfig, Objective, ThreatResponse } from './types.js';
import { DEFAULT_CONFIG } from './types.js';
import { createSeededRandom, randomChoice } from './utils.js';

/** Game class constructor type */
type GameClass<G extends Game = Game> = new (options: GameOptions) => G;

/**
 * MCTS (Monte-Carlo Tree Search) Bot
 *
 * Implements the UCT algorithm for game-agnostic AI:
 * 1. SELECT: Walk tree using UCT formula to find promising leaf
 * 2. EXPAND: Try one unexplored action from that leaf
 * 3. PLAYOUT: Random moves until game ends (up to playoutDepth)
 * 4. BACKPROPAGATE: Update win counts up the tree
 *
 * Uses incremental state management: maintains a single game instance
 * and applies/undoes moves as it traverses the tree, rather than
 * reconstructing game state from snapshots at each node.
 */
export class MCTSBot<G extends Game = Game> {
  private game: G;
  private GameClass: GameClass<G>;
  private gameType: string;
  private playerIndex: number;
  private config: BotConfig;
  private objectives?: (game: Game, playerIndex: number) => Record<string, Objective>;
  private threatResponseMoves?: (game: Game, playerIndex: number, availableMoves: BotMove[]) => ThreatResponse;
  private rng: () => number;
  private actionHistory: SerializedAction[];
  private seed?: string;

  /** Live game instance used during search (cloned from original) */
  private searchGame: G | null = null;
  /** Command history length at root node (for undo calculations) */
  private rootCommandCount: number = 0;
  /** Root snapshot for fallback recovery */
  private rootSnapshot: GameStateSnapshot | null = null;
  /** Transposition table for caching position evaluations */
  private transpositionTable: Map<string, { value: number; visits: number }> = new Map();

  constructor(
    game: G,
    GameClass: GameClass<G>,
    gameType: string,
    playerIndex: number,
    actionHistory: SerializedAction[] = [],
    config: Partial<BotConfig> = {},
    aiConfig?: AIConfig
  ) {
    this.game = game;
    this.GameClass = GameClass;
    this.gameType = gameType;
    this.playerIndex = playerIndex;
    this.actionHistory = actionHistory;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.objectives = aiConfig?.objectives;
    this.threatResponseMoves = aiConfig?.threatResponseMoves;
    this.seed = this.config.seed;
    this.rng = createSeededRandom(this.config.seed);
  }

  // ============================================================================
  // SECTION: Core Algorithm
  // Purpose: Main MCTS loop implementing SELECT, EXPAND, PLAYOUT, BACKPROPAGATE
  // ============================================================================

  /**
   * Run MCTS and return the best move.
   * Routes to parallel or single mode based on config.
   */
  async play(): Promise<BotMove> {
    if (this.config.parallel && this.config.parallel > 1) {
      return this.playParallel();
    }
    return this.playSingle();
  }

  /**
   * Run multiple independent MCTS searches with different seeds,
   * then aggregate results by voting on the best move.
   *
   * This provides diversity benefit: each search explores different
   * parts of the game tree due to randomization, reducing blind spots.
   */
  private async playParallel(): Promise<BotMove> {
    const parallelCount = this.config.parallel!;
    const iterationsPerSearch = Math.floor(this.config.iterations / parallelCount);

    // Track votes for each unique move
    const moveVotes = new Map<string, { count: number; move: BotMove }>();

    for (let i = 0; i < parallelCount; i++) {
      // Create sub-bot with unique seed for diversity
      const subConfig: Partial<BotConfig> = {
        ...this.config,
        seed: `${this.seed ?? 'default'}-parallel-${i}`,
        iterations: iterationsPerSearch,
        parallel: 1, // Prevent recursion
      };

      // Create sub-bot sharing same game instance (read-only root state is fine)
      const subBot = new MCTSBot(
        this.game,
        this.GameClass,
        this.gameType,
        this.playerIndex,
        this.actionHistory,
        subConfig,
        {
          objectives: this.objectives,
          threatResponseMoves: this.threatResponseMoves,
        }
      );

      // Run single search (playSingle is private, so use play with parallel: 1)
      const move = await subBot.play();

      // Tally vote for this move
      const key = JSON.stringify(move);
      const existing = moveVotes.get(key);
      if (existing) {
        existing.count++;
      } else {
        moveVotes.set(key, { count: 1, move });
      }
    }

    // Return move with most votes
    let best: BotMove | null = null;
    let bestCount = 0;
    for (const { count, move } of moveVotes.values()) {
      if (count > bestCount) {
        bestCount = count;
        best = move;
      }
    }

    // Safety: if somehow no votes, fall back to single search
    if (!best) {
      return this.playSingle();
    }

    return best;
  }

  /**
   * Run a single MCTS search and return the best move
   */
  private async playSingle(): Promise<BotMove> {
    const flowState = this.game.getFlowState();
    if (!flowState?.awaitingInput) {
      throw new Error('Game is not awaiting input');
    }

    // Check if this is our turn (either currentPlayer matches or we're in awaitingPlayers)
    if (!this.canBotAct(flowState)) {
      throw new Error(`Not bot's turn (player ${this.playerIndex})`);
    }

    // Get available moves at current state
    const moves = this.enumerateMoves(this.game, flowState);
    if (moves.length === 0) {
      throw new Error('No available moves');
    }

    // If only one move, return it immediately
    if (moves.length === 1) {
      return moves[0];
    }

    // Clear transposition table for fresh search
    this.transpositionTable.clear();

    // Initialize incremental state management:
    // Clone game once and track root command count for undo
    this.rootSnapshot = this.captureSnapshot();
    const clonedGame = this.restoreGame(this.rootSnapshot);
    if (!clonedGame) {
      throw new Error('Failed to clone game for MCTS search');
    }
    this.searchGame = clonedGame as G;
    this.rootCommandCount = this.searchGame.commandHistory.length;

    // Create root node (no snapshot needed per-node anymore)
    const root = this.createNode(
      flowState,
      null,
      null,
      moves,
      0 // root has 0 commands from parent
    );

    // Apply threat response at root node
    if (this.threatResponseMoves) {
      const threatResponse = this.threatResponseMoves(this.game, this.playerIndex, moves);
      if (threatResponse.moves.length > 0) {
        const threatKeys = new Set(threatResponse.moves.map(m => JSON.stringify(m)));

        if (threatResponse.urgent) {
          // URGENT: Opponent is about to win - ONLY consider blocking moves
          // Filter both allMoves and untriedMoves to just threat moves
          root.allMoves = threatResponse.moves;
          root.untriedMoves = [...threatResponse.moves];
        } else {
          // Not urgent: Prioritize threat moves but consider all options
          // Partition untriedMoves: threat moves first, then rest
          const threatFirst: BotMove[] = [];
          const rest: BotMove[] = [];
          for (const move of root.untriedMoves) {
            if (threatKeys.has(JSON.stringify(move))) {
              threatFirst.push(move);
            } else {
              rest.push(move);
            }
          }
          root.untriedMoves = [...threatFirst, ...rest];
        }
      }
    }

    // Run MCTS iterations with timeout failsafe
    const startTime = Date.now();
    const timeout = this.config.timeout ?? 2000;

    for (let i = 0; i < this.config.iterations; i++) {
      // Check timeout before each iteration
      if (Date.now() - startTime > timeout) {
        break;
      }

      // SELECT: Walk down tree, applying moves to searchGame
      const leaf = this.selectWithPath(root);

      // EXPAND: Try one unexplored move, creating child
      const child = this.expandIncremental(leaf);

      // PLAYOUT: Random simulation from current state
      const result = this.playoutIncremental(child);

      // BACKPROPAGATE: Update stats and undo back to root
      this.backpropagateWithUndo(child, result);

      // Yield to event loop in async mode (every iteration for responsiveness)
      if (this.config.async) {
        await new Promise(resolve => setImmediate(resolve));
      }
    }

    // Cleanup search state
    this.searchGame = null;
    this.rootSnapshot = null;

    // Select best child (most visits for robustness)
    if (root.children.length === 0) {
      // No children explored, pick random from initial moves
      return randomChoice(moves, this.rng);
    }

    const best = root.children.reduce((a, b) =>
      a.visits > b.visits ? a : b
    );

    return best.parentMove!;
  }

  // ============================================================================
  // SECTION: Tree Operations
  // Purpose: SELECT and EXPAND phases - navigate and grow the search tree
  // ============================================================================

  /**
   * SELECTION with path tracking: Walk down tree using UCT, applying moves to searchGame.
   * After this completes, searchGame is positioned at the returned leaf node's state.
   */
  private selectWithPath(node: MCTSNode): MCTSNode {
    while (node.untriedMoves.length === 0 && node.children.length > 0) {
      const child = this.selectChild(node);
      // Apply the child's move to searchGame to descend
      this.applyMoveToSearchGame(child);
      node = child;
    }
    return node;
  }

  /**
   * Select the most promising child node using the UCT (Upper Confidence Bound for Trees) formula.
   * Balances exploitation (nodes with high win rates) vs exploration (less-visited nodes).
   * Uses C=sqrt(2) as the exploration constant to ensure adequate tree coverage.
   */
  private selectChild(node: MCTSNode): MCTSNode {
    const C = Math.sqrt(2); // Exploration constant
    let best = node.children[0];
    let bestUCT = -Infinity;

    for (const child of node.children) {
      const visits = child.visits + 1e-6; // Avoid division by zero
      const exploitation = child.value / visits;
      const exploration = C * Math.sqrt(Math.log(node.visits + 1) / visits);
      const uct = exploitation + exploration;

      if (uct > bestUCT) {
        bestUCT = uct;
        best = child;
      }
    }
    return best;
  }

  /**
   * Apply a node's parent move to searchGame.
   * Used during selection to descend the tree.
   */
  private applyMoveToSearchGame(node: MCTSNode): void {
    if (!node.parentMove || !this.searchGame || !node.parent) return;

    const currentPlayer = this.getCurrentPlayerFromFlowState(node.parent.flowState);
    try {
      this.searchGame.continueFlow(node.parentMove.action, node.parentMove.args, currentPlayer);
    } catch (error) {
      // Move failed - this shouldn't happen for already-explored nodes
      // but handle gracefully
    }
  }

  /**
   * EXPAND with incremental state: Apply one unexplored move to searchGame.
   * The searchGame is already positioned at the node's state from selection.
   * Returns the new child node (or current node if expansion fails).
   */
  private expandIncremental(node: MCTSNode): MCTSNode {
    if (node.untriedMoves.length === 0 || node.flowState.complete) {
      return node;
    }

    if (!this.searchGame) {
      return node;
    }

    // Pick random untried move
    const idx = Math.floor(this.rng() * node.untriedMoves.length);
    const move = node.untriedMoves.splice(idx, 1)[0];

    // Record command count before applying move
    const commandCountBefore = this.searchGame.commandHistory.length;

    // Use the current player from flow state (handles simultaneous actions)
    const currentPlayer = this.getCurrentPlayerFromFlowState(node.flowState);

    // Try to apply the move
    let flowState: FlowState;
    try {
      flowState = this.searchGame.continueFlow(move.action, move.args, currentPlayer);
    } catch (error) {
      // Move failed during simulation - return current node
      return node;
    }

    // Calculate how many commands this move generated
    const commandCount = this.searchGame.commandHistory.length - commandCountBefore;

    // Get available moves for the NEXT player (whoever's turn it is now)
    const newMoves = flowState.complete ? [] : this.enumerateMovesForSimulation(this.searchGame, flowState);

    // Create child node with command count (no snapshot needed!)
    const child = this.createNode(flowState, node, move, newMoves, commandCount);
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
   * Plays random moves until the game ends or playoutDepth is reached.
   * Returns a score in [0,1]: 1=win for bot, 0=loss, 0.5=draw/unknown.
   */
  private playoutIncremental(node: MCTSNode): number {
    if (!this.searchGame) {
      return 0.5;
    }

    let flowState = node.flowState;
    let depth = 0;

    while (!flowState.complete && depth < this.config.playoutDepth) {
      // Get available moves for the current player (whoever's turn it is)
      const moves = this.enumerateMovesForSimulation(this.searchGame, flowState);
      if (moves.length === 0) {
        break;
      }

      // Random move
      const move = randomChoice(moves, this.rng);

      // Apply move for the current player (handles simultaneous actions)
      const currentPlayer = this.getCurrentPlayerFromFlowState(flowState);

      // Try to apply the move - if it fails, stop the playout
      try {
        flowState = this.searchGame.continueFlow(move.action, move.args, currentPlayer);
      } catch (error) {
        // Move failed during simulation - stop playout and evaluate current state
        break;
      }
      depth++;
    }

    // Evaluate using the final game state (with transposition table caching)
    return this.evaluateWithCache(this.searchGame, flowState);
  }

  // ============================================================================
  // SECTION: Backpropagation
  // Purpose: BACKPROPAGATE phase - update visit counts and values up the tree
  // ============================================================================

  /**
   * BACKPROPAGATE with undo: Update statistics and roll back searchGame to root state.
   * First undoes all playout moves to get back to node state, then undoes tree moves
   * as we walk up to root.
   */
  private backpropagateWithUndo(node: MCTSNode | null, result: number): void {
    if (!this.searchGame) return;

    // First, undo playout moves to return to the node's state
    // (playout commands are everything beyond the tree path)
    const totalCommands = this.searchGame.commandHistory.length - this.rootCommandCount;
    const nodeDepthCommands = this.getNodeCommandDepth(node);
    const playoutCommands = totalCommands - nodeDepthCommands;

    if (playoutCommands > 0) {
      const success = this.searchGame.undoCommands(playoutCommands);
      if (!success) {
        // Undo failed (e.g., non-invertible command like SHUFFLE)
        // Recover by restoring from root snapshot
        this.recoverFromUndoFailure();
        // Still update statistics
        this.backpropagateStats(node, result);
        return;
      }
    }

    // Now backpropagate up the tree, undoing each node's commands
    while (node !== null) {
      node.visits++;
      // Value is from perspective of player who just moved to reach this node
      // If it's our player's turn at parent, result is good for us
      // If it's opponent's turn at parent, result is bad for them (good for us)
      const isOurPerspective = node.parent === null ||
        node.parent.currentPlayer === this.playerIndex;
      node.value += isOurPerspective ? result : (1 - result);

      // Undo this node's commands to return to parent state
      if (node.commandCount > 0 && node.parent !== null) {
        const success = this.searchGame.undoCommands(node.commandCount);
        if (!success) {
          // Undo failed - recover and continue stats update only
          this.recoverFromUndoFailure();
          this.backpropagateStats(node.parent, result);
          return;
        }
      }

      node = node.parent;
    }
  }

  /**
   * Get total command depth from root to a node (sum of all commandCounts in path)
   */
  private getNodeCommandDepth(node: MCTSNode | null): number {
    let depth = 0;
    while (node !== null) {
      depth += node.commandCount;
      node = node.parent;
    }
    return depth;
  }

  /**
   * Update statistics only (no undo) - used after recovery
   */
  private backpropagateStats(node: MCTSNode | null, result: number): void {
    while (node !== null) {
      node.visits++;
      const isOurPerspective = node.parent === null ||
        node.parent.currentPlayer === this.playerIndex;
      node.value += isOurPerspective ? result : (1 - result);
      node = node.parent;
    }
  }

  // ============================================================================
  // SECTION: Utility
  // Purpose: Helper methods for bot turn detection and position evaluation
  // ============================================================================

  /**
   * Check if the bot can act in the current flow state
   */
  private canBotAct(flowState: FlowState): boolean {
    // Simultaneous action step - check awaitingPlayers first (takes priority)
    if (flowState.awaitingPlayers && flowState.awaitingPlayers.length > 0) {
      const playerState = flowState.awaitingPlayers.find(
        p => p.playerIndex === this.playerIndex && !p.completed
      );
      return playerState !== undefined && playerState.availableActions.length > 0;
    }

    // Regular action step - check currentPlayer
    if (flowState.currentPlayer !== undefined) {
      return flowState.currentPlayer === this.playerIndex;
    }

    return false;
  }

  /**
   * Get available actions for the bot player from flow state
   */
  private getAvailableActionsForBot(flowState: FlowState): string[] {
    // Simultaneous action step - check awaitingPlayers first (takes priority)
    if (flowState.awaitingPlayers) {
      const playerState = flowState.awaitingPlayers.find(
        p => p.playerIndex === this.playerIndex && !p.completed
      );
      if (playerState && playerState.availableActions.length > 0) {
        return playerState.availableActions;
      }
    }

    // Regular action step - use availableActions if currentPlayer matches
    if (flowState.availableActions && flowState.availableActions.length > 0 &&
        flowState.currentPlayer === this.playerIndex) {
      return flowState.availableActions;
    }

    // Fallback to availableActions if currentPlayer matches or is undefined
    if (flowState.availableActions && flowState.availableActions.length > 0) {
      return flowState.availableActions;
    }

    return [];
  }

  // ============================================================================
  // SECTION: Move Enumeration
  // Purpose: Discover and enumerate all legal moves for action selection
  // ============================================================================

  /**
   * Discover all legal moves available to the bot player at the current game state.
   * Queries available actions from flowState, then generates all valid argument
   * combinations for each action by examining selection definitions.
   * Returns an array of {action, args} pairs ready for tree expansion.
   */
  private enumerateMoves(game: G | null, flowState: FlowState): BotMove[] {
    const moves: BotMove[] = [];
    if (!game) return moves;
    const actions = this.getAvailableActionsForBot(flowState);
    const player = game.getPlayer(this.playerIndex);

    for (const actionName of actions) {
      const actionDef = game.getAction(actionName);
      if (!actionDef) continue;

      // Generate all valid argument combinations
      const argCombos = this.enumerateSelections(game, actionDef, player);
      for (const args of argCombos) {
        moves.push({ action: actionName, args });
      }
    }

    return moves;
  }

  /**
   * Enumerate all valid moves for the current player (whoever's turn it is)
   * Used during MCTS simulation (expand/playout)
   */
  private enumerateMovesForSimulation(game: G, flowState: FlowState): BotMove[] {
    const moves: BotMove[] = [];

    // Get the current player from flow state
    let currentPlayerIndex = flowState.currentPlayer;
    let actions: string[] = flowState.availableActions ?? [];

    // For simultaneous actions, pick the first awaiting player
    if (flowState.awaitingPlayers && flowState.awaitingPlayers.length > 0) {
      const firstAwaiting = flowState.awaitingPlayers.find(p => !p.completed && p.availableActions.length > 0);
      if (firstAwaiting) {
        currentPlayerIndex = firstAwaiting.playerIndex;
        actions = firstAwaiting.availableActions;
      }
    }

    if (currentPlayerIndex === undefined) {
      return moves;
    }

    const player = game.getPlayer(currentPlayerIndex);
    if (!player) {
      return moves;
    }

    for (const actionName of actions) {
      const actionDef = game.getAction(actionName);
      if (!actionDef) continue;

      // Generate all valid argument combinations
      const argCombos = this.enumerateSelections(game, actionDef, player);
      for (const args of argCombos) {
        moves.push({ action: actionName, args });
      }
    }

    return moves;
  }

  /**
   * Get the current player index from flow state (for simulation)
   */
  private getCurrentPlayerFromFlowState(flowState: FlowState): number {
    // For simultaneous actions, pick the first awaiting player
    if (flowState.awaitingPlayers && flowState.awaitingPlayers.length > 0) {
      const firstAwaiting = flowState.awaitingPlayers.find(p => !p.completed && p.availableActions.length > 0);
      if (firstAwaiting) {
        return firstAwaiting.playerIndex;
      }
    }
    return flowState.currentPlayer ?? this.playerIndex;
  }

  /**
   * Enumerate all valid argument combinations for an action
   */
  private enumerateSelections(
    game: Game,
    actionDef: ActionDefinition,
    player: Player
  ): Record<string, unknown>[] {
    if (actionDef.selections.length === 0) {
      return [{}];
    }

    return this.enumerateSelectionsRecursive(game, actionDef, player, 0, {});
  }

  /**
   * Recursively build all valid argument combinations
   */
  private enumerateSelectionsRecursive(
    game: Game,
    actionDef: ActionDefinition,
    player: Player,
    index: number,
    currentArgs: Record<string, unknown>
  ): Record<string, unknown>[] {
    if (index >= actionDef.selections.length) {
      return [{ ...currentArgs }];
    }

    const selection = actionDef.selections[index];
    const choices = this.getChoicesForSelection(game, actionDef.name, selection, player, currentArgs);

    // Handle text and number inputs (skip for AI - can't enumerate)
    if (selection.type === 'text' || selection.type === 'number') {
      if (selection.optional) {
        return this.enumerateSelectionsRecursive(game, actionDef, player, index + 1, currentArgs);
      }
      // Required text/number input - AI can't handle this
      return [];
    }

    if (choices.length === 0) {
      if (selection.optional) {
        return this.enumerateSelectionsRecursive(game, actionDef, player, index + 1, currentArgs);
      }
      return [];
    }

    const results: Record<string, unknown>[] = [];

    // Check for multiSelect - need to generate combinations
    const multiSelect = (selection as any).multiSelect;
    if (multiSelect) {
      const { min, max } = this.parseMultiSelect(multiSelect);
      const combinations = this.generateCombinations(choices, min, max, selection);

      // Limit combinations to avoid explosion
      const maxCombos = 50;
      const sampledCombos = combinations.length > maxCombos
        ? this.sampleChoices(combinations, maxCombos)
        : combinations;

      for (const combo of sampledCombos) {
        const newArgs = { ...currentArgs, [selection.name]: combo };
        const subResults = this.enumerateSelectionsRecursive(game, actionDef, player, index + 1, newArgs);
        results.push(...subResults);
      }

      return results;
    }

    // Single-select handling
    // Limit branching factor to avoid combinatorial explosion
    const maxChoices = 20;
    const sampledChoices = choices.length > maxChoices
      ? this.sampleChoices(choices, maxChoices)
      : choices;

    for (const choice of sampledChoices) {
      // Serialize the choice for args
      const serializedChoice = this.serializeChoice(choice, selection);
      const newArgs = { ...currentArgs, [selection.name]: serializedChoice };
      const subResults = this.enumerateSelectionsRecursive(game, actionDef, player, index + 1, newArgs);
      results.push(...subResults);
    }

    return results;
  }

  /**
   * Parse multiSelect config into min/max values
   */
  private parseMultiSelect(multiSelect: unknown): { min: number; max: number } {
    if (typeof multiSelect === 'number') {
      return { min: 1, max: multiSelect };
    }
    if (typeof multiSelect === 'object' && multiSelect !== null) {
      const config = multiSelect as { min?: number; max?: number };
      return {
        min: config.min ?? 1,
        max: config.max ?? Infinity,
      };
    }
    return { min: 1, max: Infinity };
  }

  /**
   * Generate all combinations of choices for multiSelect
   */
  private generateCombinations(
    choices: unknown[],
    min: number,
    max: number,
    selection: Selection
  ): unknown[][] {
    const results: unknown[][] = [];

    // For exact count (min === max), just generate combinations of that size
    if (min === max) {
      this.combinationsOfSize(choices, min, [], 0, results, selection);
    } else {
      // Generate combinations of all valid sizes
      for (let size = min; size <= Math.min(max, choices.length); size++) {
        this.combinationsOfSize(choices, size, [], 0, results, selection);
      }
    }

    return results;
  }

  /**
   * Generate combinations of a specific size (recursive helper)
   */
  private combinationsOfSize(
    choices: unknown[],
    size: number,
    current: unknown[],
    startIndex: number,
    results: unknown[][],
    selection: Selection
  ): void {
    if (current.length === size) {
      // Serialize each choice in the combination
      results.push(current.map(c => this.serializeChoice(c, selection)));
      return;
    }

    for (let i = startIndex; i < choices.length; i++) {
      current.push(choices[i]);
      this.combinationsOfSize(choices, size, current, i + 1, results, selection);
      current.pop();
    }
  }

  /**
   * Get valid choices for a selection
   */
  private getChoicesForSelection(
    game: Game,
    actionName: string,
    selection: Selection,
    player: Player,
    currentArgs: Record<string, unknown>
  ): unknown[] {
    return game.getSelectionChoices(actionName, selection.name, player as any, currentArgs);
  }

  /**
   * Serialize a choice value for action args
   */
  private serializeChoice(choice: unknown, selection: Selection): unknown {
    if (selection.type === 'element') {
      return (choice as { _t: { id: number } })._t.id;
    }
    // For 'elements' type (fromElements), choices are GameElement objects with id property
    if (selection.type === 'elements') {
      return (choice as { id: number }).id;
    }
    return choice;
  }

  /**
   * Sample choices to limit branching
   */
  private sampleChoices<T>(choices: T[], maxCount: number): T[] {
    if (choices.length <= maxCount) return choices;

    const sampled: T[] = [];
    const indices = new Set<number>();

    while (sampled.length < maxCount) {
      const idx = Math.floor(this.rng() * choices.length);
      if (!indices.has(idx)) {
        indices.add(idx);
        sampled.push(choices[idx]);
      }
    }

    return sampled;
  }

  // ============================================================================
  // SECTION: State Management
  // Purpose: Incremental state management with snapshot fallback for recovery
  // ============================================================================

  /**
   * Capture current game state as snapshot
   */
  private captureSnapshot(): GameStateSnapshot {
    return createSnapshot(this.game, this.gameType, this.actionHistory, this.seed);
  }

  /**
   * Restore a game from snapshot
   * Returns null if restoration fails (e.g., due to complex phase transitions)
   */
  private restoreGame(snapshot: GameStateSnapshot): Game | null {
    try {
      const game = new this.GameClass({
        playerCount: snapshot.state.settings.playerCount as number,
        playerNames: snapshot.state.settings.playerNames as string[],
        seed: snapshot.seed,
      });

      // Replay commands to restore element state
      game.replayCommands(snapshot.commandHistory);

      // Start flow and replay actions
      game.startFlow();
      for (const action of snapshot.actionHistory) {
        const { actionName, player, args } = deserializeAction(action, game);
        // Pass the player position to continueFlow (required for simultaneous actions)
        game.continueFlow(actionName, args, player.position);
      }

      return game;
    } catch (error) {
      // Restoration failed - this can happen with complex game state transitions
      return null;
    }
  }

  /**
   * Recover from undo failure by restoring searchGame from root snapshot.
   * Called when undoCommands returns false (e.g., non-invertible command like SHUFFLE).
   */
  private recoverFromUndoFailure(): void {
    if (!this.rootSnapshot) return;

    const game = this.restoreGame(this.rootSnapshot);
    if (game) {
      this.searchGame = game as G;
      this.rootCommandCount = this.searchGame.commandHistory.length;
    }
  }

  /**
   * Create an MCTS node (path-based, no snapshot)
   * allMoves is cached at creation time - enumerated once per node
   */
  private createNode(
    flowState: FlowState,
    parent: MCTSNode | null,
    parentMove: BotMove | null,
    allMoves: BotMove[],
    commandCount: number
  ): MCTSNode {
    return {
      flowState,
      parent,
      parentMove,
      commandCount,
      children: [],
      allMoves: allMoves,
      untriedMoves: [...allMoves],
      visits: 0,
      value: 0,
      currentPlayer: flowState.currentPlayer ?? this.playerIndex,
    };
  }

  /**
   * Hash a position for transposition table lookup.
   * Uses flow state position as unique identifier (tracks game progression).
   */
  private hashPosition(game: Game, flowState: FlowState): string {
    // Flow state position changes as the game progresses through flow nodes
    // It uniquely identifies where we are in the game flow
    return JSON.stringify(flowState.position);
  }

  /**
   * Evaluate position with transposition table caching.
   * Caches evaluation results to avoid redundant computation for positions
   * reached via different move orders.
   */
  private evaluateWithCache(game: Game, flowState: FlowState): number {
    // Skip caching if disabled
    if (this.config.useTranspositionTable === false) {
      return this.evaluateTerminalFromGame(game, flowState);
    }

    const hash = this.hashPosition(game, flowState);
    const cached = this.transpositionTable.get(hash);

    // Return cached value if we have enough confidence (3+ visits)
    if (cached && cached.visits >= 3) {
      return cached.value;
    }

    // Evaluate the position
    const value = this.evaluateTerminalFromGame(game, flowState);

    // Update cache with running average
    if (cached) {
      const newVisits = cached.visits + 1;
      const newValue = (cached.value * cached.visits + value) / newVisits;
      this.transpositionTable.set(hash, { value: newValue, visits: newVisits });
    } else {
      this.transpositionTable.set(hash, { value, visits: 1 });
    }

    return value;
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

        const matched: string[] = [];
        for (const [name, obj] of Object.entries(objectives)) {
          if (obj.weight > 0) {
            maxPossibleScore += obj.weight;
          } else {
            minPossibleScore += obj.weight;
          }
          if (obj.checker(game, this.playerIndex)) {
            totalScore += obj.weight;
            matched.push(`${name}(${obj.weight})`);
          }
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

    // Check for winner from game settings
    const winners = (game as any).settings?.winners as number[] | undefined;
    if (!winners || winners.length === 0) {
      return 0.5; // Draw
    }

    if (winners.includes(this.playerIndex)) {
      return 1; // Win
    }

    return 0; // Loss
  }
}
