import {
  loop,
  actionStep,
  simultaneousActionStep,
  execute,
  sequence,
  type FlowDefinition,
} from '@boardsmith/engine';
import type { CribbageGame } from './game.js';
import { Card, CribbagePlayer } from './elements.js';

/**
 * Create the Cribbage game flow
 *
 * Flow structure:
 * 1. Initialize (create deck, start first round)
 * 2. Round loop:
 *    a. Deal phase (automatic)
 *    b. Discard phase - each player discards 2 cards
 *    c. Cut starter card
 *    d. Play phase - alternate playing cards, pegging
 *    e. Show phase - score hands and crib
 *    f. Rotate dealer and repeat
 */
export function createCribbageFlow(): FlowDefinition {
  // Discard phase - both players discard 2 cards simultaneously
  const discardPhase = sequence(
    execute((ctx) => {
      const game = ctx.game as CribbageGame;
      game.cribbagePhase = 'discarding'; // Ensure phase is set for action condition
      game.message('=== DISCARD PHASE ===');
      game.message('Each player must discard 2 cards to the crib');
    }),

    // Simultaneous discard - all players can discard at the same time
    simultaneousActionStep({
      name: 'simultaneous-discard',
      actions: ['discard'],
      prompt: 'Discard 2 cards to the crib',
      // Player is done when they have 4 cards left (discarded 2)
      playerDone: (ctx, player) => {
        const game = ctx.game as CribbageGame;
        const hand = game.getPlayerHand(player as CribbagePlayer);
        return hand.count(Card) <= 4;
      },
      // All done when all players have discarded
      allDone: (ctx) => {
        const game = ctx.game as CribbageGame;
        return game.allPlayersDiscarded() || game.isFinished();
      },
    }),
  );

  // Play phase - players alternate playing cards ONE AT A TIME
  const playPhase = sequence(
    execute((ctx) => {
      const game = ctx.game as CribbageGame;
      game.cribbagePhase = 'play';
      game.runningTotal = 0;
      game.currentPlayCards = [];
      game.playerSaidGo = [false, false];
      // Non-dealer plays first
      game.currentPlayTurn = game.getNonDealer().position;
      game.message('=== PLAY PHASE ===');
    }),

    // Main play loop - continues until all cards played
    loop({
      name: 'play-loop',
      while: (ctx) => {
        const game = ctx.game as CribbageGame;
        return !game.allCardsPlayed() && !game.isFinished();
      },
      maxIterations: 100,
      do: sequence(
        // Check if we need to reset the count
        // This happens when both players have said Go (or have no playable cards)
        execute((ctx) => {
          const game = ctx.game as CribbageGame;
          const currentPlayer = game.getCurrentPlayPlayer();
          const otherPlayer = game.players[1 - game.currentPlayTurn] as CribbagePlayer;

          const currentCanPlay = game.getPlayableCards(currentPlayer).length > 0;
          const currentHasCards = game.getPlayerHand(currentPlayer).count(Card) > 0;
          const currentSaidGo = game.playerSaidGo[currentPlayer.position];

          const otherCanPlay = game.getPlayableCards(otherPlayer).length > 0;
          const otherHasCards = game.getPlayerHand(otherPlayer).count(Card) > 0;
          const otherSaidGo = game.playerSaidGo[otherPlayer.position];

          // Check if current player is stuck (said Go or can't play)
          const currentStuck = currentSaidGo || !currentCanPlay;
          // Check if other player is stuck (said Go or can't play)
          const otherStuck = otherSaidGo || !otherCanPlay;

          // If both players are stuck but at least one still has cards, reset count
          if (currentStuck && otherStuck && (currentHasCards || otherHasCards)) {
            // Award "Go" point to last player who played a card (if not already at 31)
            if (game.lastPlayerToPlay >= 0 && game.runningTotal > 0 && game.runningTotal < 31) {
              const lastPlayer = game.players[game.lastPlayerToPlay] as CribbagePlayer;
              game.addPoints(lastPlayer, 1, 'Go');
            }
            game.resetCount();
            // Player who didn't play last leads the new count
            if (game.lastPlayerToPlay >= 0) {
              game.currentPlayTurn = 1 - game.lastPlayerToPlay;
            }
          }
        }),

        // Single player action - the current player plays one card or says Go
        actionStep({
          name: 'play-or-go-step',
          player: (ctx) => {
            const game = ctx.game as CribbageGame;
            return game.getCurrentPlayPlayer();
          },
          actions: ['playCard', 'sayGo'],
          prompt: 'Play a card',
          skipIf: (ctx) => {
            const game = ctx.game as CribbageGame;
            if (game.isFinished()) return true;

            const currentPlayer = game.getCurrentPlayPlayer();
            const hasCards = game.getPlayerHand(currentPlayer).count(Card) > 0;

            // Skip if player has no cards
            if (!hasCards) return true;

            const alreadySaidGo = game.playerSaidGo[currentPlayer.position];

            // Skip if already said Go - once you say Go, you're out until count resets
            if (alreadySaidGo) return true;

            return false;
          },
        }),

        // After each action, switch to the other player (unless they've said Go)
        // Once a player says "Go", they're out for the rest of this count
        execute((ctx) => {
          const game = ctx.game as CribbageGame;
          if (game.isFinished() || game.allCardsPlayed()) return;

          const otherPosition = 1 - game.currentPlayTurn;
          const otherPlayer = game.players[otherPosition] as CribbagePlayer;
          const otherHasCards = game.getPlayerHand(otherPlayer).count(Card) > 0;
          const otherSaidGo = game.playerSaidGo[otherPosition];

          // Switch to other player only if they have cards AND haven't said Go
          // Once you say Go, you're done until count resets (even if you could now play)
          if (otherHasCards && !otherSaidGo) {
            game.switchPlayTurn();
          }
          // Otherwise stay with current player (they continue until they can't)
        }),
      ),
    }),

    // Award last card point if not already at 31
    execute((ctx) => {
      const game = ctx.game as CribbageGame;
      if (game.lastPlayerToPlay >= 0 && game.runningTotal > 0 && game.runningTotal < 31) {
        const lastPlayer = game.players[game.lastPlayerToPlay] as CribbagePlayer;
        game.addPoints(lastPlayer, 1, 'Last card');
      }
      // Final reset
      game.resetCount();
    }),
  );

  // Scoring phase - score hands and crib
  const scoringPhase = sequence(
    execute((ctx) => {
      const game = ctx.game as CribbageGame;
      game.cribbagePhase = 'scoring';
      game.message('=== SCORING PHASE ===');
    }),

    // Move played cards back to hands for scoring display
    execute((ctx) => {
      const game = ctx.game as CribbageGame;

      // For scoring, we need to know which cards were in each hand
      // Since cards are in playedCards pile, we need a different approach
      // Actually, in real cribbage, you keep your 4 cards - let's track this properly
      // For now, just score based on what we have

      // Non-dealer scores first
      const nonDealer = game.getNonDealer();
      game.message(`--- ${nonDealer.name}'s hand ---`);
      game.scorePlayerHand(nonDealer);

      if (game.isFinished()) return;

      // Dealer scores hand
      const dealer = game.getDealer();
      game.message(`--- ${dealer.name}'s hand ---`);
      game.scorePlayerHand(dealer);

      if (game.isFinished()) return;

      // Dealer scores crib
      game.message(`--- ${dealer.name}'s crib ---`);
      game.crib.contentsVisible(); // Reveal crib
      game.scoreCrib();
    }),
  );

  // One complete round
  const playRound = sequence(
    // Initialize round
    execute((ctx) => {
      const game = ctx.game as CribbageGame;
      game.startNewRound();
    }),

    // Discard phase
    discardPhase,

    // Store original hands before play (needed for scoring after cards move)
    execute((ctx) => {
      const game = ctx.game as CribbageGame;
      game.storeOriginalHands();
    }),

    // Cut starter
    execute((ctx) => {
      const game = ctx.game as CribbageGame;
      game.cutStarterCard();
      if (game.isFinished()) return;
    }),

    // Play phase
    playPhase,

    // Scoring phase - score all hands and show combined summary
    execute((ctx) => {
      const game = ctx.game as CribbageGame;
      if (game.isFinished()) {
        game.message('Game ended during play!');
        return;
      }
      game.cribbagePhase = 'scoring';
      game.message('=== SCORING PHASE ===');
      // Score all hands and crib, build round summary for UI
      game.scoreRoundAndBuildSummary();
    }),

    // Wait for acknowledgment of round summary (either player can continue)
    simultaneousActionStep({
      name: 'acknowledge-round-summary',
      actions: ['acknowledgeScore'],
      prompt: 'View round scores and continue',
      allDone: (ctx) => {
        const game = ctx.game as CribbageGame;
        return game.isFinished() || !game.roundSummary.active;
      },
    }),

    // Rotate dealer for next round
    execute((ctx) => {
      const game = ctx.game as CribbageGame;
      if (!game.isFinished()) {
        game.rotateDealer();
        game.crib.contentsHidden(); // Hide crib again
      }
    }),
  );

  return {
    root: sequence(
      // Initialize game
      execute((ctx) => {
        const game = ctx.game as CribbageGame;
        game.createDeck();
        game.message(`=== CRIBBAGE ===`);
        game.message(`First to ${game.targetScore} wins!`);
      }),

      // Main game loop
      loop({
        name: 'game-loop',
        while: (ctx) => {
          const game = ctx.game as CribbageGame;
          return !game.isFinished();
        },
        maxIterations: 100, // Safety limit
        do: playRound,
      }),

      // Game over
      execute((ctx) => {
        const game = ctx.game as CribbageGame;
        const winners = game.getWinners();
        if (winners.length > 0) {
          game.message(`=== GAME OVER ===`);
          game.message(`${winners[0].name} wins with ${winners[0].score} points!`);

          // Check for skunk (opponent < 91) or double skunk (< 61)
          const loser = game.players.find(p => !winners.includes(p as CribbagePlayer)) as CribbagePlayer;
          if (loser) {
            if (loser.score < 61) {
              game.message(`Double skunk! ${loser.name} didn't pass 60.`);
            } else if (loser.score < 91) {
              game.message(`Skunk! ${loser.name} didn't pass 90.`);
            }
          }
        }
      }),
    ),

    isComplete: (ctx) => {
      const game = ctx.game as CribbageGame;
      return game.isFinished();
    },

    getWinners: (ctx) => {
      const game = ctx.game as CribbageGame;
      return game.getWinners();
    },
  };
}
