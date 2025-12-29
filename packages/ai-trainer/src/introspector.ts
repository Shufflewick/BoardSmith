import type { Game, GameElement, Player } from '@boardsmith/engine';
import type {
  GameStructure,
  ElementTypeInfo,
  PlayerTypeInfo,
  SpatialInfo,
  GameClass,
} from './types.js';

/**
 * Properties to skip when introspecting elements
 */
const SKIP_PROPERTIES = new Set([
  // Internal properties
  '_ctx', '_t', '_visibility', 'game',
  // Standard GameElement properties
  'name', 'player', '$image', '$images',
  // Methods and functions
  'constructor', 'toString', 'toJSON',
]);

/**
 * Properties that indicate spatial positioning
 */
const SPATIAL_PROPERTIES = new Set(['row', 'column', 'x', 'y', 'q', 'r', 's']);

/**
 * Introspect a game instance to discover its structure
 */
export function introspectGame(game: Game): GameStructure {
  const elementTypes = new Map<string, ElementTypeInfo>();
  const visited = new Set<GameElement>();

  // Recursively discover all element types
  discoverElements(game, elementTypes, visited);

  // Discover player properties
  const playerInfo = discoverPlayerInfo(game);

  // Discover spatial structure
  const spatialInfo = discoverSpatialInfo(game, elementTypes);

  return {
    elementTypes,
    playerInfo,
    spatialInfo,
    playerCount: game.players.length,
  };
}

/**
 * Recursively discover element types in the game tree
 */
function discoverElements(
  element: GameElement,
  types: Map<string, ElementTypeInfo>,
  visited: Set<GameElement>
): void {
  if (visited.has(element)) return;
  visited.add(element);

  const className = element.constructor.name;

  // Skip the base Game class and internal elements
  if (className !== 'Game' && className !== 'GameElement' && !className.startsWith('_')) {
    // Get or create type info
    let typeInfo = types.get(className);
    if (!typeInfo) {
      typeInfo = {
        className,
        numericProperties: [],
        booleanProperties: [],
        stringProperties: [],
        hasOwnership: false,
        isSpatial: false,
        stringEnums: {},
      };
      types.set(className, typeInfo);
    }

    // Discover properties from this instance
    discoverProperties(element, typeInfo);
  }

  // Recurse to children
  for (const child of element.children) {
    discoverElements(child, types, visited);
  }
}

/**
 * Discover properties on an element instance
 */
function discoverProperties(element: GameElement, typeInfo: ElementTypeInfo): void {
  // Check ownership
  if (element.player !== undefined) {
    typeInfo.hasOwnership = true;
  }

  // Check spatial properties
  if (element.row !== undefined || element.column !== undefined) {
    typeInfo.isSpatial = true;
  }

  // Get all own properties (not inherited)
  const proto = Object.getPrototypeOf(element);
  const allProps = new Set([
    ...Object.keys(element),
    ...Object.getOwnPropertyNames(proto).filter(p => {
      const desc = Object.getOwnPropertyDescriptor(proto, p);
      return desc && (desc.get || typeof desc.value !== 'function');
    }),
  ]);

  for (const prop of allProps) {
    if (SKIP_PROPERTIES.has(prop)) continue;
    if (prop.startsWith('_')) continue;
    if (SPATIAL_PROPERTIES.has(prop)) {
      typeInfo.isSpatial = true;
      continue;
    }

    try {
      const value = (element as any)[prop];
      if (value === undefined || value === null) continue;

      const valueType = typeof value;

      if (valueType === 'number' && !typeInfo.numericProperties.includes(prop)) {
        typeInfo.numericProperties.push(prop);
      } else if (valueType === 'boolean' && !typeInfo.booleanProperties.includes(prop)) {
        typeInfo.booleanProperties.push(prop);
      } else if (valueType === 'string' && !typeInfo.stringProperties.includes(prop)) {
        typeInfo.stringProperties.push(prop);
        // Track enum values
        if (!typeInfo.stringEnums[prop]) {
          typeInfo.stringEnums[prop] = new Set();
        }
        typeInfo.stringEnums[prop].add(value);
      }
    } catch {
      // Skip properties that throw on access
    }
  }
}

/**
 * Discover player-specific properties
 */
function discoverPlayerInfo(game: Game): PlayerTypeInfo {
  const info: PlayerTypeInfo = {
    numericProperties: [],
    booleanProperties: [],
    stringProperties: [],
  };

  if (game.players.length === 0) return info;

  const player = game.players[0];
  const proto = Object.getPrototypeOf(player);

  // Skip standard Player properties
  const skipPlayerProps = new Set([
    'position', 'name', 'color', 'game', '_isCurrent',
    'constructor', 'toString', 'toJSON', 'isCurrent', 'setCurrent',
    'allMy', 'my', 'has',
  ]);

  const allProps = new Set([
    ...Object.keys(player),
    ...Object.getOwnPropertyNames(proto).filter(p => {
      const desc = Object.getOwnPropertyDescriptor(proto, p);
      return desc && (desc.get || typeof desc.value !== 'function');
    }),
  ]);

  for (const prop of allProps) {
    if (skipPlayerProps.has(prop)) continue;
    if (prop.startsWith('_')) continue;

    try {
      const value = (player as any)[prop];
      if (value === undefined || value === null) continue;

      const valueType = typeof value;

      if (valueType === 'number') {
        info.numericProperties.push(prop);
      } else if (valueType === 'boolean') {
        info.booleanProperties.push(prop);
      } else if (valueType === 'string') {
        info.stringProperties.push(prop);
      }
    } catch {
      // Skip properties that throw on access
    }
  }

  return info;
}

