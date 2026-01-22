/**
 * Demo Complex UI Interactions - Game
 *
 * This demo showcases how custom UIs can interact with boardInteraction.currentAction
 * to detect which action the player is filling in and show appropriate visual feedback.
 *
 * Key features:
 * - Multiple actions available simultaneously
 * - Actions with different numbers of selection steps
 * - Custom UI that reacts to action state
 */

import { Game, Player as BasePlayer, type GameOptions } from '@boardsmith/engine';
import { Card, Hand, Deck, DiscardPile } from './elements.js';
import { createGameFlow } from './flow.js';
import {
  createCollectAction,
  createDiscardAction,
  createTradeAction,
  createGiftAction,
  createScoreAction,
} from './actions.js';

export interface DemoGameOptions extends GameOptions {
  seed?: string;
}

// Define DemoPlayer first to avoid circular reference in static property
export class DemoPlayer extends BasePlayer<DemoGame, DemoPlayer> {
  hand!: Hand;
  score: number = 0;
}

export class DemoGame extends Game<DemoGame, DemoPlayer> {

  deck!: Deck;
  discardPile!: DiscardPile;

  constructor(options: DemoGameOptions) {
    super(options);

    // Register element classes
    this.registerElements([Card, Hand, Deck, DiscardPile]);

    // Create hands for each player
    for (const player of this.all(BasePlayer)) {
      const demoPlayer = player as DemoPlayer;
      demoPlayer.hand = this.create(Hand, `hand-${player.seat}`);
      demoPlayer.hand.player = player;
      demoPlayer.hand.contentsVisibleToOwner();
    }

    // Create deck and discard pile
    this.deck = this.create(Deck, 'deck');
    this.deck.setOrder('stacking');
    this.discardPile = this.create(DiscardPile, 'discard');

    // Create standard 52-card deck
    const suits = ['H', 'D', 'C', 'S'] as const;
    const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
    for (const suit of suits) {
      for (const rank of ranks) {
        this.deck.create(Card, `${rank}${suit}`, { suit, rank });
      }
    }

    // Shuffle and deal 5 cards to each player
    this.deck.shuffle();
    for (const player of this.all(BasePlayer)) {
      for (let i = 0; i < 5; i++) {
        const card = this.deck.first(Card);
        if (card) {
          const hand = this.getPlayerHand(player);
          card.putInto(hand);
        }
      }
    }

    // Register all actions - they'll all be available simultaneously
    this.registerAction(createCollectAction(this));
    this.registerAction(createDiscardAction(this));
    this.registerAction(createTradeAction(this));
    this.registerAction(createGiftAction(this));
    this.registerAction(createScoreAction(this));

    // Set up game flow
    this.setFlow(createGameFlow(this));
  }

  getPlayerHand(player: DemoPlayer): Hand {
    return this.first(Hand, `hand-${player.seat}`)!;
  }

  override isFinished(): boolean {
    // Game ends when deck is empty and all players have no cards
    if (this.deck.count(Card) > 0) return false;
    for (const player of this.all(BasePlayer)) {
      if (this.getPlayerHand(player).count(Card) > 0) return false;
    }
    return true;
  }

  override getWinners(): DemoPlayer[] {
    if (!this.isFinished()) return [];
    let maxScore = -1;
    let winners: DemoPlayer[] = [];
    for (const player of this.all(BasePlayer)) {
      if (player.score > maxScore) {
        maxScore = player.score;
        winners = [player];
      } else if (player.score === maxScore) {
        winners.push(player);
      }
    }
    return winners;
  }
}

// Set PlayerClass after both classes are defined to avoid circular reference
DemoGame.PlayerClass = DemoPlayer;
