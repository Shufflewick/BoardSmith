import { Action, type ActionDefinition } from '@boardsmith/engine';
import type { PolyPotionsGame } from './game.js';
import {
  IngredientDie,
  type PolyPotionsPlayer,
  DISTILLATION_POINTS,
  FULMINATE_POINTS,
  DISTILLATION_ROWS,
} from './elements.js';

/**
 * Create the "draft" action for Polyhedral Potions
 *
 * Select a die from the ingredient shelf to draft
 * Handles D10/D% 0/10 choice when value is 10
 */
export function createDraftAction(game: PolyPotionsGame): ActionDefinition {
  return Action.create('draft')
    .prompt('Draft a die from the ingredient shelf')
    .chooseFrom<string>('die', {
      prompt: 'Choose a die to draft',
      choices: () => {
        const available = game.getAvailableDice();
        const choices: string[] = [];

        for (const die of available) {
          if (!die.name) continue;

          // D10 showing 10 can be used as 0 or 10
          if (die.sides === 10 && die.value === 10) {
            choices.push(`${die.name}:0`);
            choices.push(`${die.name}:10`);
          } else {
            choices.push(die.name);
          }
        }

        return choices;
      },
      display: (choice) => {
        // Parse choice - may include :0 or :10 suffix
        const parts = choice.split(':');
        const dieName = parts[0];
        const overrideValue = parts[1] ? parseInt(parts[1], 10) : null;

        const die = game.shelf.getDice().find(d => d.name === dieName);
        if (!die) return choice;

        const displayValue = overrideValue !== null ? overrideValue : die.value;
        return `${dieName} (${displayValue})`;
      },
      boardRefs: (choice) => {
        const dieName = choice.split(':')[0];
        const die = game.shelf.getDice().find(d => d.name === dieName);
        return die ? { targetRef: { id: die.id } } : {};
      },
    })
    .execute((args, ctx) => {
      const player = ctx.player as PolyPotionsPlayer;
      const choice = args.die as string;

      // Parse choice - may include :0 or :10 suffix
      const parts = choice.split(':');
      const dieName = parts[0];
      const overrideValue = parts[1] ? parseInt(parts[1], 10) : undefined;

      const die = game.shelf.getDice().find(d => d.name === dieName) as IngredientDie;

      if (die) {
        const effectiveValue = overrideValue ?? die.value;
        const unlockedAbility = game.draftDie(player, die, effectiveValue);

        return {
          success: true,
          data: { unlockedAbility },
          message: `${player.name} drafted ${die.name} showing ${effectiveValue}`,
        };
      }

      return {
        success: false,
        error: `Die ${dieName} not found`,
      };
    });
}

/**
 * Create the "craft" action for Polyhedral Potions
 *
 * Combine drafted dice to create a potion value
 * Supports subtract ability and adjust (+/- 1 or 2) ability
 */
export function createCraftAction(game: PolyPotionsGame): ActionDefinition {
  return Action.create('craft')
    .prompt('Craft a potion from your drafted dice')
    .chooseFrom<string>('operation', {
      prompt: 'Choose how to combine your dice',
      choices: (ctx) => {
        const player = ctx.player as PolyPotionsPlayer;
        const choices = ['add'];
        if (player.hasAbility('subtract')) {
          choices.push('subtract');
        }
        return choices;
      },
      display: (op) => {
        if (game.draftedValues.length < 2) return op;
        const [val1, val2] = game.draftedValues;
        if (op === 'add') {
          return `Add: ${val1} + ${val2} = ${val1 + val2}`;
        } else {
          return `Subtract: |${val1} - ${val2}| = ${Math.abs(val1 - val2)} (uses ability)`;
        }
      },
    })
    .chooseFrom<string>('adjustment', {
      prompt: 'Apply adjustment?',
      choices: (ctx) => {
        const player = ctx.player as PolyPotionsPlayer;
        // If player doesn't have adjust ability, only offer 'none' which will auto-select
        if (!player.hasAbility('adjust')) {
          return ['none'];
        }
        return ['none', '+1', '+2', '-1', '-2'];
      },
      display: (adj) => {
        if (adj === 'none') return 'No adjustment';
        return `${adj} to final value (uses ability)`;
      },
    })
    .execute((args, ctx) => {
      const player = ctx.player as PolyPotionsPlayer;
      const operation = args.operation as string;
      const adjustmentStr = (args.adjustment as string) || 'none';

      const useSubtract = operation === 'subtract';
      if (useSubtract) {
        player.useAbility('subtract');
      }

      let adjustment = 0;
      if (adjustmentStr !== 'none') {
        adjustment = parseInt(adjustmentStr, 10);
        player.useAbility('adjust');
      }

      const result = game.craftPotion(player, useSubtract, adjustment);

      return {
        success: true,
        data: result,
        message: `${player.name} crafted ${result.isPoison ? 'poison' : 'potion'} with value ${result.value}`,
      };
    });
}

