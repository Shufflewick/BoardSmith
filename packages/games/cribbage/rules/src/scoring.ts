import { Card } from './elements.js';

/**
 * Score breakdown for display purposes
 */
export interface ScoreBreakdown {
  fifteens: number;      // 2 points per combination summing to 15
  pairs: number;         // 2 points per pair
  runs: number;          // 1 point per card in runs
  flush: number;         // 4-5 points for flush
  nobs: number;          // 1 point for Jack matching starter suit
  total: number;
  details: string[];     // Human-readable breakdown
}

/**
 * A single scoring item for animated reveal
 */
export interface ScoringItem {
  category: 'fifteen' | 'pair' | 'run' | 'flush' | 'nobs';
  points: number;
  cards: Card[];
  description: string;
}

/**
 * Detailed scoring result with individual combinations
 */
export interface DetailedScoreBreakdown {
  items: ScoringItem[];
  total: number;
}

/**
 * Calculate all fifteens in a set of cards
 * Each combination of cards summing to 15 = 2 points
 */
export function countFifteens(cards: Card[]): { count: number; combinations: Card[][] } {
  const combinations: Card[][] = [];
  const n = cards.length;

  // Check all possible subsets (2^n - 1, excluding empty set)
  for (let mask = 1; mask < (1 << n); mask++) {
    const subset: Card[] = [];
    let sum = 0;

    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        subset.push(cards[i]);
        sum += cards[i].pointValue;
      }
    }

    if (sum === 15) {
      combinations.push(subset);
    }
  }

  return { count: combinations.length, combinations };
}

/**
 * Count pairs in a set of cards
 * Pair = 2 points, Three of a kind = 6 points, Four of a kind = 12 points
 */
export function countPairs(cards: Card[]): { count: number; pairs: [Card, Card][] } {
  const pairs: [Card, Card][] = [];

  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      if (cards[i].rank === cards[j].rank) {
        pairs.push([cards[i], cards[j]]);
      }
    }
  }

  return { count: pairs.length, pairs };
}

/**
 * Find all runs in a set of cards
 * A run is 3+ cards in sequence (by rank value)
 * Returns the total points from runs
 */
export function countRuns(cards: Card[]): { points: number; runs: Card[][] } {
  const runs: Card[][] = [];
  const n = cards.length;

  if (n < 3) return { points: 0, runs: [] };

  // Get rank values and count duplicates
  const rankCounts = new Map<number, number>();
  for (const card of cards) {
    const rv = card.rankValue;
    rankCounts.set(rv, (rankCounts.get(rv) ?? 0) + 1);
  }

  // Get unique rank values sorted
  const uniqueRanks = [...rankCounts.keys()].sort((a, b) => a - b);

  // Find consecutive sequences in unique ranks
  let runStart = 0;
  let maxRunLength = 0;
  let currentRunStart = 0;
  let currentRunLength = 1;

  for (let i = 1; i <= uniqueRanks.length; i++) {
    if (i < uniqueRanks.length && uniqueRanks[i] === uniqueRanks[i - 1] + 1) {
      currentRunLength++;
    } else {
      if (currentRunLength >= 3 && currentRunLength > maxRunLength) {
        maxRunLength = currentRunLength;
        runStart = currentRunStart;
      }
      currentRunStart = i;
      currentRunLength = 1;
    }
  }

  if (maxRunLength < 3) return { points: 0, runs: [] };

  // Calculate multiplier from duplicates within the run
  const runRanks = uniqueRanks.slice(runStart, runStart + maxRunLength);
  let multiplier = 1;
  for (const rank of runRanks) {
    multiplier *= rankCounts.get(rank)!;
  }

  // Generate all run combinations
  function generateRuns(rankIndex: number, currentRun: Card[]): void {
    if (rankIndex >= runRanks.length) {
      runs.push([...currentRun]);
      return;
    }

    const rank = runRanks[rankIndex];
    const cardsOfRank = cards.filter(c => c.rankValue === rank);
    for (const card of cardsOfRank) {
      currentRun.push(card);
      generateRuns(rankIndex + 1, currentRun);
      currentRun.pop();
    }
  }

  generateRuns(0, []);

  const points = maxRunLength * multiplier;
  return { points, runs };
}

