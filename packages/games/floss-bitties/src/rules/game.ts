import { Game, Player, type GameOptions } from '@boardsmith/engine';
import { Card, Hand, DrawDeck, PlayArea, DiscardPile, FlossBittiesPlayer, SUITS, RANKS, type Suit } from './elements.js';
import { createGameFlow } from './flow.js';
import { createPlayToAreaAction, createDiscardAction, createDrawFromDeckAction, createDrawFromDiscardAction } from './actions.js';

export interface FlossBittiesOptions extends GameOptions {
  seed?: string;
}

/**
 * Floss Bitties game implementation
 *
 * A 2-player press-your-luck card game where players build ascending sequences
 * in suit areas to score points. Each suit area starts at -20 points once any
 * card is played, and wager cards multiply the final score.
 *
 * Rules:
 * - 6 suits (Red, Green, Blue, Purple, Yellow, White)
 * - Each suit has ranks 2-10 plus 3 wager cards
 * - Players hold 8 cards
 * - Each turn: play 1 card (to area or discard), then draw 1 card (from deck or discard)
 * - Cards in play areas must be in ascending order (wagers first)
 * - Game ends immediately when deck is empty
 * - Highest total score wins
 */
export class FlossBittiesGame extends Game<FlossBittiesGame, FlossBittiesPlayer> {
  // Use custom player class
  static PlayerClass = FlossBittiesPlayer;

  /** The main draw deck */
  deck!: DrawDeck;

  /** Track the last discarded card and who discarded it (to prevent immediate pickup) */
  lastDiscardedCardId: number | null = null;
  lastDiscardedByPosition: number | null = null;

  constructor(options: FlossBittiesOptions) {
    super(options);

    // Register element classes
    this.registerElements([Card, Hand, DrawDeck, PlayArea, DiscardPile]);

    // Create the draw deck
    this.deck = this.create(DrawDeck, 'Draw Deck');
    this.deck.setOrder('stacking');
    this.deck.contentsHidden();

    // Create play areas and discard piles for each suit
    for (const suit of SUITS) {
      // Player 1's play area for this suit
      const area0 = this.create(PlayArea, `${suit} Expedition`, { suit });
      area0.player = this.getPlayer(1);
      area0.contentsVisible();
      area0.setOrder('stacking');

      // Player 2's play area for this suit
      const area1 = this.create(PlayArea, `${suit} Expedition`, { suit });
      area1.player = this.getPlayer(2);
      area1.contentsVisible();
      area1.setOrder('stacking');

      // Shared discard pile for this suit
      const discard = this.create(DiscardPile, `${suit} Discard`, { suit });
      discard.contentsVisible();
      discard.setOrder('stacking');
    }

    // Create hands for each player
    for (const player of this.all(Player)) {
      const hand = this.create(Hand, `hand-${player.position}`);
      hand.player = player;
      hand.contentsVisibleToOwner();
    }

    // Create the deck: 6 suits × (9 rank cards + 3 wager cards) = 72 cards
    this.createDeck();
    this.deck.shuffle();

    // Deal 8 cards to each player
    this.dealCards();

    // Register actions
    this.registerAction(createPlayToAreaAction(this));
    this.registerAction(createDiscardAction(this));
    this.registerAction(createDrawFromDeckAction(this));
    this.registerAction(createDrawFromDiscardAction(this));

    // Set up game flow
    this.setFlow(createGameFlow(this));
  }

