import { Piece } from './piece.js';
import type { ElementContext } from './types.js';
import type { Player } from '../player/player.js';
import type { Game } from './game.js';

/**
 * Valid polyhedral die types
 */
export type DieSides = 4 | 6 | 8 | 10 | 12 | 20;

/**
 * Die - A polyhedral die game piece
 *
 * Dice are pieces that can be rolled to produce random values.
 * Supports standard polyhedral dice: d4, d6, d8, d10, d12, d20.
 *
 * Usage:
 * ```ts
 * // Create a d6
 * const die = board.create(Die, 'd6', { sides: 6 });
 * die.roll(); // Uses game's seeded RNG
 * console.log(die.value); // 1-6
 *
 * // Create a custom die with labels
 * const fudgeDie = board.create(Die, 'fudge', {
 *   sides: 6,
 *   faceLabels: ['-', '-', ' ', ' ', '+', '+']
 * });
 * ```
 */
export class Die<G extends Game = any, P extends Player = any> extends Piece<G, P> {
  /**
   * System property to identify this element type for AutoUI
   * $ prefix indicates this is a system property
   */
  $type!: 'die';

  /**
   * Number of sides on the die (4, 6, 8, 10, 12, or 20)
   */
  sides!: DieSides;

  /**
   * Current face value (1 to sides, or 0 if not yet rolled)
   */
  value: number = 0;

  /**
   * Die color for rendering (CSS color string)
   */
  color: string = '#ffffff';

  /**
   * Optional custom labels for each face.
   * If provided, must have exactly `sides` entries.
   * Used for custom dice like Fudge dice or dice with symbols.
   */
  faceLabels?: string[];

  /**
   * Whether the die is currently rolling (for animation).
   * This is set true briefly during roll() for UI detection.
   */
  rolling: boolean = false;

  /**
   * Roll counter - increments each time the die is rolled.
   * UI can watch this to trigger animations on actual rolls.
   */
  rollCount: number = 0;

  constructor(ctx: Partial<ElementContext>) {
    super(ctx);
    // Explicitly set as instance property for serialization
    this.$type = 'die';
  }

  /**
   * Roll the die using the game's seeded random number generator.
   * Returns the new value.
   *
   * Increments rollCount to signal the UI to animate.
   */
  roll(): number {
    this.rollCount++;
    this.value = Math.floor(this.game.random() * this.sides) + 1;
    return this.value;
  }

  /**
   * Set the die to a specific value.
   * Useful for abilities like "flip to opposite" or manual setting.
   * @param n - The value to set (1 to sides)
   */
  setValue(n: number): void {
    if (n < 1 || n > this.sides) {
      throw new Error(`Invalid die value ${n} for d${this.sides}`);
    }
    this.value = n;
  }

  /**
   * Get the opposite face value.
   * For standard dice, opposite faces sum to sides + 1.
   * d4 is special - has no true opposite, returns a different value.
   */
  getOpposite(): number {
    if (this.sides === 4) {
      // d4 has no opposite - return a random other value
      const others = [1, 2, 3, 4].filter(n => n !== this.value);
      return others[Math.floor(this.game.random() * others.length)];
    }
    // Standard dice: opposite faces sum to sides + 1
    return this.sides + 1 - this.value;
  }

  /**
   * Flip the die to show the opposite face.
   * For d4, sets to a random different value.
   */
  flip(): void {
    this.value = this.getOpposite();
  }

  /**
   * Get the display label for the current face.
   * Returns custom label if faceLabels is set, otherwise the numeric value.
   */
  getLabel(): string {
    if (this.faceLabels && this.faceLabels.length === this.sides) {
      return this.faceLabels[this.value - 1];
    }
    return String(this.value);
  }

  /**
   * Check if this die has a specific number of sides
   */
  isD4(): boolean { return this.sides === 4; }
  isD6(): boolean { return this.sides === 6; }
  isD8(): boolean { return this.sides === 8; }
  isD10(): boolean { return this.sides === 10; }
  isD12(): boolean { return this.sides === 12; }
  isD20(): boolean { return this.sides === 20; }
}
