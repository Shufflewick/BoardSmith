import { Piece, HexGrid, HexCell, Player } from '@boardsmith/engine';
import { DEFAULT_PLAYER_COLORS } from '@boardsmith/session';
import type { HexGame } from './game.js';

/**
 * A stone piece in Hex
 */
export class Stone extends Piece<HexGame, HexPlayer> {
  /**
   * Get the color of this stone (hex code)
   * Uses the player's configured color
   */
  getColorHex(): string {
    return this.player?.getColorHex() ?? '#888888';
  }
}

/**
 * A hex cell on the board
 * Uses axial coordinates (q, r)
 */
export class Cell extends HexCell<HexGame, HexPlayer> {
  /** Q coordinate (column-ish, diagonal axis) */
  q!: number;
  /** R coordinate (row-ish) */
  r!: number;

  /**
   * Get the stone on this cell, if any
   */
  getStone(): Stone | undefined {
    return this.first(Stone);
  }

  /**
   * Check if this cell is empty
   */
  isEmpty(): boolean {
    return this.count(Stone) === 0;
  }

  /**
   * Check if this cell has an opponent's stone
   */
  hasOpponentStone(player: HexPlayer): boolean {
    const stone = this.getStone();
    return stone !== undefined && stone.player !== player;
  }

  /**
   * Check if this cell has a friendly stone
   */
  hasFriendlyStone(player: HexPlayer): boolean {
    const stone = this.getStone();
    return stone !== undefined && stone.player === player;
  }

  /**
   * Get algebraic-style notation for this cell
   */
  get notation(): string {
    return `${this.q},${this.r}`;
  }

  /**
   * Check if this cell is on Red's starting edge (top-left, r=0)
   */
  isRedStartEdge(): boolean {
    return this.r === 0;
  }

  /**
   * Check if this cell is on Red's goal edge (bottom-right)
   */
  isRedGoalEdge(boardSize: number): boolean {
    return this.r === boardSize - 1;
  }

  /**
   * Check if this cell is on Blue's starting edge (top-right, q=0)
   */
  isBlueStartEdge(): boolean {
    return this.q === 0;
  }

  /**
   * Check if this cell is on Blue's goal edge (bottom-left)
   */
  isBlueGoalEdge(boardSize: number): boolean {
    return this.q === boardSize - 1;
  }
}

/**
 * The hex board - a rhombus-shaped hex grid
 */
export class Board extends HexGrid<HexGame, HexPlayer> {
  /** Board size (number of cells per edge) */
  boardSize!: number;

  // Configure hex grid for AutoUI
  override $hexOrientation: 'flat' | 'pointy' = 'pointy';
  override $coordSystem: 'offset' | 'axial' | 'cube' = 'axial';
  override $qCoord = 'q';
  override $rCoord = 'r';
  override $hexSize = 150;

  /**
   * Get a cell by axial coordinates
   */
  getCell(q: number, r: number): Cell | undefined {
    return this.first(Cell, { q, r });
  }

  /**
   * Get all empty cells
   */
  getEmptyCells(): Cell[] {
    return [...this.all(Cell)].filter(cell => cell.isEmpty());
  }

  /**
   * Get all neighboring cells for a given cell (up to 6 in a hex grid)
   */
  getNeighbors(cell: Cell): Cell[] {
    // Axial coordinate neighbor offsets
    const directions = [
      [1, 0], [1, -1], [0, -1],
      [-1, 0], [-1, 1], [0, 1]
    ];

    const neighbors: Cell[] = [];
    for (const [dq, dr] of directions) {
      const neighbor = this.getCell(cell.q + dq, cell.r + dr);
      if (neighbor) neighbors.push(neighbor);
    }
    return neighbors;
  }

  /**
   * Check if a player has won by connecting their two edges
   * Uses flood fill / BFS from starting edge
   */
  checkWin(player: HexPlayer): boolean {
    const isRed = player.position === 1;
    const size = this.boardSize;

    // Get all cells on player's starting edge that have their stone
    const startCells = [...this.all(Cell)].filter(cell => {
      if (!cell.hasFriendlyStone(player)) return false;
      return isRed ? cell.isRedStartEdge() : cell.isBlueStartEdge();
    });

    if (startCells.length === 0) return false;

    // BFS to find path to goal edge
    const visited = new Set<string>();
    const queue: Cell[] = [...startCells];

    for (const cell of startCells) {
      visited.add(`${cell.q},${cell.r}`);
    }

    while (queue.length > 0) {
      const current = queue.shift()!;

      // Check if we reached the goal edge
      if (isRed ? current.isRedGoalEdge(size) : current.isBlueGoalEdge(size)) {
        return true;
      }

      // Explore neighbors
      for (const neighbor of this.getNeighbors(current)) {
        const key = `${neighbor.q},${neighbor.r}`;
        if (visited.has(key)) continue;
        if (!neighbor.hasFriendlyStone(player)) continue;

        visited.add(key);
        queue.push(neighbor);
      }
    }

    return false;
  }
}

/**
 * Hex player
 */
export class HexPlayer extends Player {
  /** Number of stones this player has placed */
  stonesPlaced: number = 0;

  /**
   * Get the player's color (hex code)
   * Uses configured color or defaults based on position
   */
  getColorHex(): string {
    const result = this.color ?? DEFAULT_PLAYER_COLORS[this.position] ?? DEFAULT_PLAYER_COLORS[0];
    console.log('[HEX-COLOR]', {
      playerPosition: this.position,
      configuredColor: this.color,
      arrayIndex: this.position,
      lookupResult: DEFAULT_PLAYER_COLORS[this.position],
      fallbackUsed: DEFAULT_PLAYER_COLORS[this.position] === undefined,
      finalColor: result,
    });
    return result;
  }
}