/**
 * Check for flush
 * Hand flush: 4 cards same suit = 4 points
 * If starter also matches = 5 points
 * In crib, all 5 must match for 5 points (no 4-card flush)
 */
export function countFlush(
  handCards: Card[],
  starterCard: Card | null,
  isCrib: boolean
): { points: number; cards: Card[] } {
  if (handCards.length !== 4) return { points: 0, cards: [] };

  const suit = handCards[0].suit;
  const allSameSuit = handCards.every(c => c.suit === suit);

  if (!allSameSuit) return { points: 0, cards: [] };

  // For crib, starter must also match
  if (isCrib) {
    if (starterCard && starterCard.suit === suit) {
      return { points: 5, cards: [...handCards, starterCard] };
    }
    return { points: 0, cards: [] };
  }

  // For hand, 4-card flush counts
  if (starterCard && starterCard.suit === suit) {
    return { points: 5, cards: [...handCards, starterCard] };
  }

  return { points: 4, cards: handCards };
}

/**
 * Check for "His Nobs" - Jack in hand matching starter suit
 */
export function checkNobs(handCards: Card[], starterCard: Card | null): { points: number; jack: Card | null } {
  if (!starterCard) return { points: 0, jack: null };

  const jack = handCards.find(c => c.rank === 'J' && c.suit === starterCard.suit);
  if (jack) {
    return { points: 1, jack };
  }

  return { points: 0, jack: null };
}

/**
 * Calculate total score for a hand (4 cards) with starter card
 */
export function scoreHand(
  handCards: Card[],
  starterCard: Card | null,
  isCrib: boolean = false
): ScoreBreakdown {
  const allCards = starterCard ? [...handCards, starterCard] : [...handCards];
  const details: string[] = [];

  // Fifteens
  const fifteens = countFifteens(allCards);
  const fifteenPoints = fifteens.count * 2;
  if (fifteenPoints > 0) {
    details.push(`Fifteens: ${fifteens.count} x 2 = ${fifteenPoints}`);
  }

  // Pairs
  const pairs = countPairs(allCards);
  const pairPoints = pairs.count * 2;
  if (pairPoints > 0) {
    const pairType = pairs.count === 1 ? 'Pair' : pairs.count === 3 ? 'Three of a kind' : pairs.count === 6 ? 'Four of a kind' : `${pairs.count} pairs`;
    details.push(`${pairType}: ${pairPoints}`);
  }

  // Runs
  const runs = countRuns(allCards);
  if (runs.points > 0) {
    details.push(`Runs: ${runs.points}`);
  }

  // Flush
  const flush = countFlush(handCards, starterCard, isCrib);
  if (flush.points > 0) {
    details.push(`Flush: ${flush.points}`);
  }

  // Nobs
  const nobs = checkNobs(handCards, starterCard);
  if (nobs.points > 0) {
    details.push(`His Nobs: 1`);
  }

  const total = fifteenPoints + pairPoints + runs.points + flush.points + nobs.points;

  return {
    fifteens: fifteenPoints,
    pairs: pairPoints,
    runs: runs.points,
    flush: flush.points,
    nobs: nobs.points,
    total,
    details,
  };
}

/**
 * Get detailed scoring breakdown with individual combinations for animated reveal
 */
