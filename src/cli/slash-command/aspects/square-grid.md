# Square Grid Aspect

**Documentation:** Read `docs/core-concepts.md` (Grid, Piece sections) and `docs/ui-components.md` (useGameGrid) before using this template.

## Element Setup (game.ts)

<!-- typecheck: game src/rules/game.ts -->
```typescript
import { Game, type GameOptions } from 'boardsmith';
import { Board, Cell, Piece, MyPlayer } from './elements.js';

export class MyGame extends Game<MyGame, MyPlayer> {
  // Tells the engine to construct each player as a MyPlayer
  static PlayerClass = MyPlayer;

  board!: Board;

  constructor(options: GameOptions) {
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

<!-- typecheck: game src/rules/elements.ts -->
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
  declare row: number;  // GameElement declares row as optional
  isLight!: boolean;

  // Algebraic notation (a1, b2, etc. - like chess)
  get notation(): string {
    return `${String.fromCharCode(97 + this.col)}${this.row + 1}`;
  }

  isEmpty(): boolean {
    return this.count(Piece) === 0;
  }
}

// Its owner is `piece.player`, which every element already has.
export class Piece extends BasePiece<MyGame, MyPlayer> {}

export class MyPlayer extends Player {
  score: number = 0;
}
```

## Action Pattern (actions.ts)

<!-- typecheck: game src/rules/actions.ts -->
```typescript
import { Action, type ActionDefinition } from 'boardsmith';
import { Cell, Piece } from './elements.js';
import type { MyGame } from './game.js';

export function createPlacePieceAction(): ActionDefinition {
  return Action.create<MyGame>('placePiece')
    .prompt('Place a piece')
    .chooseElement('cell', {
      prompt: 'Select a cell',
      elementClass: Cell,
      from: (ctx) => ctx.game.board,
      filter: (cell) => cell.isEmpty(),
      boardRef: (cell) => ({
        id: cell.id,
        notation: cell.notation,
      }),
    })
    .execute(({ cell }, ctx) => {
      cell.create(Piece, 'piece', { player: ctx.player });
      ctx.game.message(`${ctx.player.name} placed at ${cell.notation}`);
      return { success: true };
    });
}

// Move a piece (for games like checkers)
export function createMoveAction(): ActionDefinition {
  return Action.create<MyGame>('move')
    .prompt('Move a piece')
    .chooseElement('piece', {
      prompt: 'Select your piece',
      elementClass: Piece,
      from: (ctx) => ctx.game.board,
      filter: (piece, ctx) => piece.player?.seat === ctx.player.seat,
    })
    .chooseElement('destination', {
      prompt: 'Select destination',
      elementClass: Cell,
      from: (ctx) => ctx.game.board,
      filter: (cell) => cell.isEmpty(),
      boardRef: (cell) => ({
        id: cell.id,
        notation: cell.notation,
      }),
    })
    .execute(({ piece, destination }, ctx) => {
      piece.putInto(destination);
      ctx.game.message(`${ctx.player.name} moved to ${destination.notation}`);
      return { success: true };
    });
}
```

## Custom UI Component (GameTable.vue)

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { findElements, toAlgebraicNotation, type TableBoardProps } from 'boardsmith/ui';

const props = defineProps<TableBoardProps>();

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
function getPlayerColor(playerSeat: number) {
  return playerSeat === 1 ? '#e74c3c' : '#3498db';
}

// Check available actions
const canPlace = computed(() => props.availableActions.includes('placePiece'));
const canMove = computed(() => props.availableActions.includes('move'));

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
    const { currentAction, currentPick } = props.actionController;

    if (currentAction.value !== 'move') {
      // Start move by selecting a piece
      if (piece && piece.attributes?.player?.seat === props.playerSeat) {
        props.actionController.start('move');
        props.actionController.fill('piece', piece.id);
      }
    } else if (currentPick.value?.name === 'destination') {
      // Select destination
      if (!piece) {
        props.actionController.fill('destination', cell.id);
      }
    }
  }
}

// The game is over when the flow completes. GameShell then draws its game-over
// card, with the winners, over this board; to draw your own ending instead, see
// "The End of the Game" in docs/custom-ui-guide.md. During time travel
// flowState is null, so this is false.
const isGameOver = computed(() => props.state?.flowState?.complete === true);
</script>

<template>
  <div class="game-board">
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
            backgroundColor: getPlayerColor(getCellPiece(cell).attributes?.player?.seat),
          }"
        />

        <!-- Notation label (corner cells) -->
        <span
          v-if="cell.attributes?.col === 0"
          class="row-label"
        >
          {{ (cell.attributes?.row ?? 0) + 1 }}
        </span>
        <span
          v-if="cell.attributes?.row === 0"
          class="col-label"
        >
          {{ String.fromCharCode(97 + (cell.attributes?.col ?? 0)) }}
        </span>
      </div>
    </div>

    <p v-if="!isMyTurn && !isGameOver" class="waiting">Waiting for other player...</p>
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
