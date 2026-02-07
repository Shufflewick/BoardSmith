import { Space } from './space.js';
import { Die, type DieSides } from './die.js';
import { ElementCollection } from './element-collection.js';
import type { ElementContext } from './types.js';
import type { Player } from '../player/player.js';
import type { Game } from './game.js';

/**
 * DicePool - A container for dice that can be rolled together
 *
 * DicePool is a space that:
 * - Contains multiple dice
 * - Supports rolling all dice at once
 * - Can filter dice by type (d6, d20, etc.)
 * - Lays out dice in a row by default
 *
 * Examples: dice tray, ingredient shelf, roll area
 *
 * Usage:
 * ```ts
 * const pool = game.create(DicePool, 'dice-tray');
 * pool.create(Die, 'd6', { sides: 6 });
 * pool.create(Die, 'd20', { sides: 20 });
 * pool.rollAll(); // Rolls all dice in the pool
 * ```
 */
export class DicePool<G extends Game = any, P extends Player = any> extends Space<G, P> {
  /**
   * System property to identify this element type for AutoUI
   * $ prefix indicates this is a system property
   */
  $type!: 'dice-pool';

  constructor(ctx: Partial<ElementContext>) {
    super(ctx);
    // Explicitly set as instance property for serialization
    this.$type = 'dice-pool';

    // Default layout: horizontal row with gap
    this.$direction = 'horizontal';
    this.$gap = '12px';
    this.$align = 'center';
  }

  /**
   * Get all dice in the pool
   */
  getDice(): ElementCollection<Die> {
    return this.all(Die);
  }

  /**
   * Get dice of a specific type (number of sides)
   */
  getDiceByType(sides: DieSides): Die[] {
    return this.getDice().filter(d => d.sides === sides);
  }

  /**
   * Roll all dice in the pool
   * @returns Array of [die, value] tuples
   */
  rollAll(): Array<[Die, number]> {
    const results: Array<[Die, number]> = [];
    for (const die of this.getDice()) {
      const value = die.roll();
      results.push([die, value]);
    }
    return results;
  }

  /**
   * Roll specific dice by their names
   * @param names - Names of dice to roll
   * @returns Array of [die, value] tuples
   */
  rollByName(...names: string[]): Array<[Die, number]> {
    const results: Array<[Die, number]> = [];
    for (const name of names) {
      const die = this.first(Die, { name }) as Die | undefined;
      if (die) {
        const value = die.roll();
        results.push([die, value]);
      }
    }
    return results;
  }

  /**
   * Roll dice of a specific type
   * @param sides - Number of sides (4, 6, 8, 10, 12, 20)
   * @returns Array of [die, value] tuples
   */
  rollByType(sides: DieSides): Array<[Die, number]> {
    const results: Array<[Die, number]> = [];
    for (const die of this.getDiceByType(sides)) {
      const value = die.roll();
      results.push([die, value]);
    }
    return results;
  }

  /**
   * Get the sum of all dice values
   */
  getTotal(): number {
    return this.getDice().reduce((sum, die) => sum + die.value, 0);
  }

  /**
   * Get all current dice values
   */
  getValues(): number[] {
    return this.getDice().map(d => d.value);
  }

  /**
   * Check if any die shows a specific value
   */
  hasValue(value: number): boolean {
    return this.getDice().some(d => d.value === value);
  }

  /**
   * Count how many dice show a specific value
   */
  countValue(value: number): number {
    return this.getDice().filter(d => d.value === value).length;
  }
}
