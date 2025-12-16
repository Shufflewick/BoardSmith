import { Game, type GameOptions } from '@boardsmith/engine';
import { DEFAULT_PLAYER_COLORS } from '@boardsmith/session';
import { Board, Square, CheckerPiece, CheckersPlayer, type CheckersMove } from './elements.js';
import { createMoveAction, createEndTurnAction } from './actions.js';
import { createCheckersFlow } from './flow.js';

/** Default checkers colors - red and black */
const CHECKERS_DEFAULT_COLORS = ['#e74c3c', '#2c3e50'] as const;

/**
 * Player configuration from lobby
 */
interface PlayerConfig {
  name?: string;
  isAI?: boolean;
  aiLevel?: string;
  color?: string;
}

/**
 * Checkers game options
 */
export interface CheckersOptions extends GameOptions {
  /** Random seed for deterministic gameplay */
  seed?: string;
  /** Per-player configurations from lobby */
  playerConfigs?: PlayerConfig[];
}

/**
 * American Checkers (English Draughts) implementation
 *
 * Rules:
 * - 8x8 board, pieces on dark squares only
 * - Each player starts with 12 pieces
 * - Dark pieces move first
 * - Regular pieces move diagonally forward only
 * - Kings (crowned when reaching opposite end) move diagonally in any direction
 * - Captures are mandatory - must jump if able
 * - Multiple captures in one turn if available
 * - Can choose which capture to make if multiple options
 * - Win by capturing all opponent pieces or blocking all their moves
 */
export class CheckersGame extends Game<CheckersGame, CheckersPlayer> {
  /** The game board */
  board!: Board;

  /** Track which player must continue capturing (for multi-jump turns) */
  continuingPlayer: CheckersPlayer | null = null;
  continuingPiece: CheckerPiece | null = null;

  /** Track if the current player has made a move this turn (for undo/endTurn) */
  hasMovedThisTurn: boolean = false;

  constructor(options: CheckersOptions) {
    super(options);

    // Apply player colors from config
    this.applyPlayerColors(options.playerConfigs);

    // Register element classes
    this.registerElements([Board, Square, CheckerPiece]);

    // Create the board
    this.board = this.create(Board, 'board');
    this.board.contentsVisible();

    // Create all 64 squares
    this.createSquares();

    // Place initial pieces
    this.placePieces();

    // Register actions
    this.registerAction(createMoveAction(this));
    this.registerAction(createEndTurnAction(this));

    // Set up game flow
    this.setFlow(createCheckersFlow(this));

    // Announce player colors
    this.message(`${this.players[0].name} plays ${this.players[0].color}`);
    this.message(`${this.players[1].name} plays ${this.players[1].color}`);
  }

  /**
   * Apply colors from player configs
   */
  private applyPlayerColors(playerConfigs?: PlayerConfig[]): void {
    for (let i = 0; i < this.players.length; i++) {
      const config = playerConfigs?.[i];
      if (config?.color) {
        this.players[i].color = config.color;
      } else {
        // Default colors: Player 0 = red (#e74c3c), Player 1 = black (#2c3e50)
        this.players[i].color = CHECKERS_DEFAULT_COLORS[i] ?? CHECKERS_DEFAULT_COLORS[0];
      }
    }
  }

  /**
   * Override to create CheckersPlayer instances
   */
  protected override createPlayer(position: number, name: string): CheckersPlayer {
    return new CheckersPlayer(position, name);
  }

