// Cribbage game package
export { CribbageGame, type CribbageOptions, type CribbagePhase } from './game.js';
export { Card, Hand, Crib, Deck, PlayArea, PlayedCards, StarterArea, CribbagePlayer } from './elements.js';
export { createDiscardAction, createPlayCardAction, createSayGoAction, createAcknowledgeScoreAction } from './actions.js';
export { createCribbageFlow } from './flow.js';
export {
  scoreHand,
  scoreHandDetailed,
  scorePegging,
  countFifteens,
  countPairs,
  countRuns,
  countFlush,
  checkNobs,
  type ScoreBreakdown,
  type DetailedScoreBreakdown,
  type ScoringItem,
  type PeggingScore,
} from './scoring.js';
export { getCribbageObjectives } from './ai.js';

import { CribbageGame } from './game.js';
import { getCribbageObjectives } from './ai.js';

/**
 * Game definition for the worker to register this game.
 * Contains all metadata needed to run Cribbage.
 */
export const gameDefinition = {
  gameClass: CribbageGame,
  gameType: 'cribbage',
  displayName: 'Cribbage',
  minPlayers: 2,
  maxPlayers: 2,
  ai: {
    objectives: getCribbageObjectives,
  },
} as const;