/**
 * Board-related class name patterns
 */
const BOARD_CLASS_PATTERNS = ['Board', 'Grid', 'Map', 'Field', 'Arena', 'Table'];

/**
 * Discover spatial/board structure
 */
function discoverSpatialInfo(
  game: Game,
  elementTypes: Map<string, ElementTypeInfo>
): SpatialInfo {
  const info: SpatialInfo = {
    hasBoard: false,
    isHex: false,
  };

  // Check for spatial element types
  let minRow = Infinity;
  let maxRow = 0;
  let minCol = Infinity;
  let maxCol = 0;
  let hasSpatialElements = false;
  let spatialElementCount = 0;

  // Look for Grid, Board, or other spatial containers
  for (const [className, typeInfo] of elementTypes) {
    // Check class name patterns
    for (const pattern of BOARD_CLASS_PATTERNS) {
      if (className.includes(pattern)) {
        info.hasBoard = true;
        if (className.includes('Hex')) {
          info.isHex = true;
        }
        break;
      }
    }

    // Also check if this type has spatial elements
    if (typeInfo.isSpatial) {
      info.hasBoard = true;
    }
  }

  // Scan for spatial elements to determine dimensions
  const scanSpatial = (element: GameElement) => {
    // Check for row/column positioning
    if (element.row !== undefined && element.column !== undefined) {
      hasSpatialElements = true;
      spatialElementCount++;
      minRow = Math.min(minRow, element.row);
      maxRow = Math.max(maxRow, element.row);
      minCol = Math.min(minCol, element.column);
      maxCol = Math.max(maxCol, element.column);
    }

    // Also check for hex coordinates (q, r, s)
    const elem = element as any;
    if (elem.q !== undefined && elem.r !== undefined) {
      info.isHex = true;
      hasSpatialElements = true;
    }

    for (const child of element.children) {
      scanSpatial(child);
    }
  };
  scanSpatial(game);

  if (hasSpatialElements) {
    info.hasBoard = true;

    // Only set dimensions if we found valid bounds
    if (maxRow >= minRow && maxCol >= minCol) {
      const rows = maxRow - minRow + 1;
      const cols = maxCol - minCol + 1;
      info.dimensions = { rows, columns: cols };

      // Calculate center region (middle third)
      // For asymmetric boards, this adapts to the actual size
      const rowMargin = Math.max(1, Math.floor(rows / 3));
      const colMargin = Math.max(1, Math.floor(cols / 3));
      info.centerRegion = {
        minRow: minRow + rowMargin,
        maxRow: maxRow - rowMargin,
        minCol: minCol + colMargin,
        maxCol: maxCol - colMargin,
      };
    }
  }

  return info;
}

/**
 * Create a game instance for introspection
 */
export function createIntrospectionGame<G extends Game>(
  GameClass: GameClass<G>,
  playerCount: number = 2
): G {
  return new GameClass({
    playerCount,
    seed: 'introspection',
  });
}

/**
 * Complexity estimation result
 */
export interface GameComplexity {
  /** Overall complexity score (0-100) */
  score: number;
  /** Recommended MCTS iterations */
  recommendedMCTS: number;
  /** Complexity category */
  category: 'simple' | 'moderate' | 'complex' | 'very-complex';
  /** Factors contributing to complexity */
  factors: {
    elementTypes: number;
    hasSpatial: boolean;
    boardSize: number;
    playerProperties: number;
    estimatedBranchingFactor: number;
  };
}

/**
 * Estimate game complexity from structure
 *
 * Calibration benchmarks:
 * - Go Fish, War, Memory: simple (< 30)
 * - Checkers, Connect Four, Tic-Tac-Toe: simple (< 30)
 * - Chess, Backgammon: moderate (30-50)
 * - Go, Stratego: complex (50-70)
 * - Civilization-style games: very-complex (> 70)
 */
