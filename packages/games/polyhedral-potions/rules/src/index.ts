// Main game export
export { PolyPotionsGame, type PolyPotionsOptions } from './game.js';

// Elements
export {
  IngredientDie,
  IngredientShelf,
  DraftArea,
  PolyPotionsPlayer,
  type AbilityType,
  type PlayerAbility,
  type TrackEntry,
  type IngredientBox,
  // Constants for scoring/configuration
  INGREDIENT_TRACK_CONFIG,
  DISTILLATION_POINTS,
  DISTILLATION_COMPLETION_BONUS,
  DISTILLATION_ROWS,
  FULMINATE_POINTS,
  FULMINATE_COMPLETION_BONUS,
  POTION_ROWS,
  POISON_SKULLS_FOR_STAR,
} from './elements.js';

// Actions
export {
  createDraftAction,
  createCraftAction,
  createRecordAction,
  createUseRerollAction,
  createUseFlipAction,
  createUseRefreshAction,
} from './actions.js';

// Flow
export { createPolyPotionsFlow } from './flow.js';

import { PolyPotionsGame } from './game.js';

/**
 * Game definition for the worker to register this game.
 * Contains all metadata needed to run Polyhedral Potions.
 *
 * Based on the official rules by George Jaros (GJJ Games)
 * 1-5 players, 15-30 minutes
 */
export const gameDefinition = {
  gameClass: PolyPotionsGame,
  gameType: 'polyhedral-potions',
  displayName: 'Polyhedral Potions',
  minPlayers: 1,
  maxPlayers: 5,
} as const;
