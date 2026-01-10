<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import {
  useBoardInteraction,
  prefersReducedMotion,
  useFLIPAnimation,
  useElementChangeTracker,
  useHexGrid,
  isMyElement,
  isOpponentElement,
  DEFAULT_PLAYER_COLORS,
  type GameViewElement,
  type UseActionControllerReturn,
} from '@boardsmith/ui';

// Types for game view
interface Stone {
  id: number;
  name: string;
  className: string;
  attributes?: {
    player?: { position: number; name: string };
  };
  children?: Stone[];
}

interface Cell {
  id: number;
  name: string;
  className: string;
  attributes?: {
    q: number;
    r: number;
  };
  children?: Stone[];
}

const props = defineProps<{
  gameView: any;
  playerPosition: number;
  isMyTurn: boolean;
  availableActions: string[];
  actionController: UseActionControllerReturn;
}>();

// Board ref for animations
const boardRef = ref<HTMLElement | null>(null);

// FLIP animation for stone placement
const { capturePositions, animateToNewPositions } = useFLIPAnimation({
  containerRef: boardRef,
  selector: '[data-stone-id]',
  duration: 400,
  easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
});

// Track stone changes for animations
const stoneTracker = useElementChangeTracker<number>({
  containerRef: boardRef,
  selector: '[data-stone-id]',
  getElementId: (el) => parseInt(el.getAttribute('data-stone-id') || '0', 10),
  getElementData: (el) => ({
    playerPosition: el.classList.contains('player-0') ? 0 : 1,
  }),
});

// Board interaction for click handling (injected from GameShell)
const boardInteraction = useBoardInteraction();

// Use shared hex grid utilities
const {
  cells,
  hexSize,
  hexGridBounds,
  getHexPosition,
  getHexPoints,
} = useHexGrid<Cell>({
  gameView: () => props.gameView,
  boardClassName: 'Board',
  cellClassName: 'Cell',
  defaultHexSize: 150,
  defaultOrientation: 'pointy',
});

// Computed hex polygon points
const hexPoints = computed(() => getHexPoints(1));
const innerHexPoints = computed(() => getHexPoints(0.85));

// Check if placement action is available
const canPlaceStone = computed(() => {
  return props.isMyTurn && props.availableActions.includes('placeStone');
});

// Check if a cell is a valid move target
function isValidTarget(cell: Cell): boolean {
  if (!canPlaceStone.value) return false;
  return !cell.children?.length;
}

// Check if a cell is being hovered via ActionPanel
function isHoveredFromPanel(cell: Cell): boolean {
  if (!boardInteraction) return false;
  // Create element ref for this cell
  const elementRef = {
    id: cell.id,
    notation: `${cell.attributes?.q},${cell.attributes?.r}`,
  };
  return boardInteraction.isHighlighted(elementRef);
}

// Handle cell click - pass the cell element to the action
async function handleCellClick(cell: Cell) {
  if (!isValidTarget(cell)) return;

  // Capture positions before the move
  capturePositions();
  stoneTracker.capturePositions();

  // Execute the action with the cell element (using its ID)
  await props.actionController.execute('placeStone', { cell: cell.id });
}

// Get stone color class (player positions are 1-indexed)
function getStoneClass(stone: Stone): string {
  const playerPos = stone.attributes?.player?.position;
  return playerPos === 1 ? 'player-1' : 'player-2';
}

// Check stone ownership
function isMyStone(stone: Stone | undefined): boolean {
  return isMyElement(stone as GameViewElement | undefined, props.playerPosition);
}

function isOpponentStone(stone: Stone | undefined): boolean {
  return isOpponentElement(stone as GameViewElement | undefined, props.playerPosition);
}

