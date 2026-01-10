/**
 * Demo Complex UI Interactions - Actions
 *
 * This demo showcases how custom UIs can detect which action is being filled in
 * using boardInteraction.currentAction and boardInteraction.currentSelectionName.
 *
 * All actions are available simultaneously so the UI can demonstrate:
 * 1. Detecting when a specific action button is clicked
 * 2. Showing which selection step the player is on
 * 3. Different visual feedback for different actions
 */

import { Action, Player, type ActionDefinition } from '@boardsmith/engine';
import type { DemoGame, DemoPlayer } from './game.js';
import { Card } from './elements.js';

/**
 * COLLECT - Draw a card from the deck (0 selections)
 *
 * Simple action with no selections. Shows how the UI can detect
 * when this action executes vs when other actions are in progress.
 */
export function createCollectAction(game: DemoGame): ActionDefinition {
  return Action.create('collect')
    .prompt('Draw a card from the deck')
    .condition({
      'deck has cards': () => game.deck.count(Card) > 0,
    })
    .execute((args, ctx) => {
      const player = ctx.player as DemoPlayer;
      const card = game.deck.first(Card);
      if (card) {
        card.putInto(game.getPlayerHand(player));
        game.message(`${player.name} collected a card from the deck`);
        return { success: true };
      }
      return { success: false, error: 'No cards in deck' };
    });
}

/**
 * DISCARD - Discard a card from your hand (1 selection)
 *
 * Single-step action using fromElements() for easy custom UI integration.
 * Custom UIs can send: props.action('discard', { card: cardId })
 *
 * UI can show:
 * - currentAction === 'discard'
 * - currentSelectionName === 'card'
 */
export function createDiscardAction(game: DemoGame): ActionDefinition {
  return Action.create('discard')
    .prompt('Discard a card from your hand')
    .fromElements<Card>('card', {
      prompt: 'Select a card to discard',
      elements: (ctx) => {
        const player = ctx.player as DemoPlayer;
        return [...game.getPlayerHand(player).all(Card)];
      },
      display: (card) => `${card.rank}${card.suit}`,
      boardRef: (card) => ({ id: card.id }),
    })
    .condition({
      'has cards in hand': (ctx) => {
        const player = ctx.player as DemoPlayer;
        return game.getPlayerHand(player).count(Card) > 0;
      },
    })
    .execute((args, ctx) => {
      const player = ctx.player as DemoPlayer;
      // fromElements() resolves the ID to the actual Card element
      const card = args.card as Card;
      card.putInto(game.discardPile);
      game.message(`${player.name} discarded ${card.rank}${card.suit}`);
      return { success: true };
    });
}

/**
 * TRADE - Give a card to another player in exchange (2 selections)
 *
 * Two-step action using fromElements() for the card selection.
 * Custom UIs can send: props.action('trade', { myCard: cardId, targetPlayer: playerChoice })
 *
 * UI can show:
 * - Step 1: currentAction === 'trade', currentSelectionName === 'myCard'
 * - Step 2: currentAction === 'trade', currentSelectionName === 'targetPlayer'
 */
export function createTradeAction(game: DemoGame): ActionDefinition {
  return Action.create('trade')
    .prompt('Trade a card with another player')
    .fromElements<Card>('myCard', {
      prompt: 'Select YOUR card to trade away',
      elements: (ctx) => {
        const player = ctx.player as DemoPlayer;
        return [...game.getPlayerHand(player).all(Card)];
      },
      display: (card) => `${card.rank}${card.suit}`,
      boardRef: (card) => ({ id: card.id }),
    })
    .chooseFrom('targetPlayer', {
      prompt: 'Select a player to trade with',
      choices: (ctx) => game.playerChoices({ excludeSelf: true, currentPlayer: ctx.player }),
      boardRefs: (choice: { value: number }) => {
        const targetPlayer = game.getPlayer(choice.value) as DemoPlayer;
        const hand = game.getPlayerHand(targetPlayer);
        return { targetRef: { id: hand.id } };
      },
    })
    .condition({
      'has cards in hand': (ctx) => {
        const player = ctx.player as DemoPlayer;
        return game.getPlayerHand(player).count(Card) > 0;
      },
      'multiple players in game': () => game.all(Player).length > 1,
    })
    .execute((args, ctx) => {
      const player = ctx.player as DemoPlayer;
      // fromElements() resolves the ID to the actual Card element
      const myCard = args.myCard as Card;
      // extractChoiceValue extracts the 'value' from { value, display } objects
      const targetPosition = args.targetPlayer as number;
      const targetPlayer = game.getPlayer(targetPosition) as DemoPlayer;

      // Move card to target
      myCard.putInto(game.getPlayerHand(targetPlayer));

      // Target gives a random card back
      const targetHand = game.getPlayerHand(targetPlayer);
      const targetCards = [...targetHand.all(Card)];
      if (targetCards.length > 0) {
        const randomCard = targetCards[Math.floor(Math.random() * targetCards.length)];
        randomCard.putInto(game.getPlayerHand(player));
        game.message(`${player.name} traded ${myCard.rank}${myCard.suit} with ${targetPlayer.name} for ${randomCard.rank}${randomCard.suit}`);
      } else {
        game.message(`${player.name} gave ${myCard.rank}${myCard.suit} to ${targetPlayer.name} (no card in return)`);
      }

      return { success: true };
    });
}

