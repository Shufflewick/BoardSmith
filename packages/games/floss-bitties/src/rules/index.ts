// Floss Bitties game package
export { FlossBittiesGame, type FlossBittiesOptions } from './game.js';
export {
  Card,
  Hand,
  DrawDeck,
  PlayArea,
  DiscardPile,
  FlossBittiesPlayer,
  SUITS,
  RANKS,
  type Suit,
  type Rank,
} from './elements.js';
export {
  createPlayToAreaAction,
  createDiscardAction,
  createDrawFromDeckAction,
  createDrawFromDiscardAction,
} from './actions.js';
export { createGameFlow } from './flow.js';

import { FlossBittiesGame } from './game.js';

/**
 * Game definition for the worker to register this game.
 * Contains all metadata needed to run Floss Bitties.
 */
export const gameDefinition = {
  gameClass: FlossBittiesGame,
  gameType: 'floss-bitties',
  displayName: 'Floss Bitties',
  minPlayers: 2,
  maxPlayers: 2,
} as const;