// Get player colors from game state (returns 0-indexed array with at least 2 colors)
const getPlayerColors = computed(() => {
  const board = props.gameView?.children?.find((c: any) => c.className === 'Board');
  if (!board) return [...DEFAULT_PLAYER_COLORS];

  // Extract player colors from the game state
  // Players array is 0-indexed (players[0] = Player 1)
  const players = props.gameView?.players || [];
  if (players.length === 0) return [...DEFAULT_PLAYER_COLORS];

  const colors = players.map((p: any, i: number) => p.color || DEFAULT_PLAYER_COLORS[i] || DEFAULT_PLAYER_COLORS[0]);
  // Ensure we always have at least 2 colors
  while (colors.length < 2) {
    colors.push(DEFAULT_PLAYER_COLORS[colors.length] || DEFAULT_PLAYER_COLORS[0]);
  }
  return colors;
});

// playerPosition is 1-indexed, so use position - 1 for array access
const myColor = computed(() => getPlayerColors.value[props.playerPosition - 1] || DEFAULT_PLAYER_COLORS[0]);
const opponentColor = computed(() => {
  const opponentArrayIndex = props.playerPosition === 1 ? 1 : 0;
  return getPlayerColors.value[opponentArrayIndex] || DEFAULT_PLAYER_COLORS[1];
});

// Helper to lighten a hex color
function lightenColor(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, (num >> 16) + Math.round(255 * percent));
  const g = Math.min(255, ((num >> 8) & 0x00FF) + Math.round(255 * percent));
  const b = Math.min(255, (num & 0x0000FF) + Math.round(255 * percent));
  return `rgb(${r}, ${g}, ${b})`;
}

// Helper to darken a hex color
function darkenColor(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, (num >> 16) - Math.round(255 * percent));
  const g = Math.max(0, ((num >> 8) & 0x00FF) - Math.round(255 * percent));
  const b = Math.max(0, (num & 0x0000FF) - Math.round(255 * percent));
  return `rgb(${r}, ${g}, ${b})`;
}

// Get stone fill color (playerPos is 1-indexed, array is 0-indexed)
function getStoneColor(stone: Stone): string {
  const playerPos = stone.attributes?.player?.position ?? 1;
  return getPlayerColors.value[playerPos - 1] || '#888888';
}

// Get stone glow color (lighter version)
function getStoneGlowColor(stone: Stone): string {
  const color = getStoneColor(stone);
  return lightenColor(color, 0.3);
}

// Watch for game view changes and animate
watch(
  () => props.gameView,
  async (newView, oldView) => {
    if (!oldView || prefersReducedMotion.value) return;

    await nextTick();
    animateToNewPositions();
  },
  { deep: true }
);

// Initialize tracker on mount
watch(
  () => cells.value,
  (newCells) => {
    if (!stoneTracker.isInitialized.value && newCells.length > 0) {
      const stoneIds = new Set<number>();
      for (const cell of newCells) {
        for (const stone of cell.children ?? []) {
          stoneIds.add(stone.id);
        }
      }
      stoneTracker.initialize(stoneIds);
    }
  },
  { immediate: true }
);
</script>