/**
 * Create the "record" action for Polyhedral Potions
 *
 * Record the crafted value to distillation or fulminate track
 * Poisons can repeat values, potions cannot
 */
export function createRecordAction(game: PolyPotionsGame): ActionDefinition {
  return Action.create('record')
    .prompt('Record your potion value to a track')
    .chooseFrom<string>('track', {
      prompt: 'Where to record your value?',
      choices: (ctx) => {
        const player = ctx.player as PolyPotionsPlayer;
        const value = game.craftedValue;
        const isPoison = game.craftedPoison;
        const choices: string[] = [];

        // Check distillation columns
        for (let i = 0; i < 4; i++) {
          if (player.canAddToDistillation(i, value, isPoison)) {
            choices.push(`distill-${i}`);
          }
        }

        // Check fulminate
        if (player.canAddToFulminate(value, isPoison)) {
          choices.push('fulminate');
        }

        // If no valid choices, allow any distillation column or fulminate
        // (the player must still place somewhere, even if invalid - this shouldn't happen)
        if (choices.length === 0) {
          for (let i = 0; i < 4; i++) {
            if (player.distillations[i].length < DISTILLATION_ROWS[i]) {
              choices.push(`distill-${i}`);
            }
          }
          if (player.fulminates.length < FULMINATE_POINTS.length) {
            choices.push('fulminate');
          }
        }

        return choices;
      },
      display: (choice) => {
        const player = game.players.get(game.currentPlayerIndex) as PolyPotionsPlayer;

        if (choice.startsWith('distill-')) {
          const col = parseInt(choice.split('-')[1], 10);
          const row = player.distillations[col].length;
          const points = DISTILLATION_POINTS[col]?.[row] ?? 0;
          const sign = points >= 0 ? '+' : '';
          return `Distillation ${col + 1} (${sign}${points} pts)`;
        } else if (choice === 'fulminate') {
          const position = player.fulminates.length;
          const points = FULMINATE_POINTS[Math.min(position, FULMINATE_POINTS.length - 1)];
          return `Fulminate (+${points} pts)`;
        }

        return choice;
      },
    })
    .execute((args, ctx) => {
      const player = ctx.player as PolyPotionsPlayer;
      const choice = args.track as string;
      let points = 0;

      if (choice.startsWith('distill-')) {
        const columnIndex = parseInt(choice.split('-')[1], 10);
        points = game.recordValue(player, 'distillation', columnIndex);
      } else if (choice === 'fulminate') {
        points = game.recordValue(player, 'fulminate');
      }

      // Clear turn state after recording
      game.clearTurnState(player);

      return {
        success: true,
        data: { points },
        message: `${player.name} recorded to ${choice}`,
      };
    });
}

/**
 * Create the "useReroll" action for Polyhedral Potions
 *
 * Reroll up to 2 ingredient dice (on shelf or already drafted)
 * Uses the reroll-2 ability
 */
