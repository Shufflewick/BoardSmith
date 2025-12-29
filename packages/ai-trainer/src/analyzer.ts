import type {
  GameData,
  FeatureStats,
  ActionStats,
  CandidateFeature,
} from './types.js';

/**
 * Calculate the outcome value for a player in a game
 * @returns 1 = win, 0 = loss, 0.5 = draw (no winners or multi-way tie)
 */
function getPlayerOutcome(game: GameData, playerIndex: number): number {
  // No winners = draw, all players get 0.5
  if (game.winners.length === 0) {
    return 0.5;
  }

  // Check if player is a winner
  const isWinner = game.winners.includes(playerIndex);

  // If all players are winners, it's a draw (everyone tied)
  if (game.winners.length === game.playerCount) {
    return 0.5;
  }

  // Otherwise: 1 for winners, 0 for losers
  return isWinner ? 1 : 0;
}

/**
 * Analyze simulation results to compute feature statistics
 */
export function analyzeFeatures(
  games: GameData[],
  features: CandidateFeature[]
): FeatureStats[] {
  const stats = new Map<string, FeatureStats>();

  // Initialize stats for each feature
  for (const feature of features) {
    stats.set(feature.id, {
      featureId: feature.id,
      trueAndWon: 0,
      trueAndLost: 0,
      falseAndWon: 0,
      falseAndLost: 0,
      winRateWhenTrue: 0,
      winRateWhenFalse: 0,
      correlation: 0,
      pValue: 1,
    });
  }

  // Accumulate counts from all games
  for (const game of games) {
    if (!game.completed) continue;

    for (const state of game.states) {
      // Calculate outcome: 1 = win, 0 = loss, 0.5 = draw
      const outcome = getPlayerOutcome(game, state.decidingPlayer);

      for (const [featureId, value] of state.featureValues) {
        const stat = stats.get(featureId);
        if (!stat) continue;

        // For draws (outcome = 0.5), add fractionally to both win and loss
        // This preserves the contingency table structure while handling ties
        if (value) {
          stat.trueAndWon += outcome;
          stat.trueAndLost += (1 - outcome);
        } else {
          stat.falseAndWon += outcome;
          stat.falseAndLost += (1 - outcome);
        }
      }
    }
  }

  // Calculate derived statistics
  for (const stat of stats.values()) {
    const trueTotal = stat.trueAndWon + stat.trueAndLost;
    const falseTotal = stat.falseAndWon + stat.falseAndLost;

    stat.winRateWhenTrue = trueTotal > 0 ? stat.trueAndWon / trueTotal : 0.5;
    stat.winRateWhenFalse = falseTotal > 0 ? stat.falseAndWon / falseTotal : 0.5;

    // Calculate Phi coefficient (correlation for binary variables)
    stat.correlation = calculatePhiCoefficient(
      stat.trueAndWon,
      stat.trueAndLost,
      stat.falseAndWon,
      stat.falseAndLost
    );

    // Calculate chi-squared p-value
    stat.pValue = calculateChiSquaredPValue(
      stat.trueAndWon,
      stat.trueAndLost,
      stat.falseAndWon,
      stat.falseAndLost
    );
  }

  return [...stats.values()];
}

/**
 * Analyze action preferences from simulation data
 */
export function analyzeActions(games: GameData[]): ActionStats[] {
  const stats = new Map<string, ActionStats>();

  for (const game of games) {
    if (!game.completed) continue;

    for (const state of game.states) {
      // Calculate outcome: 1 = win, 0 = loss, 0.5 = draw
      const outcome = getPlayerOutcome(game, state.decidingPlayer);
      const actionTaken = state.actionTaken;

      // Update stats for the action taken
      if (actionTaken) {
        if (!stats.has(actionTaken)) {
          stats.set(actionTaken, {
            actionName: actionTaken,
            takenAndWon: 0,
            takenAndLost: 0,
            notTakenAndWon: 0,
            notTakenAndLost: 0,
            winRateWhenTaken: 0,
            winRateWhenNotTaken: 0,
          });
        }

        const stat = stats.get(actionTaken)!;
        // For draws, add fractionally to both
        stat.takenAndWon += outcome;
        stat.takenAndLost += (1 - outcome);
      }

      // Update stats for actions not taken
      for (const available of state.availableActions) {
        if (available === actionTaken) continue;

        if (!stats.has(available)) {
          stats.set(available, {
            actionName: available,
            takenAndWon: 0,
            takenAndLost: 0,
            notTakenAndWon: 0,
            notTakenAndLost: 0,
            winRateWhenTaken: 0,
            winRateWhenNotTaken: 0,
          });
        }

        const stat = stats.get(available)!;
        // For draws, add fractionally to both
        stat.notTakenAndWon += outcome;
        stat.notTakenAndLost += (1 - outcome);
      }
    }
  }

  // Calculate win rates
  for (const stat of stats.values()) {
    const takenTotal = stat.takenAndWon + stat.takenAndLost;
    const notTakenTotal = stat.notTakenAndWon + stat.notTakenAndLost;

    stat.winRateWhenTaken = takenTotal > 0 ? stat.takenAndWon / takenTotal : 0.5;
    stat.winRateWhenNotTaken = notTakenTotal > 0 ? stat.notTakenAndWon / notTakenTotal : 0.5;
  }

  return [...stats.values()];
}

