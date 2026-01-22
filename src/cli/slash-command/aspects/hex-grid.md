# Hex Grid Aspect

**Documentation:** Read `docs/core-concepts.md` (Grid, Piece sections) and `docs/ui-components.md` (useHexGrid) before using this template.

## Element Setup (game.ts)

```typescript
import { Game, type GameOptions } from 'boardsmith';
import { Board, Cell, Stone, MyPlayer } from './elements.js';

export class MyGame extends Game<MyGame, MyPlayer> {
  board!: Board;

  constructor(options: MyGameOptions) {
    super(options);

    const boardSize = 7;  // Adjust as needed

    this.registerElements([Board, Cell, Stone]);

    // Create hex board
    this.board = this.create(Board, 'board', { boardSize });
    this.board.contentsVisible();

    // Create hex cells (axial coordinates)
    for (let r = 0; r < boardSize; r++) {
      for (let q = 0; q < boardSize; q++) {
        this.board.create(Cell, `cell-${q}-${r}`, { q, r });
      }
    }
  }
}
```

## Elements (elements.ts)

```typescript
import { Space, Piece as BasePiece, Player } from 'boardsmith';
import type { MyGame } from './game.js';

export class Board extends Space<MyGame, MyPlayer> {
  boardSize!: number;

  getCell(q: number, r: number): Cell | undefined {
    return this.first(Cell, { q, r });
  }
}

export class Cell extends Space<MyGame, MyPlayer> {
  q!: number;  // Axial column
  r!: number;  // Axial row

  // Algebraic notation (a1, b2, etc.)
  get notation(): string {
    return `${String.fromCharCode(97 + this.q)}${this.r + 1}`;
  }

  isEmpty(): boolean {
    return this.count(Stone) === 0;
  }
}

export class Stone extends BasePiece<MyGame, MyPlayer> {
  player!: MyPlayer;
}

export class MyPlayer extends Player {
  score: number = 0;
}
```

## Action Pattern (actions.ts)

```typescript
import { Action, type ActionDefinition } from 'boardsmith';
import { Cell, Stone } from './elements.js';
import type { MyGame } from './game.js';

export function createPlaceStoneAction(game: MyGame): ActionDefinition {
  return Action.create('placeStone')
    .prompt('Place a stone')
    .chooseElement<Cell>('cell', {
      prompt: 'Select a cell',
      from: () => game.board.all(Cell),
      filter: (cell) => cell.isEmpty(),
      boardRef: (cell) => ({
        id: cell.id,
        notation: cell.notation,
      }),
    })
    .execute((args, ctx) => {
      const currentGame = ctx.game as MyGame;
      const cellArg = args.cell as { id: number };
      const cell = currentGame.board.all(Cell).find(c => c.id === cellArg.id);
      if (!cell) return { success: false };

      cell.create(Stone, `stone-${ctx.player.seat}-${Date.now()}`, {
        player: ctx.player,
      });

      currentGame.message(`${ctx.player.name} placed at ${cell.notation}`);
      return { success: true };
    });
}
```

## Custom UI Component (GameTable.vue)

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { findElements, hexToPixel, getHexPolygonPoints, type UseActionControllerReturn } from 'boardsmith/ui';

const props = defineProps<{
  gameView: any;
  playerSeat: number;
  isMyTurn: boolean;
  availableActions: string[];
  actionController: UseActionControllerReturn;
}>();

const HEX_SIZE = 30;
const BOARD_SIZE = 7;

// Find all cells
const cells = computed(() => {
  if (!props.gameView) return [];
  return findElements(props.gameView, { className: 'Cell' });
});

// Calculate SVG viewBox based on board size
const viewBox = computed(() => {
  const padding = HEX_SIZE * 2;
  const width = HEX_SIZE * 2 * BOARD_SIZE + padding * 2;
  const height = HEX_SIZE * Math.sqrt(3) * BOARD_SIZE + padding * 2;
  return `-${padding} -${padding} ${width} ${height}`;
});

// Get pixel position for a hex cell
function getCellPosition(q: number, r: number) {
  return hexToPixel(q, r, HEX_SIZE, 'flat');
}

// Get SVG polygon points for hex shape
function getHexPoints(cx: number, cy: number) {
  return getHexPolygonPoints(cx, cy, HEX_SIZE, 'flat');
}

// Get stone in a cell (if any)
function getCellStone(cell: any) {
  return cell.children?.find((c: any) => c.className === 'Stone');
}

// Get player color
function getPlayerColor(playerSeat: number) {
  return playerSeat === 1 ? '#e74c3c' : '#3498db';
}

// Check if cell is playable
const canPlace = computed(() => props.availableActions.includes('placeStone'));

function handleCellClick(cell: any) {
  if (!props.isMyTurn || !canPlace.value) return;
  if (getCellStone(cell)) return;  // Cell occupied

  props.actionController.start('placeStone');
  props.actionController.fill('cell', cell.id);
}

// Game over
const isGameOver = computed(() => props.gameView?.isFinished ?? false);
</script>

<template>
  <div class="game-board">
    <div v-if="isGameOver" class="game-over-panel">
      <h2>Game Over!</h2>
    </div>

    <template v-else>
      <svg :viewBox="viewBox" class="hex-board">
        <!-- Cells -->
        <g v-for="cell in cells" :key="cell.id">
          <polygon
            :points="getHexPoints(
              getCellPosition(cell.attributes?.q ?? 0, cell.attributes?.r ?? 0).x,
              getCellPosition(cell.attributes?.q ?? 0, cell.attributes?.r ?? 0).y
            )"
            class="hex-cell"
            :class="{
              clickable: canPlace && isMyTurn && !getCellStone(cell),
              occupied: !!getCellStone(cell),
            }"
            @click="handleCellClick(cell)"
          />

          <!-- Stone if present -->
          <circle
            v-if="getCellStone(cell)"
            :cx="getCellPosition(cell.attributes?.q ?? 0, cell.attributes?.r ?? 0).x"
            :cy="getCellPosition(cell.attributes?.q ?? 0, cell.attributes?.r ?? 0).y"
            :r="HEX_SIZE * 0.6"
            :fill="getPlayerColor(getCellStone(cell).attributes?.player?.seat)"
            class="stone"
          />
        </g>
      </svg>

      <p v-if="!isMyTurn" class="waiting">Waiting for other player...</p>
    </template>
  </div>
</template>

<style scoped>
.game-board {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px;
  gap: 20px;
}

.hex-board {
  width: 100%;
  max-width: 500px;
  height: auto;
}

.hex-cell {
  fill: #2a2a3e;
  stroke: #444;
  stroke-width: 2;
  transition: fill 0.2s;
}

.hex-cell.clickable {
  cursor: pointer;
}

.hex-cell.clickable:hover {
  fill: #3a3a5e;
}

.hex-cell.occupied {
  cursor: default;
}

.stone {
  stroke: rgba(0, 0, 0, 0.3);
  stroke-width: 2;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
}

.waiting {
  color: #888;
}
</style>
```

## Key Rules

1. **Axial coordinates** - Use `q` (column) and `r` (row) for hex positions.
2. **Use `hexToPixel()`** - Converts axial coords to pixel positions for SVG.
3. **Use `getHexPolygonPoints()`** - Generates SVG polygon points for hex shapes.
4. **Orientation** - Use `'flat'` (flat-top) or `'pointy'` (pointy-top) consistently.
5. **Board visibility** - Use `contentsVisible()` for the board.
