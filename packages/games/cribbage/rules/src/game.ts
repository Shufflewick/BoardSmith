import { Game, type GameOptions } from '@boardsmith/engine';
import { Card, Hand, Crib, Deck, PlayArea, PlayedCards, StarterArea, CribbagePlayer } from './elements.js';
import { createDiscardAction, createPlayCardAction, createSayGoAction, createAcknowledgeScoreAction } from './actions.js';
import { createCribbageFlow } from './flow.js';
import { scoreHand, scoreHandDetailed, scorePegging, type ScoreBreakdown, type DetailedScoreBreakdown } from './scoring.js';

/**
 * Cribbage game options
 */
export interface CribbageOptions extends GameOptions {
  /** Random seed for deterministic gameplay */
  seed?: string;
  /** Target score to win (default 121) */
  targetScore?: number;
}

/**
 * Cribbage-specific phase tracking (separate from base Game phase)
 */
export type CribbagePhase = 'dealing' | 'discarding' | 'play' | 'scoring' | 'gameOver';

/**
 * Cribbage game implementation
 *
 * Rules:
 * - 2 players, race to 121 points
 * - Deal 6 cards each, discard 2 to crib (dealer's)
 * - Cut starter card (Jack = 2 pts "His Heels")
 * - Play phase: alternate playing, count to 31, score for 15s/pairs/runs
 * - Show phase: score hands (non-dealer first, then dealer, then crib)
 * - Rotate dealer and repeat
 */
export class CribbageGame extends Game<CribbageGame, CribbagePlayer> {
  /** The deck */
  deck!: Deck;

  /** The crib (4 discarded cards) */
  crib!: Crib;

  /** Play area for current count */
  playArea!: PlayArea;

  /** Cards played this round (cleared after both players play all cards) */
  playedCards!: PlayedCards;

  /** Starter card area */
  starterArea!: StarterArea;

  /** Current running total during play phase */
  runningTotal: number = 0;

  /** Cards played in current count sequence */
  currentPlayCards: string[] = []; // Card IDs for tracking

  /** Current cribbage phase */
  cribbagePhase: CribbagePhase = 'dealing';

  /** Target score to win */
  targetScore: number;

  /** Current dealer position (alternates each round) */
  dealerPosition: number = 0;

  /** Track who said "Go" */
  playerSaidGo: boolean[] = [false, false];

  /** Last player to play a card (for "Go" and "Last card" points) */
  lastPlayerToPlay: number = -1;

  /** Current player's turn during play phase (position) */
  currentPlayTurn: number = 0;

  /** Current scoring animation state (for UI to animate) - DEPRECATED, use roundSummary */
  scoringAnimation: {
    active: boolean;
    type: 'hand' | 'crib' | null;
    playerPosition: number;
    playerName: string;
    handCards: string[];
    starterCard: string | null;
    items: Array<{
      category: string;
      points: number;
      cardIds: string[];
      description: string;
    }>;
    currentItemIndex: number;
    totalPoints: number;
  } = {
    active: false,
    type: null,
    playerPosition: -1,
    playerName: '',
    handCards: [],
    starterCard: null,
    items: [],
    currentItemIndex: -1,
    totalPoints: 0,
  };

  /** End-of-round summary showing all scores (for UI to display) */
  roundSummary: {
    active: boolean;
    starterCard: string | null;
    nonDealerHand: {
      playerName: string;
      playerPosition: number;
      cardIds: string[];
      items: Array<{ category: string; points: number; cardIds: string[]; description: string }>;
      totalPoints: number;
    } | null;
    dealerHand: {
      playerName: string;
      playerPosition: number;
      cardIds: string[];
      items: Array<{ category: string; points: number; cardIds: string[]; description: string }>;
      totalPoints: number;
    } | null;
    crib: {
      playerName: string;
      cardIds: string[];
      items: Array<{ category: string; points: number; cardIds: string[]; description: string }>;
      totalPoints: number;
    } | null;
    roundTotal: number;
  } = {
    active: false,
    starterCard: null,
    nonDealerHand: null,
    dealerHand: null,
    crib: null,
    roundTotal: 0,
  };