export function createUseRerollAction(game: PolyPotionsGame): ActionDefinition {
  // Helper to check if a die is rerollable (on shelf or drafted this turn)
  // Uses ctx.game to avoid stale closure references
  const isRerollableDie = (die: IngredientDie, currentGame: PolyPotionsGame) => {
    const shelfDice = currentGame.shelf.getDice() as IngredientDie[];
    const draftedDice = currentGame.draftedDice;
    return shelfDice.includes(die) || draftedDice.includes(die);
  };

  return Action.create('useReroll')
    .prompt('Use Reroll ability to reroll up to 2 dice')
    .chooseElement<IngredientDie>('die1', {
      prompt: 'Select first die to reroll',
      elementClass: IngredientDie,
      from: game,
      filter: (die, ctx) => {
        const currentGame = ctx.game as PolyPotionsGame;
        return isRerollableDie(die as IngredientDie, currentGame);
      },
      display: (die) => `${die.name} (currently ${die.value})`,
      boardRef: (die) => ({ id: die.id, name: die.name }),
    })
    .chooseElement<IngredientDie>('die2', {
      prompt: 'Select second die to reroll (optional)',
      elementClass: IngredientDie,
      from: game,
      filter: (die, ctx) => {
        const currentGame = ctx.game as PolyPotionsGame;
        // Exclude the first die selected
        if (ctx.args.die1 === die.id) return false;
        return isRerollableDie(die as IngredientDie, currentGame);
      },
      display: (die) => `${die.name} (currently ${die.value})`,
      boardRef: (die) => ({ id: die.id, name: die.name }),
      optional: true,
    })
    .execute((args, ctx) => {
      // IMPORTANT: Use ctx.game, not the closure 'game', to avoid stale references
      const currentGame = ctx.game as PolyPotionsGame;
      const player = ctx.player as PolyPotionsPlayer;

      // Extract element IDs - args may contain full objects or just IDs
      const die1Id = typeof args.die1 === 'object' ? (args.die1 as any).id : args.die1 as number;
      const die2Id = args.die2 !== undefined
        ? (typeof args.die2 === 'object' ? (args.die2 as any).id : args.die2 as number)
        : undefined;

      if (!player.hasAbility('reroll-2')) {
        return { success: false, error: 'No reroll ability available' };
      }

      // Find dice by ID
      const diceToReroll: IngredientDie[] = [];
      const allDice = currentGame.all(IngredientDie);

      const die1 = allDice.find(d => d.id === die1Id);
      if (die1) diceToReroll.push(die1);

      if (die2Id !== undefined) {
        const die2 = allDice.find(d => d.id === die2Id);
        if (die2 && die2 !== die1) diceToReroll.push(die2);
      }

      if (diceToReroll.length === 0) {
        return { success: false, error: 'No valid dice selected' };
      }

      // Use the ability
      player.useAbility('reroll-2');

      // Reroll the dice
      const oldValues = diceToReroll.map(d => d.value);
      currentGame.rerollDice(diceToReroll);
      const newValues = diceToReroll.map(d => d.value);

      // Update drafted values if any drafted dice were rerolled
      const updatedValues = [...currentGame.draftedValues];
      for (let i = 0; i < currentGame.draftedDice.length; i++) {
        const draftedDie = currentGame.draftedDice[i];
        if (diceToReroll.includes(draftedDie)) {
          updatedValues[i] = draftedDie.value;
        }
      }
      currentGame.draftedValues = updatedValues;

      return {
        success: true,
        data: { oldValues, newValues },
        message: `${player.name} rerolled ${diceToReroll.map(d => d.name).join(', ')}`,
        // Chain back to draft if player still needs to draft dice
        followUp: currentGame.draftedDice.length < 2
          ? { action: 'draft' }
          : undefined,
      };
    });
}

/**
 * Create the "useFlip" action for Polyhedral Potions
 *
 * Flip an ingredient die to its opposite side
 * For D4, can choose any value (1-4)
 * Note: You do NOT have to draft the die you flip!
 */
