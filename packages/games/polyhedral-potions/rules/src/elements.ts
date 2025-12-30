import {
  Die,
  DicePool,
  Space,
  Player,
  AbilityManager,
  MonotonicTrack,
  CounterTrack,
} from '@boardsmith/engine';
import type { DieSides, TrackEntry } from '@boardsmith/engine';

// Forward declare for circular reference
import type { PolyPotionsGame } from './game.js';

/**
 * Polyhedral Potions die - extends engine Die with ingredient tracking
 */
export class IngredientDie extends Die<PolyPotionsGame, PolyPotionsPlayer> {
  /** Whether this die has been drafted this round */
  drafted: boolean = false;

  /** Whether this is a D10/D% that can be 0 or 10 */
  get canBeZeroOrTen(): boolean {
    return this.sides === 10 && this.value === 10;
  }
}

/**
 * The shared ingredient shelf - where dice are rolled and drafted from
 */
export class IngredientShelf extends DicePool<PolyPotionsGame, PolyPotionsPlayer> {}

/**
 * Player's drafted dice area - holds the 2 dice they drafted this turn
 */
export class DraftArea extends Space<PolyPotionsGame, PolyPotionsPlayer> {}

/**
 * Ability types that can be earned and used in Polyhedral Potions
 */
export type AbilityType =
  | 'subtract'      // Subtract instead of add
  | 'flip'          // Flip die to opposite side (D4 = any value)
  | 'reroll-2'      // Reroll up to 2 dice
  | 'draft-again'   // Take another full turn
  | 'refresh'       // Reroll all dice on shelf
  | 'adjust';       // +/- 1 or 2 to final value

/**
 * Ingredient track box with optional ability unlock
 */
export interface IngredientBox {
  marked: boolean;
  ability?: AbilityType;
  star?: boolean;
}

/**
 * Ingredient track configuration for each die type
 * Based on PDF rules - abilities at specific positions
 */
export const INGREDIENT_TRACK_CONFIG: Record<string, { boxes: number; abilities: { position: number; type: AbilityType }[]; starAtEnd: boolean }> = {
  d4: { boxes: 5, abilities: [{ position: 3, type: 'subtract' }], starAtEnd: true },
  d6: { boxes: 5, abilities: [{ position: 2, type: 'flip' }, { position: 4, type: 'flip' }], starAtEnd: true },
  d8: { boxes: 5, abilities: [{ position: 0, type: 'reroll-2' }, { position: 1, type: 'reroll-2' }, { position: 2, type: 'reroll-2' }, { position: 3, type: 'reroll-2' }], starAtEnd: true },
  d10: { boxes: 6, abilities: [{ position: 2, type: 'draft-again' }, { position: 4, type: 'draft-again' }], starAtEnd: true },
  d12: { boxes: 6, abilities: [{ position: 3, type: 'refresh' }], starAtEnd: true },
  d20: { boxes: 5, abilities: [{ position: 0, type: 'adjust' }, { position: 1, type: 'adjust' }, { position: 2, type: 'adjust' }], starAtEnd: true },
};

/**
 * Distillation track scoring (Sheet A)
 * Points for each cell [column][row]
 * Based on PDF page 10 - values shown in each box
 */
export const DISTILLATION_POINTS: number[][] = [
  [0, -10, -5, -2],  // Column 1 (5 rows with completion bonuses 15, 25)
  [0, -5, -2, 10],   // Column 2 (4 rows with completion bonus 15)
  [0, -2, 5, 10],    // Column 3 (4 rows with completion bonus 15)
  [0, 2, 5, 10],     // Column 4 (4 rows - connects to poison track)
];

/**
 * Distillation column completion bonuses
 */
export const DISTILLATION_COMPLETION_BONUS: number[] = [25, 15, 15, 10];

/**
 * Number of rows in each distillation column
 */
export const DISTILLATION_ROWS: number[] = [5, 4, 4, 4];

/**
 * Fulminate track scoring (Sheet A)
 * Points shown at each position on the track
 */
