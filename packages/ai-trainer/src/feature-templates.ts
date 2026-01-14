import { Player, type Game, type GameElement } from '@boardsmith/engine';
import type { GameStructure, ElementTypeInfo, CandidateFeature, GameType } from './types.js';

/**
 * Feature template - a pattern for generating candidate features
 */
export interface FeatureTemplate {
  /** Template identifier */
  id: string;
  /** Template category */
  category: CandidateFeature['category'];
  /** Description template (uses ${placeholders}) */
  descriptionTemplate: string;
  /** Required structure for this template to apply */
  requires: {
    elementType?: boolean;
    numericProperty?: boolean;
    booleanProperty?: boolean;
    stringProperty?: boolean;
    ownership?: boolean;
    spatial?: boolean;
    playerScore?: boolean;
    multiPlayer?: boolean;
    /** Only generate for these game types (if not set, works for all) */
    gameType?: GameType | GameType[];
  };
  /** Generate features from this template given game structure */
  generate: (structure: GameStructure) => CandidateFeature[];
}

/**
 * All feature templates
 */
export const FEATURE_TEMPLATES: FeatureTemplate[] = [
  // ============================================
  // COUNT FEATURES
  // ============================================
  {
    id: 'element-count-advantage',
    category: 'comparison',
    descriptionTemplate: 'Player has more ${elementType} than opponent',
    requires: { elementType: true, ownership: true, multiPlayer: true },
    generate: (structure) => {
      const features: CandidateFeature[] = [];

      for (const [className, info] of structure.elementTypes) {
        if (!info.hasOwnership) continue;

        features.push({
          id: `${className.toLowerCase()}-count-advantage`,
          description: `Player has more ${className} than opponent`,
          category: 'comparison',
          templateId: 'element-count-advantage',
          evaluate: createCountComparisonEvaluator(className, '>'),
        });

        // Also add "fewer" variant
        features.push({
          id: `${className.toLowerCase()}-count-disadvantage`,
          description: `Player has fewer ${className} than opponent`,
          category: 'comparison',
          templateId: 'element-count-advantage',
          evaluate: createCountComparisonEvaluator(className, '<'),
        });
      }

      return features;
    },
  },

  {
    id: 'element-count-threshold',
    category: 'count',
    descriptionTemplate: 'Player has at least N ${elementType}',
    requires: { elementType: true, ownership: true },
    generate: (structure) => {
      const features: CandidateFeature[] = [];

      for (const [className, info] of structure.elementTypes) {
        if (!info.hasOwnership) continue;

        // Generate thresholds: 0, 1, 3, 5
        for (const threshold of [0, 1, 3, 5]) {
          features.push({
            id: `${className.toLowerCase()}-count-gte-${threshold}`,
            description: `Player has at least ${threshold} ${className}`,
            category: 'count',
            templateId: 'element-count-threshold',
            evaluate: createCountThresholdEvaluator(className, threshold, '>='),
          });
        }

        // "Has none" is often significant
        features.push({
          id: `${className.toLowerCase()}-count-zero`,
          description: `Player has no ${className}`,
          category: 'count',
          templateId: 'element-count-threshold',
          evaluate: createCountThresholdEvaluator(className, 0, '=='),
        });
      }

      return features;
    },
  },

  // ============================================
  // BOOLEAN PROPERTY FEATURES
  // ============================================
  {
    id: 'boolean-property-count',
    category: 'count',
    descriptionTemplate: 'Player has ${elementType} with ${property}=true',
    requires: { elementType: true, booleanProperty: true, ownership: true },
    generate: (structure) => {
      const features: CandidateFeature[] = [];

      for (const [className, info] of structure.elementTypes) {
        if (!info.hasOwnership) continue;

        for (const prop of info.booleanProperties) {
          // Has any with property true
          features.push({
            id: `${className.toLowerCase()}-has-${prop}`,
            description: `Player has ${className} with ${prop}`,
            category: 'boolean',
            templateId: 'boolean-property-count',
            evaluate: createBooleanPropertyEvaluator(className, prop, true, 'any'),
          });

          // Count advantage of property
          features.push({
            id: `${className.toLowerCase()}-${prop}-advantage`,
            description: `Player has more ${className} with ${prop} than opponent`,
            category: 'comparison',
            templateId: 'boolean-property-count',
            evaluate: createBooleanPropertyComparisonEvaluator(className, prop),
          });
        }
      }

      return features;
    },
  },

  // ============================================
  // NUMERIC PROPERTY FEATURES
  // ============================================
  {
    id: 'numeric-property-sum',
    category: 'sum',
    descriptionTemplate: 'Sum of ${property} on player ${elementType}',
    requires: { elementType: true, numericProperty: true, ownership: true },
    generate: (structure) => {
      const features: CandidateFeature[] = [];

      for (const [className, info] of structure.elementTypes) {
        if (!info.hasOwnership) continue;

        for (const prop of info.numericProperties) {
          // Sum comparison
          features.push({
            id: `${className.toLowerCase()}-${prop}-sum-advantage`,
            description: `Player's ${className} ${prop} sum is higher than opponent`,
            category: 'sum',
            templateId: 'numeric-property-sum',
            evaluate: createNumericSumComparisonEvaluator(className, prop),
          });

          // Thresholds
          for (const threshold of [5, 10, 20]) {
            features.push({
              id: `${className.toLowerCase()}-${prop}-sum-gte-${threshold}`,
              description: `Player's ${className} ${prop} sum is at least ${threshold}`,
              category: 'sum',
              templateId: 'numeric-property-sum',
              evaluate: createNumericSumThresholdEvaluator(className, prop, threshold),
            });
          }
        }
      }

      return features;
    },
  },

  // ============================================
  // PLAYER SCORE FEATURES
  // ============================================
  {
    id: 'player-score-lead',
    category: 'score',
    descriptionTemplate: 'Player has higher ${property} than opponent',
    requires: { playerScore: true, multiPlayer: true },
    generate: (structure) => {
      const features: CandidateFeature[] = [];

      for (const prop of structure.playerInfo.numericProperties) {
        // Score lead
        features.push({
          id: `player-${prop}-lead`,
          description: `Player has higher ${prop} than opponent`,
          category: 'score',
          templateId: 'player-score-lead',
          evaluate: createPlayerPropertyComparisonEvaluator(prop, '>'),
        });

        // Score thresholds
        for (const threshold of [5, 10, 25, 50, 100]) {
          features.push({
            id: `player-${prop}-gte-${threshold}`,
            description: `Player ${prop} is at least ${threshold}`,
            category: 'score',
            templateId: 'player-score-lead',
            evaluate: createPlayerPropertyThresholdEvaluator(prop, threshold),
          });
        }

        // Near-win detection (high score)
        features.push({
          id: `player-${prop}-near-max`,
          description: `Player ${prop} is very high (near win)`,
          category: 'score',
          templateId: 'player-score-lead',
          evaluate: createPlayerPropertyNearMaxEvaluator(prop),
        });
      }

      return features;
    },
  },

  // ============================================
  // SPATIAL FEATURES
  // ============================================
  {
    id: 'center-control',
    category: 'spatial',
    descriptionTemplate: 'Player has ${elementType} in center region',
    requires: { spatial: true, ownership: true },
    generate: (structure) => {
      const features: CandidateFeature[] = [];
      if (!structure.spatialInfo.hasBoard || !structure.spatialInfo.centerRegion) {
        return features;
      }

      for (const [className, info] of structure.elementTypes) {
        if (!info.hasOwnership || !info.isSpatial) continue;

        features.push({
          id: `${className.toLowerCase()}-center-control`,
          description: `Player has ${className} in center region`,
          category: 'spatial',
          templateId: 'center-control',
          evaluate: createCenterControlEvaluator(className, structure.spatialInfo.centerRegion!),
        });

        features.push({
          id: `${className.toLowerCase()}-center-advantage`,
          description: `Player has more ${className} in center than opponent`,
          category: 'spatial',
          templateId: 'center-control',
          evaluate: createCenterAdvantageEvaluator(className, structure.spatialInfo.centerRegion!),
        });
      }

      return features;
    },
  },

  {
    id: 'advancement',
    category: 'spatial',
    descriptionTemplate: 'Player ${elementType} are advanced toward goal',
    requires: { spatial: true, ownership: true },
    generate: (structure) => {
      const features: CandidateFeature[] = [];
      if (!structure.spatialInfo.hasBoard || !structure.spatialInfo.dimensions) {
        return features;
      }

      for (const [className, info] of structure.elementTypes) {
        if (!info.hasOwnership || !info.isSpatial) continue;

        features.push({
          id: `${className.toLowerCase()}-advanced`,
          description: `Player ${className} are advanced (past halfway)`,
          category: 'spatial',
          templateId: 'advancement',
          evaluate: createAdvancementEvaluator(className, structure.spatialInfo.dimensions!.rows),
        });
      }

      return features;
    },
  },

  {
    id: 'edge-control',
    category: 'spatial',
    descriptionTemplate: 'Player has ${elementType} on edges',
    requires: { spatial: true, ownership: true },
    generate: (structure) => {
      const features: CandidateFeature[] = [];
      if (!structure.spatialInfo.hasBoard || !structure.spatialInfo.dimensions) {
        return features;
      }

      const { rows, columns } = structure.spatialInfo.dimensions;

      for (const [className, info] of structure.elementTypes) {
        if (!info.hasOwnership || !info.isSpatial) continue;

        // Back row defense (player 0 = row 0, player 1 = max row)
        features.push({
          id: `${className.toLowerCase()}-back-row`,
          description: `Player has ${className} on back row (defense)`,
          category: 'spatial',
          templateId: 'edge-control',
          evaluate: createBackRowEvaluator(className, rows),
        });
      }

      return features;
    },
  },

  // ============================================
  // RATIO FEATURES
  // ============================================
  {
    id: 'element-ratio',
    category: 'ratio',
    descriptionTemplate: 'Player has majority of ${elementType}',
    requires: { elementType: true, ownership: true, multiPlayer: true },
    generate: (structure) => {
      const features: CandidateFeature[] = [];

      for (const [className, info] of structure.elementTypes) {
        if (!info.hasOwnership) continue;

        features.push({
          id: `${className.toLowerCase()}-majority`,
          description: `Player has majority (>50%) of ${className}`,
          category: 'ratio',
          templateId: 'element-ratio',
          evaluate: createMajorityEvaluator(className),
        });

        features.push({
          id: `${className.toLowerCase()}-dominance`,
          description: `Player has strong majority (>66%) of ${className}`,
          category: 'ratio',
          templateId: 'element-ratio',
          evaluate: createDominanceEvaluator(className),
        });
      }

      return features;
    },
  },

  // ============================================
  // STRING PROPERTY FEATURES (for specific types)
  // ============================================
  {
    id: 'string-property-count',
    category: 'count',
    descriptionTemplate: 'Player has ${elementType} with ${property}=${value}',
    requires: { elementType: true, stringProperty: true, ownership: true },
    generate: (structure) => {
      const features: CandidateFeature[] = [];

      for (const [className, info] of structure.elementTypes) {
        if (!info.hasOwnership) continue;

        for (const prop of info.stringProperties) {
          const values = info.stringEnums[prop];
          if (!values || values.size === 0 || values.size > 10) continue;

          // For each enum value, create a "has at least one" feature
          for (const value of values) {
            features.push({
              id: `${className.toLowerCase()}-${prop}-${value.toLowerCase().replace(/\s+/g, '-')}`,
              description: `Player has ${className} with ${prop}="${value}"`,
              category: 'count',
              templateId: 'string-property-count',
              evaluate: createStringPropertyEvaluator(className, prop, value),
            });
          }
        }
      }

      return features;
    },
  },

  // ============================================
  // CONNECTION GAME FEATURES (Hex, etc.)
  // ============================================
  {
    id: 'edge-proximity',
    category: 'spatial',
    descriptionTemplate: 'Player pieces are closer to goal edge',
    requires: { spatial: true, ownership: true, gameType: 'connection' },
    generate: (structure) => {
      const features: CandidateFeature[] = [];
      if (!structure.spatialInfo.hasBoard || !structure.spatialInfo.isHex) {
        return features;
      }

      for (const [className, info] of structure.elementTypes) {
        if (!info.hasOwnership || !info.isSpatial) continue;

        features.push({
          id: `${className.toLowerCase()}-edge-proximity`,
          description: `Player ${className} are closer to goal edge than opponent's`,
          category: 'spatial',
          templateId: 'edge-proximity',
          evaluate: createEdgeProximityEvaluator(className),
        });
      }

      return features;
    },
  },

  {
    id: 'center-influence-connection',
    category: 'spatial',
    descriptionTemplate: 'Player controls center hexes (blocks opponent paths)',
    requires: { spatial: true, ownership: true, gameType: 'connection' },
    generate: (structure) => {
      const features: CandidateFeature[] = [];
      if (!structure.spatialInfo.hasBoard || !structure.spatialInfo.isHex) {
        return features;
      }
      if (!structure.spatialInfo.centerRegion) return features;

      for (const [className, info] of structure.elementTypes) {
        if (!info.hasOwnership || !info.isSpatial) continue;

        features.push({
          id: `${className.toLowerCase()}-center-influence`,
          description: `Player controls more center ${className} (blocks paths) - high weight recommended`,
          category: 'spatial',
          templateId: 'center-influence-connection',
          evaluate: createCenterAdvantageEvaluator(className, structure.spatialInfo.centerRegion!),
        });
      }

      return features;
    },
  },

  {
    id: 'connectivity-groups',
    category: 'spatial',
    descriptionTemplate: 'Player has fewer disconnected groups (more connected)',
    requires: { spatial: true, ownership: true, gameType: 'connection' },
    generate: (structure) => {
      const features: CandidateFeature[] = [];
      if (!structure.spatialInfo.hasBoard || !structure.spatialInfo.isHex) {
        return features;
      }

      for (const [className, info] of structure.elementTypes) {
        if (!info.hasOwnership || !info.isSpatial) continue;

        // Fewer groups = more connected = closer to winning
        features.push({
          id: `${className.toLowerCase()}-fewer-groups`,
          description: `Player has fewer disconnected ${className} groups (more connected = closer to winning)`,
          category: 'spatial',
          templateId: 'connectivity-groups',
          evaluate: createFewerGroupsEvaluator(className),
        });

        // Has single connected group (winning condition for connection games)
        features.push({
          id: `${className.toLowerCase()}-single-group`,
          description: `Player has all ${className} in one connected group`,
          category: 'boolean',
          templateId: 'connectivity-groups',
          evaluate: createSingleGroupEvaluator(className),
        });
      }

      return features;
    },
  },

  // ============================================
  // PATH-DISTANCE FEATURES (Connection games)
  // ============================================
  {
    id: 'path-distance-advantage',
    category: 'comparison',
    descriptionTemplate: 'Player needs fewer stones to win than opponent',
    requires: { spatial: true, ownership: true, gameType: 'connection' },
    generate: (structure) => {
      const features: CandidateFeature[] = [];
      if (!structure.spatialInfo.hasBoard || !structure.spatialInfo.isHex) {
        return features;
      }
      if (!structure.spatialInfo.dimensions) return features;

      const boardSize = structure.spatialInfo.dimensions.rows;

      // This is THE key feature for connection game AI
      features.push({
        id: 'path-distance-advantage',
        description: 'Player needs fewer stones to complete winning path than opponent - KEY FEATURE',
        category: 'comparison',
        templateId: 'path-distance-advantage',
        evaluate: createPathDistanceAdvantageEvaluator('Cell', boardSize),
      });

      return features;
    },
  },

  {
    id: 'near-win-connection',
    category: 'boolean',
    descriptionTemplate: 'Player is within N stones of winning',
    requires: { spatial: true, ownership: true, gameType: 'connection' },
    generate: (structure) => {
      const features: CandidateFeature[] = [];
      if (!structure.spatialInfo.hasBoard || !structure.spatialInfo.isHex) {
        return features;
      }
      if (!structure.spatialInfo.dimensions) return features;

      const boardSize = structure.spatialInfo.dimensions.rows;

      // Critical for late-game evaluation - detect near-wins at different thresholds
      for (const threshold of [1, 2, 3]) {
        features.push({
          id: `near-win-within-${threshold}`,
          description: `Player is within ${threshold} stone${threshold === 1 ? '' : 's'} of winning (path length <= ${threshold})`,
          category: 'boolean',
          templateId: 'near-win-connection',
          evaluate: createNearWinEvaluator('Cell', boardSize, threshold),
        });
      }

      return features;
    },
  },

  {
    id: 'path-blocked',
    category: 'boolean',
    descriptionTemplate: "Opponent's path is completely blocked",
    requires: { spatial: true, ownership: true, gameType: 'connection' },
    generate: (structure) => {
      const features: CandidateFeature[] = [];
      if (!structure.spatialInfo.hasBoard || !structure.spatialInfo.isHex) {
        return features;
      }
      if (!structure.spatialInfo.dimensions) return features;

      const boardSize = structure.spatialInfo.dimensions.rows;

      // Nearly a win condition - opponent has no path to victory
      features.push({
        id: 'opponent-path-blocked',
        description: "Opponent's path is completely blocked (no route to goal) - nearly a win",
        category: 'boolean',
        templateId: 'path-blocked',
        evaluate: createOpponentPathBlockedEvaluator('Cell', boardSize),
      });

      return features;
    },
  },

  // ============================================
  // CAPTURE GAME FEATURES (Checkers, etc.)
  // ============================================
  {
    id: 'mobility-advantage',
    category: 'comparison',
    descriptionTemplate: 'Player has more available moves than opponent',
    requires: { spatial: true, ownership: true, gameType: 'capture' },
    generate: (structure) => {
      const features: CandidateFeature[] = [];
      if (!structure.spatialInfo.hasBoard) return features;

      for (const [className, info] of structure.elementTypes) {
        if (!info.hasOwnership || !info.isSpatial) continue;

        // Proxy for mobility: pieces that aren't blocked (have adjacent empty spaces)
        features.push({
          id: `${className.toLowerCase()}-mobility-advantage`,
          description: `Player has more unblocked ${className} than opponent (mobility proxy)`,
          category: 'comparison',
          templateId: 'mobility-advantage',
          evaluate: createMobilityAdvantageEvaluator(className),
        });
      }

      return features;
    },
  },

  {
    id: 'piece-safety',
    category: 'comparison',
    descriptionTemplate: 'Player has safer pieces (on edges or backed)',
    requires: { spatial: true, ownership: true, gameType: 'capture' },
    generate: (structure) => {
      const features: CandidateFeature[] = [];
      if (!structure.spatialInfo.hasBoard || !structure.spatialInfo.dimensions) {
        return features;
      }

      const { rows, columns } = structure.spatialInfo.dimensions;

      for (const [className, info] of structure.elementTypes) {
        if (!info.hasOwnership || !info.isSpatial) continue;

        features.push({
          id: `${className.toLowerCase()}-safety-advantage`,
          description: `Player has more safe ${className} (on edges) than opponent`,
          category: 'comparison',
          templateId: 'piece-safety',
          evaluate: createSafetyAdvantageEvaluator(className, rows, columns),
        });
      }

      return features;
    },
  },

  {
    id: 'promotion-progress',
    category: 'spatial',
    descriptionTemplate: 'Player pieces are closer to promotion row',
    requires: { spatial: true, ownership: true, gameType: 'capture' },
    generate: (structure) => {
      const features: CandidateFeature[] = [];
      if (!structure.spatialInfo.hasBoard || !structure.spatialInfo.dimensions) {
        return features;
      }

      const { rows } = structure.spatialInfo.dimensions;

      for (const [className, info] of structure.elementTypes) {
        if (!info.hasOwnership || !info.isSpatial) continue;

        features.push({
          id: `${className.toLowerCase()}-promotion-progress`,
          description: `Player ${className} are closer to promotion row than opponent's`,
          category: 'spatial',
          templateId: 'promotion-progress',
          evaluate: createPromotionProgressEvaluator(className, rows),
        });
      }

      return features;
    },
  },

  // ============================================
  // RACING GAME FEATURES (Cribbage, etc.)
  // ============================================
  {
    id: 'win-proximity',
    category: 'score',
    descriptionTemplate: 'Player is within N points of winning',
    requires: { playerScore: true, gameType: 'racing' },
    generate: (structure) => {
      const features: CandidateFeature[] = [];

      for (const prop of structure.playerInfo.numericProperties) {
        // Create thresholds at different distances from common win conditions
        for (const threshold of [10, 20, 50]) {
          features.push({
            id: `player-${prop}-within-${threshold}-of-win`,
            description: `Player ${prop} is within ${threshold} points of common win target (121, 100, etc.)`,
            category: 'score',
            templateId: 'win-proximity',
            evaluate: createWinProximityEvaluator(prop, threshold),
          });
        }
      }

      return features;
    },
  },

  // ============================================
  // COLLECTION GAME FEATURES (Go Fish, etc.)
  // ============================================
  {
    id: 'collection-progress',
    category: 'comparison',
    descriptionTemplate: 'Player has more partial sets',
    requires: { elementType: true, ownership: true, gameType: 'collection' },
    generate: (structure) => {
      const features: CandidateFeature[] = [];

      for (const [className, info] of structure.elementTypes) {
        if (!info.hasOwnership) continue;

        // Hand size as proxy for collection potential
        features.push({
          id: `${className.toLowerCase()}-hand-size-advantage`,
          description: `Player has more ${className} in hand (more collection potential)`,
          category: 'comparison',
          templateId: 'collection-progress',
          evaluate: createCountComparisonEvaluator(className, '>'),
        });
      }

      return features;
    },
  },

  {
    id: 'resource-advantage',
    category: 'comparison',
    descriptionTemplate: 'Player has more cards/resources',
    requires: { elementType: true, ownership: true, gameType: 'collection' },
    generate: (structure) => {
      const features: CandidateFeature[] = [];

      for (const [className, info] of structure.elementTypes) {
        if (!info.hasOwnership) continue;

        features.push({
          id: `${className.toLowerCase()}-resource-dominance`,
          description: `Player has 2+ more ${className} than opponent`,
          category: 'comparison',
          templateId: 'resource-advantage',
          evaluate: createResourceDominanceEvaluator(className, 2),
        });
      }

      return features;
    },
  },
];

