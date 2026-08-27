export { GameElement } from './game-element.js';
export { Space } from './space.js';
export { Piece } from './piece.js';
export { Card } from './card.js';
export { Hand } from './hand.js';
export { Deck } from './deck.js';
export { Die } from './die.js';
export { DicePool } from './dice-pool.js';
export { Grid, GridCell } from './grid.js';
export { HexGrid, HexCell } from './hex-grid.js';
export {
  Game,
  DEFAULT_COLOR_PALETTE,
  RandomnessForbiddenError,
  // The engine's own root-field audience table, and the two accessors a game
  // uses to defer to it rather than hand-keep a mirror (#32).
  GAME_ROOT_FIELD_AUDIENCE,
  GAME_SELF_SERIALIZED_FIELDS,
  isEngineRootField,
  engineRootFieldAudience,
} from './game.js';
export { PersistentMap } from './persistent-map.js';
export { ElementCollection } from './element-collection.js';

export type {
  ElementClass,
  ElementContext,
  ElementTree,
  ElementJSON,
  ElementFinder,
  ElementAttributes,
  Sorter,
  ImageRef,
} from './types.js';

export type { GameRootFieldAudience, MessageEntry, MessageOptions, FormattedMessage, PlayerOf } from './game.js';
export type { GameOptions, RandomnessPolicy, GamePhase, PlayerViewFunction, AnimationEvent, ActionSpaceView, ActionSchemaView, ArgTemplate } from './game.js';
export type { ElementLayout } from './grid.js';
export type { HexOrientation, HexCoordSystem } from './hex-grid.js';
export type { LayoutDirection, LayoutAlignment } from './space.js';
export type { DieSides } from './die.js';
