/**
 * Player abilities (earned powers) as plain data.
 *
 * A Player holds its abilities as a plain `Ability<T>[]` field and these
 * functions act on it, so the list survives every snapshot, undo and bot clone
 * as ordinary data.
 *
 * @example
 * ```typescript
 * type GameAbility = 'reroll' | 'bonus';
 *
 * class MyPlayer extends Player {
 *   abilities: Ability<GameAbility>[] = [];
 * }
 *
 * addAbility(player.abilities, 'reroll');
 * if (hasUnusedAbility(player.abilities, 'reroll')) spendAbility(player.abilities, 'reroll');
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

/** Give the player a new, unused ability of `type`, noting `earnedFrom` when given. */
export function addAbility<T extends string>(abilities: Ability<T>[], type: T, earnedFrom?: string): void {
  abilities.push(earnedFrom === undefined ? { type, used: false } : { type, used: false, earnedFrom });
}

/** Whether any ability of `type` is still unused. */
export function hasUnusedAbility<T extends string>(abilities: readonly Ability<T>[], type: T): boolean {
  return abilities.some((a) => a.type === type && !a.used);
}

/** Mark one unused ability of `type` used. Returns false, changing nothing, when there is none. */
export function spendAbility<T extends string>(abilities: Ability<T>[], type: T): boolean {
  const ability = abilities.find((a) => a.type === type && !a.used);
  if (!ability) return false;
  ability.used = true;
  return true;
}

/** How many abilities of `type` are unused, or of every type when `type` is omitted. */
export function countUnusedAbilities<T extends string>(abilities: readonly Ability<T>[], type?: T): number {
  return abilities.filter((a) => !a.used && (type === undefined || a.type === type)).length;
}

/** Each ability type the player has, in first-earned order, with how many in total and how many unused. */
export function groupAbilities<T extends string>(
  abilities: readonly Ability<T>[],
): Array<{ type: T; total: number; unused: number }> {
  const grouped = new Map<T, { type: T; total: number; unused: number }>();
  for (const a of abilities) {
    const group = grouped.get(a.type) ?? { type: a.type, total: 0, unused: 0 };
    group.total++;
    if (!a.used) group.unused++;
    grouped.set(a.type, group);
  }
  return [...grouped.values()];
}
