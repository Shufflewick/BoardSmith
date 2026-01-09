import { Player, type Game, type GameElement } from '@boardsmith/engine';
import type { GameStructure, ElementTypeInfo, CandidateFeature } from './types.js';

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