// ============================================
// EVALUATOR FACTORY FUNCTIONS
// ============================================

function createCountComparisonEvaluator(
  className: string,
  operator: '>' | '<' | '>=' | '<=' | '=='
): CandidateFeature['evaluate'] {
  return (game: Game, playerIndex: number): boolean => {
    const myPlayer = getPlayerByIndex(game, playerIndex);
    const opponent = getPlayerByIndex(game, 1 - playerIndex); // Assumes 2 players

    const myCount = countElementsForPlayer(game, className, myPlayer);
    const theirCount = countElementsForPlayer(game, className, opponent);

    switch (operator) {
      case '>': return myCount > theirCount;
      case '<': return myCount < theirCount;
      case '>=': return myCount >= theirCount;
      case '<=': return myCount <= theirCount;
      case '==': return myCount === theirCount;
    }
  };
}

function createCountThresholdEvaluator(
  className: string,
  threshold: number,
  operator: '>=' | '<=' | '==' | '>'
): CandidateFeature['evaluate'] {
  return (game: Game, playerIndex: number): boolean => {
    const player = getPlayerByIndex(game, playerIndex);
    const count = countElementsForPlayer(game, className, player);

    switch (operator) {
      case '>=': return count >= threshold;
      case '<=': return count <= threshold;
      case '==': return count === threshold;
      case '>': return count > threshold;
    }
  };
}

