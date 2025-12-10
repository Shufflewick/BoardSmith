import { Game, type GameOptions } from '@boardsmith/engine';
import { Card, Hand, Pond, Books, GoFishPlayer } from './elements.js';
import { createAskAction } from './actions.js';
import { createGoFishFlow } from './flow.js';

/**
 * Go Fish game options
 */
export interface GoFishOptions extends GameOptions {
  /** Random seed for deterministic gameplay */
  seed?: string;
}

/**
 * Go Fish game implementation
 *
 * Rules:
 * - 2-3 players: 7 cards each
 * - 4-6 players: 5 cards each
 * - Ask another player for a rank you hold
 * - If they have cards of that rank, they give all of them to you
 * - If not, you "Go Fish" (draw from pond)
 * - If drawn card matches requested rank, you get another turn
 * - When you collect 4 of a kind, you form a "book"
 * - Game ends when all 13 books are formed
 * - Player with most books wins
 */
export class GoFishGame extends Game<GoFishGame, GoFishPlayer> {
  /** The pond (draw pile) */
  pond!: Pond;

  /** All ranks in a standard deck */
  static readonly RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;

  /** All suits in a standard deck */
  static readonly SUITS = ['H', 'D', 'C', 'S'] as const;

  constructor(options: GoFishOptions) {
    super(options);

    // Register element classes
    this._ctx.classRegistry.set('Card', Card as any);
    this._ctx.classRegistry.set('Hand', Hand as any);
    this._ctx.classRegistry.set('Pond', Pond as any);
    this._ctx.classRegistry.set('Books', Books as any);

    // Create pond
    this.pond = this.create(Pond, 'pond');
    this.pond.setOrder('stacking');
    this.pond.contentsHidden(); // Cards in pond are hidden from all

    // Create hands and books for each player
    for (const player of this.players) {
      const hand = this.create(Hand, `hand-${player.position}`);
      hand.player = player;
      hand.contentsVisibleToOwner(); // Only owner sees their hand

      const books = this.create(Books, `books-${player.position}`);
      books.player = player;
      books.contentsVisible(); // Everyone sees books
    }

    // Create and shuffle the deck
    this.createDeck();
    this.pond.shuffle();

    // Deal cards
    this.dealCards();

    // Register actions
    this.registerAction(createAskAction(this));

    // Set up the game flow
    this.setFlow(createGoFishFlow());
  }

  /**
   * Override to create GoFishPlayer instances
   */
  protected override createPlayer(position: number, name: string): GoFishPlayer {
    return new GoFishPlayer(position, name);
  }

  /**
   * Create a standard 52-card deck in the pond
   */
  private createDeck(): void {
    for (const suit of GoFishGame.SUITS) {
      for (const rank of GoFishGame.RANKS) {
        this.pond.create(Card, `${rank}${suit}`, { suit, rank });
      }
    }
  }

  /**
   * Deal initial cards to each player
   * 2-3 players: 7 cards each
   * 4-6 players: 5 cards each
   */
  private dealCards(): void {
    const cardsPerPlayer = this.players.length <= 3 ? 7 : 5;

    for (let i = 0; i < cardsPerPlayer; i++) {
      for (const player of this.players) {
        const card = this.pond.first(Card);
        if (card) {
          const hand = this.getPlayerHand(player);
          card.putInto(hand);
        }
      }
    }
  }

  /**
   * Get a player's hand space
   */
  getPlayerHand(player: GoFishPlayer): Hand {
    return this.first(Hand, `hand-${player.position}`)!;
  }

  /**
   * Get a player's books space
   */
  getPlayerBooks(player: GoFishPlayer): Books {
    return this.first(Books, `books-${player.position}`)!;
  }

  /**
   * Get the ranks that a player holds in their hand
   */
  getPlayerRanks(player: GoFishPlayer): string[] {
    const hand = this.getPlayerHand(player);
    const ranks = new Set<string>();
    for (const card of hand.all(Card)) {
      ranks.add(card.rank);
    }
    return Array.from(ranks).sort((a, b) => {
      const valueA = GoFishGame.RANKS.indexOf(a as any);
      const valueB = GoFishGame.RANKS.indexOf(b as any);
      return valueA - valueB;
    });
  }

  /**
   * Check if a player has any cards of a given rank
   */
  playerHasRank(player: GoFishPlayer, rank: string): boolean {
    const hand = this.getPlayerHand(player);
    return hand.all(Card, { rank }).length > 0;
  }

  /**
   * Get all cards of a rank from a player's hand
   */
  getCardsOfRank(player: GoFishPlayer, rank: string): Card[] {
    const hand = this.getPlayerHand(player);
    return [...hand.all(Card, { rank })];
  }

  /**
   * Check for and form books (4 of a kind) for a player
   * Returns the ranks that formed books
   */
  checkForBooks(player: GoFishPlayer): string[] {
    const hand = this.getPlayerHand(player);
    const books = this.getPlayerBooks(player);
    const formedBooks: string[] = [];

    // Count cards by rank
    const rankCounts = new Map<string, Card[]>();
    for (const card of hand.all(Card)) {
      const cards = rankCounts.get(card.rank) ?? [];
      cards.push(card);
      rankCounts.set(card.rank, cards);
    }

    // Form books for any rank with 4 cards
    for (const [rank, cards] of rankCounts) {
      if (cards.length === 4) {
        // Move all 4 cards to books pile
        for (const card of cards) {
          card.putInto(books);
        }
        (player as GoFishPlayer).bookCount++;
        formedBooks.push(rank);
        this.message(`${player.name} formed a book of ${rank}s!`);
      }
    }

    return formedBooks;
  }

  /**
   * Draw a card from the pond for a player
   * Returns the drawn card, or undefined if pond is empty
   */
  drawFromPond(player: GoFishPlayer): Card | undefined {
    const card = this.pond.first(Card);
    if (card) {
      const hand = this.getPlayerHand(player);
      card.putInto(hand);
    }
    return card;
  }

  /**
   * Get total number of books formed
   */
  getTotalBooks(): number {
    let total = 0;
    for (const player of this.players) {
      total += (player as GoFishPlayer).bookCount;
    }
    return total;
  }

  /**
   * Check if the game is complete (all 13 books formed)
   */
  override isFinished(): boolean {
    return this.getTotalBooks() >= 13;
  }

  /**
   * Get the winners (players with most books)
   */
  override getWinners(): GoFishPlayer[] {
    if (!this.isFinished()) return [];

    let maxBooks = 0;
    const winners: GoFishPlayer[] = [];

    for (const player of this.players) {
      const p = player as GoFishPlayer;
      if (p.bookCount > maxBooks) {
        maxBooks = p.bookCount;
        winners.length = 0;
        winners.push(p);
      } else if (p.bookCount === maxBooks) {
        winners.push(p);
      }
    }

    return winners;
  }

  /**
   * Check if a player can take any actions (has cards in hand or pond is not empty)
   */
  canPlayerTakeAction(player: GoFishPlayer): boolean {
    const hand = this.getPlayerHand(player);
    return hand.count(Card) > 0;
  }
}
