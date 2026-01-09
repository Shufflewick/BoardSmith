import { Game, Player, type GameOptions } from '@boardsmith/engine';
import { Battlefield, Unit, Enemy, TestPlayer } from './elements.js';
import {
  createAttackAction,
  createOptionalDemo,
  createEnterNumberDemo,
  createEnterTextDemo,
  createRepeatUntilDemo,
  createChoosePlayerDemo,
  createEndTurnAction,
} from './actions.js';
import { createTestFlow } from './flow.js';

/**
 * Test Action Panel Game
 *
 * A demo game to demonstrate ActionPanel features:
 * - chooseFrom: basic choice selection
 * - chooseElement: select an element from the game
 * - multiSelect: select multiple items
 * - dependsOn: selection depends on previous selection
 * - optional: skippable selection
 * - enterNumber: number input
 * - enterText: text input
 * - repeatUntil: repeat selection until terminator
 * - playerChoices: select a player using the playerChoices helper
 *
 * Note: Auto-select for single choices is controlled by the UI's Auto toggle
 */
export class TestActionPanelGame extends Game<TestActionPanelGame, TestPlayer> {
  // Use custom player class
  static PlayerClass = TestPlayer;

  /** The battlefield containing all units */
  battlefield!: Battlefield;

  /** Currently selected unit for attack (for multi-target selection) */
  selectedUnit: Unit | null = null;

  /** Current turn number */
  turn: number = 1;

  constructor(options: GameOptions) {
    super(options);

    // Register element classes
    this.registerElements([Battlefield, Unit, Enemy]);

    // Create the battlefield
    this.battlefield = this.create(Battlefield, 'battlefield', {});
    this.battlefield.contentsVisible();

    // Create player units with varying maxTargets
    this.createPlayerUnits();

    // Create enemies to attack
    this.createEnemies();

    // Register all demo actions
    this.registerAction(createAttackAction(this));      // chooseFrom + multiSelect + dependsOn
    this.registerAction(createOptionalDemo(this));       // optional
    this.registerAction(createEnterNumberDemo(this));    // enterNumber
    this.registerAction(createEnterTextDemo(this));      // enterText
    this.registerAction(createRepeatUntilDemo(this));    // repeatUntil
    this.registerAction(createChoosePlayerDemo(this));   // playerChoices
    this.registerAction(createEndTurnAction(this));

    // Set up the flow
    this.setFlow(createTestFlow(this));

    this.message('ActionPanel Feature Demo');
    this.message('Each action demonstrates a different BoardSmith feature.');
  }

  private createPlayerUnits(): void {
    const player = this.getPlayer(1)!;

    // Unit with single target (no multiSelect)
    const sniper = this.battlefield.create(Unit, 'sniper', {
      owner: player,
      unitName: 'Sniper',
      maxTargets: 1,
      strength: 3,
      health: 2,
    });
    sniper.showToAll();

    // Unit with 2 targets (multiSelect: 2)
    const rifleman = this.battlefield.create(Unit, 'rifleman', {
      owner: player,
      unitName: 'Rifleman',
      maxTargets: 2,
      strength: 1,
      health: 3,
    });
    rifleman.showToAll();

    // Unit with 3 targets (multiSelect: 3)
    const machineGunner = this.battlefield.create(Unit, 'machinegunner', {
      owner: player,
      unitName: 'Machine Gunner',
      maxTargets: 3,
      strength: 1,
      health: 4,
    });
    machineGunner.showToAll();
  }

  private createEnemies(): void {
    const enemyNames = ['Grunt A', 'Grunt B', 'Grunt C', 'Grunt D', 'Grunt E'];

    for (const name of enemyNames) {
      const enemy = this.battlefield.create(Enemy, name.toLowerCase().replace(' ', '-'), {
        enemyName: name,
        health: 2,
      });
      enemy.showToAll();
    }
  }

  /**
   * Get all player units that can still attack
   */
  getAvailableUnits(): Unit[] {
    return [...this.battlefield.all(Unit)].filter(u => !u.hasAttacked);
  }

  /**
   * Get all enemies that are still alive
   */
  getAliveEnemies(): Enemy[] {
    return [...this.battlefield.all(Enemy)].filter(e => !e.defeated);
  }

  /**
   * Reset units for a new turn
   */
  resetUnitsForNewTurn(): void {
    for (const unit of this.battlefield.all(Unit)) {
      unit.hasAttacked = false;
    }
    this.turn++;
    this.message(`--- Turn ${this.turn} ---`);
  }

  override isFinished(): boolean {
    // Game ends when all enemies are defeated
    return this.getAliveEnemies().length === 0;
  }

  override getWinners(): TestPlayer[] {
    if (this.isFinished()) {
      return [this.getPlayer(1)!];
    }
    return [];
  }
}
