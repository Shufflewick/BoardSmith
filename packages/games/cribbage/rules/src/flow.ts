import {
  loop,
  actionStep,
  simultaneousActionStep,
  execute,
  sequence,
  phase,
  Player,
  type FlowDefinition,
  type FlowContext,
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
  const discardPhase = phase('discarding', {
    do: simultaneousActionStep({
      name: 'simultaneous-discard',
      actions: ['discard'],
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
  });

  // Play phase - players alternate playing cards ONE AT A TIME
  const playPhase = phase('play', {
    do: sequence(
      // Initialize play state
      execute((ctx) => {
        const game = ctx.game as CribbageGame;
        game.runningTotal = 0;
        game.currentPlayCards = [];
        game.playerSaidGo = [false, false];
        // Non-dealer plays first
        game.currentPlayTurn = game.getNonDealer().position;
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
          const otherPlayer = game.getPlayer(3 - game.currentPlayTurn) as CribbagePlayer;

          const currentCanPlay = game.getPlayableCards(currentPlayer).length > 0;
          const currentHasCards = game.getPlayerHand(currentPlayer).count(Card) > 0;
          const currentSaidGo = game.playerSaidGo[currentPlayer.position - 1];

          const otherCanPlay = game.getPlayableCards(otherPlayer).length > 0;
          const otherHasCards = game.getPlayerHand(otherPlayer).count(Card) > 0;
          const otherSaidGo = game.playerSaidGo[otherPlayer.position - 1];

          // Check if current player is stuck (said Go or can't play)
          const currentStuck = currentSaidGo || !currentCanPlay;
          // Check if other player is stuck (said Go or can't play)
          const otherStuck = otherSaidGo || !otherCanPlay;

          // If both players are stuck but at least one still has cards, reset count
          if (currentStuck && otherStuck && (currentHasCards || otherHasCards)) {
            // Award "Go" point to last player who played a card (if not already at 31)
            if (game.lastPlayerToPlay >= 1 && game.runningTotal > 0 && game.runningTotal < 31) {
              const lastPlayer = game.getPlayer(game.lastPlayerToPlay) as CribbagePlayer;
              game.addPoints(lastPlayer, 1, 'Go');
            }
            game.resetCount();
            // Player who didn't play last leads the new count
            if (game.lastPlayerToPlay >= 1) {
              game.currentPlayTurn = 3 - game.lastPlayerToPlay;
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
          skipIf: (ctx) => {
            const game = ctx.game as CribbageGame;
            if (game.isFinished()) return true;

            const currentPlayer = game.getCurrentPlayPlayer();
            const hasCards = game.getPlayerHand(currentPlayer).count(Card) > 0;

            // Skip if player has no cards
            if (!hasCards) return true;

            const alreadySaidGo = game.playerSaidGo[currentPlayer.position - 1];

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

          const otherPosition = 3 - game.currentPlayTurn;
          const otherPlayer = game.getPlayer(otherPosition) as CribbagePlayer;
          const otherHasCards = game.getPlayerHand(otherPlayer).count(Card) > 0;
          const otherSaidGo = game.playerSaidGo[otherPosition - 1];

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
          const lastPlayer = game.getPlayer(game.lastPlayerToPlay) as CribbagePlayer;
          game.addPoints(lastPlayer, 1, 'Last card');
        }
        // Final reset
        game.resetCount();
      }),
    ),
  });

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
    phase('scoring', {
      do: sequence(
        execute((ctx) => {
          const game = ctx.game as CribbageGame;
          if (game.isFinished()) {
            game.message('Game ended during play!');
            return;
          }
          // Score all hands and crib, build round summary for UI
          game.scoreRoundAndBuildSummary();
        }),

        // Wait for acknowledgment of round summary (either player can continue)
        simultaneousActionStep({
          name: 'acknowledge-round-summary',
          actions: ['acknowledgeScore'],
          allDone: (ctx) => {
            const game = ctx.game as CribbageGame;
            return game.isFinished() || !game.roundSummary.active;
          },
        }),
      ),
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
          const loser = game.all(Player).find(p => !winners.includes(p as CribbagePlayer)) as CribbagePlayer;
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

    // Phase lifecycle hooks
    onEnterPhase: (phaseName, ctx) => {
      const game = ctx.game as CribbageGame;

      // Set the game's cribbagePhase property (used by actions and UI)
      if (phaseName === 'discarding' || phaseName === 'play' || phaseName === 'scoring') {
        game.cribbagePhase = phaseName;
      }

      // Announce the phase
      const phaseNames: Record<string, string> = {
        discarding: 'DISCARD PHASE',
        play: 'PLAY PHASE',
        scoring: 'SCORING PHASE',
      };
      const displayName = phaseNames[phaseName];
      if (displayName) {
        game.message(`=== ${displayName} ===`);
      }
      if (phaseName === 'discarding') {
        game.message('Each player must discard 2 cards to the crib');
      }
    },
  };
}
