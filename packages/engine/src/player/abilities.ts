/**
 * Ability System - Generic player ability/power-up management
 *
 * Provides a reusable system for games where players earn and use
 * special abilities. Common in dice games, roll-and-write games,
 * and games with unlockable powers.
 *
 * @example
 * ```typescript
 * // Define ability types for your game
 * type MyAbilityType = 'reroll' | 'bonus' | 'skip';
 *
 * // Create ability manager for a player
 * const abilities = new AbilityManager<MyAbilityType>();
 *
 * // Add abilities when earned
 * abilities.add('reroll');
 * abilities.add('reroll'); // Player now has 2 reroll abilities
 *
 * // Check and use abilities
 * if (abilities.hasUnused('reroll')) {
 *   abilities.use('reroll');
 * }
 * ```
 */

/**
 * A single ability instance
 */
export interface Ability<T extends string = string> {
  /** The ability type identifier */
  type: T;
  /** Whether this ability has been used */
  used: boolean;
  /** Optional metadata about how/when the ability was earned */
  earnedFrom?: string;
}

/**
 * Configuration for ability display in UI
 */
export interface AbilityDisplayInfo {
  /** Icon (emoji or icon name) */
  icon: string;
  /** Human-readable label */
  label: string;
  /** Color for styling */
  color?: string;
  /** Description of what the ability does */
  description?: string;
}

/**
 * Manages a collection of abilities for a player
 *
 * @typeParam T - The ability type string literal union for type safety
 *
 * @example
 * ```typescript
 * // Type-safe ability types
 * type GameAbility = 'reroll-2' | 'flip' | 'refresh' | 'adjust';
 *
 * class MyPlayer extends Player {
 *   abilities = new AbilityManager<GameAbility>();
 * }
 *
 * // Usage
 * player.abilities.add('reroll-2');
 * player.abilities.hasUnused('reroll-2'); // true
 * player.abilities.use('reroll-2');
 * player.abilities.hasUnused('reroll-2'); // false
 * ```
 */
export class AbilityManager<T extends string = string> {
  private abilities: Ability<T>[] = [];

  /**
   * Add a new ability
   * @param type - The ability type
   * @param earnedFrom - Optional description of how it was earned
   */
  add(type: T, earnedFrom?: string): void {
    this.abilities.push({ type, used: false, earnedFrom });
  }

  /**
   * Check if the player has any unused ability of the given type
   */
  hasUnused(type: T): boolean {
    return this.abilities.some(a => a.type === type && !a.used);
  }

  /**
   * Check if the player has any ability of the given type (used or unused)
   */
  has(type: T): boolean {
    return this.abilities.some(a => a.type === type);
  }

  /**
   * Count unused abilities of a given type
   */
  countUnused(type: T): number {
    return this.abilities.filter(a => a.type === type && !a.used).length;
  }

  /**
   * Count total abilities of a given type
   */
  count(type: T): number {
    return this.abilities.filter(a => a.type === type).length;
  }

  /**
   * Count all unused abilities
   */
  countAllUnused(): number {
    return this.abilities.filter(a => !a.used).length;
  }

  /**
   * Use an ability (marks one unused ability of the type as used)
   * @returns true if an ability was used, false if none available
   */
  use(type: T): boolean {
    const ability = this.abilities.find(a => a.type === type && !a.used);
    if (ability) {
      ability.used = true;
      return true;
    }
    return false;
  }

  /**
   * Get all abilities
   */
  getAll(): readonly Ability<T>[] {
    return this.abilities;
  }

  /**
   * Get all unused abilities
   */
  getUnused(): Ability<T>[] {
    return this.abilities.filter(a => !a.used);
  }

  /**
   * Get all used abilities
   */
  getUsed(): Ability<T>[] {
    return this.abilities.filter(a => a.used);
  }

  /**
   * Get unique ability types the player has (for display)
   */
  getTypes(): T[] {
    return [...new Set(this.abilities.map(a => a.type))];
  }

  /**
   * Get abilities grouped by type with counts
   */
  getGrouped(): Array<{ type: T; total: number; unused: number }> {
    const grouped = new Map<T, { total: number; unused: number }>();

    for (const ability of this.abilities) {
      const current = grouped.get(ability.type) ?? { total: 0, unused: 0 };
      current.total++;
      if (!ability.used) {
        current.unused++;
      }
      grouped.set(ability.type, current);
    }

    return Array.from(grouped.entries()).map(([type, counts]) => ({
      type,
      ...counts,
    }));
  }

  /**
   * Reset all abilities to unused state (for new game/round)
   */
  resetAll(): void {
    for (const ability of this.abilities) {
      ability.used = false;
    }
  }

  /**
   * Clear all abilities
   */
  clear(): void {
    this.abilities = [];
  }

  /**
   * Serialize for saving/transmission
   */
  toJSON(): Ability<T>[] {
    return this.abilities.map(a => ({ ...a }));
  }

  /**
   * Restore from serialized data
   */
  fromJSON(data: Ability<T>[]): void {
    this.abilities = data.map(a => ({ ...a }));
  }

  /**
   * Create a new AbilityManager from serialized data
   */
  static fromJSON<T extends string>(data: Ability<T>[]): AbilityManager<T> {
    const manager = new AbilityManager<T>();
    manager.fromJSON(data);
    return manager;
  }
}

/**
 * Helper to create ability display info map
 *
 * @example
 * ```typescript
 * const ABILITY_INFO = createAbilityDisplayMap({
 *   'reroll-2': { icon: '🎲', label: 'Reroll 2', color: '#2196F3' },
 *   'flip': { icon: '↻', label: 'Flip', color: '#9C27B0' },
 * });
 * ```
 */
export function createAbilityDisplayMap<T extends string>(
  info: Record<T, AbilityDisplayInfo>
): Map<T, AbilityDisplayInfo> {
  return new Map(Object.entries(info) as [T, AbilityDisplayInfo][]);
}