/**
 * GIFT - Give a card to another player for free (2 selections)
 *
 * Similar to trade but different purpose - demonstrates that
 * the UI can show different visuals for different actions
 * even if they have the same selection structure.
 *
 * Custom UIs can send: props.action('gift', { card: cardId, recipient: playerChoice })
 */
export function createGiftAction(game: DemoGame): ActionDefinition {
  return Action.create('gift')
    .prompt('Gift a card to another player')
    .fromElements<Card>('card', {
      prompt: 'Select a card to gift',
      elements: (ctx) => {
        const player = ctx.player as DemoPlayer;
        return [...game.getPlayerHand(player).all(Card)];
      },
      display: (card) => `${card.rank}${card.suit}`,
      boardRef: (card) => ({ id: card.id }),
    })
    .chooseFrom('recipient', {
      prompt: 'Select who to gift the card to',
      choices: (ctx) => game.playerChoices({ excludeSelf: true, currentPlayer: ctx.player }),
      boardRefs: (choice: { value: number }) => {
        const targetPlayer = game.getPlayer(choice.value) as DemoPlayer;
        const hand = game.getPlayerHand(targetPlayer);
        return { targetRef: { id: hand.id } };
      },
    })
    .condition({
      'has cards in hand': (ctx) => {
        const player = ctx.player as DemoPlayer;
        return game.getPlayerHand(player).count(Card) > 0;
      },
      'multiple players in game': () => game.all(Player).length > 1,
    })
    .execute((args, ctx) => {
      const player = ctx.player as DemoPlayer;
      // fromElements() resolves the ID to the actual Card element
      const card = args.card as Card;
      // extractChoiceValue extracts the 'value' from { value, display } objects
      const recipientPosition = args.recipient as number;
      const recipient = game.getPlayer(recipientPosition) as DemoPlayer;

      card.putInto(game.getPlayerHand(recipient));
      player.score += card.pointValue; // Gifting scores points!

      game.message(`${player.name} gifted ${card.rank}${card.suit} to ${recipient.name} (+${card.pointValue} points)`);

      return { success: true };
    });
}

/**
 * SCORE - Score all cards of a specific suit (2 selections)
 *
 * Choose a suit, then confirm the action. Demonstrates
 * a different selection pattern (enum choice + confirmation).
 */
export function createScoreAction(game: DemoGame): ActionDefinition {
  return Action.create('score')
    .prompt('Score all cards of one suit')
    .chooseFrom<string>('suit', {
      prompt: 'Choose a suit to score',
      choices: (ctx) => {
        const player = ctx.player as DemoPlayer;
        const hand = game.getPlayerHand(player);
        const suits = new Set<string>();
        for (const card of hand.all(Card)) {
          suits.add(card.suit);
        }
        return [...suits];
      },
      display: (suit) => {
        const names: Record<string, string> = {
          'H': '♥ Hearts', 'D': '♦ Diamonds',
          'C': '♣ Clubs', 'S': '♠ Spades',
        };
        return names[suit] || suit;
      },
    })
    .condition({
      'has cards in hand': (ctx) => {
        const player = ctx.player as DemoPlayer;
        return game.getPlayerHand(player).count(Card) > 0;
      },
    })
    .execute((args, ctx) => {
      const player = ctx.player as DemoPlayer;
      const suit = args.suit as string;
      const hand = game.getPlayerHand(player);

      const cardsToScore = [...hand.all(Card)].filter(c => c.suit === suit);
      let points = 0;
      for (const card of cardsToScore) {
        points += card.pointValue;
        card.putInto(game.discardPile);
      }

      player.score += points;
      const suitName = { 'H': 'Hearts', 'D': 'Diamonds', 'C': 'Clubs', 'S': 'Spades' }[suit];
      game.message(`${player.name} scored ${cardsToScore.length} ${suitName} for ${points} points!`);

      return { success: true };
    });
}
