import type { Game } from '@boardsmith/engine';
import type { Objective } from '@boardsmith/ai';
import type { CribbageGame } from './game.js';
import type { CribbagePlayer } from './elements.js';

/**
 * AI objectives for Cribbage
 * These guide the MCTS bot to prefer better positions during playouts
 */
export function getCribbageObjectives(
  game: Game,
  playerPosition: number
): Record<string, Objective> {
  const cribbageGame = game as CribbageGame;
  const player = cribbageGame.getPlayer(playerPosition) as CribbagePlayer;
  const opponentPosition = playerPosition === 1 ? 2 : 1;
  const opponent = cribbageGame.getPlayer(opponentPosition) as CribbagePlayer;

  return {
    // Having a score lead is good
    'score-lead': {
      checker: () => player.score > opponent.score,
      weight: 5,
    },

    // Being close to winning is very good
    'near-win': {
      checker: () => player.score >= 100,
      weight: 15,
    },

    // Being very close to winning (about to win)
    'winning-position': {
      checker: () => player.score >= 115,
      weight: 25,
    },

    // Preventing opponent from winning
    'block-opponent-win': {
      checker: () => opponent.score < 100,
      weight: 10,
    },

    // Being the dealer is a slight advantage (get crib)
    'is-dealer': {
      checker: () => player.isDealer,
      weight: 2,
    },

    // Large score lead (15+ points)
    'large-lead': {
      checker: () => player.score - opponent.score >= 15,
      weight: 8,
    },

    // In a close game, every point matters
    'close-game-ahead': {
      checker: () => {
        const diff = player.score - opponent.score;
        return diff > 0 && diff < 10 && player.score >= 90;
      },
      weight: 12,
    },

    // Opponent falling behind significantly
    'opponent-behind': {
      checker: () => opponent.score < player.score - 20,
      weight: 6,
    },

    // Already won
    'game-won': {
      checker: () => player.score >= cribbageGame.targetScore,
      weight: 50,
    },
  };
}
