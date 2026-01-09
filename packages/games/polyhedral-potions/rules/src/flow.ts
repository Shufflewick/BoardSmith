import {
  loop,
  eachPlayer,
  actionStep,
  execute,
  sequence,
  Player,
  type FlowDefinition,
} from '@boardsmith/engine';
import type { PolyPotionsGame } from './game.js';
import type { PolyPotionsPlayer, IngredientDie } from './elements.js';

/**
 * Create the Polyhedral Potions game flow
 *
 * Turn structure (per PDF rules):
 * 1. Draft Phase: Select 2 dice from the shelf
 *    - If only 1 die left, auto-draft and reroll other 6
 *    - For 3 players, special "Rule of Three" applies
 * 2. Craft Phase: Combine dice values (add, or subtract with ability)
 *    - Can use +/- 1 or 2 ability
 * 3. Record Phase: Add value to distillation or fulminate track
 *
 * Abilities usable during turn:
 * - Subtract: Use during craft (instead of add)
 * - Flip: Change any die to opposite face (D4 = any value)
 * - Reroll 2: Reroll up to 2 dice on shelf
 * - Refresh: Reroll all dice on shelf
 * - Adjust: +/- 1 or 2 to final value during craft
 * - Draft Again: Take another full turn after completing current
 *
 * Round structure:
 * - All players take turns drafting and crafting
 * - After all players go, reroll all dice for next round
 *
 * Game end:
 * - When any player gets 3 stars, finish the round
 * - Highest score wins (tiebreaker: stars, then unused abilities)
 */
export function createPolyPotionsFlow(): FlowDefinition {
  // Helper to get available ability actions for the current player
  const getAvailableAbilityActions = (ctx: any): string[] => {
    const player = ctx.player as PolyPotionsPlayer;
    const actions: string[] = [];
    if (player.hasAbility('reroll-2')) actions.push('useReroll');
    if (player.hasAbility('flip')) actions.push('useFlip');
    if (player.hasAbility('refresh')) actions.push('useRefresh');
    return actions;
  };

  // A single player's turn
  const playerTurn = sequence(
    // Draft first die (with ability options)
    actionStep({
      name: 'draft-1',
      actions: (ctx) => ['draft', ...getAvailableAbilityActions(ctx)],
    }),

    // Check if only one die left - auto-draft and reroll for next pick
    execute((ctx) => {
      const game = ctx.game as PolyPotionsGame;
      const available = game.getAvailableDice();
      const playerCount = game.all(Player).length;

      // Standard rule: if only 1 die left after first draft
      if (available.length === 1 && game.draftedDice.length === 1) {
        // For 3 players with Rule of Three, only take 1 die
        if (playerCount === 3) {
          // Rule of Three: don't auto-draft, player only gets 1 die this turn
          // and next player rolls fresh
          game.message('Rule of Three: Only 1 die available, skipping second draft');
          // We'll handle this in the skipIf below
        } else {
          // Standard: Auto-draft the last die
          const player = ctx.player as PolyPotionsPlayer;
          game.draftDie(player, available[0]);

          // Reroll the other 6 dice with animation
          const diceToReroll: IngredientDie[] = [];
          for (const die of game.shelf.getDice()) {
            const ingredientDie = die as IngredientDie;
            if (!game.draftedDice.includes(ingredientDie)) {
              ingredientDie.drafted = false;
              diceToReroll.push(ingredientDie);
            }
          }
          game.rerollDice(diceToReroll);

          game.message('Only 1 die left - drafted automatically and rerolled shelf');
        }
      }
    }),

    // Draft second die (skip if auto-drafted or Rule of Three)
    actionStep({
      name: 'draft-2',
      actions: (ctx) => ['draft', ...getAvailableAbilityActions(ctx)],
      skipIf: (ctx) => {
        const game = ctx.game as PolyPotionsGame;
        // Skip if already have 2 dice
        if (game.draftedDice.length >= 2) return true;
        // Skip for Rule of Three (3 players and only 1 die was available)
        if (game.all(Player).length === 3 && game.getAvailableDice().length === 0) return true;
        return false;
      },
    }),

    // Handle Rule of Three - skip craft/record if only 1 die drafted
    execute((ctx) => {
      const game = ctx.game as PolyPotionsGame;
      if (game.draftedDice.length === 1 && game.all(Player).length === 3) {
        // Rule of Three: Player only drafted 1 die, no crafting
        // Next player will roll all 7 fresh
        game.rollAllDice();
        game.draftedDice = [];
        game.draftedValues = [];
        game.message('Rule of Three active - next player rolls fresh dice');
      }
    }),

    // Craft the potion (skip if Rule of Three with only 1 die)
    actionStep({
      name: 'craft',
      actions: ['craft'],
      skipIf: (ctx) => {
        const game = ctx.game as PolyPotionsGame;
        return game.draftedValues.length < 2;
      },
    }),

    // Record to track (skip if Rule of Three with only 1 die)
    actionStep({
      name: 'record',
      actions: ['record'],
      skipIf: (ctx) => {
        const game = ctx.game as PolyPotionsGame;
        return game.craftedValue === 0;
      },
    }),

    // Check for Draft Again ability - allow taking another turn
    execute((ctx) => {
      const game = ctx.game as PolyPotionsGame;
      const player = ctx.player as PolyPotionsPlayer;

      // Draft Again lets the player take another full turn
      // This is tracked so the flow can repeat if needed
      if (player.hasAbility('draft-again')) {
        // Store that player has draft-again available
        // The actual usage would be prompted through UI
        // For now, auto-use is not implemented - would need action step
      }
    }),
  );

  return {
    root: loop({
      name: 'game-loop',
      while: (ctx) => {
        const game = ctx.game as PolyPotionsGame;
        return !game.isFinished();
      },
      maxIterations: 1000,
      do: sequence(
        // Each player takes a turn
        eachPlayer({
          name: 'player-turns',
          do: playerTurn,
        }),

        // End of round - reset dice
        execute((ctx) => {
          const game = ctx.game as PolyPotionsGame;
          if (!game.isFinished()) {
            game.startNewRound();
          }
        }),
      ),
    }),

    isComplete: (ctx) => {
      const game = ctx.game as PolyPotionsGame;
      return game.isFinished();
    },

    getWinners: (ctx) => {
      const game = ctx.game as PolyPotionsGame;
      return game.getWinners();
    },
  };
}