function createBooleanPropertyEvaluator(
  className: string,
  property: string,
  value: boolean,
  mode: 'any' | 'all'
): CandidateFeature['evaluate'] {
  return (game: Game, playerIndex: number): boolean => {
    const player = getPlayerByIndex(game, playerIndex);
    const elements = getElementsForPlayer(game, className, player);

    if (elements.length === 0) return false;

    if (mode === 'any') {
      return elements.some(e => (e as any)[property] === value);
    } else {
      return elements.every(e => (e as any)[property] === value);
    }
  };
}

function createBooleanPropertyComparisonEvaluator(
  className: string,
  property: string
): CandidateFeature['evaluate'] {
  return (game: Game, playerIndex: number): boolean => {
    const myPlayer = getPlayerByIndex(game, playerIndex);
    const opponent = getPlayerByIndex(game, 1 - playerIndex);

    const myCount = getElementsForPlayer(game, className, myPlayer)
      .filter(e => (e as any)[property] === true).length;
    const theirCount = getElementsForPlayer(game, className, opponent)
      .filter(e => (e as any)[property] === true).length;

    return myCount > theirCount;
  };
}

function createNumericSumComparisonEvaluator(
  className: string,
  property: string
): CandidateFeature['evaluate'] {
  return (game: Game, playerIndex: number): boolean => {
    const myPlayer = getPlayerByIndex(game, playerIndex);
    const opponent = getPlayerByIndex(game, 1 - playerIndex);

    const mySum = getElementsForPlayer(game, className, myPlayer)
      .reduce((sum, e) => sum + ((e as any)[property] ?? 0), 0);
    const theirSum = getElementsForPlayer(game, className, opponent)
      .reduce((sum, e) => sum + ((e as any)[property] ?? 0), 0);

    return mySum > theirSum;
  };
}