export function scoreHandDetailed(
  handCards: Card[],
  starterCard: Card | null,
  isCrib: boolean = false
): DetailedScoreBreakdown {
  const allCards = starterCard ? [...handCards, starterCard] : [...handCards];
  const items: ScoringItem[] = [];
  let total = 0;

  // Fifteens - each combination individually
  const fifteens = countFifteens(allCards);
  for (const combo of fifteens.combinations) {
    const cardStr = combo.map(c => c.toString()).join(' + ');
    items.push({
      category: 'fifteen',
      points: 2,
      cards: combo,
      description: `Fifteen: ${cardStr} = 2`,
    });
    total += 2;
  }

  // Pairs - each pair individually
  const pairs = countPairs(allCards);
  for (const [card1, card2] of pairs.pairs) {
    items.push({
      category: 'pair',
      points: 2,
      cards: [card1, card2],
      description: `Pair: ${card1.toString()} + ${card2.toString()} = 2`,
    });
    total += 2;
  }

  // Runs - each run individually
  const runs = countRuns(allCards);
  for (const run of runs.runs) {
    const runLength = run.length;
    const cardStr = run.map(c => c.toString()).join('-');
    items.push({
      category: 'run',
      points: runLength,
      cards: run,
      description: `Run: ${cardStr} = ${runLength}`,
    });
    total += runLength;
  }

  // Flush
  const flush = countFlush(handCards, starterCard, isCrib);
  if (flush.points > 0) {
    const cardStr = flush.cards.map(c => c.toString()).join(', ');
    items.push({
      category: 'flush',
      points: flush.points,
      cards: flush.cards,
      description: `Flush: ${cardStr} = ${flush.points}`,
    });
    total += flush.points;
  }

  // Nobs
  const nobs = checkNobs(handCards, starterCard);
  if (nobs.points > 0 && nobs.jack) {
    items.push({
      category: 'nobs',
      points: 1,
      cards: [nobs.jack],
      description: `His Nobs: ${nobs.jack.toString()} = 1`,
    });
    total += 1;
  }

  return { items, total };
}

/**
 * Pegging scoring during play phase
 */
export interface PeggingScore {
  points: number;
  reasons: string[];
}

/**
 * Calculate points for a card played during pegging
 * @param playedCards Cards already played this count (including the new card)
 * @param runningTotal Current running total
 */
export function scorePegging(playedCards: Card[], runningTotal: number): PeggingScore {
  const points: number[] = [];
  const reasons: string[] = [];

  // Check for fifteen
  if (runningTotal === 15) {
    points.push(2);
    reasons.push('Fifteen for 2');
  }

  // Check for thirty-one
  if (runningTotal === 31) {
    points.push(2);
    reasons.push('Thirty-one for 2');
  }

  if (playedCards.length >= 2) {
    // Check for pairs/triples/quads (consecutive same rank at end)
    let pairCount = 1;
    const lastRank = playedCards[playedCards.length - 1].rank;
    for (let i = playedCards.length - 2; i >= 0; i--) {
      if (playedCards[i].rank === lastRank) {
        pairCount++;
      } else {
        break;
      }
    }

    if (pairCount === 2) {
      points.push(2);
      reasons.push('Pair for 2');
    } else if (pairCount === 3) {
      points.push(6);
      reasons.push('Three of a kind for 6');
    } else if (pairCount === 4) {
      points.push(12);
      reasons.push('Four of a kind for 12');
    }

    // Check for runs (3+ cards at end that form a run)
    if (playedCards.length >= 3) {
      for (let runLength = playedCards.length; runLength >= 3; runLength--) {
        const lastN = playedCards.slice(-runLength);
        const ranks = lastN.map(c => c.rankValue).sort((a, b) => a - b);

        // Check if consecutive
        let isRun = true;
        for (let i = 1; i < ranks.length; i++) {
          if (ranks[i] !== ranks[i - 1] + 1) {
            isRun = false;
            break;
          }
        }

        if (isRun) {
          points.push(runLength);
          reasons.push(`Run of ${runLength} for ${runLength}`);
          break; // Only count longest run
        }
      }
    }
  }

  return {
    points: points.reduce((a, b) => a + b, 0),
    reasons,
  };
}