export function estimateComplexity(structure: GameStructure): GameComplexity {
  const factors = {
    elementTypes: structure.elementTypes.size,
    hasSpatial: structure.spatialInfo.hasBoard,
    boardSize: structure.spatialInfo.dimensions
      ? structure.spatialInfo.dimensions.rows * structure.spatialInfo.dimensions.columns
      : 0,
    playerProperties:
      structure.playerInfo.numericProperties.length +
      structure.playerInfo.booleanProperties.length,
    estimatedBranchingFactor: 1,
  };

  // Estimate branching factor based on game characteristics
  if (factors.hasSpatial && factors.boardSize > 0) {
    // Board games: branching depends on board size and piece mobility
    // Checkers (64 squares): ~10-20 moves typical
    // Chess (64 squares): ~30-40 moves typical
    // Go (361 squares): ~200+ moves typical
    if (factors.boardSize <= 64) {
      factors.estimatedBranchingFactor = 15; // Small boards like checkers/chess
    } else if (factors.boardSize <= 100) {
      factors.estimatedBranchingFactor = 30; // Medium boards
    } else {
      factors.estimatedBranchingFactor = 50 + factors.boardSize / 10; // Large boards like Go
    }
  } else {
    // Card/non-spatial games: typically 3-10 options per turn
    factors.estimatedBranchingFactor = Math.min(10, factors.elementTypes + 3);
  }

  // Calculate complexity score (0-100 scale)
  let score = 0;

  // Element type diversity (0-10)
  // Most games have 2-5 element types, this shouldn't dominate
  score += Math.min(10, factors.elementTypes * 2);

  // Spatial complexity (0-25)
  // Only significant for large or complex boards
  if (factors.hasSpatial && factors.boardSize > 0) {
    if (factors.boardSize <= 64) {
      score += 5; // Standard 8x8 or smaller
    } else if (factors.boardSize <= 100) {
      score += 12; // 10x10 boards
    } else {
      score += 25; // Very large boards (Go, etc.)
    }
  }

  // Player property complexity (0-10)
  // Multiple tracked properties suggest complex scoring/state
  score += Math.min(10, factors.playerProperties * 2);

  // Branching factor is the main complexity driver (0-55)
  if (factors.estimatedBranchingFactor <= 10) {
    score += 5;  // Low branching (card games, simple choices)
  } else if (factors.estimatedBranchingFactor <= 20) {
    score += 15; // Moderate branching (checkers)
  } else if (factors.estimatedBranchingFactor <= 40) {
    score += 30; // High branching (chess)
  } else {
    score += 40 + Math.min(15, (factors.estimatedBranchingFactor - 40) / 5); // Very high (Go)
  }

  // Determine category and recommended MCTS
  let category: GameComplexity['category'];
  let recommendedMCTS: number;

  if (score < 30) {
    category = 'simple';
    recommendedMCTS = 3;
  } else if (score < 50) {
    category = 'moderate';
    recommendedMCTS = 15;
  } else if (score < 70) {
    category = 'complex';
    recommendedMCTS = 50;
  } else {
    category = 'very-complex';
    recommendedMCTS = 100;
  }

  return {
    score: Math.min(100, Math.round(score)),
    recommendedMCTS,
    category,
    factors,
  };
}

/**
 * Print discovered structure (for debugging)
 */
export function printGameStructure(structure: GameStructure): void {
  console.log('\n=== Game Structure ===\n');
  console.log(`Players: ${structure.playerCount}`);

  console.log('\n--- Element Types ---');
  for (const [name, info] of structure.elementTypes) {
    console.log(`\n${name}:`);
    console.log(`  Ownership: ${info.hasOwnership}`);
    console.log(`  Spatial: ${info.isSpatial}`);
    if (info.numericProperties.length > 0) {
      console.log(`  Numeric: ${info.numericProperties.join(', ')}`);
    }
    if (info.booleanProperties.length > 0) {
      console.log(`  Boolean: ${info.booleanProperties.join(', ')}`);
    }
    if (info.stringProperties.length > 0) {
      console.log(`  String: ${info.stringProperties.join(', ')}`);
      for (const [prop, values] of Object.entries(info.stringEnums)) {
        if (values.size > 0 && values.size <= 10) {
          console.log(`    ${prop} values: ${[...values].join(', ')}`);
        }
      }
    }
  }

  console.log('\n--- Player Properties ---');
  const pi = structure.playerInfo;
  if (pi.numericProperties.length > 0) {
    console.log(`  Numeric: ${pi.numericProperties.join(', ')}`);
  }
  if (pi.booleanProperties.length > 0) {
    console.log(`  Boolean: ${pi.booleanProperties.join(', ')}`);
  }
  if (pi.stringProperties.length > 0) {
    console.log(`  String: ${pi.stringProperties.join(', ')}`);
  }

  console.log('\n--- Spatial Info ---');
  const si = structure.spatialInfo;
  console.log(`  Has Board: ${si.hasBoard}`);
  if (si.dimensions) {
    console.log(`  Dimensions: ${si.dimensions.rows} x ${si.dimensions.columns}`);
  }
  if (si.centerRegion) {
    console.log(`  Center: rows ${si.centerRegion.minRow}-${si.centerRegion.maxRow}, cols ${si.centerRegion.minCol}-${si.centerRegion.maxCol}`);
  }
  console.log(`  Hex Grid: ${si.isHex}`);
}