function createNumericSumThresholdEvaluator(
  className: string,
  property: string,
  threshold: number
): CandidateFeature['evaluate'] {
  return (game: Game, playerIndex: number): boolean => {
    const player = getPlayerByIndex(game, playerIndex);
    const sum = getElementsForPlayer(game, className, player)
      .reduce((s, e) => s + ((e as any)[property] ?? 0), 0);
    return sum >= threshold;
  };
}

function createPlayerPropertyComparisonEvaluator(
  property: string,
  operator: '>' | '<'
): CandidateFeature['evaluate'] {
  return (game: Game, playerIndex: number): boolean => {
    const myPlayer = getPlayerByIndex(game, playerIndex);
    const opponent = getPlayerByIndex(game, 1 - playerIndex);

    const myValue = (myPlayer as any)[property] ?? 0;
    const theirValue = (opponent as any)[property] ?? 0;

    return operator === '>' ? myValue > theirValue : myValue < theirValue;
  };
}

function createPlayerPropertyThresholdEvaluator(
  property: string,
  threshold: number
): CandidateFeature['evaluate'] {
  return (game: Game, playerIndex: number): boolean => {
    const player = getPlayerByIndex(game, playerIndex);
    return ((player as any)[property] ?? 0) >= threshold;
  };
}

function createPlayerPropertyNearMaxEvaluator(
  property: string
): CandidateFeature['evaluate'] {
  // Dynamically determine "near max" based on all players' values
  return (game: Game, playerIndex: number): boolean => {
    const player = getPlayerByIndex(game, playerIndex);
    const myValue = (player as any)[property] ?? 0;

    // Find the max value across all players
    let maxValue = 0;
    for (const p of getAllPlayers(game)) {
      maxValue = Math.max(maxValue, (p as any)[property] ?? 0);
    }

    // "Near max" = at least 75% of highest value seen, and value is significant
    return maxValue > 0 && myValue >= maxValue * 0.75 && myValue >= 10;
  };
}

