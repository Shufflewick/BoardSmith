import { Action, type ActionDefinition } from '@boardsmith/engine';
import type { FlossBittiesGame } from './game.js';
import { Card, DiscardPile, FlossBittiesPlayer } from './elements.js';

/**
 * Play a card from hand to the player's play area for that suit
 * Cards must be played in ascending order (wagers first, then increasing ranks)
 */
export function createPlayToAreaAction(game: FlossBittiesGame): ActionDefinition {
  return Action.create('playToArea')
    .prompt('Play a card to your expedition')
    .chooseFrom<Card>('card', {
      prompt: 'Select a card to play',
      choices: (ctx) => {
        const player = ctx.player as FlossBittiesPlayer;
        return game.getPlayableCards(player);
      },
      boardRefs: (card: Card) => ({
        targetRef: { id: card.id },
      }),
    })
    .condition((ctx) => {
      const player = ctx.player as FlossBittiesPlayer;
      return game.getPlayableCards(player).length > 0;
    })
    .execute((args, ctx) => {
      const player = ctx.player as FlossBittiesPlayer;
      const card = args.card as Card;

      const playArea = game.getPlayArea(player, card.suit);
      card.putInto(playArea);

      game.message(`${player.name} played ${card.name} to their ${card.suit} expedition`);

      return {
        success: true,
        data: { playedToArea: true, suit: card.suit },
        message: `Played ${card.name} to ${card.suit} expedition`,
      };
    });
}

/**
 * Discard a card from hand to the shared discard pile for that suit
 */
export function createDiscardAction(game: FlossBittiesGame): ActionDefinition {
  return Action.create('discard')
    .prompt('Discard a card')
    .chooseFrom<Card>('card', {
      prompt: 'Select a card to discard',
      choices: (ctx) => {
        const player = ctx.player as FlossBittiesPlayer;
        const hand = game.getPlayerHand(player);
        return [...hand.all(Card)];
      },
      boardRefs: (card: Card) => ({
        targetRef: { id: card.id },
      }),
    })
    .execute((args, ctx) => {
      const player = ctx.player as FlossBittiesPlayer;
      const card = args.card as Card;

      const discardPile = game.getDiscardPile(card.suit);
      card.putInto(discardPile);

      // Track this discard so player can't immediately pick it up
      game.trackDiscard(card, player);

      game.message(`${player.name} discarded ${card.name}`);

      return {
        success: true,
        data: { discarded: true, suit: card.suit, cardId: card.id },
        message: `Discarded ${card.name}`,
      };
    });
}

/**
 * Draw the top card from the main deck
 */
export function createDrawFromDeckAction(game: FlossBittiesGame): ActionDefinition {
  return Action.create('drawFromDeck')
    .prompt('Draw from deck')
    .condition(() => game.deck.count(Card) > 0)
    .execute((args, ctx) => {
      const player = ctx.player as FlossBittiesPlayer;
      const hand = game.getPlayerHand(player);

      const [card] = game.deck.drawTo(hand, 1, Card);

      if (card) {
        game.message(`${player.name} drew a card from the deck`);
        return {
          success: true,
          data: { drewFromDeck: true },
          message: 'Drew a card from the deck',
        };
      }

      return {
        success: false,
        message: 'No cards left in deck',
      };
    });
}

/**
 * Draw the top card from a discard pile
 * Cannot draw the card you just discarded this turn
 */
export function createDrawFromDiscardAction(game: FlossBittiesGame): ActionDefinition {
  return Action.create('drawFromDiscard')
    .prompt('Draw from a discard pile')
    .chooseFrom<DiscardPile>('pile', {
      prompt: 'Select a discard pile to draw from',
      choices: (ctx) => {
        const player = ctx.player as FlossBittiesPlayer;
        return game.getDrawableDiscardPiles(player);
      },
      display: (pile: DiscardPile) => {
        const topCard = pile.last(Card);
        return topCard ? `${pile.suit} (${topCard.name})` : pile.suit;
      },
      boardRefs: (pile: DiscardPile) => {
        const topCard = pile.last(Card);
        return topCard ? { targetRef: { id: topCard.id } } : {};
      },
    })
    .condition((ctx) => {
      const player = ctx.player as FlossBittiesPlayer;
      return game.getDrawableDiscardPiles(player).length > 0;
    })
    .execute((args, ctx) => {
      const player = ctx.player as FlossBittiesPlayer;
      const pile = args.pile as DiscardPile;
      const hand = game.getPlayerHand(player);

      const card = pile.last(Card);
      if (card) {
        card.putInto(hand);
        game.message(`${player.name} drew ${card.name} from the ${pile.suit} discard`);

        return {
          success: true,
          data: { drewFromDiscard: true, suit: pile.suit },
          message: `Drew ${card.name} from ${pile.suit} discard`,
        };
      }

      return {
        success: false,
        message: 'Discard pile is empty',
      };
    });
}