export function createUseFlipAction(game: PolyPotionsGame): ActionDefinition {
  // Helper to check if a die is flippable (on shelf or drafted this turn)
  // Uses ctx.game to avoid stale closure references
  const isFlippableDie = (die: IngredientDie, currentGame: PolyPotionsGame) => {
    const shelfDice = currentGame.shelf.getDice() as IngredientDie[];
    const draftedDice = currentGame.draftedDice;
    return shelfDice.includes(die) || draftedDice.includes(die);
  };

  return Action.create('useFlip')
    .prompt('Use Flip ability to flip a die to its opposite side')
    .chooseElement<IngredientDie>('die', {
      prompt: 'Select a die to flip',
      elementClass: IngredientDie,
      from: game,
      filter: (die, ctx) => {
        const currentGame = ctx.game as PolyPotionsGame;
        return isFlippableDie(die as IngredientDie, currentGame);
      },
      display: (die) => {
        const opposite = die.sides === 4 ? 'any' : (die.sides + 1 - die.value);
        return `${die.name} (${die.value} → ${opposite})`;
      },
      boardRef: (die) => ({ id: die.id, name: die.name }),
    })
    .chooseFrom<string>('newValue', {
      prompt: 'Choose the new value (1-4 only applies to D4)',
      choices: () => ['opposite', '1', '2', '3', '4'],
      display: (val) => {
        if (val === 'opposite') return 'Flip to opposite side';
        return `Set to ${val} (D4 only)`;
      },
    })
    .execute((args, ctx) => {
      // IMPORTANT: Use ctx.game, not the closure 'game', to avoid stale references after hot-reload
      const currentGame = ctx.game as PolyPotionsGame;
      const player = ctx.player as PolyPotionsPlayer;

      // Extract element ID - args may contain full object or just ID
      const dieId = typeof args.die === 'object' ? (args.die as any).id : args.die as number;
      const newValueStr = args.newValue as string;

      if (!player.hasAbility('flip')) {
        return { success: false, error: 'No flip ability available' };
      }

      const die = currentGame.all(IngredientDie).find(d => d.id === dieId);

      if (!die) {
        return { success: false, error: 'Die not found' };
      }

      // Use the ability
      player.useAbility('flip');

      const oldValue = die.value;
      // Only D4 can use specific values; other dice always flip to opposite
      if (die.sides === 4 && newValueStr !== 'opposite') {
        currentGame.flipDie(die, parseInt(newValueStr, 10));
      } else {
        // For non-D4 dice (or if 'opposite' selected), flip to opposite
        currentGame.flipDie(die);
      }

      // Update drafted values if this was a drafted die
      const draftedIndex = currentGame.draftedDice.indexOf(die);
      if (draftedIndex >= 0) {
        const updatedValues = [...currentGame.draftedValues];
        updatedValues[draftedIndex] = die.value;
        currentGame.draftedValues = updatedValues;
      }

      return {
        success: true,
        data: { oldValue, newValue: die.value },
        message: `${player.name} flipped ${die.name} from ${oldValue} to ${die.value}`,
        // Chain back to draft if player still needs to draft dice
        followUp: currentGame.draftedDice.length < 2
          ? { action: 'draft' }
          : undefined,
      };
    });
}

/**
 * Create the "useRefresh" action for Polyhedral Potions
 *
 * Reroll all dice on the shelf
 * If you've already drafted one die, you can keep it or include it in the refresh
 */
export function createUseRefreshAction(game: PolyPotionsGame): ActionDefinition {
  return Action.create('useRefresh')
    .prompt('Use Refresh ability to reroll all shelf dice')
    .chooseFrom<string>('keepDrafted', {
      prompt: 'Keep your drafted die?',
      choices: (ctx) => {
        const currentGame = ctx.game as PolyPotionsGame;
        if (currentGame.draftedDice.length === 0) {
          return ['no_drafted'];
        }
        return ['keep', 'include'];
      },
      display: (choice) => {
        if (choice === 'no_drafted') return 'Refresh all shelf dice';
        if (choice === 'keep') return 'Keep drafted die, refresh shelf';
        return 'Include drafted die in refresh';
      },
    })
    .execute((args, ctx) => {
      // IMPORTANT: Use ctx.game, not the closure 'game', to avoid stale references after hot-reload
      const currentGame = ctx.game as PolyPotionsGame;
      const player = ctx.player as PolyPotionsPlayer;
      const keepChoice = args.keepDrafted as string;

      if (!player.hasAbility('refresh')) {
        return { success: false, error: 'No refresh ability available' };
      }

      // Use the ability
      player.useAbility('refresh');

      if (keepChoice === 'include' && currentGame.draftedDice.length > 0) {
        // Include drafted die in refresh - put it back on shelf first
        const die = currentGame.draftedDice[0];
        die.drafted = false;
        die.putInto(currentGame.shelf);
        currentGame.draftedDice = [];
        currentGame.draftedValues = [];
        currentGame.refreshShelf();
      } else if (keepChoice === 'keep' && currentGame.draftedDice.length > 0) {
        // Keep drafted die, only refresh shelf
        currentGame.refreshShelf(currentGame.draftedDice[0]);
      } else {
        // No drafted die, just refresh
        currentGame.refreshShelf();
      }

      return {
        success: true,
        message: `${player.name} refreshed the ingredient shelf`,
        // Chain back to draft if player still needs to draft dice
        followUp: currentGame.draftedDice.length < 2
          ? { action: 'draft' }
          : undefined,
      };
    });
}