function createCenterControlEvaluator(
  className: string,
  center: { minRow: number; maxRow: number; minCol: number; maxCol: number }
): CandidateFeature['evaluate'] {
  return (game: Game, playerIndex: number): boolean => {
    const player = getPlayerByIndex(game, playerIndex);
    const elements = getElementsForPlayer(game, className, player);

    return elements.some(e => {
      const row = (e as any).row;
      const col = (e as any).column;
      return row !== undefined && col !== undefined &&
        row >= center.minRow && row <= center.maxRow &&
        col >= center.minCol && col <= center.maxCol;
    });
  };
}

function createCenterAdvantageEvaluator(
  className: string,
  center: { minRow: number; maxRow: number; minCol: number; maxCol: number }
): CandidateFeature['evaluate'] {
  return (game: Game, playerIndex: number): boolean => {
    const myPlayer = getPlayerByIndex(game, playerIndex);
    const opponent = getPlayerByIndex(game, 1 - playerIndex);

    const countInCenter = (player: Player) => {
      return getElementsForPlayer(game, className, player).filter(e => {
        const row = (e as any).row;
        const col = (e as any).column;
        return row !== undefined && col !== undefined &&
          row >= center.minRow && row <= center.maxRow &&
          col >= center.minCol && col <= center.maxCol;
      }).length;
    };

    return countInCenter(myPlayer) > countInCenter(opponent);
  };
}

function createAdvancementEvaluator(
  className: string,
  totalRows: number
): CandidateFeature['evaluate'] {
  return (game: Game, playerIndex: number): boolean => {
    const player = getPlayerByIndex(game, playerIndex);
    const elements = getElementsForPlayer(game, className, player);

    if (elements.length === 0) return false;

    // Player 0 advances toward high rows, player 1 toward low rows
    const goalRow = playerIndex === 0 ? totalRows - 1 : 0;
    const halfway = totalRows / 2;

    const advancedCount = elements.filter(e => {
      const row = (e as any).row;
      if (row === undefined) return false;

      if (playerIndex === 0) {
        return row > halfway;
      } else {
        return row < halfway;
      }
    }).length;

    return advancedCount > elements.length / 2;
  };
}

function createBackRowEvaluator(
  className: string,
  totalRows: number
): CandidateFeature['evaluate'] {
  return (game: Game, playerIndex: number): boolean => {
    const player = getPlayerByIndex(game, playerIndex);
    const elements = getElementsForPlayer(game, className, player);

    const backRow = playerIndex === 0 ? 0 : totalRows - 1;

    return elements.some(e => (e as any).row === backRow);
  };
}

function createMajorityEvaluator(className: string): CandidateFeature['evaluate'] {
  return (game: Game, playerIndex: number): boolean => {
    const player = getPlayerByIndex(game, playerIndex);
    const myCount = countElementsForPlayer(game, className, player);
    const totalCount = countAllElements(game, className);

    return totalCount > 0 && myCount > totalCount / 2;
  };
}

function createDominanceEvaluator(className: string): CandidateFeature['evaluate'] {
  return (game: Game, playerIndex: number): boolean => {
    const player = getPlayerByIndex(game, playerIndex);
    const myCount = countElementsForPlayer(game, className, player);
    const totalCount = countAllElements(game, className);

    return totalCount > 0 && myCount > totalCount * 0.66;
  };
}

