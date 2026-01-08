import { Piece, Grid, GridCell, Player } from '@boardsmith/engine';
import type { CheckersGame } from './game.js';

/**
 * A checker piece that can be a regular piece or a king
 */
export class CheckerPiece extends Piece<CheckersGame, CheckersPlayer> {
  /** Whether this piece has been crowned as a king */
  isKing: boolean = false;

  /**
   * Get the direction this piece can move (1 = down the board, -1 = up)
   * Regular pieces move toward opponent's side, kings move both ways
   */
  get forwardDirection(): number {
    // Player 1 (dark) starts at top, moves down (+1)
    // Player 2 (light) starts at bottom, moves up (-1)
    return this.player?.position === 1 ? 1 : -1;
  }

  /**
   * Crown this piece as a king
   */
  crown(): void {
    this.isKing = true;
  }
}

/**
 * A square on the checkerboard
 * Only dark squares are playable in checkers
 */
export class Square extends GridCell<CheckersGame, CheckersPlayer> {
  /** Row position (0-7, 0 is top) */
  declare row: number;
  /** Column position (0-7, 0 is left) */
  col!: number;
  /** Whether this is a dark (playable) square */
  isDark!: boolean;

  /**
   * Get the piece on this square, if any
   */
  getPiece(): CheckerPiece | undefined {
    return this.first(CheckerPiece);
  }

  /**
   * Check if this square is empty
   */
  isEmpty(): boolean {
    return this.count(CheckerPiece) === 0;
  }

  /**
   * Check if this square has an opponent's piece
   */
  hasOpponentPiece(player: CheckersPlayer): boolean {
    const piece = this.getPiece();
    return piece !== undefined && piece.player !== player;
  }

  /**
   * Check if this square has a friendly piece
   */
  hasFriendlyPiece(player: CheckersPlayer): boolean {
    const piece = this.getPiece();
    return piece !== undefined && piece.player === player;
  }

  /**
   * Get algebraic notation for this square (a1-h8 style)
   */
  get notation(): string {
    const col = String.fromCharCode(97 + this.col); // a-h
    const row = 8 - this.row; // 1-8 (row 0 = 8, row 7 = 1)
    return `${col}${row}`;
  }
}

/**
 * The checkerboard - contains all 64 squares
 */
export class Board extends Grid<CheckersGame, CheckersPlayer> {
  // Set grid labels for AutoUI (chess-style notation)
  $rowLabels = ['8', '7', '6', '5', '4', '3', '2', '1'];
  $columnLabels = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  // Tell AutoUI which attributes represent coordinates
  $rowCoord = 'row';
  $colCoord = 'col';

  /**
   * Get a square by row and column
   */
  getSquare(row: number, col: number): Square | undefined {
    return this.first(Square, { row, col });
  }

  /**
   * Get a square by algebraic notation (e.g., "a1")
   */
  getSquareByNotation(notation: string): Square | undefined {
    const col = notation.charCodeAt(0) - 97; // 'a' = 0
    const row = 8 - parseInt(notation[1]); // '8' = 0
    return this.getSquare(row, col);
  }

  /**
   * Get all dark (playable) squares
   */
  getDarkSquares(): Square[] {
    return [...this.all(Square, { isDark: true })];
  }
}

/**
 * Checkers player
 */
export class CheckersPlayer extends Player {
  /** Number of pieces captured by this player */
  capturedCount: number = 0;
  /** The color of this player's checkers (hex code) */
  color: string = '#e74c3c';
}

/**
 * Represents a move in checkers (can be a sequence of jumps)
 */
export interface CheckersMove {
  /** The piece being moved */
  piece: CheckerPiece;
  /** Starting square */
  from: Square;
  /** Ending square */
  to: Square;
  /** Squares jumped over (for captures) */
  captures: Square[];
  /** Whether this move results in a king */
  becomesKing: boolean;
}
