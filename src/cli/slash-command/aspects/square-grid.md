# Square Grid Aspect

**Documentation:** Read `docs/core-concepts.md` (Grid, Piece sections) and `docs/ui-components.md` (useGameGrid) before using this template.

## Element Setup (game.ts)

```typescript
import { Game, type GameOptions } from 'boardsmith';
import { Board, Cell, Piece, MyPlayer } from './elements.js';

export class MyGame extends Game<MyGame, MyPlayer> {
  board!: Board;

  constructor(options: MyGameOptions) {
    super(options);

    const gridSize = 8;  // Adjust as needed

    this.registerElements([Board, Cell, Piece]);

    // Create square grid board
    this.board = this.create(Board, 'board', { gridSize });
    this.board.contentsVisible();

    // Create cells (row 0 = bottom, like chess)
    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        this.board.create(Cell, `cell-${col}-${row}`, {
          col,
          row,
          isLight: (row + col) % 2 === 0,
        });
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
  gridSize!: number;

  getCell(col: number, row: number): Cell | undefined {
    return this.first(Cell, { col, row });
  }
}

export class Cell extends Space<MyGame, MyPlayer> {
  col!: number;
  row!: number;
  isLight!: boolean;

  // Algebraic notation (a1, b2, etc. - like chess)
  get notation(): string {
    return `${String.fromCharCode(97 + this.col)}${this.row + 1}`;
  }

  isEmpty(): boolean {
    return this.count(Piece) === 0;
  }
}

export class Piece extends BasePiece<MyGame, MyPlayer> {
  player!: MyPlayer;
}

export class MyPlayer extends Player {
  score: number = 0;
}
```

## Action Pattern (actions.ts)

```typescript
import { Action, type ActionDefinition } from 'boardsmith';
import { Cell, Piece } from './elements.js';
import type { MyGame } from './game.js';

export function createPlacePieceAction(game: MyGame): ActionDefinition {
  return Action.create('placePiece')
    .prompt('Place a piece')
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

      cell.create(Piece, `piece-${ctx.player.position}-${Date.now()}`, {
        player: ctx.player,
      });

      currentGame.message(`${ctx.player.name} placed at ${cell.notation}`);
      return { success: true };
    });
}

// Move a piece (for games like checkers)
export function createMoveAction(game: MyGame): ActionDefinition {
  return Action.create('move')
    .prompt('Move a piece')
    .chooseElement<Piece>('piece', {
      prompt: 'Select your piece',
      from: () => game.board.all(Piece),
      filter: (piece, ctx) => piece.player === ctx.player,
    })
    .chooseElement<Cell>('destination', {
      prompt: 'Select destination',
      from: () => game.board.all(Cell),
      filter: (cell) => cell.isEmpty(),
      boardRef: (cell) => ({
        id: cell.id,
        notation: cell.notation,
      }),
    })
    .execute((args, ctx) => {
      const currentGame = ctx.game as MyGame;
      const pieceArg = args.piece as { id: number };
      const destArg = args.destination as { id: number };

      const piece = currentGame.all(Piece).find(p => p.id === pieceArg.id);
      const dest = currentGame.board.all(Cell).find(c => c.id === destArg.id);

      if (!piece || !dest) return { success: false };

      piece.putInto(dest);
      currentGame.message(`${ctx.player.name} moved to ${dest.notation}`);
      return { success: true };
    });
}
```

## Custom UI Component (GameBoard.vue)

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { findElements, toAlgebraicNotation, type UseActionControllerReturn } from 'boardsmith/ui';

const props = defineProps<{
  gameView: any;
  playerPosition: number;
  isMyTurn: boolean;
  availableActions: string[];
  actionController: UseActionControllerReturn;
}>();

const CELL_SIZE = 60;
const GRID_SIZE = 8;

// Find all cells
const cells = computed(() => {
  if (!props.gameView) return [];
  return findElements(props.gameView, { className: 'Cell' });
});