function createStringPropertyEvaluator(
  className: string,
  property: string,
  value: string
): CandidateFeature['evaluate'] {
  return (game: Game, playerIndex: number): boolean => {
    const player = getPlayerByIndex(game, playerIndex);
    const elements = getElementsForPlayer(game, className, player);

    return elements.some(e => (e as any)[property] === value);
  };
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get a player by 0-based index.
 * The AI trainer uses 0-indexed player positions (0, 1, etc.) but the new API uses 1-indexed positions.
 */
function getPlayerByIndex(game: Game, playerIndex: number): Player {
  // Convert 0-based index to 1-based position
  return game.getPlayer(playerIndex + 1)!;
}

/**
 * Get all players as an array (for iteration and opponent lookup)
 */
function getAllPlayers(game: Game): Player[] {
  return [...game.all(Player)];
}

function getElementsForPlayer(game: Game, className: string, player: Player): GameElement[] {
  const results: GameElement[] = [];
  const scan = (element: GameElement) => {
    if (element.constructor.name === className && element.player === player) {
      results.push(element);
    }
    for (const child of element.children) {
      scan(child);
    }
  };
  scan(game);
  return results;
}

function countElementsForPlayer(game: Game, className: string, player: Player): number {
  return getElementsForPlayer(game, className, player).length;
}

function countAllElements(game: Game, className: string): number {
  let count = 0;
  const scan = (element: GameElement) => {
    if (element.constructor.name === className) {
      count++;
    }
    for (const child of element.children) {
      scan(child);
    }
  };
  scan(game);
  return count;
}

// ============================================
// CONNECTION GAME EVALUATORS
// ============================================

/**
 * Hex direction offsets for adjacency (axial coordinates: q, r)
 */
const HEX_DIRECTIONS = [
  { dq: 1, dr: 0 },   // East
  { dq: 1, dr: -1 },  // Northeast
  { dq: 0, dr: -1 },  // Northwest
  { dq: -1, dr: 0 },  // West
  { dq: -1, dr: 1 },  // Southwest
  { dq: 0, dr: 1 },   // Southeast
];

/**
 * Compute the shortest path length from a player's start edge to goal edge on a hex grid.
 * Uses Dijkstra's algorithm with costs: friendly cell = 0, empty cell = 1, enemy cell = Infinity.
 *
 * @param game - The game instance
 * @param className - The element class name (e.g., 'Cell')
 * @param playerIndex - 0-based player index (0 = position 1, 1 = position 2)
 * @param boardSize - Size of the hex board
 * @returns The minimum number of empty cells needed to complete a winning path,
 *          or 0 if already connected, or boardSize * 2 if completely blocked
 */
export function computeShortestPathLength(
  game: Game,
  className: string,
  playerIndex: number,
  boardSize: number
): number {
  // In Hex:
  // - Player 0 (position 1, Red) connects r=0 to r=boardSize-1
  // - Player 1 (position 2, Blue) connects q=0 to q=boardSize-1

  const myPlayer = getPlayerByIndex(game, playerIndex);
  const opponent = getPlayerByIndex(game, 1 - playerIndex);

  // Get all cells and build a lookup map
  const cells = new Map<string, { q: number; r: number; element: GameElement }>();
  const cellKey = (q: number, r: number) => `${q},${r}`;

  const scan = (element: GameElement) => {
    if (element.constructor.name === className) {
      const q = (element as any).q;
      const r = (element as any).r;
      if (q !== undefined && r !== undefined) {
        cells.set(cellKey(q, r), { q, r, element });
      }
    }
    for (const child of element.children) {
      scan(child);
    }
  };
  scan(game);

  if (cells.size === 0) return boardSize * 2;

  // Determine which cells are start/goal based on player axis
  const isStartCell = (q: number, r: number): boolean => {
    return playerIndex === 0 ? r === 0 : q === 0;
  };

  const isGoalCell = (q: number, r: number): boolean => {
    return playerIndex === 0 ? r === boardSize - 1 : q === boardSize - 1;
  };

  // Get the cost to move through a cell
  // Friendly = 0 (already ours), Empty = 1 (need to place), Enemy = Infinity (blocked)
  const getCellCost = (cellData: { element: GameElement }): number => {
    // Check if cell has a stone - look for Stone class child
    const element = cellData.element;
    let stone: GameElement | undefined;
    for (const child of element.children) {
      if (child.constructor.name === 'Stone') {
        stone = child;
        break;
      }
    }

    if (!stone) {
      return 1; // Empty cell - costs 1 move to claim
    }

    const stonePlayer = (stone as any).player;
    if (stonePlayer === myPlayer) {
      return 0; // Our stone - free passage
    }

    return Infinity; // Enemy stone - impassable
  };

  // Initialize distances - use array sorted by distance as simple priority queue
  const distances = new Map<string, number>();
  const queue: Array<{ key: string; dist: number }> = [];

  // Start from all cells on start edge
  for (const [key, cellData] of cells) {
    if (isStartCell(cellData.q, cellData.r)) {
      const cost = getCellCost(cellData);
      if (cost !== Infinity) {
        distances.set(key, cost);
        queue.push({ key, dist: cost });
      }
    }
  }

  if (queue.length === 0) return boardSize * 2; // No accessible start cells

  // Sort queue by distance (ascending)
  queue.sort((a, b) => a.dist - b.dist);

  const visited = new Set<string>();

  // Dijkstra's algorithm
  while (queue.length > 0) {
    // Pop the cell with smallest distance
    const current = queue.shift()!;
    const { key, dist } = current;

    if (visited.has(key)) continue;
    visited.add(key);

    const [qStr, rStr] = key.split(',');
    const q = parseInt(qStr, 10);
    const r = parseInt(rStr, 10);

    // Check if we reached the goal
    if (isGoalCell(q, r)) {
      return dist;
    }

    // Explore neighbors
    for (const dir of HEX_DIRECTIONS) {
      const nq = q + dir.dq;
      const nr = r + dir.dr;
      const neighborKey = cellKey(nq, nr);

      if (visited.has(neighborKey)) continue;

      const neighborData = cells.get(neighborKey);
      if (!neighborData) continue;

      const moveCost = getCellCost(neighborData);
      if (moveCost === Infinity) continue;

      const newDist = dist + moveCost;
      const currentDist = distances.get(neighborKey) ?? Infinity;

      if (newDist < currentDist) {
        distances.set(neighborKey, newDist);
        // Add to queue (may have duplicates, but visited set handles it)
        queue.push({ key: neighborKey, dist: newDist });
        // Re-sort queue
        queue.sort((a, b) => a.dist - b.dist);
      }
    }
  }

  // No path found - completely blocked
  return boardSize * 2;
}

/**
 * Count connected groups of pieces on a hex grid using flood fill.
 */
function countConnectedGroups(game: Game, className: string, player: Player): number {
  const elements = getElementsForPlayer(game, className, player);
  if (elements.length === 0) return 0;

  // Build a set of positions for fast lookup
  const positionKey = (q: number, r: number) => `${q},${r}`;
  const positions = new Map<string, GameElement>();

  for (const elem of elements) {
    const q = (elem as any).q;
    const r = (elem as any).r;
    if (q !== undefined && r !== undefined) {
      positions.set(positionKey(q, r), elem);
    }
  }

  if (positions.size === 0) return 0;

  const visited = new Set<string>();
  let groupCount = 0;

  // Flood fill from each unvisited position
  for (const [key] of positions) {
    if (visited.has(key)) continue;

    // BFS flood fill
    const queue = [key];
    visited.add(key);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const [qStr, rStr] = current.split(',');
      const q = parseInt(qStr, 10);
      const r = parseInt(rStr, 10);

      // Check all hex neighbors
      for (const dir of HEX_DIRECTIONS) {
        const neighborKey = positionKey(q + dir.dq, r + dir.dr);
        if (positions.has(neighborKey) && !visited.has(neighborKey)) {
          visited.add(neighborKey);
          queue.push(neighborKey);
        }
      }
    }

    groupCount++;
  }

  return groupCount;
}