export const FULMINATE_POINTS: number[] = [0, 1, 3, 6, 11, 16, 23, 30, 40, 50];

/**
 * Fulminate completion bonus (completing entire track)
 */
export const FULMINATE_COMPLETION_BONUS = 65;

/**
 * Potions chart structure - which potions are in each row
 * Stars are earned for completing rows
 * Based on PDF pages 5, 8-9
 */
export const POTION_ROWS: { potions: number[]; stars: number }[] = [
  { potions: [1, 2, 3], stars: 1 },
  { potions: [4, 5, 6, 7], stars: 1 },
  { potions: [8, 9, 10, 11], stars: 1 },
  { potions: [12, 13, 14, 15], stars: 1 },
  { potions: [16, 17, 18, 19], stars: 1 },
  { potions: [20, 21, 22, 23], stars: 1 },
  { potions: [24, 25, 26], stars: 1 },
  { potions: [27, 28], stars: 1 },
  { potions: [29, 30], stars: 2 },
  { potions: [31, 32], stars: 2 },
];

/**
 * Poison track - 6 skulls, completing all gives 1 star
 */
export const POISON_SKULLS_FOR_STAR = 6;

/**
 * Create distillation track for a column
 */
function createDistillationTrack(columnIndex: number): MonotonicTrack {
  return new MonotonicTrack({
    id: `distill-${columnIndex}`,
    name: `Distillation ${columnIndex + 1}`,
    direction: 'decreasing',
    maxEntries: DISTILLATION_ROWS[columnIndex],
    pointsPerEntry: DISTILLATION_POINTS[columnIndex],
    completionBonus: DISTILLATION_COMPLETION_BONUS[columnIndex],
    allowSpecialEntries: true, // Poison can equal previous value
  });
}

/**
 * Create fulminate track
 */
function createFulminateTrack(): MonotonicTrack {
  return new MonotonicTrack({
    id: 'fulminate',
    name: 'Fulminate',
    direction: 'increasing',
    maxEntries: FULMINATE_POINTS.length,
    pointsPerEntry: FULMINATE_POINTS,
    completionBonus: FULMINATE_COMPLETION_BONUS,
    allowSpecialEntries: true, // Poison can equal previous value
  });
}

/**
 * Create poison track
 */
function createPoisonTrack(): CounterTrack {
  return new CounterTrack({
    id: 'poison',
    name: 'Poison',
    maxEntries: POISON_SKULLS_FOR_STAR,
    pointsPerCount: 2,
    completionBonus: 10, // Star worth 10 points
  });
}

/**
 * Polyhedral Potions player with score sheet tracking
 *
 * Uses the engine's AbilityManager and Track systems for reusable patterns.
 */
export class PolyPotionsPlayer extends Player {
  /**
   * Ingredient tracks - one for each die type
   * Tracks how many times each ingredient has been drafted
   */
  ingredientTracks: Record<string, IngredientBox[]> = {};

  /**
   * Potions crafted (1-32, marked true when crafted)
   */
  potionsCrafted: boolean[] = new Array(32).fill(false);

  /**
   * Poison track - uses CounterTrack from engine
   */
  poisonTrack: CounterTrack;

  /**
   * Distillation tracks - 4 columns using MonotonicTrack
   */
  distillationTracks: MonotonicTrack[];

  /**
   * Fulminate track - uses MonotonicTrack
   */
  fulminateTrack: MonotonicTrack;

  /**
   * Abilities - uses AbilityManager from engine
   */
  abilityManager: AbilityManager<AbilityType>;

  /**
   * Stars earned (10 points each, from completing rows)
   */
  stars: number = 0;

  /**
   * Stars from ingredient tracks
   */
  ingredientStars: number = 0;

  /**
   * Stars from potion rows
   */
  potionStars: number = 0;

  /**
   * Whether the poison star has been earned
   */
  poisonStarEarned: boolean = false;

  /**
   * Whether this player crafted a poison this turn (allows duplicate values)
   */
  craftedPoisonThisTurn: boolean = false;

