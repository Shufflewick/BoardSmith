import { Game, type GameOptions } from '@boardsmith/engine';
import { Board, Cell, Stone, HexPlayer } from './elements.js';
import { createPlaceStoneAction } from './actions.js';
import { createHexFlow } from './flow.js';

/**
 * Configuration options for a Hex game
 */
export interface HexOptions extends GameOptions {
  /** Board size (default: 7 for testing, standard is 11) */
  boardSize?: number;
}

/**
 * Hex Game
 *
 * A connection game played on a rhombus-shaped hex grid.
 * - Red player (0) tries to connect top to bottom (r=0 to r=size-1)
 * - Blue player (1) tries to connect left to right (q=0 to q=size-1)
 * - Players alternate placing one stone per turn
 * - First to connect their two edges wins
 * - No draws possible (mathematically proven)
 */
export class HexGame extends Game<HexGame, HexPlayer> {
  // Game configuration
  boardSize: number = 7;

  /** The game board */
  board!: Board;

  /** Track the winner */
  winner?: HexPlayer;

  constructor(options: HexOptions) {
    super(options);

    // Apply options
    this.boardSize = options.boardSize ?? 7;

    // Register element classes
    this.registerElements([Board, Cell, Stone]);

    // Create the hex board
    this.board = this.create(Board, 'board', {
      boardSize: this.boardSize,
    });
    this.board.contentsVisible();

    // Create all cells in a rhombus pattern
    // For a size N board, we have N rows and N columns in axial coords
    for (let r = 0; r < this.boardSize; r++) {
      for (let q = 0; q < this.boardSize; q++) {
        const cell = this.board.create(Cell, `cell-${q}-${r}`, { q, r });
        cell.contentsVisible();
      }
    }

    // Register actions
    this.registerAction(createPlaceStoneAction(this));

    // Set up the flow
    this.setFlow(createHexFlow(this));

    this.message('Hex game started!');
    this.message(`Board size: ${this.boardSize}x${this.boardSize}`);
    this.message('Red connects top to bottom, Blue connects left to right.');
  }

  /**
   * Override to create HexPlayer instances
   */
  protected override createPlayer(position: number, name: string): HexPlayer {
    return new HexPlayer(position, name);
  }

  /**
   * Set the winner and mark game as finished
   */
  setWinner(player: HexPlayer): void {
    this.winner = player;
  }

  /**
   * Check if the game is over
   */
  override isFinished(): boolean {
    // Game ends when there's a winner
    if (this.winner) return true;

    // Game also ends if board is full (but this shouldn't happen in Hex
    // since someone always wins before the board fills)
    const emptyCells = this.board.getEmptyCells();
    return emptyCells.length === 0;
  }

  /**
   * Get the winner(s)
   */
  override getWinners(): HexPlayer[] {
    return this.winner ? [this.winner] : [];
  }
}