function createEdgeProximityEvaluator(className: string): CandidateFeature['evaluate'] {
  return (game: Game, playerIndex: number): boolean => {
    const myPlayer = getPlayerByIndex(game, playerIndex);
    const opponent = getPlayerByIndex(game, 1 - playerIndex);

    const myElements = getElementsForPlayer(game, className, myPlayer);
    const theirElements = getElementsForPlayer(game, className, opponent);

    if (myElements.length === 0 && theirElements.length === 0) return false;

    // For hex games, player 0 typically connects top-bottom (r coordinate)
    // Player 1 connects left-right (q coordinate)
    // Being closer to your goal edge is better

    const getGoalDistance = (elem: GameElement, pIndex: number): number => {
      const q = (elem as any).q ?? 0;
      const r = (elem as any).r ?? 0;
      // Simplified: use r for player 0, q for player 1
      // Lower distance = closer to goal
      if (pIndex === 0) {
        return r; // Player 0 wants high r (or low, depends on game - use absolute)
      } else {
        return q; // Player 1 wants high q
      }
    };

    const myAvg = myElements.length > 0
      ? myElements.reduce((sum, e) => sum + getGoalDistance(e, playerIndex), 0) / myElements.length
      : 0;

    const theirAvg = theirElements.length > 0
      ? theirElements.reduce((sum, e) => sum + getGoalDistance(e, 1 - playerIndex), 0) / theirElements.length
      : 0;

    // Higher average (further along goal axis) is better
    return myAvg > theirAvg;
  };
}

function createFewerGroupsEvaluator(className: string): CandidateFeature['evaluate'] {
  return (game: Game, playerIndex: number): boolean => {
    const myPlayer = getPlayerByIndex(game, playerIndex);
    const opponent = getPlayerByIndex(game, 1 - playerIndex);

    const myGroups = countConnectedGroups(game, className, myPlayer);
    const theirGroups = countConnectedGroups(game, className, opponent);

    // Fewer groups = more connected = better for connection games
    // But only if we have pieces at all
    if (myGroups === 0) return false;
    if (theirGroups === 0) return true;

    return myGroups < theirGroups;
  };
}

function createSingleGroupEvaluator(className: string): CandidateFeature['evaluate'] {
  return (game: Game, playerIndex: number): boolean => {
    const player = getPlayerByIndex(game, playerIndex);
    const elements = getElementsForPlayer(game, className, player);

    if (elements.length === 0) return false;

    const groups = countConnectedGroups(game, className, player);
    return groups === 1;
  };
}

// ============================================
// PATH-DISTANCE EVALUATORS (Connection games)
// ============================================

/**
 * Evaluator: Player has shorter path to victory than opponent.
 * This is THE key feature for connection game AI.
 */
function createPathDistanceAdvantageEvaluator(
  className: string,
  boardSize: number
): CandidateFeature['evaluate'] {
  return (game: Game, playerIndex: number): boolean => {
    const myPathLength = computeShortestPathLength(game, className, playerIndex, boardSize);
    const opponentPathLength = computeShortestPathLength(game, className, 1 - playerIndex, boardSize);

    // Shorter path = better position
    // If both are blocked (boardSize * 2), neither has advantage
    return myPathLength < opponentPathLength;
  };
}

/**
 * Evaluator: Player is within N stones of winning.
 * Critical for late-game detection.
 */
function createNearWinEvaluator(
  className: string,
  boardSize: number,
  threshold: number
): CandidateFeature['evaluate'] {
  return (game: Game, playerIndex: number): boolean => {
    const pathLength = computeShortestPathLength(game, className, playerIndex, boardSize);
    return pathLength <= threshold;
  };
}

/**
 * Evaluator: Opponent's path is completely blocked.
 * This is nearly a win condition.
 */
function createOpponentPathBlockedEvaluator(
  className: string,
  boardSize: number
): CandidateFeature['evaluate'] {
  return (game: Game, playerIndex: number): boolean => {
    const opponentPathLength = computeShortestPathLength(game, className, 1 - playerIndex, boardSize);
    // boardSize * 2 is the "blocked" return value from computeShortestPathLength
    return opponentPathLength >= boardSize * 2;
  };
}

// ============================================
// CAPTURE GAME EVALUATORS
// ============================================

