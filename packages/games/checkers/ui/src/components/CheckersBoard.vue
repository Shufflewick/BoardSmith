<script setup lang="ts">
import { ref, computed, watch, watchEffect, nextTick } from 'vue';
import { useBoardInteraction, prefersReducedMotion } from '@boardsmith/ui';

// Board interaction for syncing with ActionPanel
const boardInteraction = useBoardInteraction();

// Animation state - tracks piece positions for FLIP animations
const boardRef = ref<HTMLElement | null>(null);
const piecePositions = new Map<number, DOMRect>();

// Capture positions of all pieces before state changes
function capturePositions() {
  piecePositions.clear();
  if (!boardRef.value) return;

  const pieces = boardRef.value.querySelectorAll('[data-piece-id]');
  pieces.forEach((el) => {
    const id = parseInt(el.getAttribute('data-piece-id') || '0', 10);
    if (id) {
      piecePositions.set(id, el.getBoundingClientRect());
    }
  });
}

// Animate pieces from old positions to new positions
function animateMovements() {
  if (prefersReducedMotion.value) return;
  if (!boardRef.value) return;

  const pieces = boardRef.value.querySelectorAll('[data-piece-id]');

  pieces.forEach((el) => {
    const id = parseInt(el.getAttribute('data-piece-id') || '0', 10);
    const oldRect = piecePositions.get(id);

    if (!oldRect) return;

    const newRect = el.getBoundingClientRect();
    const deltaX = oldRect.left - newRect.left;
    const deltaY = oldRect.top - newRect.top;

    // Only animate if actually moved
    if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
      (el as HTMLElement).animate([
        { transform: `translate(${deltaX}px, ${deltaY}px)` },
        { transform: 'translate(0, 0)' }
      ], {
        duration: 300,
        easing: 'ease-out',
        fill: 'backwards'
      });
    }
  });

  piecePositions.clear();
}

interface CheckerPiece {
  id: number;
  name: string;
  className: string;
  attributes?: {
    isKing?: boolean;
    player?: { position: number };
  };
}

interface Square {
  id: number;
  name: string;
  className: string;
  attributes?: {
    row?: number;
    col?: number;
    isDark?: boolean;
  };
  children?: CheckerPiece[];
}

interface Move {
  pieceId: number;
  fromRow: number;
  fromCol: number;
  toRow: number;
  toCol: number;
  captureRow?: number;
  captureCol?: number;
  becomesKing: boolean;
}