<template>
  <div class="hex-board-wrapper" ref="boardRef" :style="{ '--my-color': myColor }">
    <!-- Scanline overlay -->
    <div class="scanlines"></div>

    <!-- SVG Definitions for gradients -->
    <svg width="0" height="0" style="position: absolute;">
      <defs>
        <!-- Player 0 gradient (dynamic) -->
        <radialGradient id="player0StoneGradient" cx="30%" cy="30%">
          <stop offset="0%" :stop-color="lightenColor(getPlayerColors[0], 0.2)" />
          <stop offset="50%" :stop-color="getPlayerColors[0]" />
          <stop offset="100%" :stop-color="darkenColor(getPlayerColors[0], 0.15)" />
        </radialGradient>
        <!-- Player 1 gradient (dynamic) -->
        <radialGradient id="player1StoneGradient" cx="30%" cy="30%">
          <stop offset="0%" :stop-color="lightenColor(getPlayerColors[1], 0.2)" />
          <stop offset="50%" :stop-color="getPlayerColors[1]" />
          <stop offset="100%" :stop-color="darkenColor(getPlayerColors[1], 0.15)" />
        </radialGradient>
      </defs>
    </svg>

    <svg
      class="hex-board"
      :viewBox="`${hexGridBounds.minX} ${hexGridBounds.minY} ${hexGridBounds.width} ${hexGridBounds.height}`"
      preserveAspectRatio="xMidYMid meet"
    >
      <!-- Background grid pattern -->
      <defs>
        <pattern id="gridPattern" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(0, 255, 204, 0.05)" stroke-width="1"/>
        </pattern>
      </defs>
      <rect :x="hexGridBounds.minX" :y="hexGridBounds.minY" :width="hexGridBounds.width" :height="hexGridBounds.height" fill="url(#gridPattern)" />

      <!-- Render hex cells -->
      <g
        v-for="cell in cells"
        :key="cell.id"
        class="hex-cell-group"
        :class="{
          'valid-target': isValidTarget(cell),
          'has-stone': (cell.children?.length ?? 0) > 0,
          'panel-hovered': isHoveredFromPanel(cell)
        }"
        :transform="`translate(${getHexPosition(cell.attributes?.q ?? 0, cell.attributes?.r ?? 0).x}, ${getHexPosition(cell.attributes?.q ?? 0, cell.attributes?.r ?? 0).y})`"
        @click="handleCellClick(cell)"
      >
        <!-- Outer hex border -->
        <polygon
          :points="hexPoints"
          class="hex-border"
        />

        <!-- Inner hex fill -->
        <polygon
          :points="innerHexPoints"
          class="hex-inner"
        />


        <!-- Stone piece -->
        <g v-for="stone in (cell.children ?? [])" :key="stone.id" class="stone-group">
          <!-- Stone glow -->
          <circle
            :r="hexSize * 0.4"
            class="stone-glow"
            :style="{ fill: getStoneGlowColor(stone).replace('rgb', 'rgba').replace(')', ', 0.4)') }"
          />
          <!-- Main stone -->
          <circle
            :data-stone-id="stone.id"
            :r="hexSize * 0.32"
            class="hex-stone"
            :class="{ 'is-mine': isMyStone(stone), 'is-opponent': isOpponentStone(stone) }"
            :style="{
              fill: `url(#player${(stone.attributes?.player?.position ?? 1) - 1}StoneGradient)`,
              stroke: lightenColor(getStoneColor(stone), 0.2),
            }"
          />
          <!-- Stone highlight -->
          <ellipse
            :rx="hexSize * 0.15"
            :ry="hexSize * 0.08"
            :cy="-hexSize * 0.12"
            class="stone-highlight"
          />
        </g>

        <!-- Cell coordinate label -->
        <text
          class="hex-coord"
          text-anchor="middle"
          dominant-baseline="middle"
          :y="hexSize * 0.55"
        >{{ cell.attributes?.q }},{{ cell.attributes?.r }}</text>
      </g>
    </svg>

    <!-- Turn indicator -->
    <div v-if="canPlaceStone" class="turn-indicator">
      <span class="indicator-icon"></span>
      <span class="indicator-text">SELECT TARGET CELL</span>
    </div>
  </div>
</template>