  /**
   * Create all 64 squares on the board
   */
  private createSquares(): void {
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        // Dark squares are where (row + col) is odd
        const isDark = (row + col) % 2 === 1;
        // Use algebraic notation for square names (a1-h8)
        const colLetter = String.fromCharCode(97 + col); // a-h
        const rowNumber = 8 - row; // 1-8 (row 0 = 8, row 7 = 1)
        const notation = `${colLetter}${rowNumber}`;
        const square = this.board.create(Square, notation, { row, col, isDark });
        square.contentsVisible();
      }
    }
  }

  /**
   * Place initial pieces on the board
   * Player 0 (dark pieces) on rows 0-2
   * Player 1 (light pieces) on rows 5-7
   */
  private placePieces(): void {
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const square = this.board.getSquare(row, col);
        if (!square || !square.isDark) continue;

        // Player 0 pieces on top 3 rows
        if (row < 3) {
          const piece = square.create(CheckerPiece, `p0-${row}-${col}`);
          piece.player = this.players[0];
        }
        // Player 1 pieces on bottom 3 rows
        else if (row > 4) {
          const piece = square.create(CheckerPiece, `p1-${row}-${col}`);
          piece.player = this.players[1];
        }
      }
    }
  }

  /**
   * Get all pieces belonging to a player
   */
  getPlayerPieces(player: CheckersPlayer): CheckerPiece[] {
    const pieces: CheckerPiece[] = [];
    for (const square of this.board.getDarkSquares()) {
      const piece = square.getPiece();
      if (piece && piece.player === player) {
        pieces.push(piece);
      }
    }
    return pieces;
  }

  /**
   * Get the square a piece is on
   */
  getPieceSquare(piece: CheckerPiece): Square | undefined {
    return piece.parent as Square | undefined;
  }

  /**
   * Check if a move is a valid simple move (non-capture)
   */
  isValidSimpleMove(piece: CheckerPiece, to: Square): boolean {
    const from = this.getPieceSquare(piece);
    if (!from || !to.isEmpty()) return false;

    const rowDiff = to.row - from.row;
    const colDiff = Math.abs(to.col - from.col);

    // Must move exactly 1 square diagonally
    if (colDiff !== 1 || Math.abs(rowDiff) !== 1) return false;

    // Check direction
    if (!piece.isKing) {
      // Regular pieces can only move forward
      if (piece.forwardDirection === 1 && rowDiff !== 1) return false;
      if (piece.forwardDirection === -1 && rowDiff !== -1) return false;
    }

    return true;
  }

  /**
   * Get all valid capture moves for a piece
   * Returns array of { to: Square, captured: Square }
   */
  getCaptureMoves(piece: CheckerPiece): Array<{ to: Square; captured: Square }> {
    const from = this.getPieceSquare(piece);
    if (!from) return [];

    const player = piece.player;
    if (!player) return [];

    const captures: Array<{ to: Square; captured: Square }> = [];
    const directions = piece.isKing
      ? [[-1, -1], [-1, 1], [1, -1], [1, 1]]
      : piece.forwardDirection === 1
        ? [[1, -1], [1, 1]]
        : [[-1, -1], [-1, 1]];

    for (const [dRow, dCol] of directions) {
      const midRow = from.row + dRow;
      const midCol = from.col + dCol;
      const endRow = from.row + 2 * dRow;
      const endCol = from.col + 2 * dCol;

      // Check bounds
      if (endRow < 0 || endRow > 7 || endCol < 0 || endCol > 7) continue;

      const midSquare = this.board.getSquare(midRow, midCol);
      const endSquare = this.board.getSquare(endRow, endCol);

      if (!midSquare || !endSquare) continue;

      // Middle square must have opponent's piece
      if (!midSquare.hasOpponentPiece(player)) continue;

      // End square must be empty
      if (!endSquare.isEmpty()) continue;

      captures.push({ to: endSquare, captured: midSquare });
    }

    return captures;
  }

  /**
   * Check if a player has any capture moves available
   */
  playerHasCaptures(player: CheckersPlayer): boolean {
    for (const piece of this.getPlayerPieces(player)) {
      if (this.getCaptureMoves(piece).length > 0) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if a player has ANY valid move (early exit optimization)
   * Much faster than getValidMoves().length > 0 for checking game state
   */
  hasAnyValidMove(player: CheckersPlayer): boolean {
    const pieces = this.getPlayerPieces(player);
    if (pieces.length === 0) return false;

    // First check for captures (mandatory) - early exit on first found
    for (const piece of pieces) {
      if (this.getCaptureMoves(piece).length > 0) {
        return true;
      }
    }

    // No captures, check for simple moves - early exit on first found
    for (const piece of pieces) {
      const from = this.getPieceSquare(piece);
      if (!from) continue;

      for (const dRow of piece.isKing ? [-1, 1] : [piece.forwardDirection]) {
        for (const dCol of [-1, 1]) {
          const toRow = from.row + dRow;
          const toCol = from.col + dCol;

          if (toRow < 0 || toRow > 7 || toCol < 0 || toCol > 7) continue;

          const to = this.board.getSquare(toRow, toCol);
          if (to && to.isEmpty()) {
            return true; // Found at least one valid move
          }
        }
      }
    }

    return false;
  }

  /**
   * Check if a specific piece has capture moves available
   */
  pieceHasCaptures(piece: CheckerPiece): boolean {
    return this.getCaptureMoves(piece).length > 0;
  }

  /**
   * Get all valid moves for a player
   * If captures are available, only capture moves are returned (mandatory capture rule)
   */
  getValidMoves(player: CheckersPlayer): CheckersMove[] {
    const moves: CheckersMove[] = [];
    const pieces = this.getPlayerPieces(player);

    // First check for captures (mandatory)
    let hasCaptures = false;
    for (const piece of pieces) {
      const captureMoves = this.getCaptureMoves(piece);
      if (captureMoves.length > 0) {
        hasCaptures = true;
        const from = this.getPieceSquare(piece)!;
        for (const { to, captured } of captureMoves) {
          const becomesKing = !piece.isKing && this.isKingRow(to.row, player);
          moves.push({
            piece,
            from,
            to,
            captures: [captured],
            becomesKing,
          });
        }
      }
    }

    // If captures available, must capture (return only capture moves)
    if (hasCaptures) return moves;

    // No captures, return simple moves
    for (const piece of pieces) {
      const from = this.getPieceSquare(piece);
      if (!from) continue;

      // Check all diagonally adjacent squares
      for (const dRow of piece.isKing ? [-1, 1] : [piece.forwardDirection]) {
        for (const dCol of [-1, 1]) {
          const toRow = from.row + dRow;
          const toCol = from.col + dCol;

          if (toRow < 0 || toRow > 7 || toCol < 0 || toCol > 7) continue;

          const to = this.board.getSquare(toRow, toCol);
          if (!to || !to.isEmpty()) continue;

          const becomesKing = !piece.isKing && this.isKingRow(to.row, player);
          moves.push({
            piece,
            from,
            to,
            captures: [],
            becomesKing,
          });
        }
      }
    }

    return moves;
  }

  /**
   * Get valid moves for a specific piece (for multi-jump continuation)
   */
  getValidMovesForPiece(piece: CheckerPiece): CheckersMove[] {
    const player = piece.player;
    if (!player) return [];

    const moves: CheckersMove[] = [];
    const captureMoves = this.getCaptureMoves(piece);

    if (captureMoves.length > 0) {
      const from = this.getPieceSquare(piece)!;
      for (const { to, captured } of captureMoves) {
        const becomesKing = !piece.isKing && this.isKingRow(to.row, player);
        moves.push({
          piece,
          from,
          to,
          captures: [captured],
          becomesKing,
        });
      }
    }

    return moves;
  }

  /**
   * Check if a row is the king row for a player
   */
  isKingRow(row: number, player: CheckersPlayer): boolean {
    // Player 0 kings at row 7, Player 1 kings at row 0
    return player.position === 0 ? row === 7 : row === 0;
  }

  /**
   * Execute a move
   */
  executeMove(move: CheckersMove): void {
    const { piece, from, to, captures, becomesKing } = move;

    // Remove captured pieces
    for (const capturedSquare of captures) {
      const capturedPiece = capturedSquare.getPiece();
      if (capturedPiece) {
        capturedPiece.remove();
        if (piece.player) {
          piece.player.capturedCount++;
        }
        this.message(`${piece.player?.name} captured a piece!`);
      }
    }

    // Move the piece
    piece.putInto(to);

    // Crown if reaching king row (and turn ends)
    if (becomesKing) {
      piece.crown();
      this.message(`${piece.player?.name}'s piece was crowned!`);
    }
  }

  /**
   * Check if the game is over
   * Optimized to use hasAnyValidMove() for early exit
   */
  override isFinished(): boolean {
    // Game is over if either player has no pieces or no valid moves
    for (const player of this.players) {
      if (!this.hasAnyValidMove(player)) return true;
    }
    return false;
  }

  /**
   * Get the winner(s)
   * Optimized to use hasAnyValidMove() instead of getValidMoves()
   */
  override getWinners(): CheckersPlayer[] {
    if (!this.isFinished()) return [];

    // Check each player - whoever has no moves loses
    for (const player of this.players) {
      if (!this.hasAnyValidMove(player)) {
        const opponent = this.players.find(p => p !== player);
        return opponent ? [opponent] : [];
      }
    }

    return [];
  }

  /**
   * Check if current player can make any move
   * Optimized to use hasAnyValidMove() for early exit
   */
  canCurrentPlayerMove(player: CheckersPlayer): boolean {
    return this.hasAnyValidMove(player);
  }
}