  /** All ranks in a standard deck */
  static readonly RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;

  /** All suits in a standard deck */
  static readonly SUITS = ['H', 'D', 'C', 'S'] as const;

  constructor(options: CribbageOptions) {
    super(options);

    this.targetScore = options.targetScore ?? 121;

    // Register element classes
    this.registerElements([Card, Hand, Crib, Deck, PlayArea, PlayedCards, StarterArea]);

    // Create deck
    this.deck = this.create(Deck, 'deck');
    this.deck.setOrder('stacking');
    this.deck.contentsHidden();

    // Create crib
    this.crib = this.create(Crib, 'crib');
    this.crib.contentsHidden(); // Hidden until scoring

    // Create play area
    this.playArea = this.create(PlayArea, 'play-area');
    this.playArea.contentsVisible();

    // Create played cards pile
    this.playedCards = this.create(PlayedCards, 'played-cards');
    this.playedCards.contentsVisible();

    // Create starter area
    this.starterArea = this.create(StarterArea, 'starter');
    this.starterArea.contentsVisible();

    // Create hands for each player
    for (const player of this.players) {
      const hand = this.create(Hand, `hand-${player.position}`);
      hand.player = player;
      hand.contentsVisibleToOwner();
    }

    // Randomly determine first dealer (simulates cutting for deal)
    this.dealerPosition = this.random() < 0.5 ? 0 : 1;
    (this.players[this.dealerPosition] as CribbagePlayer).isDealer = true;

    // Register actions
    this.registerAction(createDiscardAction(this));
    this.registerAction(createPlayCardAction(this));
    this.registerAction(createSayGoAction(this));
    this.registerAction(createAcknowledgeScoreAction(this));

    // Set up the game flow
    this.setFlow(createCribbageFlow());
  }

  /**
   * Override to create CribbagePlayer instances
   */
  protected override createPlayer(position: number, name: string): CribbagePlayer {
    return new CribbagePlayer(position, name);
  }

  /**
   * Create a standard 52-card deck
   */
  createDeck(): void {
    // Sprite sheet layout: 13 columns (ranks), 5 rows (4 suits + back)
    // Card size: 238x333, Back size: 223x311
    const CARD_WIDTH = 238;
    const CARD_HEIGHT = 333;
    const BACK_WIDTH = 223;
    const BACK_HEIGHT = 311;

    // Suit row order in sprite: C=0, D=1, H=2, S=3
    const suitRows: Record<string, number> = { C: 0, D: 1, H: 2, S: 3 };

    // Rank column order: A=0, 2-10=1-9, J=10, Q=11, K=12
    const rankCols: Record<string, number> = {
      A: 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5, '7': 6,
      '8': 7, '9': 8, '10': 9, J: 10, Q: 11, K: 12,
    };

    for (const suit of CribbageGame.SUITS) {
      for (const rank of CribbageGame.RANKS) {
        const card = this.deck.create(Card, `${rank}${suit}`, { suit, rank });
        // Set card images - using CSS sprite sheet with coordinates
        const col = rankCols[rank];
        const row = suitRows[suit];
        card.$images = {
          face: {
            sprite: '/cards/deck-sprite.svg',
            x: col * CARD_WIDTH,
            y: row * CARD_HEIGHT,
            width: CARD_WIDTH,
            height: CARD_HEIGHT,
          },
          back: {
            sprite: '/cards/deck-sprite.svg',
            x: 0,
            y: 4 * CARD_HEIGHT, // Back is on row 4 (5th row, 0-indexed)
            width: BACK_WIDTH,
            height: BACK_HEIGHT,
          },
        };
      }
    }
  }