/**
 * Calculate Phi coefficient (correlation for 2x2 contingency table)
 */
function calculatePhiCoefficient(
  a: number, // true and won
  b: number, // true and lost
  c: number, // false and won
  d: number  // false and lost
): number {
  const n = a + b + c + d;
  if (n === 0) return 0;

  const numerator = a * d - b * c;
  const denominator = Math.sqrt((a + b) * (c + d) * (a + c) * (b + d));

  if (denominator === 0) return 0;
  return numerator / denominator;
}

/**
 * Calculate chi-squared test p-value for 2x2 contingency table
 */
function calculateChiSquaredPValue(
  a: number,
  b: number,
  c: number,
  d: number
): number {
  const n = a + b + c + d;
  if (n === 0) return 1;

  // Calculate expected values
  const row1 = a + b;
  const row2 = c + d;
  const col1 = a + c;
  const col2 = b + d;

  if (row1 === 0 || row2 === 0 || col1 === 0 || col2 === 0) return 1;

  const e_a = (row1 * col1) / n;
  const e_b = (row1 * col2) / n;
  const e_c = (row2 * col1) / n;
  const e_d = (row2 * col2) / n;

  // Calculate chi-squared statistic
  const chiSquared =
    ((a - e_a) ** 2) / e_a +
    ((b - e_b) ** 2) / e_b +
    ((c - e_c) ** 2) / e_c +
    ((d - e_d) ** 2) / e_d;

  // Approximate p-value from chi-squared distribution with 1 degree of freedom
  return chiSquaredToP(chiSquared, 1);
}

/**
 * Approximate chi-squared CDF (cumulative distribution function)
 * This is a simplified approximation for 1 degree of freedom
 */
function chiSquaredToP(x: number, df: number): number {
  if (x <= 0) return 1;

  // For df=1, use the relationship with normal distribution
  if (df === 1) {
    const z = Math.sqrt(x);
    // Approximate 1 - Phi(z) using error function approximation
    return 2 * (1 - normalCDF(z));
  }

  // For other df, use Wilson-Hilferty approximation
  const v = df;
  const z = Math.pow(x / v, 1 / 3) - (1 - 2 / (9 * v));
  const denom = Math.sqrt(2 / (9 * v));

  return 1 - normalCDF(z / denom);
}

/**
 * Normal CDF approximation
 */
function normalCDF(x: number): number {
  // Approximation using the error function
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

/**
 * Select top features based on correlation
 */
export function selectTopFeatures(
  stats: FeatureStats[],
  maxFeatures: number,
  minCorrelation: number
): FeatureStats[] {
  // Filter by minimum absolute correlation
  const significant = stats.filter(s => Math.abs(s.correlation) >= minCorrelation);

  // Sort by absolute correlation (descending)
  significant.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));

  // Take top N
  return significant.slice(0, maxFeatures);
}

/**
 * Convert correlation to weight
 */
export function correlationToWeight(correlation: number, scale: number = 10): number {
  // Use log-odds transformation: weight = log(P_true / P_false) * scale
  // Simplified: just scale the correlation and clamp
  const weight = correlation * scale;
  return Math.max(-20, Math.min(20, weight)); // Clamp to reasonable range
}

/**
 * Print analysis summary
 */
export function printAnalysisSummary(
  featureStats: FeatureStats[],
  actionStats: ActionStats[]
): void {
  console.log('\n=== Feature Analysis ===\n');

  // Sort by absolute correlation
  const sortedFeatures = [...featureStats].sort(
    (a, b) => Math.abs(b.correlation) - Math.abs(a.correlation)
  );

  console.log('Top 10 Features by Correlation:');
  for (const stat of sortedFeatures.slice(0, 10)) {
    const sign = stat.correlation > 0 ? '+' : '';
    console.log(
      `  ${stat.featureId}: ${sign}${stat.correlation.toFixed(3)} ` +
      `(win rate: ${(stat.winRateWhenTrue * 100).toFixed(1)}% true, ` +
      `${(stat.winRateWhenFalse * 100).toFixed(1)}% false)`
    );
  }

  console.log('\n=== Action Analysis ===\n');

  // Sort by win rate difference
  const sortedActions = [...actionStats].sort(
    (a, b) => (b.winRateWhenTaken - b.winRateWhenNotTaken) -
              (a.winRateWhenTaken - a.winRateWhenNotTaken)
  );

  console.log('Top 5 Actions by Win Rate Improvement:');
  for (const stat of sortedActions.slice(0, 5)) {
    const diff = stat.winRateWhenTaken - stat.winRateWhenNotTaken;
    console.log(
      `  ${stat.actionName}: ${diff > 0 ? '+' : ''}${(diff * 100).toFixed(1)}% ` +
      `(${(stat.winRateWhenTaken * 100).toFixed(1)}% when taken, ` +
      `${(stat.winRateWhenNotTaken * 100).toFixed(1)}% when not)`
    );
  }
}