const props = defineProps<{
  gameView: any;
  playerPosition: number;
  isMyTurn: boolean;
  availableActions: string[];
  action: (name: string, args: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
  actionArgs: Record<string, unknown>;
  executeAction: (name: string) => Promise<void>;
  setBoardPrompt: (prompt: string | null) => void;
}>();

// Local state
const selectedPieceId = ref<number | null>(null);
const isMoving = ref(false);

// Get the board from gameView
const board = computed(() => {
  if (!props.gameView?.children) return null;
  return props.gameView.children.find((c: any) => c.className === 'Board');
});

// Get all squares organized in a map for fast lookup
const squaresMap = computed<Map<string, Square>>(() => {
  const map = new Map<string, Square>();
  if (!board.value?.children) return map;

  for (const child of board.value.children) {
    if (child.className === 'Square') {
      const key = `${child.attributes?.row}-${child.attributes?.col}`;
      map.set(key, child);
    }
  }
  return map;
});

// Get square at position
function getSquare(row: number, col: number): Square | undefined {
  return squaresMap.value.get(`${row}-${col}`);
}

// Get piece on a square
function getPiece(square: Square | undefined): CheckerPiece | undefined {
  if (!square) return undefined;
  return square.children?.find((c) => c.className === 'CheckerPiece');
}

// Get piece at position
function getPieceAt(row: number, col: number): CheckerPiece | undefined {
  return getPiece(getSquare(row, col));
}

// Check if a piece belongs to the current player
function isMyPiece(piece: CheckerPiece | undefined): boolean {
  if (!piece) return false;
  return piece.attributes?.player?.position === props.playerPosition;
}

// Check if a piece belongs to the opponent
function isOpponentPiece(piece: CheckerPiece | undefined): boolean {
  if (!piece) return false;
  return piece.attributes?.player?.position !== props.playerPosition;
}

// Get forward direction for current player
function getForwardDirection(): number {
  // Player 0 moves down (+1), Player 1 moves up (-1)
  return props.playerPosition === 0 ? 1 : -1;
}

// Check if a row is the king row for the current player
function isKingRow(row: number): boolean {
  return props.playerPosition === 0 ? row === 7 : row === 0;
}

// Get capture moves for a piece
function getCaptureMoves(piece: CheckerPiece, fromRow: number, fromCol: number): Move[] {
  const moves: Move[] = [];
  const isKing = piece.attributes?.isKing;
  const forward = getForwardDirection();

  // Directions: kings can move all 4 diagonals, regular pieces only forward
  const directions = isKing
    ? [[-1, -1], [-1, 1], [1, -1], [1, 1]]
    : [[forward, -1], [forward, 1]];

  for (const [dRow, dCol] of directions) {
    const midRow = fromRow + dRow;
    const midCol = fromCol + dCol;
    const endRow = fromRow + 2 * dRow;
    const endCol = fromCol + 2 * dCol;

    // Check bounds
    if (endRow < 0 || endRow > 7 || endCol < 0 || endCol > 7) continue;

    const midPiece = getPieceAt(midRow, midCol);
    const endPiece = getPieceAt(endRow, endCol);

    // Middle must have opponent piece, end must be empty
    if (isOpponentPiece(midPiece) && !endPiece) {
      moves.push({
        pieceId: piece.id,
        fromRow,
        fromCol,
        toRow: endRow,
        toCol: endCol,
        captureRow: midRow,
        captureCol: midCol,
        becomesKing: !isKing && isKingRow(endRow),
      });
    }
  }

  return moves;
}

// Get simple (non-capture) moves for a piece
function getSimpleMoves(piece: CheckerPiece, fromRow: number, fromCol: number): Move[] {
  const moves: Move[] = [];
  const isKing = piece.attributes?.isKing;
  const forward = getForwardDirection();

  // Directions: kings can move all 4 diagonals, regular pieces only forward
  const rowDirs = isKing ? [-1, 1] : [forward];

  for (const dRow of rowDirs) {
    for (const dCol of [-1, 1]) {
      const toRow = fromRow + dRow;
      const toCol = fromCol + dCol;

      // Check bounds
      if (toRow < 0 || toRow > 7 || toCol < 0 || toCol > 7) continue;

      const toPiece = getPieceAt(toRow, toCol);

      // Must be empty
      if (!toPiece) {
        moves.push({
          pieceId: piece.id,
          fromRow,
          fromCol,
          toRow,
          toCol,
          becomesKing: !isKing && isKingRow(toRow),
        });
      }
    }
  }

  return moves;
}

// Compute all valid moves for the current player
const allValidMoves = computed<Move[]>(() => {
  if (!props.isMyTurn || !props.availableActions.includes('move')) return [];

  const moves: Move[] = [];
  let hasCaptures = false;

  // Find all my pieces and their possible moves
  for (const [, square] of squaresMap.value) {
    const piece = getPiece(square);
    if (!piece || !isMyPiece(piece)) continue;

    const row = square.attributes?.row ?? 0;
    const col = square.attributes?.col ?? 0;

    // Check captures first (mandatory capture rule)
    const captures = getCaptureMoves(piece, row, col);
    if (captures.length > 0) {
      hasCaptures = true;
      moves.push(...captures);
    }
  }

  // If captures available, only return captures (mandatory)
  if (hasCaptures) return moves;

  // No captures, get simple moves
  for (const [, square] of squaresMap.value) {
    const piece = getPiece(square);
    if (!piece || !isMyPiece(piece)) continue;

    const row = square.attributes?.row ?? 0;
    const col = square.attributes?.col ?? 0;

    moves.push(...getSimpleMoves(piece, row, col));
  }

  return moves;
});

// Get moves for the selected piece
const selectedPieceMoves = computed<Move[]>(() => {
  if (selectedPieceId.value === null) return [];
  return allValidMoves.value.filter((m) => m.pieceId === selectedPieceId.value);
});

// Get pieces that can move
const movablePieceIds = computed<Set<number>>(() => {
  return new Set(allValidMoves.value.map((m) => m.pieceId));
});

// Update board prompt based on selection state and clear selection when turn ends
watch(
  [() => props.isMyTurn, selectedPieceId, () => props.availableActions],
  ([myTurn, pieceId, actions]) => {
    if (!myTurn || !actions.includes('move')) {
      // Clear selection when turn ends
      if (selectedPieceId.value !== null) {
        selectedPieceId.value = null;
        boardInteraction?.clear();
      }
      props.setBoardPrompt(null);
      return;
    }

    if (pieceId === null) {
      props.setBoardPrompt('Select a piece to move');
    } else {
      props.setBoardPrompt('Click a highlighted square to move');
    }
  },
  { immediate: true }
);

// Local mirror of boardInteraction.selectedElement for reliable reactivity
const panelSelectedElement = ref<{ id?: number; notation?: string } | null>(null);

// Sync panelSelectedElement from boardInteraction using watchEffect
// This ensures we properly track changes even across component boundaries
watchEffect(() => {
  if (boardInteraction) {
    panelSelectedElement.value = boardInteraction.selectedElement;
  }
});

// Handle square click
function handleSquareClick(row: number, col: number) {
  if (!props.isMyTurn || isMoving.value) return;

  const square = getSquare(row, col);
  const piece = getPiece(square);

  // If clicking on one of my movable pieces, select it
  if (piece && isMyPiece(piece) && movablePieceIds.value.has(piece.id)) {
    selectedPieceId.value = piece.id;
    // Also update board interaction to filter ActionPanel choices
    updateBoardInteraction(row, col, piece.id);
    return;
  }

  // If we have a selected piece (either via board or ActionPanel), check if this is a valid destination
  const effectiveId = effectiveSelectedPieceId.value;
  if (effectiveId !== null) {
    const move = effectiveSelectedPieceMoves.value.find(
      (m) => m.toRow === row && m.toCol === col
    );

    if (move) {
      executeMove(move);
      return;
    }
  }

  // Clear selection if clicking elsewhere
  selectedPieceId.value = null;
  if (boardInteraction) {
    boardInteraction.clear();
  }
}

// Convert row/col to algebraic notation (a1-h8)
function squareToNotation(row: number, col: number): string {
  const colLetter = String.fromCharCode(97 + col); // a-h
  const rowNumber = 8 - row; // 1-8 (row 0 = 8, row 7 = 1)
  return `${colLetter}${rowNumber}`;
}

// Check if a square is highlighted from ActionPanel hover
function isHighlightedFromPanel(row: number, col: number): boolean {
  if (!boardInteraction) return false;
  const notation = squareToNotation(row, col);
  return boardInteraction.isHighlighted({ notation });
}

// Check if a square is the selected source in ActionPanel
function isSelectedFromPanel(row: number, col: number): boolean {
  if (!boardInteraction) return false;
  const notation = squareToNotation(row, col);
  return boardInteraction.isSelected({ notation });
}

// When clicking a piece, also update board interaction for filtering ActionPanel
function updateBoardInteraction(row: number, col: number, pieceId: number) {
  if (!boardInteraction) return;
  const notation = squareToNotation(row, col);
  // Pass both ID and notation so ActionPanel can match the element
  boardInteraction.selectElement({ id: pieceId, notation });
}

// Execute a move
async function executeMove(move: Move) {
  if (isMoving.value) return;

  isMoving.value = true;
  try {
    // Build the destination choice object that matches the action's expected format
    const fromNotation = squareToNotation(move.fromRow, move.fromCol);
    const toNotation = squareToNotation(move.toRow, move.toCol);

    // The action expects: { piece: elementId, destination: DestinationChoice }
    const destination = {
      pieceId: move.pieceId,
      fromNotation,
      toNotation,
      isCapture: move.captureRow !== undefined,
      becomesKing: move.becomesKing,
    };

    const result = await props.action('move', {
      piece: move.pieceId,
      destination,
    });

    if (result.success) {
      selectedPieceId.value = null;
      // Clear board interaction state
      boardInteraction?.clear();
    }
  } finally {
    setTimeout(() => {
      isMoving.value = false;
    }, 300);
  }
}

// Get the effective selected piece ID (from local state OR from boardInteraction via panelSelectedElement)
const effectiveSelectedPieceId = computed(() => {
  // First check local selection (from clicking on the board)
  if (selectedPieceId.value !== null) {
    return selectedPieceId.value;
  }

  // Then check if ActionPanel has selected an element (synced via watchEffect)
  const selected = panelSelectedElement.value;
  if (!selected) return null;

  // Find the piece that matches the selection
  for (const [, square] of squaresMap.value) {
    const piece = getPiece(square);
    if (!piece) continue;

    // Match by ID
    if (selected.id !== undefined && piece.id === selected.id) {
      if (movablePieceIds.value.has(piece.id)) {
        return piece.id;
      }
    }

    // Match by notation
    if (selected.notation) {
      const squareNotation = squareToNotation(
        square.attributes?.row ?? 0,
        square.attributes?.col ?? 0
      );
      if (squareNotation === selected.notation && movablePieceIds.value.has(piece.id)) {
        return piece.id;
      }
    }
  }

  return null;
});

// Get moves for the effectively selected piece
const effectiveSelectedPieceMoves = computed<Move[]>(() => {
  if (effectiveSelectedPieceId.value === null) return [];
  return allValidMoves.value.filter((m) => m.pieceId === effectiveSelectedPieceId.value);
});

// Check if a square is a valid destination for the selected piece
function isValidDestination(row: number, col: number): boolean {
  return effectiveSelectedPieceMoves.value.some((m) => m.toRow === row && m.toCol === col);
}

// Check if a square contains the selected piece
function isSelectedSquare(row: number, col: number): boolean {
  const effectiveId = effectiveSelectedPieceId.value;
  if (effectiveId === null) return false;
  const piece = getPieceAt(row, col);
  return piece?.id === effectiveId;
}

// Check if square contains a piece that would be captured
function isCaptureTarget(row: number, col: number): boolean {
  return effectiveSelectedPieceMoves.value.some(
    (m) => m.captureRow === row && m.captureCol === col
  );
}

// Check if a piece can be selected (has valid moves)
function isSelectablePiece(row: number, col: number): boolean {
  const piece = getPieceAt(row, col);
  return piece !== undefined && movablePieceIds.value.has(piece.id);
}

// Get piece color class
function getPieceColorClass(piece: CheckerPiece): string {
  const playerPos = piece.attributes?.player?.position;
  if (playerPos === undefined || playerPos === null) {
    // Fallback: check piece name to determine color
    if (piece.name?.startsWith('p0-')) return 'dark';
    if (piece.name?.startsWith('p1-')) return 'light';
    return 'dark'; // Default fallback
  }
  return playerPos === 0 ? 'dark' : 'light';
}

// Count pieces for each player
const pieceCount = computed(() => {
  let dark = 0;
  let light = 0;
  for (const [, square] of squaresMap.value) {
    const piece = getPiece(square);
    if (piece) {
      if (piece.attributes?.player?.position === 0) dark++;
      else light++;
    }
  }
  return { dark, light };
});

// Game over detection
const gameOver = computed(() => {
  return props.gameView?.phase === 'finished';
});

const winner = computed(() => {
  if (!gameOver.value) return null;
  if (pieceCount.value.dark === 0) return props.playerPosition === 1 ? 'You win!' : 'Opponent wins!';
  if (pieceCount.value.light === 0) return props.playerPosition === 0 ? 'You win!' : 'Opponent wins!';
  return 'Game Over!';
});

// Current player name for display
const currentPlayerColor = computed(() => {
  const currentPos = props.gameView?.currentPlayer;
  return currentPos === 0 ? 'Dark' : 'Light';
});

// Watch for gameView changes and animate piece movements
watch(
  () => props.gameView,
  async (newView, oldView) => {
    if (!oldView) return;

    // Capture positions before Vue updates DOM
    capturePositions();

    // Wait for DOM to update
    await nextTick();

    // Animate to new positions
    animateMovements();
  },
  { deep: false }
);
</script>

<template>
  <div class="checkers-board">
    <!-- Game Over -->
    <div v-if="gameOver" class="game-over">
      <h2>Game Over!</h2>
      <p class="winner">{{ winner }}</p>
      <p>Dark pieces: {{ pieceCount.dark }} | Light pieces: {{ pieceCount.light }}</p>
    </div>

    <!-- Board -->
    <div v-else class="board-container">
      <!-- Column labels (a-h) -->
      <div class="board-labels column-labels">
        <span class="label corner"></span>
        <span v-for="col in 8" :key="col" class="label">{{ String.fromCharCode(96 + col) }}</span>
      </div>

      <div class="board-with-rows">
        <!-- Row labels (8-1) -->
        <div class="board-labels row-labels">
          <span v-for="row in 8" :key="row" class="label">{{ 9 - row }}</span>
        </div>

        <div ref="boardRef" class="board">
          <template v-for="row in 8" :key="row">
            <div
              v-for="col in 8"
              :key="`${row}-${col}`"
              class="square"
              :class="{
                dark: (row + col) % 2 === 0,
                light: (row + col) % 2 === 1,
                'valid-destination': isValidDestination(row - 1, col - 1),
                'selected-square': isSelectedSquare(row - 1, col - 1),
                'capture-target': isCaptureTarget(row - 1, col - 1),
                'selectable': isMyTurn && isSelectablePiece(row - 1, col - 1),
                'panel-highlighted': isHighlightedFromPanel(row - 1, col - 1),
                'panel-selected': isSelectedFromPanel(row - 1, col - 1),
              }"
              @click="handleSquareClick(row - 1, col - 1)"
            >
              <div
                v-if="getPieceAt(row - 1, col - 1)"
                class="piece"
                :class="[
                  getPieceColorClass(getPieceAt(row - 1, col - 1)!),
                  {
                    king: getPieceAt(row - 1, col - 1)?.attributes?.isKing,
                    movable: movablePieceIds.has(getPieceAt(row - 1, col - 1)!.id)
                  }
                ]"
                :data-piece-id="getPieceAt(row - 1, col - 1)!.id"
              >
                <span v-if="getPieceAt(row - 1, col - 1)?.attributes?.isKing" class="crown">&#9813;</span>
              </div>
            </div>
          </template>
        </div>
      </div>

      <!-- Capture indicator -->
      <div v-if="isMyTurn && allValidMoves.some(m => m.captureRow !== undefined)" class="capture-notice">
        Captures are mandatory - you must jump!
      </div>
    </div>
  </div>
