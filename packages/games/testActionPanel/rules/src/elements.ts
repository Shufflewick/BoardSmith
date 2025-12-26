import { Piece, Player, Space } from '@boardsmith/engine';
import type { TestActionPanelGame } from './game.js';

/**
 * Player with combat units
 */
export class TestPlayer extends Player<TestActionPanelGame> {
  score: number = 0;
}

/**
 * Container for all units and enemies
 */
export class Battlefield extends Space<TestActionPanelGame, TestPlayer> {}

/**
 * A combat unit that can attack enemies
 */
export class Unit extends Piece<TestActionPanelGame, TestPlayer> {
  /** Which player owns this unit */
  owner!: TestPlayer;

  /** Unit name for display */
  unitName!: string;

  /** How many targets this unit can attack at once */
  maxTargets: number = 1;

  /** Combat strength */
  strength: number = 1;

  /** Health points */
  health: number = 3;

  /** Whether this unit has attacked this turn */
  hasAttacked: boolean = false;

  get notation(): string {
    return this.unitName;
  }
}

/**
 * An enemy target that can be attacked
 */
export class Enemy extends Piece<TestActionPanelGame, TestPlayer> {
  /** Enemy name for display */
  enemyName!: string;

  /** Health points */
  health: number = 2;

  /** Whether this enemy is defeated */
  defeated: boolean = false;

  get notation(): string {
    return this.enemyName;
  }
}
