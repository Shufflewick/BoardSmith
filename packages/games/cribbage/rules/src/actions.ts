import { Action, type ActionDefinition } from '@boardsmith/engine';
import type { CribbageGame } from './game.js';
import { Card, CribbagePlayer } from './elements.js';

/**
 * Create the "discard" action for Cribbage
 * Players discard 2 cards to the crib
 *
 * Uses fromElements() with multiSelect for easy custom UI integration.
 * Custom UIs can send: props.action('discard', { cards: [cardId1, cardId2] })
 *
 * The multiSelect config { min: 2, max: 2 } auto-confirms when 2 cards are selected.
 */
export function createDiscardAction(game: CribbageGame): ActionDefinition {
  return Action.create('discard')
    .prompt('Discard 2 cards to the crib')
    .fromElements<Card>('cards', {
      prompt: 'Select 2 cards to discard',
      elements: (ctx) => {
        const game = ctx.game as CribbageGame;
        const player = ctx.player as CribbagePlayer;
        const hand = game.getPlayerHand(player);
        return [...hand.all(Card)];
      },
      display: (card) => `${card.rank}${card.suit}`,
      boardRef: (card) => ({ id: card.id }),
      // Exactly 2 cards required - auto-confirms when 2 are selected (no Done button)
      multiSelect: { min: 2, max: 2 },
    })
    .condition((ctx) => {
      const game = ctx.game as CribbageGame;
      const player = ctx.player as CribbagePlayer;
      const hand = game.getPlayerHand(player);
      return game.cribbagePhase === 'discarding' && hand.count(Card) === 6;
    })
    .execute((args, ctx) => {
      const game = ctx.game as CribbageGame;
      const player = ctx.player as CribbagePlayer;
      // fromElements() with multiSelect resolves IDs to an array of Card elements
      const cards = args.cards as Card[];

      if (!cards || cards.length !== 2) {
        return { success: false, error: 'Must discard exactly 2 cards from your hand' };
      }

      cards.forEach(card => card.putInto(game.crib));

      game.message(`${player.name} discards ${cards.map(c => `${c.rank}${c.suit}`).join(' and ')} to the crib`);

      return {
        success: true,
        data: {
          doneDiscarding: true,
        },
        message: `Discarded 2 cards to crib`,
      };
    });
}

/**
 * Create the "playCard" action for the play phase
 */
export function createPlayCardAction(game: CribbageGame): ActionDefinition {
  return Action.create('playCard')
    .prompt('Play a card')
    .chooseElement('card', {
      prompt: 'Choose a card to play',
      elementClass: Card,
      from: (ctx) => {
        const game = ctx.game as CribbageGame;
        const player = ctx.player as CribbagePlayer;
        return game.getPlayerHand(player);
      },
      filter: (card, ctx) => {
        const game = ctx.game as CribbageGame;
        const player = ctx.player as CribbagePlayer;
        const playable = game.getPlayableCards(player);
        return playable.some(c => c.id === card.id);
      },
      display: (card) => {
        return `${card.rank}${card.suit} (${card.pointValue})`;
      },
    })
    .condition((ctx) => {
      const game = ctx.game as CribbageGame;
      const player = ctx.player as CribbagePlayer;
      // Can play if in play phase and has playable cards
      return game.cribbagePhase === 'play' && game.getPlayableCards(player).length > 0;
    })
    .execute((args, ctx) => {
      const game = ctx.game as CribbageGame;
      const player = ctx.player as CribbagePlayer;
      // args.card is resolved to the actual Card element by ActionExecutor.resolveArgs
      const card = args.card as Card;

      if (!card) {
        return { success: false, error: 'Card not found' };
      }

      if (!game.canPlayCard(player, card)) {
        return { success: false, error: 'Cannot play this card (would exceed 31)' };
      }

      const pointsScored = game.playCard(player, card);

      // Check if count hit 31 (auto-reset, which also resets Go flags)
      const hitThirtyOne = game.runningTotal === 31;
      if (hitThirtyOne) {
        game.resetCount();
      }

      // Note: Do NOT reset Go flags here - they only reset when count resets
      // If opponent said Go, current player continues until they can't play either

      return {
        success: true,
        data: {
          pointsScored,
          runningTotal: game.runningTotal,
          hitThirtyOne,
        },
        message: `Played ${card.rank}${card.suit}${pointsScored > 0 ? ` for ${pointsScored} points` : ''}`,
      };
    });
}

/**
 * Create the "sayGo" action when a player can't play
 */
export function createSayGoAction(game: CribbageGame): ActionDefinition {
  return Action.create('sayGo')
    .prompt('Say "Go" (cannot play)')
    .condition((ctx) => {
      const game = ctx.game as CribbageGame;
      const player = ctx.player as CribbagePlayer;
      // Must say Go if in play phase, has cards in hand, but none are playable
      return game.cribbagePhase === 'play' &&
             game.mustSayGo(player) &&
             !game.playerSaidGo[player.position - 1];
    })
    .execute((args, ctx) => {
      const game = ctx.game as CribbageGame;
      const player = ctx.player as CribbagePlayer;
      game.playerSaidGo[player.position - 1] = true;
      game.message(`${player.name} says "Go"`);

      // Check if both players have said Go
      const otherPlayer = game.players.find(p => p.position !== player.position) as CribbagePlayer;
      const otherSaidGo = game.playerSaidGo[otherPlayer.position - 1];
      const otherCanPlay = game.getPlayableCards(otherPlayer).length > 0;
      const otherHasCards = game.getPlayerHand(otherPlayer).count(Card) > 0;

      // If other player already said Go or has no cards, last player to play gets 1 point
      if ((otherSaidGo && !otherCanPlay) || !otherHasCards) {
        // Award point for "Go" or "Last card"
        const lastPlayer = game.players.get(game.lastPlayerToPlay) as CribbagePlayer;
        if (lastPlayer) {
          game.addPoints(lastPlayer, 1, game.runningTotal === 31 ? 'Thirty-one' : 'Go');
        }
        game.resetCount();
      }

      return {
        success: true,
        data: {
          otherPlayerGo: otherSaidGo,
        },
        message: 'Go!',
      };
    });
}

/**
 * Create the "acknowledgeScore" action to continue after viewing a score
 * Either player can acknowledge to proceed
 */
export function createAcknowledgeScoreAction(game: CribbageGame): ActionDefinition {
  return Action.create('acknowledgeScore')
    .prompt('Continue')
    .condition((ctx) => {
      const game = ctx.game as CribbageGame;
      // Can acknowledge if there's an active scoring animation or round summary
      return game.cribbagePhase === 'scoring' && (game.scoringAnimation.active || game.roundSummary.active);
    })
    .execute((args, ctx) => {
      const game = ctx.game as CribbageGame;
      // Clear the scoring animation so the game can proceed
      game.clearScoringAnimation();

      return {
        success: true,
        message: 'Continuing...',
      };
    });
}
