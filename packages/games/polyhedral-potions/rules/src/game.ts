import { Game, Player, type GameOptions, type DieSides } from '@boardsmith/engine';
import {
  IngredientDie,
  IngredientShelf,
  DraftArea,
  PolyPotionsPlayer,
  type AbilityType,
  DISTILLATION_POINTS,
  FULMINATE_POINTS,
} from './elements.js';
import {
  createDraftAction,
  createCraftAction,
  createRecordAction,
  createUseRerollAction,
  createUseFlipAction,
  createUseRefreshAction,
} from './actions.js';
import { createPolyPotionsFlow } from './flow.js';

/**
 * Polyhedral Potions game options
 */
export interface PolyPotionsOptions extends GameOptions {
  /** Random seed for deterministic gameplay */
  seed?: string;
}

/**
 * Die configuration with colors
 * Based on PDF - 7 dice: D4, D6, D8, D10, D% (D10), D12, D20
 */
const DIE_CONFIG: Array<{ name: string; sides: DieSides; color: string; dieType: string }> = [
  { name: 'd4', sides: 4, color: '#4CAF50', dieType: 'd4' },    // Green
  { name: 'd6', sides: 6, color: '#9C27B0', dieType: 'd6' },    // Purple
  { name: 'd8', sides: 8, color: '#2196F3', dieType: 'd8' },    // Blue
  { name: 'd10', sides: 10, color: '#FF9800', dieType: 'd10' },  // Orange
  { name: 'd10%', sides: 10, color: '#FF5722', dieType: 'd10' }, // Deep Orange (percentile, counts as d10)
  { name: 'd12', sides: 12, color: '#E91E63', dieType: 'd12' },  // Pink
  { name: 'd20', sides: 20, color: '#F44336', dieType: 'd20' },  // Red
];

/**
 * Polyhedral Potions - A dice-drafting roll & write game
 *
 * Based on the official rules by George Jaros (GJJ Games)
 *
 * Rules summary:
 * - 7 polyhedral dice on a shared "ingredient shelf"
 * - Each turn: draft 2 dice, combine values to craft potions
 * - Track ingredients used (unlocks abilities), potions crafted, distillations, fulminates
 * - D10 can be 0 or 10 when showing 10/0
 * - Poisons allow repeating values in tracks
 * - Earn abilities by drafting certain dice
 * - Game ends when any player gets 3 stars
 * - Highest score wins (tiebreaker: most stars, then most unused abilities)
 */
export class PolyPotionsGame extends Game<PolyPotionsGame, PolyPotionsPlayer> {
  // Use custom player class
  static PlayerClass = PolyPotionsPlayer;
  /** The shared ingredient shelf with 7 dice */
  shelf!: IngredientShelf;

  /** Current round number */
  round: number = 1;

  // ---- HMR-safe state (stored in settings) ----

  /** Dice drafted this turn (for tracking) - stores IDs, resolves to elements */
  get draftedDice(): IngredientDie[] {
    const ids = (this.settings._draftedDiceIds as number[]) ?? [];
    return ids.map(id => this.getElementById(id) as IngredientDie).filter(Boolean);
  }
  set draftedDice(value: IngredientDie[]) {
    this.settings._draftedDiceIds = value.map(die => die._t.id);
  }

  /** The effective values of drafted dice (may differ due to D10 0/10 choice or flip) */
  get draftedValues(): number[] {
    return (this.settings._draftedValues as number[]) ?? [];
  }
  set draftedValues(value: number[]) {
    this.settings._draftedValues = value;
  }

  /** The crafted potion/poison value this turn */
  craftedValue: number = 0;

  /** Whether a poison was crafted this turn (vs potion) */
  craftedPoison: boolean = false;

  /** Current player position for display functions (1-indexed) */
  currentPlayerIndex: number = 1;

  /** Whether game end has been triggered */
  gameEndTriggered: boolean = false;

  constructor(options: PolyPotionsOptions) {
    super(options);

    // Register element classes
    this.registerElements([IngredientDie, IngredientShelf, DraftArea]);

    // Create the shared ingredient shelf
    this.shelf = this.create(IngredientShelf, 'ingredient-shelf');
    this.shelf.$direction = 'horizontal';
    this.shelf.$gap = '16px';
    this.shelf.$align = 'center';

    // Create the 7 polyhedral dice
    for (const config of DIE_CONFIG) {
      const die = this.shelf.create(IngredientDie, config.name, {
        sides: config.sides,
        color: config.color,
      });
      // Store the die type for ingredient tracking
      (die as any).dieType = config.dieType;
    }

    // Roll all dice with animation
    this.rollAllDice();

    // Create draft areas for each player
    for (const player of this.all(Player) as unknown as PolyPotionsPlayer[]) {
      const draftArea = this.create(DraftArea, `draft-${player.position}`);
      draftArea.player = player;
      draftArea.$direction = 'horizontal';
      draftArea.$gap = '12px';
    }

    // Register actions
    this.registerAction(createDraftAction(this));
    this.registerAction(createCraftAction(this));
    this.registerAction(createRecordAction(this));

    // Register ability actions
    this.registerAction(createUseRerollAction(this));
    this.registerAction(createUseFlipAction(this));
    this.registerAction(createUseRefreshAction(this));

    // Set up the game flow
    this.setFlow(createPolyPotionsFlow());
  }