</template>

<style scoped>
.checkers-board {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
}

.board-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.board-labels {
  display: flex;
  gap: 0;
}

.column-labels {
  margin-left: 24px; /* Account for row labels */
}

.column-labels .label {
  width: calc(min(80vw, 480px) / 8);
  text-align: center;
  font-size: 0.75rem;
  color: #888;
  font-weight: bold;
  text-transform: uppercase;
}

.column-labels .corner {
  width: 0;
}

.board-with-rows {
  display: flex;
  gap: 4px;
}

.row-labels {
  display: flex;
  flex-direction: column;
}

.row-labels .label {
  height: calc(min(80vw, 480px) / 8);
  width: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  color: #888;
  font-weight: bold;
}

.board {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  grid-template-rows: repeat(8, 1fr);
  width: min(80vw, 480px);
  height: min(80vw, 480px);
  border: 4px solid #8b4513;
  border-radius: 4px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.square {
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  transition: background-color 0.2s;
}

.square.light {
  background: #f0d9b5;
}

.square.dark {
  background: #b58863;
}

.square.selectable {
  cursor: pointer;
}

.square.selectable:hover {
  background: rgba(0, 217, 255, 0.3);
}

.square.valid-destination {
  cursor: pointer;
  background: rgba(0, 255, 136, 0.4) !important;
}

.square.valid-destination::after {
  content: '';
  position: absolute;
  width: 30%;
  height: 30%;
  background: rgba(0, 255, 136, 0.8);
  border-radius: 50%;
  animation: pulse-destination 1s ease-in-out infinite;
}

@keyframes pulse-destination {
  0%, 100% { transform: scale(1); opacity: 0.8; }
  50% { transform: scale(1.2); opacity: 1; }
}

.square.selected-square {
  background: rgba(0, 217, 255, 0.5) !important;
}

.square.capture-target {
  background: rgba(255, 100, 100, 0.5) !important;
}

/* ActionPanel hover highlighting */
.square.panel-highlighted {
  box-shadow: inset 0 0 0 3px rgba(0, 217, 255, 0.8);
}

.square.panel-highlighted .piece {
  transform: scale(1.1);
  box-shadow: 0 0 12px rgba(0, 217, 255, 0.6);
}

/* ActionPanel selection (filtered source) */
.square.panel-selected {
  box-shadow: inset 0 0 0 4px #00ff88;
}

.square.panel-selected .piece {
  transform: scale(1.15);
  box-shadow: 0 0 16px rgba(0, 255, 136, 0.8);
}

.piece {
  width: 80%;
  height: 80%;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
  transition: transform 0.2s, box-shadow 0.2s;
  position: relative;
}

.piece.dark {
  background: linear-gradient(145deg, #4a4a4a, #2a2a2a);
  border: 3px solid #1a1a1a;
}

.piece.light {
  background: linear-gradient(145deg, #f5f5f5, #d0d0d0);
  border: 3px solid #aaa;
}

.piece.movable {
  cursor: pointer;
}

.square.selectable:hover .piece.movable {
  transform: scale(1.08);
  box-shadow: 0 6px 16px rgba(0, 217, 255, 0.4);
}

.piece.king .crown {
  font-size: 1.5rem;
  text-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
}

.piece.dark.king .crown {
  color: #ffd700;
}

.piece.light.king .crown {
  color: #b8860b;
}

.capture-notice {
  padding: 8px 16px;
  background: rgba(255, 100, 100, 0.2);
  border: 1px solid rgba(255, 100, 100, 0.4);
  border-radius: 6px;
  color: #ff6b6b;
  font-size: 0.9rem;
}

.game-over {
  text-align: center;
  padding: 40px;
  background: rgba(0, 217, 255, 0.1);
  border-radius: 16px;
}

.game-over h2 {
  font-size: 2rem;
  margin-bottom: 15px;
}

.winner {
  font-size: 1.5rem;
  color: #00ff88;
  margin-bottom: 10px;
}
</style>
