import { Action, type ActionDefinition, type ActionContext } from '@boardsmith/engine';
import type { TestActionPanelGame } from './game.js';
import { Unit, Enemy, TestPlayer } from './elements.js';

/**
 * Demo action showing chooseElement + chooseFrom with dynamic multiSelect
 *
 * Demonstrates:
 * 1. chooseElement - select an element from the game
 * 2. dependsOn - second selection depends on first selection's value
 * 3. multiSelect - dynamic multi-selection based on previous selection
 */
export function createAttackAction(game: TestActionPanelGame): ActionDefinition {
  return Action.create('chooseFromDemo')
    .prompt('chooseFrom')
    .condition((ctx) => {
      const units = game.getAvailableUnits();
      const enemies = game.getAliveEnemies();
      return units.length > 0 && enemies.length > 0;
    })
    // chooseElement: select an element from the game
    .chooseElement<Unit>('chooseElement', {
      prompt: 'chooseElement',
      elementClass: Unit,
      filter: (element) => {
        const unit = element as Unit;
        return !unit.hasAttacked;
      },
      display: (unit) => `${unit.unitName} (Targets: ${unit.maxTargets}, Str: ${unit.strength})`,
    })
    // chooseFrom with dependsOn + dynamic multiSelect
    .chooseFrom<string>('multiSelect', {
      prompt: 'multiSelect',
      // dependsOn: re-evaluate choices when chooseElement changes
      dependsOn: 'chooseElement',
      choices: (ctx: ActionContext) => {
        return game.getAliveEnemies().map(e => e.enemyName);
      },
      // Dynamic multiSelect based on selected element's maxTargets
      multiSelect: (ctx: ActionContext) => {
        const unit = ctx.args.chooseElement as Unit;
        if (!unit) return undefined;

        // If unit can only target 1, use regular single-select (no multiSelect)
        if (unit.maxTargets <= 1) {
          return undefined;
        }

        // Otherwise enable multiSelect with unit's maxTargets
        return {
          min: 0,
          max: unit.maxTargets,
        };
      },
    })
    .execute((args, ctx) => {
      const player = ctx.player as TestPlayer;
      const unit = args.chooseElement as Unit;

      // multiSelect can be a single string or array depending on multiSelect config
      let targetNames: string[];
      if (Array.isArray(args.multiSelect)) {
        targetNames = args.multiSelect as string[];
      } else {
        targetNames = [args.multiSelect as string];
      }

      // Mark unit as having attacked
      unit.hasAttacked = true;

      // Process each target
      const results: string[] = [];
      for (const targetName of targetNames) {
        const enemy = game.getAliveEnemies().find(e => e.enemyName === targetName);
        if (enemy) {
          enemy.health -= unit.strength;
          if (enemy.health <= 0) {
            enemy.defeated = true;
            results.push(`${targetName} defeated!`);
            player.score += 10;
          } else {
            results.push(`${targetName} hit for ${unit.strength} damage (${enemy.health} HP left)`);
          }
        }
      }

      game.message(`${unit.unitName} attacks ${targetNames.join(', ')}: ${results.join(', ')}`);

      return {
        success: true,
        message: `${unit.unitName} attacked ${targetNames.length} target(s)`,
      };
    });
}

/**
 * Demo action showing optional selection
 *
 * Demonstrates:
 * - optional: true allows skipping the selection
 */
export function createOptionalDemo(game: TestActionPanelGame): ActionDefinition {
  return Action.create('optionalDemo')
    .prompt('optional')
    .chooseFrom<string>('optional', {
      prompt: 'optional (can skip)',
      choices: ['Option A', 'Option B', 'Option C'],
      optional: true,
    })
    .execute((args, ctx) => {
      const choice = args.optional as string | undefined;
      game.message(`optional demo: selected "${choice ?? 'nothing (skipped)'}"`);
      return { success: true };
    });
}

/**
 * Demo action showing enterNumber
 *
 * Demonstrates:
 * - enterNumber with min/max/integer constraints
 */
export function createEnterNumberDemo(game: TestActionPanelGame): ActionDefinition {
  return Action.create('enterNumberDemo')
    .prompt('enterNumber')
    .enterNumber('enterNumber', {
      prompt: 'enterNumber (1-10, integer)',
      min: 1,
      max: 10,
      integer: true,
    })
    .execute((args, ctx) => {
      game.message(`enterNumber demo: entered ${args.enterNumber}`);
      return { success: true };
    });
}

/**
 * Demo action showing enterText
 *
 * Demonstrates:
 * - enterText with length constraints
 */
export function createEnterTextDemo(game: TestActionPanelGame): ActionDefinition {
  return Action.create('enterTextDemo')
    .prompt('enterText')
    .enterText('enterText', {
      prompt: 'enterText (3-20 chars)',
      minLength: 3,
      maxLength: 20,
    })
    .execute((args, ctx) => {
      game.message(`enterText demo: entered "${args.enterText}"`);
      return { success: true };
    });
}

/**
 * Demo action showing repeatUntil
 *
 * Demonstrates:
 * - repeatUntil: keep selecting until "Done" is chosen
 */
export function createRepeatUntilDemo(game: TestActionPanelGame): ActionDefinition {
  return Action.create('repeatUntilDemo')
    .prompt('repeatUntil')
    .chooseFrom<string>('repeatUntil', {
      prompt: 'repeatUntil (select until "Done")',
      choices: ['Apple', 'Banana', 'Cherry', 'Done'],
      repeatUntil: 'Done',
    })
    .execute((args, ctx) => {
      const selections = args.repeatUntil as string[];
      // Filter out the terminator
      const items = selections.filter(s => s !== 'Done');
      game.message(`repeatUntil demo: selected [${items.join(', ')}]`);
      return { success: true };
    });
}

/**
 * Demo action showing playerChoices helper
 *
 * Demonstrates:
 * - playerChoices(): helper to generate player choices for chooseFrom
 * - Can be used with excludeSelf to filter out the current player
 */
export function createChoosePlayerDemo(game: TestActionPanelGame): ActionDefinition {
  return Action.create('playerChoicesDemo')
    .prompt('playerChoices')
    .condition(() => game.players.length > 1)
    .chooseFrom('player', {
      prompt: 'playerChoices (excludeSelf)',
      choices: (ctx) => game.playerChoices({ excludeSelf: true, currentPlayer: ctx.player }),
    })
    .execute((args, ctx) => {
      const choice = args.player as { value: number; display: string };
      const selectedPlayer = game.players.get(choice.value) as TestPlayer;
      game.message(`playerChoices demo: selected "${selectedPlayer.name}"`);
      return { success: true };
    });
}

/**
 * End turn action - resets units for new turn
 */
export function createEndTurnAction(game: TestActionPanelGame): ActionDefinition {
  return Action.create('endTurn')
    .prompt('End Turn')
    .execute((args, ctx) => {
      game.resetUnitsForNewTurn();
      return { success: true };
    });
}
