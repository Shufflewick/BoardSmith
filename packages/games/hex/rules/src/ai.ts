import type { HexGame } from './game.js';
import { Board, Cell, HexPlayer } from './elements.js';

/**
 * AI objectives for Hex
 * Used by MCTS bot to evaluate game states
 */
export function getHexObjectives(game: HexGame, player: HexPlayer) {
  const board = game.board;
  if (!board) return { score: 0 };

  const size = board.boardSize;
  const isRed = player.position === 1;

  // Check for win/loss
  if (game.winner) {
    return { score: game.winner === player ? 1000 : -1000 };
  }

  // Heuristic: count connected components and proximity to goal
  let score = 0;

  // Get all cells with player's stones
  const playerCells = [...board.all(Cell)].filter(cell =>
    cell.hasFriendlyStone(player)
  );

  // Score based on number of stones placed
  score += playerCells.length * 10;

  // Score based on proximity to goal edges
  for (const cell of playerCells) {
    if (isRed) {
      // Red wants to connect top (r=0) to bottom (r=size-1)
      // Score cells closer to both edges
      const topDist = cell.r;
      const bottomDist = size - 1 - cell.r;
      const minDist = Math.min(topDist, bottomDist);
      score += (size - minDist) * 2;

      // Bonus for cells on edges
      if (cell.isRedStartEdge()) score += 5;
      if (cell.isRedGoalEdge(size)) score += 5;
    } else {
      // Blue wants to connect left (q=0) to right (q=size-1)
      const leftDist = cell.q;
      const rightDist = size - 1 - cell.q;
      const minDist = Math.min(leftDist, rightDist);
      score += (size - minDist) * 2;

      // Bonus for cells on edges
      if (cell.isBlueStartEdge()) score += 5;
      if (cell.isBlueGoalEdge(size)) score += 5;
    }
  }

  // Center control bonus (center cells are more valuable)
  const center = Math.floor(size / 2);
  for (const cell of playerCells) {
    const distFromCenter = Math.abs(cell.q - center) + Math.abs(cell.r - center);
    score += Math.max(0, size - distFromCenter);
  }

  // Penalize opponent's progress
  const opponentCells = [...board.all(Cell)].filter(cell =>
    cell.hasOpponentStone(player)
  );
  score -= opponentCells.length * 5;

  return { score };
}