  /**
   * Get a player's draft area
   */
  getPlayerDraftArea(player: PolyPotionsPlayer): DraftArea {
    return this.first(DraftArea, `draft-${player.position}`)!;
  }

  /**
   * Get all undrafted dice on the shelf
   */
  getAvailableDice(): IngredientDie[] {
    return this.shelf.getDice().filter(d => !(d as IngredientDie).drafted) as IngredientDie[];
  }

  /**
   * Get the die type for ingredient tracking (both d10 and d10% count as d10)
   */
  getDieType(die: IngredientDie): string {
    return (die as any).dieType || `d${die.sides}`;
  }

  /**
   * Draft a die (move to player's draft area, mark as drafted)
   * Returns any ability unlocked by drafting this ingredient
   */
  draftDie(player: PolyPotionsPlayer, die: IngredientDie, effectiveValue?: number): AbilityType | null {
    die.drafted = true;
    this.draftedDice = [...this.draftedDice, die];

    // Move the die to the player's draft area
    const draftArea = this.getPlayerDraftArea(player);
    if (draftArea) {
      die.putInto(draftArea);
    }

    // Use effective value if provided (for D10 0/10 choice), otherwise use die value
    const value = effectiveValue ?? die.value;
    this.draftedValues = [...this.draftedValues, value];

    // Track ingredient usage and check for ability unlock
    const dieType = this.getDieType(die);
    const unlockedAbility = player.useIngredient(dieType);

    if (unlockedAbility) {
      this.message(`${player.name} drafted ${die.name} showing ${value} and unlocked ${unlockedAbility}!`);
    } else {
      this.message(`${player.name} drafted ${die.name} showing ${value}`);
    }

    return unlockedAbility;
  }

  /**
   * Craft a potion or poison from the drafted dice
   * Returns the crafted value
   */
  craftPotion(
    player: PolyPotionsPlayer,
    useSubtract: boolean = false,
    adjustment: number = 0
  ): { value: number; isPoison: boolean; starsEarned: number } {
    if (this.draftedValues.length !== 2) {
      throw new Error('Must have exactly 2 drafted dice to craft');
    }

    const [val1, val2] = this.draftedValues;
    let value: number;

    if (useSubtract) {
      // Subtract: larger - smaller
      value = Math.abs(val1 - val2);
    } else {
      value = val1 + val2;
    }

    // Apply adjustment (+/- 1 or 2)
    value += adjustment;

    // Clamp to valid range for display purposes
    value = Math.max(0, value);

    this.craftedValue = value;

    // Check if potion can be crafted
    let isPoison = false;
    let starsEarned = 0;

    if (player.canCraftPotion(value)) {
      starsEarned = player.craftPotion(value);
      this.message(`${player.name} crafted potion #${value}!`);
      if (starsEarned > 0) {
        this.message(`${player.name} earned ${starsEarned} star(s) for completing a potion row!`);
      }
    } else {
      // Poison skull instead
      isPoison = true;
      const gotStar = player.addPoisonSkull();
      this.craftedPoison = true;
      if (gotStar) {
        starsEarned = 1;
        this.message(`${player.name} got a poison skull and earned a star for completing all poisons!`);
      } else {
        this.message(`${player.name} got a poison skull (potion #${value} already crafted or out of range)`);
      }
    }

    // Check if game end is triggered
    if (player.stars >= 3 && !this.gameEndTriggered) {
      this.gameEndTriggered = true;
      this.message(`${player.name} has 3 stars! Game will end after this round.`);
    }

    return { value, isPoison, starsEarned };
  }

  /**
   * Record the crafted value to distillation or fulminate track
   */
  recordValue(
    player: PolyPotionsPlayer,
    track: 'distillation' | 'fulminate',
    columnIndex?: number
  ): number {
    const value = this.craftedValue;
    const isPoison = this.craftedPoison;
    let points = 0;

    if (track === 'distillation' && columnIndex !== undefined) {
      points = player.addDistillation(columnIndex, value);
      this.message(`${player.name} added ${value} to distillation column ${columnIndex + 1} (+${points} points)`);
    } else if (track === 'fulminate') {
      points = player.addFulminate(value);
      this.message(`${player.name} added ${value} to fulminate track (+${points} points)`);
    }

    return points;
  }

