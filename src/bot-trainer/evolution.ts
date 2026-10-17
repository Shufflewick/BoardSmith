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

import type { ObjectiveWeight } from './types.js';

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
  objectives: ObjectiveWeight[],
  sigma: number,
  rng: () => number
): ObjectiveWeight[] {
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

    return {
      ...obj,
      weight: newWeight,
    };
  });
}

/**
 * Crossover two parent objective sets: each objective's weight comes from one
 * parent at random. Both parents must hold the same ids, as every set descended
 * from one objective set does (mutation keeps every id); other parents throw.
 *
 * @param parent1 - First parent objectives
 * @param parent2 - Second parent objectives, with the same ids as parent1
 * @param rng - Seeded random function
 * @returns Child objective set
 */
export function crossoverWeights(
  parent1: ObjectiveWeight[],
  parent2: ObjectiveWeight[],
  rng: () => number
): ObjectiveWeight[] {
  const byId = new Map(parent2.map(o => [o.id, o]));
  const ids1 = new Set(parent1.map(o => o.id));
  const unmatched = [
    ...parent1.filter(o => !byId.has(o.id)),
    ...parent2.filter(o => !ids1.has(o.id)),
  ].map(o => o.id);
  if (unmatched.length > 0) {
    throw new Error(
      `Cannot cross over two objective sets that hold different objectives. Only one parent has: ${unmatched.join(', ')}. `
      + 'Both parents must descend from the same objective set.',
    );
  }
  return parent1.map(o => ({ ...(rng() < 0.5 ? o : byId.get(o.id)!) }));
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
  population: ObjectiveWeight[][],
  fitnesses: number[],
  mu: number
): ObjectiveWeight[][] {
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
  parents: ObjectiveWeight[][],
  lambda: number,
  sigma: number,
  rng: () => number
): ObjectiveWeight[][] {
  if (parents.length === 0) {
    return [];
  }

  const offspring: ObjectiveWeight[][] = [];

  for (let i = 0; i < lambda; i++) {
    let child: ObjectiveWeight[];

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