  /**
   * Create the 72-card deck
   */
  private createDeck(): void {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        // Create 3 copies of wager cards, 1 copy of each rank card
        const copies = rank === 'Wager' ? 3 : 1;
        for (let i = 0; i < copies; i++) {
          const name = rank === 'Wager'
            ? `${suit} Wager ${i + 1}`
            : `${rank} of ${suit}`;
          this.deck.create(Card, name, { suit, rank });
        }
      }
    }
  }

  /**
   * Deal 8 cards to each player
   */
  private dealCards(): void {
    for (let i = 0; i < 8; i++) {
      for (const player of this.all(Player)) {
        this.deck.drawTo(this.getPlayerHand(player), 1, Card);
      }
    }
  }

  /**
   * Get a player's hand
   */
  getPlayerHand(player: FlossBittiesPlayer): Hand {
    return this.first(Hand, `hand-${player.position}`)!;
  }

  /**
   * Get a player's play area for a specific suit
   */
  getPlayArea(player: FlossBittiesPlayer, suit: Suit): PlayArea {
    return this.first(PlayArea, { player, suit })!;
  }

  /**
   * Get the discard pile for a specific suit
   */
  getDiscardPile(suit: Suit): DiscardPile {
    return this.first(DiscardPile, { suit })!;
  }

  /**
   * Get all cards in a player's play area for a suit, in order played
   */
  getPlayAreaCards(player: FlossBittiesPlayer, suit: Suit): Card[] {
    const area = this.getPlayArea(player, suit);
    return [...area.all(Card)];
  }

  /**
   * Get the highest rank value currently in a player's play area for a suit
   * Returns -1 if empty (so any card can be played)
   */
  getHighestPlayedValue(player: FlossBittiesPlayer, suit: Suit): number {
    const cards = this.getPlayAreaCards(player, suit);
    if (cards.length === 0) return -1;
    return Math.max(...cards.map(c => c.value));
  }

  /**
   * Check if a card can be legally played to a player's play area
   * Card must have higher value than all cards already there
   */
  canPlayToArea(player: FlossBittiesPlayer, card: Card): boolean {
    const highestValue = this.getHighestPlayedValue(player, card.suit);
    return card.value > highestValue;
  }

  /**
   * Get cards from hand that can be legally played to the player's area
   */
  getPlayableCards(player: FlossBittiesPlayer): Card[] {
    const hand = this.getPlayerHand(player);
    return [...hand.all(Card)].filter(card => this.canPlayToArea(player, card));
  }

  /**
   * Get the top card of a discard pile (or undefined if empty)
   */
  getTopDiscard(suit: Suit): Card | undefined {
    const pile = this.getDiscardPile(suit);
    return pile.last(Card);
  }

  /**
   * Get all discard piles that have cards and can be drawn from by a player
   * (excludes the card the player just discarded this turn)
   */
  getDrawableDiscardPiles(player: FlossBittiesPlayer): DiscardPile[] {
    const piles: DiscardPile[] = [];
    for (const suit of SUITS) {
      const pile = this.getDiscardPile(suit);
      const topCard = pile.last(Card);
      if (topCard) {
        // Can't draw the card you just discarded
        if (topCard.id === this.lastDiscardedCardId &&
            this.lastDiscardedByPosition === player.position) {
          continue;
        }
        piles.push(pile);
      }
    }
    return piles;
  }

  /**
   * Calculate score for a single play area
   * - Empty area = 0 points
   * - Otherwise: (sum of card values - 20) × (1 + wager count)
   */
  calculateAreaScore(player: FlossBittiesPlayer, suit: Suit): number {
    const cards = this.getPlayAreaCards(player, suit);
    if (cards.length === 0) return 0;

    const wagerCount = cards.filter(c => c.rank === 'Wager').length;
    const cardSum = cards.reduce((sum, c) => sum + c.value, 0);
    const baseScore = cardSum - 20;
    const multiplier = 1 + wagerCount;

    return baseScore * multiplier;
  }

  /**
   * Calculate total score for a player across all suits
   */
  calculateTotalScore(player: FlossBittiesPlayer): number {
    let total = 0;
    for (const suit of SUITS) {
      total += this.calculateAreaScore(player, suit);
    }
    return total;
  }

  /**
   * Check if game is finished (deck is empty)
   */
  override isFinished(): boolean {
    return this.deck.count(Card) === 0;
  }

  /**
   * Get the winner(s) - player with highest score
   */
  override getWinners(): FlossBittiesPlayer[] {
    if (!this.isFinished()) return [];

    const scores = this.all(Player).map(p => ({
      player: p,
      score: this.calculateTotalScore(p),
    }));

    const maxScore = Math.max(...scores.map(s => s.score));
    return scores.filter(s => s.score === maxScore).map(s => s.player);
  }

  /**
   * Clear the last discarded tracking (called at start of each turn)
   */
  clearLastDiscarded(): void {
    this.lastDiscardedCardId = null;
    this.lastDiscardedByPosition = null;
  }

  /**
   * Track a discarded card (to prevent immediate pickup)
   */
  trackDiscard(card: Card, player: FlossBittiesPlayer): void {
    this.lastDiscardedCardId = card.id;
    this.lastDiscardedByPosition = player.position;
  }
}