  /**
   * Start a new round - shuffle and deal
   */
  startNewRound(): void {
    this.cribbagePhase = 'dealing';

    // Clear all areas
    this.moveAllToArea(this.crib, this.deck);
    this.moveAllToArea(this.playArea, this.deck);
    this.moveAllToArea(this.playedCards, this.deck);
    this.moveAllToArea(this.starterArea, this.deck);

    for (const player of this.players) {
      const hand = this.getPlayerHand(player as CribbagePlayer);
      this.moveAllToArea(hand, this.deck);
      (player as CribbagePlayer).cardsPlayedThisRound = 0;
    }

    // Shuffle
    this.deck.shuffle();

    // Deal 6 cards to each player
    this.dealCards();

    this.cribbagePhase = 'discarding';
    this.message(`New round! ${this.getDealer().name} is the dealer.`);
  }

  /**
   * Move all cards from one area to another
   */
  private moveAllToArea(from: Hand | Crib | PlayArea | PlayedCards | StarterArea, to: Deck | Hand): void {
    for (const card of [...from.all(Card)]) {
      card.putInto(to);
    }
  }

  /**
   * Deal 6 cards to each player
   */
  dealCards(): void {
    // Deal alternating, starting with non-dealer
    const nonDealer = this.getNonDealer();
    const dealer = this.getDealer();

    for (let i = 0; i < 6; i++) {
      // Non-dealer first, then dealer
      this.deck.drawTo(this.getPlayerHand(nonDealer), 1, Card);
      this.deck.drawTo(this.getPlayerHand(dealer), 1, Card);
    }
  }

  /**
   * Get a player's hand space
   */
  getPlayerHand(player: CribbagePlayer): Hand {
    return this.first(Hand, `hand-${player.position}`)!;
  }

  /**
   * Get the dealer
   */
  getDealer(): CribbagePlayer {
    return this.players[this.dealerPosition] as CribbagePlayer;
  }

  /**
   * Get the non-dealer
   */
  getNonDealer(): CribbagePlayer {
    return this.players[1 - this.dealerPosition] as CribbagePlayer;
  }

  /**
   * Rotate dealer for next round
   */
  rotateDealer(): void {
    (this.players[this.dealerPosition] as CribbagePlayer).isDealer = false;
    this.dealerPosition = 1 - this.dealerPosition;
    (this.players[this.dealerPosition] as CribbagePlayer).isDealer = true;
  }

  /**
   * Get the current player during play phase
   */
  getCurrentPlayPlayer(): CribbagePlayer {
    return this.players[this.currentPlayTurn] as CribbagePlayer;
  }

  /**
   * Switch to the other player's turn
   */
  switchPlayTurn(): void {
    this.currentPlayTurn = 1 - this.currentPlayTurn;
  }

  /**
   * Cut the starter card
   */
  cutStarterCard(): void {
    const [starter] = this.deck.drawTo(this.starterArea, 1, Card);
    if (starter) {
      this.message(`Starter card: ${starter.rank}${starter.suit}`);

      // His Heels: Jack as starter = 2 points for dealer
      if (starter.rank === 'J') {
        this.addPoints(this.getDealer(), 2, 'His Heels');
      }
    }
  }

  /**
   * Get the starter card
   */
  getStarterCard(): Card | null {
    return this.starterArea.first(Card) ?? null;
  }

  /**
   * Store original hand cards for each player (call after discard, before play)
   * This is needed because cards move during play phase but we need originals for scoring
   */
  storeOriginalHands(): void {
    for (const player of this.players) {
      const p = player as CribbagePlayer;
      const hand = this.getPlayerHand(p);
      p.originalHandCardIds = [...hand.all(Card)].map(c => c.name!);
    }
  }

  /**
   * Get a player's original hand cards (for scoring after play phase)
   */
  getOriginalHandCards(player: CribbagePlayer): Card[] {
    return player.originalHandCardIds
      .map(id => this.first(Card, id))
      .filter((c): c is Card => c !== undefined);
  }

  /**
   * Add points to a player
   */
  addPoints(player: CribbagePlayer, points: number, reason: string): void {
    player.score += points;
    this.message(`${player.name} scores ${points} (${reason}) - Total: ${player.score}`);

    if (player.score >= this.targetScore) {
      this.cribbagePhase = 'gameOver';
    }
  }