  constructor(position: number, name: string) {
    super(position, name);

    // Initialize ability manager with starting reroll ability
    this.abilityManager = new AbilityManager<AbilityType>();
    this.abilityManager.add('reroll-2', 'starting');

    // Initialize scoring tracks using engine abstractions
    this.distillationTracks = [
      createDistillationTrack(0),
      createDistillationTrack(1),
      createDistillationTrack(2),
      createDistillationTrack(3),
    ];
    this.fulminateTrack = createFulminateTrack();
    this.poisonTrack = createPoisonTrack();

    // Initialize ingredient tracks (game-specific unlock system)
    for (const [dieType, config] of Object.entries(INGREDIENT_TRACK_CONFIG)) {
      this.ingredientTracks[dieType] = [];
      for (let i = 0; i < config.boxes; i++) {
        const box: IngredientBox = { marked: false };
        const abilityConfig = config.abilities.find(a => a.position === i);
        if (abilityConfig) {
          box.ability = abilityConfig.type;
        }
        if (i === config.boxes - 1 && config.starAtEnd) {
          box.star = true;
        }
        this.ingredientTracks[dieType].push(box);
      }
    }
  }

  /**
   * Current score calculation based on PDF rules
   */
  get score(): number {
    let total = 0;

    // Distillation points from tracks
    for (const track of this.distillationTracks) {
      total += track.calculatePoints();
    }

    // Fulminate points from track
    total += this.fulminateTrack.calculatePoints();

    // Poison points from track
    total += this.poisonTrack.calculatePoints();

    // Stars (10 points each) - note: poison track completion bonus already included
    // So we only add stars not from poison here
    total += (this.stars - (this.poisonStarEarned ? 1 : 0)) * 10;

    return total;
  }

  // ============================================
  // Ability methods (delegating to AbilityManager)
  // ============================================

  /**
   * Get abilities for serialization (backwards compatible)
   */
  get abilities() {
    return this.abilityManager.toJSON();
  }

  /**
   * Check if player has an unused ability of a given type
   */
  hasAbility(type: AbilityType): boolean {
    return this.abilityManager.hasUnused(type);
  }

  /**
   * Count unused abilities of a given type
   */
  countAbility(type: AbilityType): number {
    return this.abilityManager.countUnused(type);
  }

  /**
   * Use an ability (marks it as used)
   */
  useAbility(type: AbilityType): boolean {
    return this.abilityManager.use(type);
  }

  // ============================================
  // Track methods (delegating to Track classes)
  // ============================================

  /**
   * Get distillations for serialization (backwards compatible)
   */
  get distillations(): TrackEntry[][] {
    return this.distillationTracks.map(track =>
      track.getEntries().map(e => ({ value: e.value, points: e.points }))
    );
  }

  /**
   * Get fulminates for serialization (backwards compatible)
   */
  get fulminates(): TrackEntry[] {
    return this.fulminateTrack.getEntries().map(e => ({ value: e.value, points: e.points }));
  }

  /**
   * Get poison skulls count for serialization (backwards compatible)
   */
  get poisonSkulls(): number {
    return this.poisonTrack.count;
  }

  /**
   * Check if a value can be added to a distillation column
   */
  canAddToDistillation(columnIndex: number, value: number, isPoison: boolean = false): boolean {
    if (columnIndex < 0 || columnIndex >= 4) return false;
    return this.distillationTracks[columnIndex].canAdd(value, isPoison);
  }

  /**
   * Add a value to distillation track
   */
  addDistillation(columnIndex: number, value: number): number {
    return this.distillationTracks[columnIndex].add(value);
  }

  /**
   * Check if a value can be added to fulminate track
   */
  canAddToFulminate(value: number, isPoison: boolean = false): boolean {
    return this.fulminateTrack.canAdd(value, isPoison);
  }

  /**
   * Add a value to fulminate track
   */
  addFulminate(value: number): number {
    return this.fulminateTrack.add(value);
  }