// Get piece in a cell (if any)
function getCellPiece(cell: any) {
  return cell.children?.find((c: any) => c.className === 'Piece');
}

// Get player color
function getPlayerColor(playerPosition: number) {
  return playerPosition === 1 ? '#e74c3c' : '#3498db';
}

// Check available actions
const canPlace = computed(() => props.availableActions.includes('placePiece'));
const canMove = computed(() => props.availableActions.includes('move'));

// Track selected piece for two-step move
const selectedPiece = computed(() => {
  const { currentSelection } = props.actionController;
  if (currentSelection.value?.name === 'destination') {
    return props.actionController.pendingAction === 'move';
  }
  return false;
});

function handleCellClick(cell: any) {
  if (!props.isMyTurn) return;

  const piece = getCellPiece(cell);

  // If placing a piece
  if (canPlace.value && !piece) {
    props.actionController.start('placePiece');
    props.actionController.fill('cell', cell.id);
    return;
  }

  // If moving - click piece first, then destination
  if (canMove.value) {
    const { pendingAction, currentSelection } = props.actionController;

    if (!pendingAction) {
      // Start move by selecting a piece
      if (piece && piece.attributes?.player?.position === props.playerPosition) {
        props.actionController.start('move');
        props.actionController.fill('piece', piece.id);
      }
    } else if (currentSelection.value?.name === 'destination') {
      // Select destination
      if (!piece) {
        props.actionController.fill('destination', cell.id);
      }
    }
  }
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
      <div
        class="grid"
        :style="{
          display: 'grid',
          gridTemplateColumns: `repeat(${GRID_SIZE}, ${CELL_SIZE}px)`,
          gap: '0',
        }"
      >
        <div
          v-for="cell in cells"
          :key="cell.id"
          class="cell"
          :class="{
            light: cell.attributes?.isLight,
            dark: !cell.attributes?.isLight,
            clickable: isMyTurn && (canPlace || canMove),
          }"
          :style="{ width: `${CELL_SIZE}px`, height: `${CELL_SIZE}px` }"
          @click="handleCellClick(cell)"
        >
          <!-- Piece if present -->
          <div
            v-if="getCellPiece(cell)"
            class="piece"
            :style="{
              backgroundColor: getPlayerColor(getCellPiece(cell).attributes?.player?.position),
            }"
          />

          <!-- Notation label (corner cells) -->
          <span
            v-if="cell.attributes?.col === 0"
            class="row-label"
          >
            {{ cell.attributes?.row + 1 }}
          </span>
          <span
            v-if="cell.attributes?.row === 0"
            class="col-label"
          >
            {{ String.fromCharCode(97 + (cell.attributes?.col ?? 0)) }}
          </span>
        </div>
      </div>

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

.grid {
  border: 2px solid #444;
  border-radius: 4px;
  overflow: hidden;
}

.cell {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s;
}

.cell.light {
  background-color: #f0d9b5;
}

.cell.dark {
  background-color: #b58863;
}

.cell.clickable {
  cursor: pointer;
}

.cell.clickable:hover {
  filter: brightness(1.1);
}

.piece {
  width: 80%;
  height: 80%;
  border-radius: 50%;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}

.row-label {
  position: absolute;
  left: 2px;
  top: 2px;
  font-size: 10px;
  color: rgba(0, 0, 0, 0.5);
}

.col-label {
  position: absolute;
  right: 2px;
  bottom: 2px;
  font-size: 10px;
  color: rgba(0, 0, 0, 0.5);
}

.waiting {
  color: #888;
}
</style>
```

## Key Rules

1. **Row/Col coordinates** - Use `col` (x) and `row` (y) with row 0 at bottom (chess-style).
2. **Algebraic notation** - Use `toAlgebraicNotation()` for display (a1, b2, etc.).
3. **Cell colors** - Checkerboard pattern: `(row + col) % 2 === 0` for light squares.
4. **Two-step moves** - Use `start()` then `fill()` for piece selection, then destination.
5. **Board visibility** - Use `contentsVisible()` for the board.
