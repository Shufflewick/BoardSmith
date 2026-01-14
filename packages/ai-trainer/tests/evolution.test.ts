import { describe, it, expect } from 'vitest';
import type { LearnedObjective } from '../src/types';
import {
  mutateWeights,
  crossoverWeights,
  selectBest,
  generateOffspring,
  createSeededRandom,
} from '../src/evolution';

// Helper to create test objectives
function createObjective(featureId: string, weight: number): LearnedObjective {
  return {
    featureId,
    description: `Test feature ${featureId}`,
    weight,
    checkerCode: `() => true`,
    correlation: 0.5,
  };
}

describe('evolution', () => {
  describe('createSeededRandom', () => {
    it('produces deterministic sequence from same seed', () => {
      const rng1 = createSeededRandom('test-seed');
      const rng2 = createSeededRandom('test-seed');

      const seq1 = [rng1(), rng1(), rng1()];
      const seq2 = [rng2(), rng2(), rng2()];

      expect(seq1).toEqual(seq2);
    });

    it('produces different sequences for different seeds', () => {
      const rng1 = createSeededRandom('seed-a');
      const rng2 = createSeededRandom('seed-b');

      const seq1 = [rng1(), rng1(), rng1()];
      const seq2 = [rng2(), rng2(), rng2()];

      expect(seq1).not.toEqual(seq2);
    });

    it('produces values between 0 and 1', () => {
      const rng = createSeededRandom('bounds-test');

      for (let i = 0; i < 100; i++) {
        const val = rng();
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThan(1);
      }
    });
  });

  describe('mutateWeights', () => {
    it('preserves feature IDs', () => {
      const objectives = [
        createObjective('feature-a', 5),
        createObjective('feature-b', -3),
      ];
      const rng = createSeededRandom('mutate-test');

      const mutated = mutateWeights(objectives, 1.0, rng);

      expect(mutated.map(o => o.featureId)).toEqual(['feature-a', 'feature-b']);
    });

    it('changes weights', () => {
      const objectives = [
        createObjective('feature-a', 5),
        createObjective('feature-b', -3),
      ];
      const rng = createSeededRandom('mutate-changes');

      const mutated = mutateWeights(objectives, 1.0, rng);

      // At least one weight should be different
      const original = objectives.map(o => o.weight);
      const changed = mutated.map(o => o.weight);
      expect(changed).not.toEqual(original);
    });

    it('keeps weights within bounds [-20, 20]', () => {
      // Start with extreme weights
      const objectives = [
        createObjective('feature-a', 19),
        createObjective('feature-b', -19),
      ];
      const rng = createSeededRandom('bounds-test');

      // Mutate many times with high sigma
      let current = objectives;
      for (let i = 0; i < 100; i++) {
        current = mutateWeights(current, 5.0, rng);
      }

      for (const obj of current) {
        expect(obj.weight).toBeGreaterThanOrEqual(-20);
        expect(obj.weight).toBeLessThanOrEqual(20);
      }
    });

    it('returns identical weights with sigma=0', () => {
      const objectives = [
        createObjective('feature-a', 5),
        createObjective('feature-b', -3),
      ];
      const rng = createSeededRandom('zero-sigma');

      const mutated = mutateWeights(objectives, 0, rng);

      expect(mutated.map(o => o.weight)).toEqual([5, -3]);
    });

    it('returns new array (immutable)', () => {
      const objectives = [createObjective('feature-a', 5)];
      const rng = createSeededRandom('immutable');

      const mutated = mutateWeights(objectives, 1.0, rng);

      expect(mutated).not.toBe(objectives);
      expect(mutated[0]).not.toBe(objectives[0]);
    });

    it('preserves other objective properties', () => {
      const objectives = [
        createObjective('feature-a', 5),
      ];
      const rng = createSeededRandom('preserve');

      const mutated = mutateWeights(objectives, 1.0, rng);

      expect(mutated[0].description).toBe(objectives[0].description);
      expect(mutated[0].checkerCode).toBe(objectives[0].checkerCode);
      expect(mutated[0].correlation).toBe(objectives[0].correlation);
    });
  });

  describe('crossoverWeights', () => {
    it('combines features from both parents', () => {
      const parent1 = [
        createObjective('feature-a', 5),
        createObjective('feature-b', 3),
      ];
      const parent2 = [
        createObjective('feature-a', -2),
        createObjective('feature-c', 7),
      ];
      const rng = createSeededRandom('crossover');

      const child = crossoverWeights(parent1, parent2, rng);

      // Child should have features from both parents
      const childIds = child.map(o => o.featureId);
      // feature-a is in both, so it should always be present
      expect(childIds).toContain('feature-a');
    });

    it('for shared features, picks weight from one parent', () => {
      const parent1 = [createObjective('shared', 10)];
      const parent2 = [createObjective('shared', -10)];
      const rng = createSeededRandom('shared-feature');

      const child = crossoverWeights(parent1, parent2, rng);

      const sharedFeature = child.find(o => o.featureId === 'shared');
      expect(sharedFeature).toBeDefined();
      // Weight should be from one parent or the other
      expect([10, -10]).toContain(sharedFeature!.weight);
    });

    it('returns new array (immutable)', () => {
      const parent1 = [createObjective('feature-a', 5)];
      const parent2 = [createObjective('feature-a', -5)];
      const rng = createSeededRandom('immutable');

      const child = crossoverWeights(parent1, parent2, rng);

      expect(child).not.toBe(parent1);
      expect(child).not.toBe(parent2);
    });
  });

  describe('selectBest', () => {
    it('returns exactly mu items', () => {
      const population = [
        [createObjective('a', 1)],
        [createObjective('b', 2)],
        [createObjective('c', 3)],
        [createObjective('d', 4)],
        [createObjective('e', 5)],
      ];
      const fitnesses = [0.1, 0.5, 0.3, 0.9, 0.2];

      const selected = selectBest(population, fitnesses, 3);

      expect(selected).toHaveLength(3);
    });

    it('returns items in fitness order (highest first)', () => {
      const population = [
        [createObjective('worst', 1)],
        [createObjective('middle', 2)],
        [createObjective('best', 3)],
      ];
      const fitnesses = [0.1, 0.5, 0.9];

      const selected = selectBest(population, fitnesses, 3);

      expect(selected[0][0].featureId).toBe('best');
      expect(selected[1][0].featureId).toBe('middle');
      expect(selected[2][0].featureId).toBe('worst');
    });

    it('handles mu larger than population', () => {
      const population = [
        [createObjective('a', 1)],
        [createObjective('b', 2)],
      ];
      const fitnesses = [0.5, 0.3];

      const selected = selectBest(population, fitnesses, 5);

      // Should return all available
      expect(selected).toHaveLength(2);
    });

    it('handles empty population', () => {
      const selected = selectBest([], [], 3);

      expect(selected).toHaveLength(0);
    });
  });

  describe('generateOffspring', () => {
    it('returns exactly lambda items', () => {
      const parents = [
        [createObjective('a', 1), createObjective('b', 2)],
        [createObjective('a', 3), createObjective('c', 4)],
      ];
      const rng = createSeededRandom('offspring-count');

      const offspring = generateOffspring(parents, 10, 1.0, rng);

      expect(offspring).toHaveLength(10);
    });

    it('produces mutated versions of parent weights', () => {
      const parents = [
        [createObjective('a', 5)],
      ];
      const rng = createSeededRandom('mutations');

      const offspring = generateOffspring(parents, 5, 1.0, rng);

      // All offspring should have the same feature (from single parent)
      for (const child of offspring) {
        expect(child[0].featureId).toBe('a');
      }

      // At least some weights should differ from parent
      const childWeights = offspring.map(o => o[0].weight);
      const allSame = childWeights.every(w => w === 5);
      expect(allSame).toBe(false);
    });

    it('handles single parent', () => {
      const parents = [
        [createObjective('a', 5)],
      ];
      const rng = createSeededRandom('single-parent');

      const offspring = generateOffspring(parents, 3, 1.0, rng);

      expect(offspring).toHaveLength(3);
    });

    it('produces deterministic results with same seed', () => {
      const parents = [
        [createObjective('a', 5), createObjective('b', 3)],
        [createObjective('a', -5), createObjective('c', 7)],
      ];

      const rng1 = createSeededRandom('determinism');
      const rng2 = createSeededRandom('determinism');

      const offspring1 = generateOffspring(parents, 5, 1.0, rng1);
      const offspring2 = generateOffspring(parents, 5, 1.0, rng2);

      // Should produce identical offspring
      for (let i = 0; i < offspring1.length; i++) {
        const child1Weights = offspring1[i].map(o => o.weight);
        const child2Weights = offspring2[i].map(o => o.weight);
        expect(child1Weights).toEqual(child2Weights);
      }
    });
  });
});
