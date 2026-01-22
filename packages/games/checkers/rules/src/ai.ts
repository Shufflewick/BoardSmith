import type { Game } from '@boardsmith/engine';
import type { Objective } from '@boardsmith/ai';
import type { CheckersGame } from './game.js';
import type { CheckersPlayer } from './elements.js';

/**
 * AI objectives for Checkers
 * These guide the MCTS bot to prefer better positions during playouts
 */
export function getCheckersObjectives(
  game: Game,
  playerSeat: number
): Record<string, Objective> {
  const checkersGame = game as CheckersGame;
  const player = checkersGame.getPlayer(playerSeat) as CheckersPlayer;
  const opponentSeat = playerSeat === 1 ? 2 : 1;
  const opponent = checkersGame.getPlayer(opponentSeat) as CheckersPlayer;

  return {
    // Having more pieces is good
    'piece-advantage': {
      checker: () => {
        const myPieces = checkersGame.getPlayerPieces(player).length;
        const theirPieces = checkersGame.getPlayerPieces(opponent).length;
        return myPieces > theirPieces;
      },
      weight: 5,
    },

    // Having more kings is very good
    'king-advantage': {
      checker: () => {
        const myKings = checkersGame.getPlayerPieces(player).filter(p => p.isKing).length;
        const theirKings = checkersGame.getPlayerPieces(opponent).filter(p => p.isKing).length;
        return myKings > theirKings;
      },
      weight: 8,
    },

    // Control the center (squares in rows 3-4)
    'center-control': {
      checker: () => {
        const myPieces = checkersGame.getPlayerPieces(player);
        const centerPieces = myPieces.filter(p => {
          const square = checkersGame.getPieceSquare(p);
          return square && square.row >= 3 && square.row <= 4;
        });
        return centerPieces.length >= 2;
      },
      weight: 3,
    },

    // Advancing pieces toward king row is good
    'advancement': {
      checker: () => {
        const myPieces = checkersGame.getPlayerPieces(player).filter(p => !p.isKing);
        if (myPieces.length === 0) return false;

        const kingRow = player.seat === 1 ? 7 : 0;
        const avgDistance = myPieces.reduce((sum, p) => {
          const square = checkersGame.getPieceSquare(p);
          if (!square) return sum;
          return sum + Math.abs(square.row - kingRow);
        }, 0) / myPieces.length;

        // Good if average distance to king row is less than 3
        return avgDistance < 3;
      },
      weight: 2,
    },

    // Protect the back row (prevent opponent kings)
    'back-row-defense': {
      checker: () => {
        const backRow = player.seat === 1 ? 0 : 7;
        const myPieces = checkersGame.getPlayerPieces(player);
        const backRowPieces = myPieces.filter(p => {
          const square = checkersGame.getPieceSquare(p);
          return square && square.row === backRow;
        });
        return backRowPieces.length >= 1;
      },
      weight: 2,
    },

    // Having capture opportunities is good
    'capture-available': {
      checker: () => checkersGame.playerHasCaptures(player),
      weight: 4,
    },

    // Opponent having no moves is very good (near win)
    'opponent-blocked': {
      checker: () => checkersGame.getValidMoves(opponent).length === 0,
      weight: 20,
    },
  };
}