<style scoped>
.hex-board-wrapper {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  width: 100%;
  padding: 20px;
  background: linear-gradient(135deg, #0a0a12 0%, #1a1a2e 50%, #0a0a12 100%);
  border-radius: 12px;
  border: 1px solid rgba(0, 255, 204, 0.2);
  box-shadow:
    0 0 30px rgba(0, 255, 204, 0.1),
    inset 0 0 60px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

/* Scanline effect */
.scanlines {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(0, 0, 0, 0.1) 2px,
    rgba(0, 0, 0, 0.1) 4px
  );
  pointer-events: none;
  z-index: 10;
}

.hex-board {
  max-width: 100%;
  height: auto;
  max-height: 60vh;
  filter: drop-shadow(0 0 20px rgba(0, 255, 204, 0.2));
}

/* Hex cell group */
.hex-cell-group {
  cursor: default;
}

.hex-cell-group.valid-target {
  cursor: pointer;
}

/* Hex border - outer glow line */
.hex-border {
  fill: none;
  stroke: rgba(0, 255, 204, 0.3);
  stroke-width: 2;
  transition: stroke 0.2s ease;
  pointer-events: none;
}

.hex-cell-group:hover .hex-border {
  stroke: rgba(0, 255, 204, 0.6);
}

.hex-cell-group.valid-target .hex-border {
  stroke: #00ffcc;
  stroke-width: 3;
}

/* Hex inner fill - this is the clickable area */
.hex-inner {
  fill: rgba(10, 20, 30, 0.8);
  stroke: rgba(0, 255, 204, 0.15);
  stroke-width: 1;
  transition: fill 0.2s ease;
  pointer-events: all;
}

.hex-cell-group:hover .hex-inner {
  fill: rgba(0, 255, 204, 0.15);
}

.hex-cell-group.valid-target .hex-inner {
  fill: rgba(0, 255, 204, 0.2);
}

.hex-cell-group.valid-target:hover .hex-inner {
  fill: rgba(0, 255, 204, 0.35);
}

.hex-cell-group.has-stone .hex-inner {
  fill: rgba(5, 10, 15, 0.9);
}

/* Panel hover highlight - when hovering over a space in ActionPanel */
.hex-cell-group.panel-hovered .hex-border {
  stroke: #ffcc00;
  stroke-width: 4;
  filter: drop-shadow(0 0 8px rgba(255, 204, 0, 0.6));
}

.hex-cell-group.panel-hovered .hex-inner {
  fill: rgba(255, 204, 0, 0.25);
}

.hex-cell-group.panel-hovered .hex-coord {
  fill: rgba(255, 204, 0, 0.9);
}

/* Stone styles */
.stone-group {
  pointer-events: none;
  animation: stone-materialize 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes stone-materialize {
  0% {
    transform: scale(0);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

.stone-glow {
  pointer-events: none;
}

.hex-stone {
  pointer-events: none;
  filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.4));
  stroke-width: 2;
}

.hex-stone.is-mine {
  stroke-width: 3;
}

.stone-highlight {
  fill: rgba(255, 255, 255, 0.3);
  pointer-events: none;
}

/* Coordinate labels */
.hex-coord {
  font-family: 'Courier New', monospace;
  font-size: 12px;
  font-weight: bold;
  fill: rgba(0, 255, 204, 0.2);
  pointer-events: none;
  user-select: none;
  text-transform: uppercase;
  letter-spacing: 1px;
  transition: fill 0.3s ease;
}

.hex-cell-group:hover .hex-coord {
  fill: rgba(0, 255, 204, 0.5);
}

.hex-cell-group.valid-target .hex-coord {
  fill: rgba(0, 255, 204, 0.8);
}

/* Turn indicator */
.turn-indicator {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 24px;
  background: linear-gradient(90deg, transparent, rgba(0, 255, 204, 0.1), transparent);
  border: 1px solid rgba(0, 255, 204, 0.4);
  border-radius: 4px;
  animation: indicator-glow 2s ease-in-out infinite;
}

@keyframes indicator-glow {
  0%, 100% {
    box-shadow: 0 0 10px rgba(0, 255, 204, 0.3);
    border-color: rgba(0, 255, 204, 0.4);
  }
  50% {
    box-shadow: 0 0 20px rgba(0, 255, 204, 0.6);
    border-color: rgba(0, 255, 204, 0.8);
  }
}

.indicator-icon {
  width: 12px;
  height: 12px;
  background: #00ffcc;
  border-radius: 50%;
  animation: icon-blink 1s ease-in-out infinite;
}

@keyframes icon-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.indicator-text {
  font-family: 'Courier New', monospace;
  font-size: 0.85rem;
  font-weight: bold;
  color: #00ffcc;
  letter-spacing: 2px;
  text-transform: uppercase;
}

/* Dynamic player color theming via CSS variable */
.hex-board-wrapper {
  --my-color-rgb: 0, 255, 204; /* Default fallback */
}

.hex-board-wrapper[style*="--my-color"] {
  border-color: color-mix(in srgb, var(--my-color) 30%, transparent);
  box-shadow:
    0 0 30px color-mix(in srgb, var(--my-color) 10%, transparent),
    inset 0 0 60px rgba(0, 0, 0, 0.5);
}
</style>