  /**
   * Get points for distillation based on column and row
   */
  getDistillationPoints(column: number, row: number): number {
    return DISTILLATION_POINTS[column]?.[row] ?? 0;
  }

  /**
   * Get points for fulminate based on position
   */
  getFulminatePoints(position: number): number {
    return FULMINATE_POINTS[Math.min(position, FULMINATE_POINTS.length - 1)];
  }

  /**
   * Reset for next round - reroll all dice, clear draft state
   */
  startNewRound(): void {
    // Move any drafted dice back to the shelf first
    for (const die of this.draftedDice) {
      die.drafted = false;
      die.putInto(this.shelf);
    }

    // Also check all draft areas and move dice back
    for (const player of this.all(Player)) {
      const draftArea = this.getPlayerDraftArea(player as PolyPotionsPlayer);
      if (draftArea) {
        for (const die of draftArea.all(IngredientDie)) {
          die.drafted = false;
          die.putInto(this.shelf);
        }
      }
    }

    // Reset drafted state and reroll all dice with animation
    this.rollAllDice();

    // Clear drafted dice tracking
    this.draftedDice = [];
    this.draftedValues = [];
    this.craftedValue = 0;
    this.craftedPoison = false;

    this.round++;
    this.message(`Round ${this.round} begins!`);
  }

  /**
   * Roll all dice on the shelf.
   * Each roll increments the die's rollCount which triggers UI animation.
   */
  rollAllDice(): void {
    for (const die of this.shelf.getDice()) {
      const ingredientDie = die as IngredientDie;
      ingredientDie.drafted = false;
      ingredientDie.roll();
    }
  }

  /**
   * Clear player's turn state (after they complete their turn)
   */
  clearTurnState(player: PolyPotionsPlayer): void {
    // Move drafted dice back to the shelf
    for (const die of this.draftedDice) {
      die.drafted = false;
      die.putInto(this.shelf);
    }

    this.draftedDice = [];
    this.draftedValues = [];
    this.craftedValue = 0;
    this.craftedPoison = false;
    player.resetTurnState();
  }

  /**
   * Reroll specific dice (for reroll-2 ability).
   * Each roll increments the die's rollCount which triggers UI animation.
   */
  rerollDice(dice: IngredientDie[]): void {
    for (const die of dice) {
      die.roll();
    }
    this.message(`Rerolled ${dice.length} dice`);
  }

  /**
   * Refresh the entire shelf (for refresh ability).
   * Each roll increments the die's rollCount which triggers UI animation.
   */
  refreshShelf(keepDie?: IngredientDie): void {
    for (const die of this.shelf.getDice()) {
      if (die !== keepDie) {
        const ingredientDie = die as IngredientDie;
        ingredientDie.drafted = false;
        ingredientDie.roll();
      }
    }
    this.message('Refreshed the ingredient shelf');
  }

  /**
   * Flip a die to its opposite side (for flip ability)
   * D4 can be set to any value (1-4)
   */
  flipDie(die: IngredientDie, newValue?: number): void {
    if (die.sides === 4 && newValue !== undefined) {
      // D4 can be any value
      die.value = Math.max(1, Math.min(4, newValue));
    } else {
      // Other dice flip to opposite: n becomes (sides + 1 - n)
      die.value = die.sides + 1 - die.value;
    }
    this.message(`Flipped ${die.name} to ${die.value}`);
  }

  /**
   * Check if the game is complete (any player has 3 stars and round is complete)
   */
  override isFinished(): boolean {
    return this.gameEndTriggered;
  }

  /**
   * Get the winners (player(s) with highest score)
   * Tiebreaker: most stars, then most unused abilities
   */
  override getWinners(): PolyPotionsPlayer[] {
    if (!this.isFinished()) return [];

    let maxScore = -1;
    let winners: PolyPotionsPlayer[] = [];

    for (const player of this.all(Player)) {
      const p = player as PolyPotionsPlayer;
      if (p.score > maxScore) {
        maxScore = p.score;
        winners = [p];
      } else if (p.score === maxScore) {
        winners.push(p);
      }
    }

    // Tiebreaker 1: most stars
    if (winners.length > 1) {
      const maxStars = Math.max(...winners.map(p => p.stars));
      winners = winners.filter(p => p.stars === maxStars);
    }

    // Tiebreaker 2: most unused abilities
    if (winners.length > 1) {
      const countUnused = (p: PolyPotionsPlayer) =>
        p.abilities.filter(a => !a.used).length;
      const maxUnused = Math.max(...winners.map(countUnused));
      winners = winners.filter(p => countUnused(p) === maxUnused);
    }

    return winners;
  }
}