  /**
   * Check if a player can play a card without exceeding 31
   */
  canPlayCard(player: CribbagePlayer, card: Card): boolean {
    return this.runningTotal + card.pointValue <= 31;
  }

  /**
   * Get cards a player can legally play
   */
  getPlayableCards(player: CribbagePlayer): Card[] {
    const hand = this.getPlayerHand(player);
    return [...hand.all(Card)].filter(c => this.canPlayCard(player, c));
  }

  /**
   * Check if player must say "Go" (can't play any card)
   */
  mustSayGo(player: CribbagePlayer): boolean {
    return this.getPlayableCards(player).length === 0 && this.getPlayerHand(player).count(Card) > 0;
  }

  /**
   * Play a card during the play phase
   */
  playCard(player: CribbagePlayer, card: Card): number {
    const hand = this.getPlayerHand(player);

    // Move card to play area
    card.putInto(this.playArea);
    if (card.name) {
      this.currentPlayCards.push(card.name);
    }
    this.runningTotal += card.pointValue;
    this.lastPlayerToPlay = player.position;
    player.cardsPlayedThisRound++;

    this.message(`${player.name} plays ${card.rank}${card.suit} (count: ${this.runningTotal})`);

    // Score the play
    const playedCardsInOrder = this.currentPlayCards.map(id => this.first(Card, id)!);
    const score = scorePegging(playedCardsInOrder, this.runningTotal);

    if (score.points > 0) {
      this.addPoints(player, score.points, score.reasons.join(', '));
    }

    return score.points;
  }

  /**
   * Reset the count (after 31 or both players can't play)
   */
  resetCount(): void {
    // Move play area cards to played cards pile
    for (const card of [...this.playArea.all(Card)]) {
      card.putInto(this.playedCards);
    }
    this.runningTotal = 0;
    this.currentPlayCards = [];
    this.playerSaidGo = [false, false];
    this.message('Count reset to 0');
  }

  /**
   * Score a player's hand with animated reveal of each combination
   */
  scorePlayerHand(player: CribbagePlayer): DetailedScoreBreakdown {
    // Use original hand cards (stored before play phase) since cards have moved
    const handCards = this.getOriginalHandCards(player);
    const starter = this.getStarterCard();

    const score = scoreHandDetailed(handCards, starter, false);

    // Set up scoring animation state for UI
    this.scoringAnimation = {
      active: true,
      type: 'hand',
      playerPosition: player.position,
      playerName: player.name,
      handCards: handCards.map(c => c.name!),
      starterCard: starter?.name ?? null,
      items: score.items.map(item => ({
        category: item.category,
        points: item.points,
        cardIds: item.cards.map(c => c.name!),
        description: item.description,
      })),
      currentItemIndex: 0,
      totalPoints: score.total,
    };

    // Show the hand being scored (for game log)
    const handStr = handCards.map(c => c.toString()).join(', ');
    const starterStr = starter ? ` + ${starter.toString()}` : '';
    this.message(`${player.name}'s hand: ${handStr}${starterStr}`);

    // Announce each scoring combination individually (for game log)
    let runningTotal = 0;
    for (const item of score.items) {
      runningTotal += item.points;
      this.message(`  ${item.description} (${runningTotal} total)`);
    }

    // Award the total points
    if (score.total > 0) {
      this.addPoints(player, score.total, 'Hand');
    } else {
      this.message(`  No points`);
    }

    return score;
  }

