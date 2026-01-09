import { Player, type Game } from '@boardsmith/engine';
import type { Objective } from '@boardsmith/ai';
import type { GoFishGame } from './game.js';
import type { GoFishPlayer } from './elements.js';
import { Card } from './elements.js';

/**
 * AI objectives for Go Fish
 * These guide the MCTS bot to prefer better positions during playouts
 */
export function getGoFishObjectives(
  game: Game,
  playerPosition: number
): Record<string, Objective> {
  const goFishGame = game as GoFishGame;
  const player = goFishGame.getPlayer(playerPosition) as GoFishPlayer;
  const allPlayers = [...goFishGame.all(Player)] as GoFishPlayer[];

  return {
    // Having more books is the main goal
    'book-lead': {
      checker: () => {
        const myBooks = player.bookCount;
        const maxOpponentBooks = Math.max(
          ...allPlayers
            .filter(p => p !== player)
            .map(p => (p as GoFishPlayer).bookCount)
        );
        return myBooks > maxOpponentBooks;
      },
      weight: 10,
    },

    // Having a large hand means more options
    'large-hand': {
      checker: () => {
        const hand = goFishGame.getPlayerHand(player);
        return hand.all(Card).length >= 5;
      },
      weight: 2,
    },

    // Having multiple cards of the same rank (close to a book)
    'near-book': {
      checker: () => {
        const hand = goFishGame.getPlayerHand(player);
        const rankCounts = new Map<string, number>();
        for (const card of hand.all(Card)) {
          rankCounts.set(card.rank, (rankCounts.get(card.rank) ?? 0) + 1);
        }
        // Check if we have 3 of any rank
        for (const count of rankCounts.values()) {
          if (count >= 3) return true;
        }
        return false;
      },
      weight: 5,
    },

    // Having diverse ranks means more asking options
    'rank-diversity': {
      checker: () => {
        const ranks = goFishGame.getPlayerRanks(player);
        return ranks.length >= 4;
      },
      weight: 2,
    },

    // Winning or being close to winning
    'near-win': {
      checker: () => {
        // Having 7+ books out of 13 means likely win
        return player.bookCount >= 7;
      },
      weight: 15,
    },

    // Opponent running out of cards
    'opponent-low-cards': {
      checker: () => {
        for (const p of allPlayers) {
          if (p === player) continue;
          const hand = goFishGame.getPlayerHand(p);
          if (hand.all(Card).length <= 2) return true;
        }
        return false;
      },
      weight: 3,
    },
  };
}
