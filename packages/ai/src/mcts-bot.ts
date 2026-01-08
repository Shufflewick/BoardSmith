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
import type { BotConfig, BotMove, MCTSNode, AIConfig, Objective } from './types.js';
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
 */
export class MCTSBot<G extends Game = Game> {
  private game: G;
  private GameClass: GameClass<G>;
  private gameType: string;
  private playerIndex: number;
  private config: BotConfig;
  private objectives?: (game: Game, playerIndex: number) => Record<string, Objective>;
  private rng: () => number;
  private actionHistory: SerializedAction[];
  private seed?: string;

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
    this.seed = this.config.seed;
    this.rng = createSeededRandom(this.config.seed);
  }

  /**
   * Run MCTS and return the best move
   */
  async play(): Promise<BotMove> {
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

    // Create root node
    const root = this.createNode(
      this.captureSnapshot(),
      flowState,
      null,
      null,
      moves
    );

    // Run MCTS iterations with timeout failsafe
    const startTime = Date.now();
    const timeout = this.config.timeout ?? 2000;

    for (let i = 0; i < this.config.iterations; i++) {
      // Check timeout before each iteration
      if (Date.now() - startTime > timeout) {
        break;
      }

      const leaf = this.select(root);
      const { child, game } = this.expand(leaf);
      const result = this.playout(child, game);
      this.backpropagate(child, result);

      // Yield to event loop in async mode (every iteration for responsiveness)
      if (this.config.async) {
        await new Promise(resolve => setImmediate(resolve));
      }
    }

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

  /**
   * SELECTION: Walk down tree using UCT until we find a node with untried moves
   */
  private select(node: MCTSNode): MCTSNode {
    while (node.untriedMoves.length === 0 && node.children.length > 0) {
      node = this.selectChild(node);
    }
    return node;
  }

  /**
   * Select child using UCT (Upper Confidence Bound for Trees)
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
   * EXPANSION: Add one child node for an untried move
   * Returns both the child node and the game instance for reuse in playout
   */
  private expand(node: MCTSNode): { child: MCTSNode; game: Game | null } {
    if (node.untriedMoves.length === 0 || node.flowState.complete) {
      return { child: node, game: null };
    }

    // Pick random untried move
    const idx = Math.floor(this.rng() * node.untriedMoves.length);
    const move = node.untriedMoves.splice(idx, 1)[0];

    // Restore game once and reuse it
    const game = this.restoreGame(node.snapshot);
    if (!game) {
      // Restoration failed - return current node without expanding
      return { child: node, game: null };
    }

    // Use the current player from flow state (handles simultaneous actions)
    const currentPlayer = this.getCurrentPlayerFromFlowState(node.flowState);

    // Try to apply the move - if it fails, return the current node without expanding
    let flowState: FlowState;
    try {
      flowState = game.continueFlow(move.action, move.args, currentPlayer);
    } catch (error) {
      // Move failed during simulation - this can happen with complex game state transitions
      // Return the current node and let playout evaluate it
      return { child: node, game: null };
    }

    // Get available moves for the NEXT player (whoever's turn it is now)
    const newMoves = flowState.complete ? [] : this.enumerateMovesForSimulation(game as G, flowState);

    // Create snapshot for storing in tree (needed for future expansions)
    const newActionHistory = [
      ...node.snapshot.actionHistory,
      {
        name: move.action,
        player: currentPlayer,
        args: move.args,
        timestamp: Date.now(),
      },
    ];
    const snapshot = createSnapshot(game, this.gameType, newActionHistory, node.snapshot.seed);

    const child = this.createNode(snapshot, flowState, node, move, newMoves);
    node.children.push(child);

    return { child, game };
  }

  /**
   * PLAYOUT: Random simulation until game ends or depth limit
   * Can optionally receive a pre-created game instance from expand()
   */
  private playout(node: MCTSNode, existingGame: Game | null): number {
    // Reuse existing game if provided, otherwise restore
    const game = existingGame ?? this.restoreGame(node.snapshot);
    if (!game) {
      // Restoration failed - return neutral result
      return 0.5;
    }

    let flowState = node.flowState;
    let depth = 0;

    while (!flowState.complete && depth < this.config.playoutDepth) {
      // Get available moves for the current player (whoever's turn it is)
      const moves = this.enumerateMovesForSimulation(game as G, flowState);
      if (moves.length === 0) {
        break;
      }

      // Random move
      const move = randomChoice(moves, this.rng);

      // Apply move for the current player (handles simultaneous actions)
      const currentPlayer = this.getCurrentPlayerFromFlowState(flowState);

      // Try to apply the move - if it fails, stop the playout
      try {
        flowState = game.continueFlow(move.action, move.args, currentPlayer);
      } catch (error) {
        // Move failed during simulation - stop playout and evaluate current state
        break;
      }
      depth++;
    }

    // Evaluate using the final game state
    return this.evaluateTerminalFromGame(game, flowState);
  }

  /**
   * BACKPROPAGATION: Update statistics up the tree
   */
  private backpropagate(node: MCTSNode | null, result: number): void {
    while (node !== null) {
      node.visits++;
      // Value is from perspective of player who just moved to reach this node
      // If it's our player's turn at parent, result is good for us
      // If it's opponent's turn at parent, result is bad for them (good for us)
      const isOurPerspective = node.parent === null ||
        node.parent.currentPlayer === this.playerIndex;
      node.value += isOurPerspective ? result : (1 - result);
      node = node.parent;
    }
  }

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

  /**
   * Enumerate all valid moves for the bot player at current game state
   * Used for the initial move selection
   */
  private enumerateMoves(game: G, flowState: FlowState): BotMove[] {
    const moves: BotMove[] = [];
    const actions = this.getAvailableActionsForBot(flowState);
    const player = game.players.get(this.playerIndex);

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

    const player = game.players.get(currentPlayerIndex);
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
   * Enumerate moves from a snapshot (creates temporary game)
   */
  private enumerateMovesFromSnapshot(snapshot: GameStateSnapshot, flowState: FlowState): BotMove[] {
    const game = this.restoreGame(snapshot);
    if (!game) return [];
    return this.enumerateMoves(game as G, flowState);
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
        playerCount: snapshot.state.players.length,
        playerNames: snapshot.state.players.map(p => p.name as string),
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
   * Apply a move to a snapshot, returning new snapshot and flow state
   * Returns null if the game cannot be restored or move fails
   */
  private applyMove(
    snapshot: GameStateSnapshot,
    move: BotMove
  ): { snapshot: GameStateSnapshot; flowState: FlowState } | null {
    const game = this.restoreGame(snapshot);
    if (!game) return null;

    const currentPlayer = game.getFlowState()?.currentPlayer ?? this.playerIndex;

    // Apply the move
    let flowState: FlowState;
    try {
      flowState = game.continueFlow(move.action, move.args, currentPlayer);
    } catch (error) {
      return null;
    }

    // Create new snapshot with updated action history
    const newActionHistory = [
      ...snapshot.actionHistory,
      {
        name: move.action,
        player: currentPlayer,
        args: move.args,
        timestamp: Date.now(),
      },
    ];

    const newSnapshot = createSnapshot(game, this.gameType, newActionHistory, snapshot.seed);

    return { snapshot: newSnapshot, flowState };
  }

  /**
   * Create an MCTS node
   */
  private createNode(
    snapshot: GameStateSnapshot,
    flowState: FlowState,
    parent: MCTSNode | null,
    parentMove: BotMove | null,
    untriedMoves: BotMove[]
  ): MCTSNode {
    return {
      snapshot,
      flowState,
      parent,
      parentMove,
      children: [],
      untriedMoves: [...untriedMoves],
      visits: 0,
      value: 0,
      currentPlayer: flowState.currentPlayer ?? this.playerIndex,
    };
  }

  /**
   * Evaluate objectives at a position
   */
  private evaluateObjectives(snapshot: GameStateSnapshot): number {
    if (!this.objectives) return 0;

    const game = this.restoreGame(snapshot);
    if (!game) return 0;

    const objectives = this.objectives(game, this.playerIndex);

    let totalScore = 0;
    for (const obj of Object.values(objectives)) {
      if (obj.checker(game, this.playerIndex)) {
        totalScore += obj.weight;
      }
    }

    return totalScore;
  }

  /**
   * Evaluate terminal position from snapshot
   */
  private evaluateTerminal(snapshot: GameStateSnapshot, flowState: FlowState): number {
    if (!flowState.complete) {
      // Game didn't complete - use objectives if available
      if (this.objectives) {
        const score = this.evaluateObjectives(snapshot);
        // Normalize to [0, 1]
        return score > 0 ? 0.6 : (score < 0 ? 0.4 : 0.5);
      }
      return 0.5; // Draw/unknown
    }

    // Check for winner
    const winners = snapshot.state.settings.winners as number[] | undefined;
    if (!winners || winners.length === 0) {
      return 0.5; // Draw
    }

    if (winners.includes(this.playerIndex)) {
      return 1; // Win
    }

    return 0; // Loss
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
        for (const obj of Object.values(objectives)) {
          if (obj.checker(game, this.playerIndex)) {
            totalScore += obj.weight;
          }
        }
        // Normalize to [0, 1]
        return totalScore > 0 ? 0.6 : (totalScore < 0 ? 0.4 : 0.5);
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