  /**
   * Score the crib (dealer only) with animated reveal
   */
  scoreCrib(): DetailedScoreBreakdown {
    const cribCards = [...this.crib.all(Card)];
    const starter = this.getStarterCard();
    const dealer = this.getDealer();

    const score = scoreHandDetailed(cribCards, starter, true);

    // Set up scoring animation state for UI
    this.scoringAnimation = {
      active: true,
      type: 'crib',
      playerPosition: dealer.position,
      playerName: dealer.name,
      handCards: cribCards.map(c => c.name!),
      starterCard: starter?.name ?? null,
      items: score.items.map(item => ({
        category: item.category,
        points: item.points,
        cardIds: item.cards.map(c => c.name!),
        description: item.description,
      })),
      currentItemIndex: 0,
      totalPoints: score.total,
    };

    // Show the crib being scored (for game log)
    const cribStr = cribCards.map(c => c.toString()).join(', ');
    const starterStr = starter ? ` + ${starter.toString()}` : '';
    this.message(`${dealer.name}'s crib: ${cribStr}${starterStr}`);

    // Announce each scoring combination individually (for game log)
    let runningTotal = 0;
    for (const item of score.items) {
      runningTotal += item.points;
      this.message(`  ${item.description} (${runningTotal} total)`);
    }

    // Award the total points
    if (score.total > 0) {
      this.addPoints(dealer, score.total, 'Crib');
    } else {
      this.message(`  No points`);
    }

    return score;
  }

  /**
   * Clear the scoring animation state (called by UI when animation completes)
   */
  clearScoringAnimation(): void {
    this.scoringAnimation = {
      active: false,
      type: null,
      playerPosition: -1,
      playerName: '',
      handCards: [],
      starterCard: null,
      items: [],
      currentItemIndex: -1,
      totalPoints: 0,
    };
    // Also clear round summary
    this.roundSummary = {
      active: false,
      starterCard: null,
      nonDealerHand: null,
      dealerHand: null,
      crib: null,
      roundTotal: 0,
    };
  }

  /**
   * Score all hands and crib, then build round summary for UI display
   */
  scoreRoundAndBuildSummary(): void {
    const nonDealer = this.getNonDealer();
    const dealer = this.getDealer();
    const starter = this.getStarterCard();

    // Score non-dealer's hand
    const nonDealerCards = this.getOriginalHandCards(nonDealer);
    const nonDealerScore = scoreHandDetailed(nonDealerCards, starter, false);

    this.message(`--- ${nonDealer.name}'s hand ---`);
    const nonDealerHandStr = nonDealerCards.map(c => c.toString()).join(', ');
    this.message(`${nonDealer.name}'s hand: ${nonDealerHandStr}`);
    let runningTotal = 0;
    for (const item of nonDealerScore.items) {
      runningTotal += item.points;
      this.message(`  ${item.description} (${runningTotal} total)`);
    }
    if (nonDealerScore.total > 0) {
      this.addPoints(nonDealer, nonDealerScore.total, 'Hand');
    } else {
      this.message(`  No points`);
    }

    // Check for win after non-dealer scores
    if (this.isFinished()) {
      this.buildRoundSummary(nonDealerCards, nonDealerScore, null, null, null, null);
      return;
    }

    // Score dealer's hand
    const dealerCards = this.getOriginalHandCards(dealer);
    const dealerScore = scoreHandDetailed(dealerCards, starter, false);

    this.message(`--- ${dealer.name}'s hand ---`);
    const dealerHandStr = dealerCards.map(c => c.toString()).join(', ');
    this.message(`${dealer.name}'s hand: ${dealerHandStr}`);
    runningTotal = 0;
    for (const item of dealerScore.items) {
      runningTotal += item.points;
      this.message(`  ${item.description} (${runningTotal} total)`);
    }
    if (dealerScore.total > 0) {
      this.addPoints(dealer, dealerScore.total, 'Hand');
    } else {
      this.message(`  No points`);
    }

    // Check for win after dealer scores hand
    if (this.isFinished()) {
      this.buildRoundSummary(nonDealerCards, nonDealerScore, dealerCards, dealerScore, null, null);
      return;
    }

    // Score crib
    const cribCards = [...this.crib.all(Card)];
    this.crib.contentsVisible();
    const cribScore = scoreHandDetailed(cribCards, starter, true);

    this.message(`--- ${dealer.name}'s crib ---`);
    const cribStr = cribCards.map(c => c.toString()).join(', ');
    this.message(`${dealer.name}'s crib: ${cribStr}`);
    runningTotal = 0;
    for (const item of cribScore.items) {
      runningTotal += item.points;
      this.message(`  ${item.description} (${runningTotal} total)`);
    }
    if (cribScore.total > 0) {
      this.addPoints(dealer, cribScore.total, 'Crib');
    } else {
      this.message(`  No points`);
    }

    // Build the round summary for UI
    this.buildRoundSummary(nonDealerCards, nonDealerScore, dealerCards, dealerScore, cribCards, cribScore);
  }