  /**
   * Add a poison skull and check for star
   */
  addPoisonSkull(): boolean {
    this.craftedPoisonThisTurn = true;
    this.poisonTrack.increment();

    // Check for poison star (completing all 6)
    if (this.poisonTrack.isComplete() && !this.poisonStarEarned) {
      this.poisonStarEarned = true;
      this.stars++;
      return true;
    }
    return false;
  }

  // ============================================
  // Ingredient tracking (game-specific)
  // ============================================

  /**
   * Mark an ingredient as used and check for ability unlocks
   */
  useIngredient(dieType: string): AbilityType | null {
    const key = dieType.toLowerCase();
    const track = this.ingredientTracks[key];
    if (!track) return null;

    // Find the first unmarked box
    const boxIndex = track.findIndex(b => !b.marked);
    if (boxIndex === -1) return null;

    const box = track[boxIndex];
    box.marked = true;

    // Check for star (completing ingredient row)
    if (box.star) {
      this.ingredientStars++;
      this.stars++;
    }

    // Check for ability unlock
    if (box.ability) {
      this.abilityManager.add(box.ability, `${dieType}-track`);
      return box.ability;
    }

    return null;
  }

  /**
   * Get how many boxes are marked in an ingredient track
   */
  getIngredientCount(dieType: string): number {
    const key = dieType.toLowerCase();
    const track = this.ingredientTracks[key];
    if (!track) return 0;
    return track.filter(b => b.marked).length;
  }

  /**
   * Check if ingredient track is complete
   */
  isIngredientComplete(dieType: string): boolean {
    const key = dieType.toLowerCase();
    const track = this.ingredientTracks[key];
    if (!track) return false;
    return track.every(b => b.marked);
  }

  // ============================================
  // Potion crafting (game-specific row system)
  // ============================================

  /**
   * Check if a potion value can be crafted
   */
  canCraftPotion(value: number): boolean {
    if (value < 1 || value > 32) return false;
    return !this.potionsCrafted[value - 1];
  }

  /**
   * Mark a potion as crafted and check for row completion stars
   */
  craftPotion(value: number): number {
    if (value < 1 || value > 32) return 0;

    this.potionsCrafted[value - 1] = true;

    // Check if any row is now complete
    let starsEarned = 0;
    for (const row of POTION_ROWS) {
      const isComplete = row.potions.every(p => this.potionsCrafted[p - 1]);
      if (isComplete) {
        const rowStars = row.stars;
        const alreadyCounted = this.countPotionRowStarsFor(row);
        if (alreadyCounted < rowStars) {
          starsEarned = rowStars - alreadyCounted;
          this.potionStars += starsEarned;
          this.stars += starsEarned;
        }
      }
    }

    return starsEarned;
  }

  /**
   * Helper to count stars already awarded for a potion row
   */
  private countPotionRowStarsFor(row: { potions: number[]; stars: number }): number {
    let totalPotionStars = 0;
    for (const r of POTION_ROWS) {
      if (r === row) break;
      if (r.potions.every(p => this.potionsCrafted[p - 1])) {
        totalPotionStars += r.stars;
      }
    }
    return this.potionStars - totalPotionStars > 0 ? row.stars : 0;
  }

  // ============================================
  // Turn state
  // ============================================

  /**
   * Reset turn state
   */
  resetTurnState(): void {
    this.craftedPoisonThisTurn = false;
  }

  // ============================================
  // Serialization
  // ============================================

  /**
   * Serialize player to JSON for the game view
   */
  override toJSON(): Record<string, unknown> {
    return {
      // Base player properties
      position: this.position,
      name: this.name,
      color: this.color,
      // Computed properties
      score: this.score,
      stars: this.stars,
      ingredientStars: this.ingredientStars,
      potionStars: this.potionStars,
      // Ability manager data (backwards compatible format)
      abilities: this.abilities,
      // Track data (backwards compatible format)
      ingredientTracks: this.ingredientTracks,
      potionsCrafted: this.potionsCrafted,
      poisonSkulls: this.poisonSkulls,
      poisonStarEarned: this.poisonStarEarned,
      distillations: this.distillations,
      fulminates: this.fulminates,
    };
  }
}
