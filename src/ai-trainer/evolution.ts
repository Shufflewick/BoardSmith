/**
 * Weight evolution module using µ+λ evolution strategy.
 *
 * µ (mu) = parent population size
 * λ (lambda) = offspring population size
 *
 * Each generation:
 * 1. Generate λ offspring from µ parents via mutation/crossover
 * 2. Evaluate all offspring fitness (benchmark games)
 * 3. Select top µ from combined population (µ+λ) as next parents
 */

import type { LearnedObjective } from './types.js';
import { createSeededRandom } from '../utils/random.js';

// Re-export for backwards compatibility
export { createSeededRandom };

/**
 * Generate Gaussian random number using Box-Muller transform.
 *
 * @param rng - Seeded random function
 * @returns Random number from N(0, 1)
 */
function gaussian(rng: () => number): number {
  // Box-Muller transform
  const u1 = rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1 || 0.0001)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Clamp a value to bounds.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Weight bounds for clamping */
const WEIGHT_MIN = -20;
const WEIGHT_MAX = 20;

/** Probability to flip sign during mutation */
const SIGN_FLIP_PROBABILITY = 0.1;

/** Probability to use crossover (vs pure mutation) when generating offspring */
const CROSSOVER_PROBABILITY = 0.2;

/**
 * Mutate objective weights using Gaussian perturbation.
 *
 * @param objectives - Array of learned objectives
 * @param sigma - Standard deviation for mutation (0 = no mutation)
 * @param rng - Seeded random function
 * @returns New array with mutated weights
 */
export function mutateWeights(
  objectives: LearnedObjective[],
  sigma: number,
  rng: () => number
): LearnedObjective[] {
  return objectives.map(obj => {
    let newWeight = obj.weight;

    // Apply Gaussian perturbation
    if (sigma > 0) {
      newWeight = obj.weight + gaussian(rng) * sigma;

      // Occasionally flip sign to explore opposite hypothesis
      if (rng() < SIGN_FLIP_PROBABILITY) {
        newWeight = -newWeight;
      }
    }

    // Clamp to bounds
    newWeight = clamp(newWeight, WEIGHT_MIN, WEIGHT_MAX);

    return {
      ...obj,
      weight: newWeight,
    };
  });
}

/**
 * Crossover two parent objective sets.
 *
 * For features in both parents: randomly pick weight from one
 * For features in only one parent: include with 50% probability
 *
 * @param parent1 - First parent objectives
 * @param parent2 - Second parent objectives
 * @param rng - Seeded random function
 * @returns Child objective set
 */
export function crossoverWeights(
  parent1: LearnedObjective[],
  parent2: LearnedObjective[],
  rng: () => number
): LearnedObjective[] {
  // Build maps for efficient lookup
  const map1 = new Map(parent1.map(o => [o.featureId, o]));
  const map2 = new Map(parent2.map(o => [o.featureId, o]));

  // Get all unique feature IDs
  const allFeatureIds = new Set([...map1.keys(), ...map2.keys()]);

  const child: LearnedObjective[] = [];

  for (const featureId of allFeatureIds) {
    const obj1 = map1.get(featureId);
    const obj2 = map2.get(featureId);

    if (obj1 && obj2) {
      // Feature in both parents: randomly pick one
      const selected = rng() < 0.5 ? obj1 : obj2;
      child.push({ ...selected });
    } else if (obj1) {
      // Only in parent1: include with 50% probability
      if (rng() < 0.5) {
        child.push({ ...obj1 });
      }
    } else if (obj2) {
      // Only in parent2: include with 50% probability
      if (rng() < 0.5) {
        child.push({ ...obj2 });
      }
    }
  }

  return child;
}

/**
 * Select the best individuals from a population based on fitness.
 *
 * @param population - Array of objective sets
 * @param fitnesses - Fitness scores for each individual (same order)
 * @param mu - Number of individuals to select
 * @returns Top mu individuals sorted by fitness (highest first)
 */
export function selectBest(
  population: LearnedObjective[][],
  fitnesses: number[],
  mu: number
): LearnedObjective[][] {
  if (population.length === 0) {
    return [];
  }

  // Pair population with fitnesses
  const paired = population.map((individual, i) => ({
    individual,
    fitness: fitnesses[i],
  }));

  // Sort by fitness descending
  paired.sort((a, b) => b.fitness - a.fitness);

  // Return top mu
  return paired.slice(0, mu).map(p => p.individual);
}

/**
 * Generate offspring from parent population.
 *
 * 80% pure mutation of random parent
 * 20% crossover between two parents + mutation
 *
 * @param parents - Parent objective sets
 * @param lambda - Number of offspring to generate
 * @param sigma - Mutation sigma
 * @param rng - Seeded random function
 * @returns Array of lambda offspring
 */
export function generateOffspring(
  parents: LearnedObjective[][],
  lambda: number,
  sigma: number,
  rng: () => number
): LearnedObjective[][] {
  if (parents.length === 0) {
    return [];
  }

  const offspring: LearnedObjective[][] = [];

  for (let i = 0; i < lambda; i++) {
    let child: LearnedObjective[];

    // Decide: pure mutation or crossover
    if (parents.length > 1 && rng() < CROSSOVER_PROBABILITY) {
      // Crossover: pick two different parents
      const idx1 = Math.floor(rng() * parents.length);
      let idx2 = Math.floor(rng() * parents.length);
      if (idx2 === idx1) {
        idx2 = (idx2 + 1) % parents.length;
      }
      child = crossoverWeights(parents[idx1], parents[idx2], rng);
      // Apply mutation to crossover result
      child = mutateWeights(child, sigma, rng);
    } else {
      // Pure mutation: pick random parent and mutate
      const parentIdx = Math.floor(rng() * parents.length);
      child = mutateWeights(parents[parentIdx], sigma, rng);
    }

    offspring.push(child);
  }

  return offspring;
}