  /**
   * Build the round summary state for UI display
   */
  private buildRoundSummary(
    nonDealerCards: Card[],
    nonDealerScore: DetailedScoreBreakdown,
    dealerCards: Card[] | null,
    dealerScore: DetailedScoreBreakdown | null,
    cribCards: Card[] | null,
    cribScore: DetailedScoreBreakdown | null
  ): void {
    const nonDealer = this.getNonDealer();
    const dealer = this.getDealer();
    const starter = this.getStarterCard();

    this.roundSummary = {
      active: true,
      starterCard: starter?.name ?? null,
      nonDealerHand: {
        playerName: nonDealer.name,
        playerPosition: nonDealer.position,
        cardIds: nonDealerCards.map(c => c.name!),
        items: nonDealerScore.items.map(item => ({
          category: item.category,
          points: item.points,
          cardIds: item.cards.map(c => c.name!),
          description: item.description,
        })),
        totalPoints: nonDealerScore.total,
      },
      dealerHand: dealerCards && dealerScore ? {
        playerName: dealer.name,
        playerPosition: dealer.position,
        cardIds: dealerCards.map(c => c.name!),
        items: dealerScore.items.map(item => ({
          category: item.category,
          points: item.points,
          cardIds: item.cards.map(c => c.name!),
          description: item.description,
        })),
        totalPoints: dealerScore.total,
      } : null,
      crib: cribCards && cribScore ? {
        playerName: dealer.name,
        cardIds: cribCards.map(c => c.name!),
        items: cribScore.items.map(item => ({
          category: item.category,
          points: item.points,
          cardIds: item.cards.map(c => c.name!),
          description: item.description,
        })),
        totalPoints: cribScore.total,
      } : null,
      roundTotal: nonDealerScore.total + (dealerScore?.total ?? 0) + (cribScore?.total ?? 0),
    };
  }

  /**
   * Check if both players have played all their cards
   */
  allCardsPlayed(): boolean {
    for (const player of this.players) {
      const hand = this.getPlayerHand(player as CribbagePlayer);
      if (hand.count(Card) > 0) return false;
    }
    return true;
  }

  /**
   * Check if the game is complete
   */
  override isFinished(): boolean {
    return this.cribbagePhase === 'gameOver' || this.players.some(p => (p as CribbagePlayer).score >= this.targetScore);
  }

  /**
   * Get the winners
   */
  override getWinners(): CribbagePlayer[] {
    if (!this.isFinished()) return [];

    // Winner is first to reach target score
    const winners = this.players.filter(p => (p as CribbagePlayer).score >= this.targetScore);
    if (winners.length > 0) {
      return winners as CribbagePlayer[];
    }

    // Shouldn't reach here normally
    return [];
  }

  /**
   * Get how many cards each player has discarded to crib
   */
  getDiscardCounts(): Map<number, number> {
    const counts = new Map<number, number>();
    for (const player of this.players) {
      const p = player as CribbagePlayer;
      const hand = this.getPlayerHand(p);
      // Started with 6, discarded = 6 - current hand size (during discard phase)
      // During discard, hand goes from 6 to 4
      counts.set(p.position, Math.max(0, 6 - hand.count(Card)));
    }
    return counts;
  }

  /**
   * Check if all players have finished discarding
   */
  allPlayersDiscarded(): boolean {
    const counts = this.getDiscardCounts();
    for (const count of counts.values()) {
      if (count < 2) return false;
    }
    return true;
  }
}
