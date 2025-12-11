import { Action, type ActionDefinition } from '@boardsmith/engine';
import type { CheckersGame } from './game.js';
import { CheckerPiece, Square, CheckersPlayer, type CheckersMove } from './elements.js';

/**
 * Create the endTurn action for Checkers
 *
 * This action is available after a player has made a move (and is not in a multi-jump).
 * It allows the player to confirm their turn is complete, enabling undo before confirmation.
 */
export function createEndTurnAction(game: CheckersGame): ActionDefinition {
  return Action.create('endTurn')
    .prompt('End Turn')
    .condition((ctx) => {
      // Only available if player has made a move this turn
      // and is not in a multi-jump continuation
      const player = ctx.player as CheckersPlayer;

      // Can't end turn during a multi-jump
      if (game.continuingPlayer === player && game.continuingPiece) {
        return false;
      }

      // Check if hasMovedThisTurn is set
      return game.hasMovedThisTurn === true;
    })
    .execute((args, ctx) => {
      const player = ctx.player as CheckersPlayer;

      // Clear the moved flag
      game.hasMovedThisTurn = false;

      return {
        success: true,
        data: { turnEnded: true },
        message: `${player.name} ended their turn.`,
      };
    });
}

/**
 * Destination choice value - includes piece ID for filtering
 */
interface DestinationChoice {
  pieceId: number;
  fromNotation: string;
  toNotation: string;
  isCapture: boolean;
  becomesKing: boolean;
}

/**
 * Create the move action for Checkers
 *
 * This action uses two-step selection:
 * 1. Choose a piece to move (element selection)
 * 2. Choose a destination (choice selection, filtered by selected piece)
 *
 * When captures are available, they are mandatory.
 * After a capture, if the piece can make additional captures,
 * the turn continues with that piece.
 */
export function createMoveAction(game: CheckersGame): ActionDefinition {
  // Helper to get valid moves for a player or continuing piece
  function getMovesForPlayer(player: CheckersPlayer): CheckersMove[] {
    if (game.continuingPiece && game.continuingPlayer === player) {
      return game.getValidMovesForPiece(game.continuingPiece);
    }
    return game.getValidMoves(player);
  }

  // Helper to get pieces with valid moves
  function getPiecesWithMoves(player: CheckersPlayer): CheckerPiece[] {
    // If continuing a multi-jump, only that piece can move
    if (game.continuingPiece && game.continuingPlayer === player) {
      return [game.continuingPiece];
    }

    const moves = game.getValidMoves(player);
    const pieceIds = new Set(moves.map(m => m.piece.id));
    return [...pieceIds].map(id => game.getElementById(id) as CheckerPiece).filter(Boolean);
  }

  return Action.create('move')
    .prompt('Move')
    // Step 1: Select a piece to move
    .chooseElement<CheckerPiece>('piece', {
      prompt: 'Select a piece to move',
      elementClass: CheckerPiece,
      filter: (element, ctx) => {
        const piece = element as CheckerPiece;
        const player = ctx.player as CheckersPlayer;

        // Only allow selecting pieces that belong to the current player and have moves
        if (piece.player !== player) return false;

        // If continuing a multi-jump, only the continuing piece can be selected
        if (game.continuingPiece && game.continuingPlayer === player) {
          return piece === game.continuingPiece;
        }

        // Check if this piece has any valid moves
        const moves = game.getValidMoves(player);
        return moves.some(m => m.piece.id === piece.id);
      },
      display: (piece, ctx) => {
        // Display the notation of the square the piece is on
        const square = game.getPieceSquare(piece);
        return square?.notation || String(piece.id);
      },
      boardRef: (piece, ctx) => {
        const square = game.getPieceSquare(piece);
        return {
          id: piece.id,
          notation: square?.notation,
        };
      },
      skipIfOnlyOne: true,
    })
    // Step 2: Select a destination
    .chooseFrom<DestinationChoice>('destination', {
      prompt: 'Select destination',
      choices: (ctx) => {
        const player = ctx.player as CheckersPlayer;
        const moves = getMovesForPlayer(player);

        // Return all valid destinations with their piece IDs for filtering
        return moves.map(m => ({
          pieceId: m.piece.id,
          fromNotation: m.from.notation,
          toNotation: m.to.notation,
          isCapture: m.captures.length > 0,
          becomesKing: m.becomesKing,
        }));
      },
      display: (choice) => {
        let text = choice.toNotation;
        if (choice.isCapture) text += ' (capture)';
        if (choice.becomesKing) text += ' → King';
        return text;
      },
      boardRefs: (choice) => {
        const toSquare = game.board.getSquareByNotation(choice.toNotation);
        return {
          sourceRef: {
            id: choice.pieceId,
            notation: choice.fromNotation,
          },
          targetRef: {
            id: toSquare?.id,
            notation: choice.toNotation,
          },
        };
      },
      // Filter destinations based on selected piece
      filterBy: {
        key: 'pieceId',
        selectionName: 'piece',
      },
    })
    .condition((ctx) => {
      const player = ctx.player as CheckersPlayer;

      // If continuing multi-jump, only this player can act
      if (game.continuingPlayer && game.continuingPlayer !== player) {
        return false;
      }

      // If player already moved this turn (and not in multi-jump), they can't move again
      // They must click "End Turn" to pass to opponent
      if (game.hasMovedThisTurn && !game.continuingPiece) {
        return false;
      }

      // Check if player has any valid moves
      if (game.continuingPiece) {
        return game.getValidMovesForPiece(game.continuingPiece).length > 0;
      }

      return game.getValidMoves(player).length > 0;
    })
    .execute((args, ctx) => {
      const player = ctx.player as CheckersPlayer;
      const piece = args.piece as CheckerPiece;
      const destination = args.destination as DestinationChoice;

      // Find the actual move
      const moves = getMovesForPlayer(player);
      const move = moves.find(
        m => m.piece.id === piece.id && m.to.notation === destination.toNotation
      );

      if (!move) {
        return {
          success: false,
          error: 'Invalid move',
        };
      }

      // Log the move
      const pieceType = move.piece.isKing ? 'King' : 'Piece';
      const isCapture = move.captures.length > 0;

      game.message(`${player.name}: ${pieceType} ${move.from.notation} -> ${move.to.notation}`);

      // Execute the move
      game.executeMove(move);

      // Check for multi-jump continuation
      // Note: In American checkers, when crowned the turn ends immediately
      if (isCapture && !move.becomesKing) {
        const additionalCaptures = game.getCaptureMoves(move.piece);
        if (additionalCaptures.length > 0) {
          // Must continue capturing with this piece
          game.continuingPlayer = player;
          game.continuingPiece = move.piece;

          game.message(`${player.name} must continue capturing!`);

          return {
            success: true,
            data: {
              captured: true,
              mustContinue: true,
              from: move.from.notation,
              to: move.to.notation,
              crowned: false,
            },
            message: `Captured! Must continue jumping.`,
          };
        }
      }

      // Turn can end - clear continuation state and mark that player has moved
      game.continuingPlayer = null;
      game.continuingPiece = null;
      game.hasMovedThisTurn = true;

      return {
        success: true,
        data: {
          captured: isCapture,
          mustContinue: false,
          canEndTurn: true, // Signal that player can now end their turn
          from: move.from.notation,
          to: move.to.notation,
          crowned: move.becomesKing,
        },
        message: move.becomesKing
          ? `Moved and crowned!`
          : isCapture
            ? `Captured!`
            : `Moved ${move.from.notation} to ${move.to.notation}`,
      };
    });
}