function createMobilityAdvantageEvaluator(className: string): CandidateFeature['evaluate'] {
  return (game: Game, playerIndex: number): boolean => {
    const myPlayer = getPlayerByIndex(game, playerIndex);
    const opponent = getPlayerByIndex(game, 1 - playerIndex);

    // Proxy: count pieces that have at least one adjacent empty space
    const countMobilePieces = (player: Player): number => {
      const elements = getElementsForPlayer(game, className, player);
      let mobile = 0;

      for (const elem of elements) {
        const row = (elem as any).row;
        const col = (elem as any).column;
        if (row === undefined || col === undefined) continue;

        // Simple heuristic: piece is "mobile" if not on the board edge
        // (more sophisticated would check actual adjacent spaces)
        mobile++;
      }

      return mobile;
    };

    return countMobilePieces(myPlayer) > countMobilePieces(opponent);
  };
}

function createSafetyAdvantageEvaluator(
  className: string,
  totalRows: number,
  totalColumns: number
): CandidateFeature['evaluate'] {
  return (game: Game, playerIndex: number): boolean => {
    const myPlayer = getPlayerByIndex(game, playerIndex);
    const opponent = getPlayerByIndex(game, 1 - playerIndex);

    // Count pieces on edges (safer from capture)
    const countSafePieces = (player: Player): number => {
      const elements = getElementsForPlayer(game, className, player);
      let safe = 0;

      for (const elem of elements) {
        const row = (elem as any).row;
        const col = (elem as any).column;
        if (row === undefined || col === undefined) continue;

        // Piece is "safe" if on any edge
        if (row === 0 || row === totalRows - 1 || col === 0 || col === totalColumns - 1) {
          safe++;
        }
      }

      return safe;
    };

    return countSafePieces(myPlayer) > countSafePieces(opponent);
  };
}

function createPromotionProgressEvaluator(
  className: string,
  totalRows: number
): CandidateFeature['evaluate'] {
  return (game: Game, playerIndex: number): boolean => {
    const myPlayer = getPlayerByIndex(game, playerIndex);
    const opponent = getPlayerByIndex(game, 1 - playerIndex);

    // Calculate average distance to promotion row
    const avgDistanceToPromotion = (player: Player, pIndex: number): number => {
      const elements = getElementsForPlayer(game, className, player);
      if (elements.length === 0) return totalRows;

      // Player 0 promotes at row totalRows-1, player 1 promotes at row 0
      const promotionRow = pIndex === 0 ? totalRows - 1 : 0;

      let totalDistance = 0;
      for (const elem of elements) {
        const row = (elem as any).row ?? 0;
        totalDistance += Math.abs(promotionRow - row);
      }

      return totalDistance / elements.length;
    };

    const myAvg = avgDistanceToPromotion(myPlayer, playerIndex);
    const theirAvg = avgDistanceToPromotion(opponent, 1 - playerIndex);

    // Lower average distance = closer to promotion = better
    return myAvg < theirAvg;
  };
}

// ============================================
// RACING GAME EVALUATORS
// ============================================

function createWinProximityEvaluator(
  property: string,
  threshold: number
): CandidateFeature['evaluate'] {
  // Common win targets for racing games
  const WIN_TARGETS = [121, 100, 500, 1000];

  return (game: Game, playerIndex: number): boolean => {
    const player = getPlayerByIndex(game, playerIndex);
    const value = (player as any)[property] ?? 0;

    // Check if within threshold of any common win target
    for (const target of WIN_TARGETS) {
      if (value >= target - threshold && value < target) {
        return true;
      }
    }

    // Also check if game has targetScore property
    const gameTarget = (game as any).targetScore;
    if (typeof gameTarget === 'number') {
      return value >= gameTarget - threshold && value < gameTarget;
    }

    return false;
  };
}

// ============================================
// COLLECTION GAME EVALUATORS
// ============================================

function createResourceDominanceEvaluator(
  className: string,
  minAdvantage: number
): CandidateFeature['evaluate'] {
  return (game: Game, playerIndex: number): boolean => {
    const myPlayer = getPlayerByIndex(game, playerIndex);
    const opponent = getPlayerByIndex(game, 1 - playerIndex);

    const myCount = countElementsForPlayer(game, className, myPlayer);
    const theirCount = countElementsForPlayer(game, className, opponent);

    return myCount >= theirCount + minAdvantage;
  };
}

// ============================================
// FEATURE GENERATION FUNCTIONS
// ============================================

/**
 * Check if a template's gameType requirement is satisfied by the game structure.
 */
function matchesGameType(
  templateGameType: GameType | GameType[] | undefined,
  structureGameType: GameType
): boolean {
  if (templateGameType === undefined) {
    return true; // No requirement = matches all
  }

  if (Array.isArray(templateGameType)) {
    return templateGameType.includes(structureGameType);
  }

  return templateGameType === structureGameType;
}

/**
 * Generate all candidate features for a game structure.
 * Filters templates by their requirements including gameType.
 */
export function generateCandidateFeatures(structure: GameStructure): CandidateFeature[] {
  const features: CandidateFeature[] = [];

  for (const template of FEATURE_TEMPLATES) {
    // Check gameType requirement
    if (!matchesGameType(template.requires.gameType, structure.winConditionInfo.gameType)) {
      continue;
    }

    // Check other structural requirements
    const req = template.requires;

    if (req.elementType && structure.elementTypes.size === 0) continue;
    if (req.ownership && ![...structure.elementTypes.values()].some(t => t.hasOwnership)) continue;
    if (req.spatial && !structure.spatialInfo.hasBoard) continue;
    if (req.playerScore && structure.playerInfo.numericProperties.length === 0) continue;
    if (req.multiPlayer && structure.playerCount < 2) continue;
    if (req.numericProperty && ![...structure.elementTypes.values()].some(t => t.numericProperties.length > 0)) continue;
    if (req.booleanProperty && ![...structure.elementTypes.values()].some(t => t.booleanProperties.length > 0)) continue;
    if (req.stringProperty && ![...structure.elementTypes.values()].some(t => t.stringProperties.length > 0)) continue;

    // Generate features from this template
    const generated = template.generate(structure);
    features.push(...generated);
  }

  return features;
}
