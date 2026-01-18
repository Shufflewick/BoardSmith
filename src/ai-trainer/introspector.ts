import { Player, type Game, type GameElement } from '@boardsmith/engine';
import type {
  GameStructure,
  ElementTypeInfo,
  PlayerTypeInfo,
  SpatialInfo,
  GameClass,
  WinConditionInfo,
  GameType,
} from './types.js';

/**
 * Game Introspector
 *
 * This module discovers game structure at runtime by examining actual game instances.
 * It uses dynamic property access (`as any`) intentionally - the purpose of introspection
 * is to analyze properties that cannot be known at compile time.
 *
 * This is similar to reflection in other languages or JSON.parse() returning unknown types.
 * The dynamic access is confined to this module and produces typed results (GameStructure).
 */

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

  // Build partial structure for win condition analysis
  const partialStructure = {
    elementTypes,
    playerInfo,
    spatialInfo,
    playerCount: game.all(Player).length,
  };

  // Analyze win conditions
  const winConditionInfo = analyzeWinConditions(game, partialStructure);

  return {
    ...partialStructure,
    winConditionInfo,
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

    // Dynamic property access is intentional - introspection discovers unknown properties
    // at runtime. TypeScript cannot statically type properties that vary per game.
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

  const players = [...game.all(Player)];
  if (players.length === 0) return info;

  const player = players[0];
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

    // Dynamic property access is intentional - introspection discovers unknown player
    // properties at runtime. Each game defines different custom player properties.
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

    // Dynamic property access is intentional - hex coordinates (q, r, s) may or may
    // not exist depending on whether the game uses hex grids.
    const elem = element as any;
    if (elem.q !== undefined && elem.r !== undefined) {
      info.isHex = true;
      hasSpatialElements = true;
      spatialElementCount++;
      // For hex grids, use q as column and r as row for dimension calculation
      minRow = Math.min(minRow, elem.r);
      maxRow = Math.max(maxRow, elem.r);
      minCol = Math.min(minCol, elem.q);
      maxCol = Math.max(maxCol, elem.q);
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

// ============================================================================
// WIN CONDITION ANALYSIS
// ============================================================================

/**
 * Player properties that indicate score-based (racing) win conditions
 */
const SCORE_PROPERTY_NAMES = new Set([
  'score', 'points', 'total', 'money', 'gold', 'coins',
  'victory', 'vp', 'victorypoints',
]);

/**
 * Player properties that indicate collection-based win conditions
 */
const COLLECTION_PROPERTY_NAMES = new Set([
  'bookcount', 'books', 'sets', 'collections', 'pairs',
  'completed', 'achievements', 'trophies',
]);

/**
 * Player properties that indicate capture/elimination-based win conditions
 */
const CAPTURE_PROPERTY_NAMES = new Set([
  'capturedcount', 'captures', 'kills', 'eliminated',
  'pieces', 'units', 'armies',
]);

/**
 * Analyze win condition patterns to determine game type.
 *
 * Detection examines:
 * 1. Player properties (score, bookCount, capturedCount, etc.)
 * 2. Game properties (winner, targetScore, etc.)
 * 3. Spatial structure (hex grid → connection game)
 * 4. Element ownership patterns
 */
export function analyzeWinConditions(
  game: Game,
  structure: Omit<GameStructure, 'winConditionInfo'>
): WinConditionInfo {
  const indicators: string[] = [];

  // Track detection signals for each type
  let scoreSignals = 0;
  let collectionSignals = 0;
  let captureSignals = 0;
  let connectionSignals = 0;
  let territorySignals = 0;

  // ============================================================================
  // 1. SCORE-BASED DETECTION (Racing games like Cribbage)
  // ============================================================================

  // Check player numeric properties for score-like names
  for (const prop of structure.playerInfo.numericProperties) {
    if (SCORE_PROPERTY_NAMES.has(prop.toLowerCase())) {
      indicators.push(`Player has '${prop}' property`);
      scoreSignals += 2;
    }
  }

  // Check game for targetScore property (strong signal for racing games)
  // Dynamic property access is intentional - we're detecting game-specific properties
  const gameAny = game as any;
  if (typeof gameAny.targetScore === 'number') {
    indicators.push('Game has targetScore property');
    scoreSignals += 3;
  }

  // ============================================================================
  // 2. COLLECTION-BASED DETECTION (Games like Go Fish)
  // ============================================================================

  // Check player numeric properties for collection-like names
  for (const prop of structure.playerInfo.numericProperties) {
    if (COLLECTION_PROPERTY_NAMES.has(prop.toLowerCase())) {
      indicators.push(`Player has '${prop}' property`);
      collectionSignals += 3;
    }
  }

  // Check for Books or Sets element types
  for (const [className] of structure.elementTypes) {
    const lowerName = className.toLowerCase();
    if (lowerName.includes('book') || lowerName.includes('set') || lowerName.includes('collection')) {
      indicators.push(`Has '${className}' element type`);
      collectionSignals += 2;
    }
  }

  // ============================================================================
  // 3. CAPTURE/ELIMINATION-BASED DETECTION (Games like Checkers)
  // ============================================================================

  // Check player numeric properties for capture-like names
  for (const prop of structure.playerInfo.numericProperties) {
    if (CAPTURE_PROPERTY_NAMES.has(prop.toLowerCase())) {
      indicators.push(`Player has '${prop}' property`);
      captureSignals += 2;
    }
  }

  // Check for owned spatial pieces (can be captured)
  let hasOwnedSpatialPieces = false;
  for (const [className, typeInfo] of structure.elementTypes) {
    if (typeInfo.hasOwnership && typeInfo.isSpatial) {
      hasOwnedSpatialPieces = true;
      // Piece-like class names are strong signals
      const lowerName = className.toLowerCase();
      if (lowerName.includes('piece') || lowerName.includes('checker') ||
          lowerName.includes('stone') || lowerName.includes('unit')) {
        indicators.push(`Has owned spatial '${className}' type`);
        captureSignals += 1;
      }
    }
  }

  // Board game without score → likely capture-based
  if (structure.spatialInfo.hasBoard && hasOwnedSpatialPieces && scoreSignals === 0) {
    indicators.push('Board game with owned pieces, no score');
    captureSignals += 1;
  }

  // ============================================================================
  // 4. CONNECTION-BASED DETECTION (Games like Hex)
  // ============================================================================

  // Hex grid is a strong signal for connection games
  if (structure.spatialInfo.isHex) {
    indicators.push('Hex grid detected');
    connectionSignals += 3;
  }

  // Check game for winner property (connection games often track winner directly)
  if (gameAny.winner !== undefined) {
    indicators.push('Game has winner property');
    // Winner property alone is weak signal; combined with hex it's strong
    if (structure.spatialInfo.isHex) {
      connectionSignals += 2;
    } else {
      connectionSignals += 1;
    }
  }

  // Check for Cell/Hex element types with ownership
  for (const [className, typeInfo] of structure.elementTypes) {
    const lowerName = className.toLowerCase();
    if ((lowerName.includes('cell') || lowerName.includes('hex')) && typeInfo.isSpatial) {
      if (structure.spatialInfo.isHex) {
        indicators.push(`Has '${className}' hex cells`);
        connectionSignals += 1;
      }
    }
  }

  // ============================================================================
  // 5. TERRITORY-BASED DETECTION (Future: Go)
  // ============================================================================

  // Currently just placeholder detection
  // Territory games typically have area control, influence, or territory tracking
  for (const prop of structure.playerInfo.numericProperties) {
    const lowerProp = prop.toLowerCase();
    if (lowerProp.includes('territory') || lowerProp.includes('area') ||
        lowerProp.includes('influence') || lowerProp.includes('control')) {
      indicators.push(`Player has '${prop}' property`);
      territorySignals += 2;
    }
  }

  // ============================================================================
  // DETERMINE GAME TYPE
  // ============================================================================

  // Score each type and pick highest confidence
  const scores: Array<{ type: GameType; signals: number; maxSignals: number }> = [
    { type: 'racing', signals: scoreSignals, maxSignals: 5 },
    { type: 'collection', signals: collectionSignals, maxSignals: 5 },
    { type: 'capture', signals: captureSignals, maxSignals: 4 },
    { type: 'connection', signals: connectionSignals, maxSignals: 6 },
    { type: 'territory', signals: territorySignals, maxSignals: 4 },
  ];

  // Sort by signals (descending)
  scores.sort((a, b) => b.signals - a.signals);

  const best = scores[0];

  // Need at least some signals to classify
  let gameType: GameType = 'unknown';
  let confidence = 0;

  if (best.signals > 0) {
    gameType = best.type;
    confidence = Math.min(1, best.signals / best.maxSignals);
  }

  // Build result
  return {
    gameType,
    confidence,
    indicators,
    scoreBased: scoreSignals > 0,
    eliminationBased: captureSignals > 0,
    connectionBased: connectionSignals > 0,
    collectionBased: collectionSignals > 0,
  };
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
    recommendedMCTS = 15;
  } else if (score < 50) {
    category = 'moderate';
    recommendedMCTS = 25;
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
