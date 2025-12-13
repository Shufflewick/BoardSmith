<script setup lang="ts">
/**
 * AutoElement - Renders a single game element with appropriate styling
 *
 * Automatically selects rendering strategy based on system properties set by engine classes:
 * - Card: Playing card (detected via $type='card' from engine Card class)
 * - Hand: Player's hand of cards (detected via $type='hand' from engine Hand class)
 * - Deck: Stack of cards (detected via $type='deck' from engine Deck class)
 * - Board: Grid layout (detected via $layout='grid' from engine Grid class)
 * - GridCell: Positioned cell within a grid
 * - Piece: Generic game element (tokens, tiles, etc.)
 * - Space: Generic container with children
 *
 * Board Interaction:
 * - Highlights elements when hovered in ActionPanel
 * - Click to select and filter ActionPanel choices
 */
import { computed, inject, provide, ref, watchEffect, type Ref } from 'vue';
import { useBoardInteraction } from '../../composables/useBoardInteraction';

export interface GameElement {
  id: number;
  name?: string;
  className: string;
  attributes?: Record<string, unknown>;
  children?: GameElement[];
  childCount?: number;
  __hidden?: boolean;
}

const props = defineProps<{
  element: GameElement;
  depth: number;
  /** Size override for pieces inside hex cells */
  hexPieceSize?: number;
}>();

const emit = defineEmits<{
  (e: 'elementClick', element: GameElement): void;
}>();

// Inject context
const playerPosition = inject<number>('playerPosition', 0);
const selectableElements = inject<Ref<Set<number>>>('selectableElements');
const selectedElements = inject<Ref<Set<number>>>('selectedElements');
const defaultBackImage = inject<Ref<ImageInfo | null>>('defaultBackImage', ref(null));

// Time travel diff for highlighting changed elements
const timeTravelDiff = inject<Ref<{ added: number[]; removed: number[]; changed: number[] } | null>>('timeTravelDiff', ref(null));

// Diff highlighting computed properties
const isDiffAdded = computed(() => timeTravelDiff?.value?.added?.includes(props.element.id) ?? false);
const isDiffChanged = computed(() => timeTravelDiff?.value?.changed?.includes(props.element.id) ?? false);
const diffHighlightClass = computed(() => {
  if (isDiffAdded.value) return 'diff-added';
  if (isDiffChanged.value) return 'diff-changed';
  return '';
});

// Board interaction for hover highlighting and click selection
const boardInteraction = useBoardInteraction();

// Grid coordinate metadata (provided by parent Grid element)
const parentGridCoords = inject<{ rowCoord: string; colCoord: string } | null>('gridCoords', null);

// If this is a Grid element, provide coordinate metadata to children
if (props.element.attributes?.$layout === 'grid') {
  const rowCoord = props.element.attributes?.$rowCoord as string | undefined;
  const colCoord = props.element.attributes?.$colCoord as string | undefined;
  if (rowCoord && colCoord) {
    provide('gridCoords', { rowCoord, colCoord });
  }
}

// Get the coordinate attribute names for grid rendering
// Finds the first 2 numeric attributes in grid cell children
const gridCoordNames = computed(() => {
  const attrs = props.element.attributes ?? {};
  const layout = attrs.$layout as string | undefined;

  if (layout !== 'grid') return null;

  const children = visibleChildren.value;
  if (children.length === 0) return null;

  // Find the first two numeric attributes from the first child
  const firstChild = children[0];
  const numericAttrs = Object.entries(firstChild.attributes ?? {})
    .filter(([key, value]) => typeof value === 'number' && !key.startsWith('_'))
    .map(([key]) => key)
    .slice(0, 2);

  if (numericAttrs.length < 2) return null;

  return { first: numericAttrs[0], second: numericAttrs[1] };
});

// Element type detection
// Uses system properties set by the engine (NO game-specific className checks)
const elementType = computed(() => {
  const attrs = props.element.attributes ?? {};
  const type = attrs.$type as string | undefined;
  const layout = attrs.$layout as string | undefined;

  // Check $type property set by engine element classes (Card, Hand, Deck, etc.)
  if (type === 'card') return 'card';
  if (type === 'hand') return 'hand';
  if (type === 'deck') return 'deck';

  // Use $layout property set by engine element classes
  // Grid, HexGrid, etc. set this explicitly - NO GUESSING
  if (layout === 'grid') return 'board';
  if (layout === 'hex-grid') return 'hex-board';

  // HexCell detection via $type
  if (type === 'hex-cell') return 'hex-cell';

  // GridCell children are positioned cells
  // They have numeric coordinates but don't render as boards themselves
  const hasCoords = Object.entries(attrs).filter(([k, v]) => typeof v === 'number' && !k.startsWith('_')).length >= 2;
  if (hasCoords && props.depth > 0) return 'grid-cell';

  // Check if it's a leaf element (child of a space with no children)
  if (props.depth > 0 && !props.element.children?.length) return 'piece';

  // Default to space (container)
  return 'space';
});

// Check if element is owned by current player
const isOwned = computed(() => {
  const player = props.element.attributes?.player as { position?: number } | undefined;
  return player?.position === playerPosition;
});

// Get player name from element attributes
const playerName = computed(() => {
  const player = props.element.attributes?.player as { name?: string; position?: number } | undefined;
  return player?.name || `Player ${(player?.position ?? 0) + 1}`;
});

// Check if element is selectable/selected
const isSelectable = computed(() => selectableElements?.value?.has(props.element.id) ?? false);
const isSelected = computed(() => selectedElements?.value?.has(props.element.id) ?? false);

// Compute element notation for board cells
// Uses element.name which is set by the game designer
const elementNotation = computed(() => {
  // The game designer sets element names - use them directly
  // Examples: "a1", "b6", "center", "home-base", etc.
  return props.element.name || null;
});

// Drag state
const isDragged = computed(() => {
  if (!boardInteraction) return false;
  return boardInteraction.isDraggedElement({
    id: props.element.id,
    name: props.element.name,
    notation: elementNotation.value || undefined,
  });
});

const isDropTarget = computed(() => {
  if (!boardInteraction) return false;
  return boardInteraction.isDropTarget({
    id: props.element.id,
    name: props.element.name,
    notation: elementNotation.value || undefined,
  });
});

// Board interaction states
const isBoardHighlighted = computed(() => {
  if (!boardInteraction) return false;
  return boardInteraction.isHighlighted({
    id: props.element.id,
    name: props.element.name,
    notation: elementNotation.value || undefined,
  });
});

const isBoardSelected = computed(() => {
  if (!boardInteraction) return false;
  return boardInteraction.isSelected({
    id: props.element.id,
    name: props.element.name,
    notation: elementNotation.value || undefined,
  });
});

const isValidTarget = computed(() => {
  if (!boardInteraction) return false;
  return boardInteraction.isValidTarget({
    id: props.element.id,
    name: props.element.name,
    notation: elementNotation.value || undefined,
  });
});

const isActionSelectable = computed(() => {
  if (!boardInteraction) return false;

  // Don't show as action-selectable if already selected
  if (isBoardSelected.value) return false;

  const elementRef = {
    id: props.element.id,
    name: props.element.name,
    notation: elementNotation.value || undefined,
  };

  // Check if this element is in valid elements for current selection
  if (boardInteraction.isSelectableElement(elementRef)) {
    return true;
  }

  // Also check if this is the draggable selected element (for skipIfOnlyOne scenarios)
  if (boardInteraction.isDraggableSelectedElement(elementRef)) {
    return true;
  }

  return false;
});

// Get display label for element
const displayLabel = computed(() => {
  // Use element name or className
  return props.element.name || props.element.className;
});

// Card image handling - get face/back image from $images attribute
const cardImages = computed(() => {
  const attrs = props.element.attributes;
  if (!attrs?.$images) return null;

  const images = attrs.$images as Record<string, string | { sprite: string; x: number; y: number; width?: number; height?: number }>;
  return {
    face: images.face,
    back: images.back,
  };
});

// Get the current card image based on visibility
const currentCardImage = computed((): ImageInfo | null => {
  if (!cardImages.value) return null;

  const isHidden = props.element.__hidden || props.element.attributes?.__hidden;
  const image = isHidden ? cardImages.value.back : cardImages.value.face;

  if (!image) return null;

  // Handle simple string path (individual image file)
  if (typeof image === 'string') {
    return { type: 'url' as const, src: image };
  }

  // Handle CSS sprite sheet with coordinates
  if (typeof image === 'object' && 'sprite' in image && 'x' in image && 'y' in image) {
    const sprite = image as { sprite: string; x: number; y: number; width: number; height: number };
    return {
      type: 'sprite' as const,
      sprite: sprite.sprite,
      x: sprite.x,
      y: sprite.y,
      width: sprite.width,
      height: sprite.height,
    };
  }

  return null;
});

// Piece style - size for hex pieces, visibility control
const pieceStyle = computed(() => {
  if (props.hexPieceSize) {
    return `width: ${props.hexPieceSize}px !important; height: ${props.hexPieceSize}px !important;`;
  }
  return undefined;
});

// Get children (or empty if hidden)
const visibleChildren = computed(() => {
  if (props.element.__hidden) return [];
  return props.element.children ?? [];
});

// Count display for hidden/count-only elements
const childCountDisplay = computed(() => {
  if (props.element.childCount !== undefined) {
    return props.element.childCount;
  }
  return visibleChildren.value.length;
});

// Type for parsed image info (either URL or sprite with coordinates)
type ImageInfo =
  | { type: 'url'; src: string }
  | { type: 'sprite'; sprite: string; x: number; y: number; width: number; height: number };

// Helper to extract image info from $images value (handles string and sprite sheet formats)
function getImageInfo(image: unknown): ImageInfo | null {
  if (!image) return null;
  if (typeof image === 'string') return { type: 'url', src: image };
  if (typeof image === 'object' && image !== null) {
    const spriteObj = image as { sprite?: string; x?: number; y?: number; width?: number; height?: number };
    if (spriteObj.sprite && typeof spriteObj.x === 'number' && typeof spriteObj.y === 'number') {
      return {
        type: 'sprite',
        sprite: spriteObj.sprite,
        x: spriteObj.x,
        y: spriteObj.y,
        width: spriteObj.width ?? 238,
        height: spriteObj.height ?? 333,
      };
    }
    if (spriteObj.sprite) {
      return { type: 'url', src: spriteObj.sprite };
    }
  }
  return null;
}

// Sprite sheet layout constants
// Standard card dimensions in the sprite sheet (face cards)
const NATIVE_CARD_WIDTH = 238;
const NATIVE_CARD_HEIGHT = 333;
const SPRITE_COLS = 13;
const SPRITE_ROWS = 5;

// Helper to compute scaled CSS sprite styles for a given display size
// IMPORTANT: Scale based on native face card dimensions (238x333), not the individual
// card's dimensions, because card backs may have different sizes in the sprite
function getSpriteStyle(info: ImageInfo, displayWidth: number = 60, displayHeight: number = 84): Record<string, string> {
  if (info.type !== 'sprite') return {};

  // Scale based on standard card size, not individual card's dimensions
  // This ensures consistent scaling for both face cards and back cards
  const scaleX = displayWidth / NATIVE_CARD_WIDTH;
  const scaleY = displayHeight / NATIVE_CARD_HEIGHT;

  // Total sprite sheet dimensions
  const sheetWidth = SPRITE_COLS * NATIVE_CARD_WIDTH;
  const sheetHeight = SPRITE_ROWS * NATIVE_CARD_HEIGHT;

  // Scaled sprite sheet size
  const scaledSheetWidth = sheetWidth * scaleX;
  const scaledSheetHeight = sheetHeight * scaleY;

  // Scale the position coordinates
  const scaledX = info.x * scaleX;
  const scaledY = info.y * scaleY;

  return {
    backgroundImage: `url(${info.sprite})`,
    backgroundPosition: `-${scaledX}px -${scaledY}px`,
    backgroundSize: `${scaledSheetWidth}px ${scaledSheetHeight}px`,
    backgroundRepeat: 'no-repeat',
  };
}

// Get back image info from any child's $images (for deck stacks and hidden cards)
const childBackImage = computed((): ImageInfo | null => {
  // Check visible children first
  for (const child of (props.element.children ?? [])) {
    const images = child.attributes?.$images as Record<string, unknown> | undefined;
    if (images?.back) {
      const info = getImageInfo(images.back);
      if (info) return info;
    }
  }
  // Also check this element's own $images (for deck containers that have $images set directly)
  const ownImages = props.element.attributes?.$images as Record<string, unknown> | undefined;
  if (ownImages?.back) {
    const info = getImageInfo(ownImages.back);
    if (info) return info;
  }
  // Fall back to the default back image from the game view (includes sprite coordinates)
  if (defaultBackImage.value) {
    return defaultBackImage.value;
  }
  return null;
});

// Threshold for splitting hand into two rows (cards per row)
const MAX_CARDS_PER_ROW = 10;

// Sort cards alphanumerically by their name/label
const sortedHandCards = computed(() => {
  const cards = [...visibleChildren.value];
  return cards.sort((a, b) => {
    const nameA = a.name || '';
    const nameB = b.name || '';
    // Natural sort: extract rank and suit for proper ordering
    // Card names are typically like "5H", "10S", "KD", "AC"
    const parseCard = (name: string) => {
      const match = name.match(/^(\d+|[AJQK])([CDHS]?)$/i);
      if (!match) return { rank: 0, suit: name };
      const rankStr = match[1].toUpperCase();
      const suit = (match[2] || '').toUpperCase();
      // Convert rank to number for proper sorting
      const rankMap: Record<string, number> = { 'A': 1, 'J': 11, 'Q': 12, 'K': 13 };
      const rank = rankMap[rankStr] ?? parseInt(rankStr, 10);
      return { rank, suit };
    };
    const cardA = parseCard(nameA);
    const cardB = parseCard(nameB);
    // Sort by rank first, then by suit
    if (cardA.rank !== cardB.rank) return cardA.rank - cardB.rank;
    return cardA.suit.localeCompare(cardB.suit);
  });
});

// Whether hand needs to split into two rows
const handNeedsTwoRows = computed(() => {
  const count = visibleChildren.value.length || props.element.childCount || 0;
  return count > MAX_CARDS_PER_ROW;
});

// Back row cards (first half, displayed behind)
const backRowCards = computed(() => {
  if (!handNeedsTwoRows.value) return [];
  const cards = sortedHandCards.value;
  const halfPoint = Math.ceil(cards.length / 2);
  return cards.slice(0, halfPoint);
});

// Front row cards (second half, or all if single row)
const frontRowCards = computed(() => {
  if (!handNeedsTwoRows.value) return sortedHandCards.value;
  const cards = sortedHandCards.value;
  const halfPoint = Math.ceil(cards.length / 2);
  return cards.slice(halfPoint);
});

// Layout properties from element attributes
const layoutProps = computed(() => {
  const attrs = props.element.attributes ?? {};
  return {
    direction: attrs.$direction as 'horizontal' | 'vertical' | undefined,
    gap: attrs.$gap as string | undefined,
    overlap: attrs.$overlap as number | undefined,
    fan: attrs.$fan as boolean | undefined,
    fanAngle: attrs.$fanAngle as number | undefined,
    align: attrs.$align as 'start' | 'center' | 'end' | 'stretch' | undefined,
  };
});

// Compute layout styles for containers
const layoutStyles = computed(() => {
  const { direction, gap, overlap, fan, fanAngle, align } = layoutProps.value;
  const styles: Record<string, string> = {};

  // Direction determines flex-direction
  if (direction) {
    styles['--layout-direction'] = direction === 'vertical' ? 'column' : 'row';
  }

  // Gap between children
  if (gap) {
    styles['--layout-gap'] = gap;
  }

  // Overlap for stacked elements
  if (overlap !== undefined) {
    // Overlap as negative margin percentage (based on element width/height)
    const overlapPercent = Math.round(overlap * 100);
    styles['--layout-overlap'] = `${overlapPercent}%`;
  }

  // Fan properties
  if (fan) {
    styles['--layout-fan'] = '1';
    styles['--layout-fan-angle'] = `${fanAngle ?? 30}deg`;
  }

  // Alignment
  if (align) {
    const alignMap: Record<string, string> = {
      start: 'flex-start',
      center: 'center',
      end: 'flex-end',
      stretch: 'stretch',
    };
    styles['--layout-align'] = alignMap[align] || 'center';
  }

  return styles;
});

function handleClick(event: MouseEvent) {
  // For leaf elements, let click bubble to parent grid-cell so the cell handles selection
  if (elementType.value === 'piece') {
    // Don't stop propagation - let parent grid-cell handle the selection
    return;
  }

  event.stopPropagation();

  // Check if this element is selectable for the current action
  const isActionSelectable = boardInteraction?.isSelectableElement({
    id: props.element.id,
    name: props.element.name,
    notation: elementNotation.value || undefined,
  });

  if (isActionSelectable) {
    // Trigger action selection (e.g., selecting a card to discard)
    boardInteraction?.triggerElementSelect({
      id: props.element.id,
      name: props.element.name,
      notation: elementNotation.value || undefined,
    });
    return;
  }

  // Handle board interaction (for filtering action choices)
  if (elementNotation.value && boardInteraction) {
    boardInteraction.selectElement({
      id: props.element.id,
      name: props.element.name,
      notation: elementNotation.value,
    });
  }

  if (isSelectable.value) {
    emit('elementClick', props.element);
  }
}

function handleChildClick(child: GameElement) {
  emit('elementClick', child);
}

// Handle click on grid cells to select for filtering or trigger action
function handleCellClick() {
  if (!boardInteraction) return;

  // Check if this cell is selectable for the current action
  if (isActionSelectable.value) {
    const elementRef = {
      id: props.element.id,
      name: props.element.name,
      notation: elementNotation.value || undefined,
    };

    // If this is an empty cell (destination), trigger the action immediately
    if (visibleChildren.value.length === 0) {
      boardInteraction.triggerElementSelect(elementRef);
      return;
    }

    // If this is a cell with a piece (source), select it to highlight and show valid moves
    // First, mark this square as selected (for visual highlighting)
    boardInteraction.selectElement(elementRef);
    // Then, trigger the action selection to move to the next step (destinations)
    boardInteraction.triggerElementSelect(elementRef);
    return;
  }

  // Otherwise, use it for filtering action choices
  if (elementNotation.value) {
    boardInteraction.selectElement({
      id: props.element.id,
      name: props.element.name,
      notation: elementNotation.value,
    });
  }
}

// Board size detection (for dynamic grid rendering)
// Generic - works with any two numeric attributes
const boardSize = computed(() => {
  if (elementType.value !== 'board' || !visibleChildren.value.length || !gridCoordNames.value) {
    return { rows: 8, columns: 8 }; // Default fallback
  }

  const { first, second } = gridCoordNames.value;
  let maxFirst = 0;
  let maxSecond = 0;

  for (const child of visibleChildren.value) {
    const attrs = child.attributes ?? {};
    const firstVal = attrs[first];
    const secondVal = attrs[second];

    if (typeof firstVal === 'number') maxFirst = Math.max(maxFirst, firstVal);
    if (typeof secondVal === 'number') maxSecond = Math.max(maxSecond, secondVal);
  }

  return {
    rows: maxFirst + 1,
    columns: maxSecond + 1,
  };
});

// Hex grid properties
const hexGridProps = computed(() => {
  const attrs = props.element.attributes ?? {};
  const result = {
    orientation: (attrs.$hexOrientation as 'flat' | 'pointy') ?? 'pointy',
    coordSystem: (attrs.$coordSystem as 'offset' | 'axial' | 'cube') ?? 'axial',
    qCoord: (attrs.$qCoord as string) ?? 'q',
    rCoord: (attrs.$rCoord as string) ?? 'r',
    sCoord: attrs.$sCoord as string | undefined,
    hexSize: (attrs.$hexSize as number) ?? 50,
  };
  return result;
});

// Calculate hex cell position in pixels based on axial coordinates
const hexCellPosition = computed(() => {
  if (elementType.value !== 'hex-cell') return null;

  const attrs = props.element.attributes ?? {};
  // Get coordinate names from parent (injected)
  const hexProps = inject<{ qCoord: string; rCoord: string; hexSize: number; orientation: 'flat' | 'pointy' } | null>('hexGridProps', null);
  if (!hexProps) return null;

  const q = attrs[hexProps.qCoord] as number ?? 0;
  const r = attrs[hexProps.rCoord] as number ?? 0;
  const size = hexProps.hexSize;
  const orientation = hexProps.orientation;

  // Axial to pixel conversion
  // https://www.redblobgames.com/grids/hexagons/#hex-to-pixel
  let x: number, y: number;

  if (orientation === 'pointy') {
    // Pointy-top hex
    x = size * (Math.sqrt(3) * q + Math.sqrt(3) / 2 * r);
    y = size * (3 / 2 * r);
  } else {
    // Flat-top hex
    x = size * (3 / 2 * q);
    y = size * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r);
  }

  return { x, y };
});

// Provide hex grid props to children
const hexPropsProvided = ref(false);
watchEffect(() => {
  if (elementType.value === 'hex-board' && !hexPropsProvided.value) {
    provide('hexGridProps', hexGridProps.value);
    hexPropsProvided.value = true;
  }
});

// Calculate hex grid bounds (for SVG viewBox)
const hexGridBounds = computed(() => {
  if (elementType.value !== 'hex-board' || !visibleChildren.value.length) {
    return { minX: 0, minY: 0, width: 400, height: 400 };
  }

  const { qCoord, rCoord, hexSize, orientation } = hexGridProps.value;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  for (const child of visibleChildren.value) {
    const attrs = child.attributes ?? {};
    const q = (attrs[qCoord] as number) ?? 0;
    const r = (attrs[rCoord] as number) ?? 0;

    let x: number, y: number;
    if (orientation === 'pointy') {
      x = hexSize * (Math.sqrt(3) * q + Math.sqrt(3) / 2 * r);
      y = hexSize * (3 / 2 * r);
    } else {
      x = hexSize * (3 / 2 * q);
      y = hexSize * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r);
    }

    minX = Math.min(minX, x - hexSize);
    maxX = Math.max(maxX, x + hexSize);
    minY = Math.min(minY, y - hexSize);
    maxY = Math.max(maxY, y + hexSize);
  }

  // Add padding
  const padding = hexSize;
  return {
    minX: minX - padding,
    minY: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
});

// Generate hex polygon points for SVG
const hexPoints = computed(() => {
  const size = hexGridProps.value.hexSize;
  const orientation = hexGridProps.value.orientation;
  const points: string[] = [];

  for (let i = 0; i < 6; i++) {
    const angleDeg = orientation === 'pointy' ? 60 * i - 30 : 60 * i;
    const angleRad = Math.PI / 180 * angleDeg;
    const x = size * Math.cos(angleRad);
    const y = size * Math.sin(angleRad);
    points.push(`${x},${y}`);
  }

  return points.join(' ');
});

// Helper to get hex position for a child element
function getHexPosition(child: GameElement): { x: number; y: number } {
  const attrs = child.attributes ?? {};
  const { qCoord, rCoord, hexSize, orientation } = hexGridProps.value;

  const q = (attrs[qCoord] as number) ?? 0;
  const r = (attrs[rCoord] as number) ?? 0;

  let x: number, y: number;
  if (orientation === 'pointy') {
    x = hexSize * (Math.sqrt(3) * q + Math.sqrt(3) / 2 * r);
    y = hexSize * (3 / 2 * r);
  } else {
    x = hexSize * (3 / 2 * q);
    y = hexSize * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r);
  }

  return { x, y };
}

// Handle click on hex cell
function handleHexClick(child: GameElement) {
  if (!boardInteraction) return;

  const isSelectable = boardInteraction.isSelectableElement({
    id: child.id,
    name: child.name,
  });

  if (isSelectable) {
    boardInteraction.triggerElementSelect({
      id: child.id,
      name: child.name,
    });
  } else if (child.name) {
    boardInteraction.selectElement({
      id: child.id,
      name: child.name,
    });
  }
}

// Drag and drop handlers
function handleDragStart(event: DragEvent) {
  if (!boardInteraction || !isActionSelectable.value) {
    event.preventDefault();
    return;
  }

  event.dataTransfer?.setData('boardsmith/element', JSON.stringify({
    id: props.element.id,
    name: props.element.name,
    notation: elementNotation.value,
  }));
  event.dataTransfer!.effectAllowed = 'move';

  boardInteraction.startDrag({
    id: props.element.id,
    name: props.element.name,
    notation: elementNotation.value || undefined,
  });
}

function handleDragEnd() {
  if (boardInteraction?.isDragging) {
    boardInteraction.endDrag();
  }
}

function handleDragOver(event: DragEvent) {
  if (!boardInteraction?.isDragging) return;
  if (!isDropTarget.value) return;

  event.preventDefault();
  event.dataTransfer!.dropEffect = 'move';
}

function handleDrop(event: DragEvent) {
  if (!boardInteraction?.isDragging) return;

  event.preventDefault();

  boardInteraction.triggerDrop({
    id: props.element.id,
    name: props.element.name,
    notation: elementNotation.value || undefined,
  });
}

// ============================================
// Zoom Preview Data Attribute (for event delegation)
// ============================================
// Standard card display size (used for preview calculations)
const CARD_DISPLAY_WIDTH = 60;
const CARD_DISPLAY_HEIGHT = 84;

const cardPreviewData = computed(() => {
  if (elementType.value !== 'card') return null;

  // Parse card name for rank/suit (e.g., "5H" → { rank: '5', suit: 'H' })
  const match = props.element.name?.match(/^(\d+|[AJQK])([CDHS]?)$/i);
  const rank = match?.[1]?.toUpperCase();
  const suit = (match?.[2] || '').toUpperCase();

  // Get current visibility state
  const isHidden = props.element.__hidden || props.element.attributes?.__hidden;

  return JSON.stringify({
    rank,
    suit,
    faceImage: cardImages.value?.face,
    backImage: cardImages.value?.back,
    showBack: !!isHidden,
    label: props.element.name || displayLabel.value,
    width: CARD_DISPLAY_WIDTH,
    height: CARD_DISPLAY_HEIGHT,
  });
});

// Preview data for deck/hand card backs (hidden cards showing backs)
// Always returns data so zoom preview works even without images
const cardBackPreviewData = computed(() => {
  return JSON.stringify({
    backImage: childBackImage.value || undefined,
    showBack: true,
    label: 'Card',
    width: CARD_DISPLAY_WIDTH,
    height: CARD_DISPLAY_HEIGHT,
  });
});
</script>

<template>
  <div
    class="auto-element"
    :class="[
      `type-${elementType}`,
      `depth-${Math.min(depth, 3)}`,
      diffHighlightClass,
      {
        'is-owned': isOwned,
        'is-selectable': isSelectable,
        'is-selected': isSelected,
        'is-hidden': element.__hidden,
        'is-board-highlighted': isBoardHighlighted,
        'is-board-selected': isBoardSelected,
        'is-valid-target': isValidTarget,
      }
    ]"
    @click="handleClick"
  >
    <!-- CARD RENDERING -->
    <template v-if="elementType === 'card'">
      <div
        class="card-container"
        :class="{
          'action-selectable': isActionSelectable,
          'is-draggable': isActionSelectable,
          'is-dragging': isDragged,
          'has-image': !!currentCardImage,
        }"
        :data-element-id="element.id"
        :data-animatable="true"
        :data-card-preview="cardPreviewData"
        :draggable="isActionSelectable"
        @click="handleClick"
        @dragstart="handleDragStart"
        @dragend="handleDragEnd"
      >
        <!-- Card with image -->
        <template v-if="currentCardImage">
          <!-- Regular image file -->
          <img
            v-if="currentCardImage.type === 'url'"
            :src="currentCardImage.src"
            class="card-image"
            :class="{ 'card-image-back': element.__hidden || element.attributes?.__hidden }"
            :alt="displayLabel"
          />
          <!-- CSS sprite sheet with background-position -->
          <div
            v-else-if="currentCardImage.type === 'sprite'"
            class="card-image card-sprite"
            :class="{ 'card-image-back': element.__hidden || element.attributes?.__hidden }"
            :style="getSpriteStyle(currentCardImage)"
          ></div>
        </template>
        <!-- Fallback: Hidden card shows card back -->
        <div v-else-if="element.__hidden || element.attributes?.__hidden" class="card-back" :class="{ 'has-image': childBackImage }">
          <img v-if="childBackImage?.type === 'url'" :src="childBackImage.src" class="card-image" alt="Card back" />
          <div
            v-else-if="childBackImage?.type === 'sprite'"
            class="card-image card-sprite"
            :style="getSpriteStyle(childBackImage)"
          ></div>
        </div>
        <!-- Fallback: Visible card shows face with label -->
        <div v-else class="card-face">
          {{ displayLabel }}
        </div>
      </div>
    </template>

    <!-- HAND RENDERING -->
    <template v-else-if="elementType === 'hand'">
      <div class="hand-container" :style="layoutStyles" :data-zone="element.name" :data-zone-id="element.id">
        <div class="hand-header">
          <span class="hand-label">
            {{ isOwned ? 'Your Hand' : `${playerName}'s Hand` }}
          </span>
          <span class="hand-count">{{ childCountDisplay }} cards</span>
        </div>
        <div class="hand-cards-wrapper" :class="{ 'has-fan': layoutProps.fan, 'has-overlap': layoutProps.overlap !== undefined, 'two-rows': handNeedsTwoRows }">
          <!-- Back row (first half of cards when split) -->
          <div v-if="handNeedsTwoRows" class="hand-cards hand-cards-back">
            <template v-if="visibleChildren.length > 0">
              <AutoElement
                v-for="(child, index) in backRowCards"
                :key="child.id"
                :element="child"
                :depth="depth + 1"
                class="hand-card"
                :style="{ '--card-index': index, '--card-count': backRowCards.length, '--row': 'back' }"
                @element-click="handleChildClick"
              />
            </template>
            <template v-else-if="element.childCount">
              <div
                v-for="i in Math.ceil(element.childCount / 2)"
                :key="i"
                class="hand-card card-back-small"
                :class="{ 'has-image': childBackImage }"
                :style="{ '--card-index': i - 1, '--card-count': Math.ceil(element.childCount / 2), '--row': 'back' }"
                :data-card-preview="cardBackPreviewData"
              >
                <img v-if="childBackImage?.type === 'url'" :src="childBackImage.src" class="card-image" alt="Card back" />
                <div
                  v-else-if="childBackImage?.type === 'sprite'"
                  class="card-image card-sprite"
                  :style="getSpriteStyle(childBackImage)"
                ></div>
              </div>
            </template>
          </div>
          <!-- Front row (or all cards when single row) -->
          <div class="hand-cards hand-cards-front" :data-zone="element.name">
            <template v-if="visibleChildren.length > 0">
              <AutoElement
                v-for="(child, index) in frontRowCards"
                :key="child.id"
                :element="child"
                :depth="depth + 1"
                class="hand-card"
                :style="{ '--card-index': index, '--card-count': frontRowCards.length, '--row': 'front' }"
                @element-click="handleChildClick"
              />
            </template>
            <template v-else-if="element.childCount">
              <div
                v-for="i in (handNeedsTwoRows ? Math.floor(element.childCount / 2) : element.childCount)"
                :key="i"
                class="hand-card card-back-small"
                :class="{ 'has-image': childBackImage }"
                :style="{ '--card-index': i - 1, '--card-count': handNeedsTwoRows ? Math.floor(element.childCount / 2) : element.childCount, '--row': 'front' }"
                :data-card-preview="cardBackPreviewData"
              >
                <img v-if="childBackImage?.type === 'url'" :src="childBackImage.src" class="card-image" alt="Card back" />
                <div
                  v-else-if="childBackImage?.type === 'sprite'"
                  class="card-image card-sprite"
                  :style="getSpriteStyle(childBackImage)"
                ></div>
              </div>
            </template>
            <div v-if="!visibleChildren.length && !element.childCount" class="empty-hand">No cards</div>
          </div>
        </div>
      </div>
    </template>

    <!-- DECK RENDERING -->
    <template v-else-if="elementType === 'deck'">
      <div class="deck-container" :style="layoutStyles" :data-zone="element.name" :data-zone-id="element.id">
        <div class="deck-header">
          <span class="deck-label">{{ displayLabel }}</span>
          <span class="deck-count" v-if="childCountDisplay">{{ childCountDisplay }} cards</span>
        </div>
        <!-- Show stacked cards (hidden or visible) -->
        <template v-if="visibleChildren.length > 0">
          <div class="deck-stack" :data-zone="element.name">
            <!-- Only show up to 5 cards in the visual stack -->
            <AutoElement
              v-for="(child, index) in visibleChildren.slice(0, 5)"
              :key="child.id"
              :element="child"
              :depth="depth + 1"
              class="deck-card-element"
              :style="{ '--stack-index': index + 1 }"
              @element-click="handleChildClick"
            />
          </div>
        </template>
        <!-- Empty deck -->
        <template v-else>
          <div class="empty-deck">
            <span class="empty-text">Empty</span>
          </div>
        </template>
      </div>
    </template>

    <!-- BOARD RENDERING -->
    <template v-else-if="elementType === 'board'">
      <div class="board-container">
        <div class="board-header">{{ displayLabel }}</div>
        <div class="board-with-labels">
          <!-- Column labels (from game designer or numeric indices) -->
          <div class="board-column-labels">
            <span class="board-label corner"></span>
            <span v-for="(label, index) in (element.attributes?.$columnLabels as string[] || Array.from({length: boardSize.columns}, (_, i) => String(i)))" :key="index" class="board-label">{{ label }}</span>
          </div>
          <div class="board-row-wrapper">
            <!-- Row labels (from game designer or numeric indices) -->
            <div class="board-row-labels">
              <span v-for="(label, index) in (element.attributes?.$rowLabels as string[] || Array.from({length: boardSize.rows}, (_, i) => String(i)))" :key="index" class="board-label">{{ label }}</span>
            </div>
            <div class="board-grid" :style="{ 'grid-template-columns': `repeat(${boardSize.columns}, 1fr)` }">
              <AutoElement
                v-for="child in visibleChildren"
                :key="child.id"
                :element="child"
                :depth="depth + 1"
                @element-click="handleChildClick"
              />
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- GRID CELL RENDERING -->
    <template v-else-if="elementType === 'grid-cell'">
      <div
        class="grid-cell"
        :class="{
          'has-children': visibleChildren.length > 0,
          'is-clickable': visibleChildren.length > 0,
          'action-selectable': isActionSelectable,
          'is-drop-target': isDropTarget,
        }"
        :style="parentGridCoords ? {
          'grid-row': (element.attributes?.[parentGridCoords.rowCoord] as number) + 1,
          'grid-column': (element.attributes?.[parentGridCoords.colCoord] as number) + 1,
        } : {}"
        @click.stop="handleCellClick"
        @dragover="handleDragOver"
        @drop="handleDrop"
        :title="elementNotation || undefined"
      >
        <!-- Notation label shown on hover -->
        <span v-if="elementNotation" class="cell-notation">{{ elementNotation }}</span>
        <AutoElement
          v-for="child in visibleChildren"
          :key="child.id"
          :element="child"
          :depth="depth + 1"
          @element-click="handleChildClick"
        />
      </div>
    </template>

    <!-- HEX BOARD RENDERING -->
    <template v-else-if="elementType === 'hex-board'">
      <div class="hex-board-container">
        <div class="hex-board-header">{{ displayLabel }}</div>
        <svg
          class="hex-board"
          :key="`hex-svg-${props.element.id}`"
          :viewBox="`${hexGridBounds.minX} ${hexGridBounds.minY} ${hexGridBounds.width} ${hexGridBounds.height}`"
          :width="hexGridBounds.width"
          :height="hexGridBounds.height"
          preserveAspectRatio="xMidYMid meet"
        >
          <!-- Render hex cells as groups with polygon + content -->
          <g
            v-for="child in visibleChildren"
            :key="child.id"
            class="hex-cell-group"
            :transform="`translate(${getHexPosition(child).x}, ${getHexPosition(child).y})`"
          >
            <polygon
              :points="hexPoints"
              class="hex-polygon"
              :class="{
                'has-children': (child.children?.length ?? 0) > 0,
                'action-selectable': boardInteraction?.isSelectableElement({ id: child.id, name: child.name }),
                'is-board-highlighted': boardInteraction?.isHighlighted({ id: child.id, name: child.name }),
                'is-board-selected': boardInteraction?.isSelected({ id: child.id, name: child.name }),
              }"
              @click="handleHexClick(child)"
            />
            <!-- Child content as SVG circle (no foreignObject) -->
            <circle
              v-for="grandchild in (child.children || [])"
              :key="grandchild.id"
              :r="hexGridProps.hexSize * 0.35"
              class="hex-piece-circle"
              :class="{
                'player-0': (grandchild.attributes?.player as any)?.position === 0,
                'player-1': (grandchild.attributes?.player as any)?.position === 1,
              }"
            >
              <title>{{ grandchild.name }}</title>
            </circle>
            <!-- Cell label -->
            <text
              v-if="child.name"
              class="hex-label"
              text-anchor="middle"
              dominant-baseline="middle"
              :y="hexGridProps.hexSize * 0.7"
            >{{ child.name }}</text>
          </g>
        </svg>
      </div>
    </template>

    <!-- HEX CELL RENDERING (standalone, outside SVG context) -->
    <template v-else-if="elementType === 'hex-cell'">
      <div
        class="hex-cell"
        :class="{
          'has-children': visibleChildren.length > 0,
          'action-selectable': isActionSelectable,
        }"
        @click.stop="handleCellClick"
      >
        <AutoElement
          v-for="child in visibleChildren"
          :key="child.id"
          :element="child"
          :depth="depth + 1"
          @element-click="handleChildClick"
        />
      </div>
    </template>

    <!-- LEAF ELEMENT RENDERING -->
    <!-- Clicks on leaf elements bubble to parent grid-cell for selection -->
    <template v-else-if="elementType === 'piece'">
      <div
        :class="['piece', { 'is-draggable': isActionSelectable, 'is-dragging': isDragged, 'hex-piece': !!props.hexPieceSize }]"
        :style="pieceStyle"
        :data-element-id="element.id"
        :data-animatable="true"
        :draggable="isActionSelectable"
        @dragstart="handleDragStart"
        @dragend="handleDragEnd"
      >
        {{ displayLabel }}
      </div>
    </template>

    <!-- GENERIC SPACE RENDERING -->
    <template v-else>
      <div class="space-container" :style="layoutStyles">
        <div class="space-header">
          <span class="space-label">
            <template v-if="props.element.attributes?.player">
              {{ isOwned ? `Your ${props.element.className}` : `${playerName}'s ${props.element.className}` }}
            </template>
            <template v-else>
              {{ displayLabel }}
            </template>
          </span>
          <span v-if="childCountDisplay > 0" class="space-count">({{ childCountDisplay }})</span>
        </div>
        <div v-if="visibleChildren.length > 0" class="space-children" :class="{ 'has-overlap': layoutProps.overlap !== undefined, 'has-fan': layoutProps.fan }">
          <AutoElement
            v-for="(child, index) in visibleChildren"
            :key="child.id"
            :element="child"
            :depth="depth + 1"
            :style="{ '--card-index': index, '--card-count': visibleChildren.length }"
            @element-click="handleChildClick"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.auto-element {
  transition: all 0.2s ease;
}

/* Selection states */
.is-selectable {
  cursor: pointer;
}

.is-selectable:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 217, 255, 0.3);
}

.is-selected {
  outline: 3px solid #00d9ff;
  outline-offset: 2px;
}

/* CARD STYLES */
.card-container {
  display: inline-block;
  transition: transform 0.2s ease;
}

.card-container.action-selectable {
  cursor: pointer;
  outline: 2px solid rgba(46, 204, 113, 0.6);
  outline-offset: 2px;
  border-radius: 8px;
  animation: pulse-card 2s ease-in-out infinite;
}

.card-container.action-selectable:hover {
  outline-color: rgba(46, 204, 113, 1);
  outline-width: 3px;
  transform: translateY(-8px);
}

@keyframes pulse-card {
  0%, 100% {
    outline-color: rgba(46, 204, 113, 0.6);
  }
  50% {
    outline-color: rgba(46, 204, 113, 1);
  }
}

.card-face {
  /* Playing card aspect ratio: 2.5" x 3.5" */
  width: 60px;
  min-width: 45px;
  height: 84px;
  background: #fff;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  color: #000;
  font-size: 0.85rem;
  text-align: center;
  padding: 4px;
  border: 2px solid #333;
  flex-shrink: 0;
}

/* Card image styles */
.card-image {
  width: 60px;
  min-width: 45px;
  height: 84px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  flex-shrink: 0;
  object-fit: contain;
}

/* CSS sprite sheet (uses background-position) */
.card-sprite {
  width: 60px;
  min-width: 45px;
  height: 84px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  flex-shrink: 0;
  background-repeat: no-repeat;
}

/* HAND STYLES */
.hand-container {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  padding: 16px;
  transition: all 0.2s ease;
  overflow: visible;
  position: relative;
}

.hand-container.action-selectable {
  cursor: pointer;
  border: 2px solid rgba(0, 255, 136, 0.6);
  background: rgba(0, 255, 136, 0.1);
  animation: pulse-hand 2s ease-in-out infinite;
}

.hand-container.action-selectable:hover {
  border-color: rgba(0, 255, 136, 1);
  background: rgba(0, 255, 136, 0.2);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 255, 136, 0.3);
}

@keyframes pulse-hand {
  0%, 100% {
    border-color: rgba(0, 255, 136, 0.6);
  }
  50% {
    border-color: rgba(0, 255, 136, 1);
  }
}

.hand-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.hand-label {
  font-weight: bold;
  color: #fff;
}

.hand-count {
  color: #888;
  font-size: 0.9rem;
}

/* Wrapper for hand cards - handles two-row stacking */
.hand-cards-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
}

/* Two-row mode: stack rows with overlap */
.hand-cards-wrapper.two-rows {
  /* Back row peeks above front row */
}

.hand-cards-wrapper.two-rows .hand-cards-back {
  /* Position back row to peek above front row */
  margin-bottom: -50px; /* Vertical overlap - back row peeks over front */
  z-index: 1;
}

.hand-cards-wrapper.two-rows .hand-cards-front {
  z-index: 2;
}

/* Base hand-cards row */
.hand-cards {
  display: flex;
  min-height: 90px;
  flex-direction: var(--layout-direction, row);
  align-items: flex-end;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
}

/* When fan is active, add padding to contain rotated cards */
.hand-cards-wrapper.has-fan .hand-cards {
  padding: 20px 30px 10px 30px;
  gap: 0;
  flex-wrap: nowrap;
}

/* Overlap mode */
.hand-cards-wrapper.has-overlap .hand-cards {
  gap: 0;
}

/* Default hand-card layout */
.hand-card {
  flex-shrink: 0;
  transition: transform 0.2s ease, z-index 0s;
}

.hand-card:hover {
  z-index: 100 !important; /* Always on top when hovered */
}

/* Non-fan cards lift on hover */
.hand-cards-wrapper:not(.has-fan) .hand-card:hover {
  transform: translateY(-8px);
}

/* Overlap layout - minimal overlap for readability */
.hand-cards-wrapper.has-overlap .hand-card {
  margin-right: -10px;
}

.hand-cards-wrapper.has-overlap .hand-card:last-child {
  margin-right: 0;
}

/* Fan layout - rotate cards around a point below the card */
.hand-cards-wrapper.has-fan .hand-card {
  --fan-angle: var(--layout-fan-angle, 30deg);
  --half-count: calc((var(--card-count, 1) - 1) / 2);
  --angle-step: calc(var(--fan-angle) / max(var(--card-count, 1) - 1, 1));
  --rotation: calc((var(--card-index, 0) - var(--half-count)) * var(--angle-step));
  transform: rotate(var(--rotation));
  /* Rotate around bottom center - creates the fan arc */
  transform-origin: center bottom;
}

/* Fan cards lift and un-rotate on hover for readability */
.hand-cards-wrapper.has-fan .hand-card:hover {
  transform: rotate(0deg) translateY(-15px) scale(1.05);
  z-index: 100 !important;
}

.card-back,
.card-back-small {
  /* Playing card aspect ratio matching card-face */
  width: 60px;
  min-width: 45px;
  height: 84px;
  background: linear-gradient(135deg, #1a365d 0%, #2c5282 100%);
  border-radius: 8px;
  border: 2px solid #4a6fa5;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  flex-shrink: 0;
}

.card-back.has-image,
.card-back-small.has-image {
  background: transparent;
  border: none;
}

.card-back .card-image,
.card-back-small .card-image {
  width: 100%;
  height: 100%;
  border-radius: 8px;
  object-fit: contain;
}

.hidden-cards, .empty-hand {
  color: #666;
  font-style: italic;
  display: flex;
  align-items: center;
}

/* DECK STYLES */
.deck-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
}

.deck-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.deck-label {
  font-size: 1.25rem;
  font-weight: bold;
  color: #fff;
}

.deck-count {
  font-size: 0.9rem;
  color: #aaa;
}

.deck-stack {
  position: relative;
  width: 60px;
  height: 84px;
  align-self: flex-start;
}

/* Actual card elements rendered in deck stack */
.deck-card-element {
  position: absolute;
  top: calc(var(--stack-index, 0) * -2px);
  left: calc(var(--stack-index, 0) * 1px);
}

/* Size the card container within the deck */
.deck-card-element :deep(.card-container) {
  width: 60px;
  height: 84px;
}

.deck-card-element :deep(.card-image) {
  width: 100%;
  height: 100%;
  border-radius: 8px;
  object-fit: cover;
}

.deck-card-element :deep(.card-back) {
  width: 100%;
  height: 100%;
  border-radius: 8px;
}

.empty-deck {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 20px;
}

.empty-text {
  color: #666;
  font-style: italic;
}

/* BOARD STYLES */
.board-container {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  padding: 16px;
}

.board-header {
  font-weight: bold;
  margin-bottom: 12px;
}

.board-with-labels {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.board-column-labels {
  display: flex;
  gap: 2px;
  margin-left: 24px; /* Account for row labels */
}

.board-label {
  width: 50px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  color: #888;
  font-weight: bold;
  text-transform: uppercase;
}

.board-label.corner {
  width: 20px;
}

.board-row-wrapper {
  display: flex;
  gap: 4px;
}

.board-row-labels {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.board-row-labels .board-label {
  width: 20px;
  height: 50px;
}

.board-grid {
  display: grid;
  gap: 2px;
  /* grid-template-columns set dynamically via inline style based on board size */
}

/* GRID CELL STYLES */
.grid-cell {
  width: 50px;
  height: 50px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  transition: all 0.15s ease;
}

.grid-cell.is-clickable {
  cursor: pointer;
}

.grid-cell.is-clickable:hover {
  background: rgba(0, 217, 255, 0.2);
}

.cell-notation {
  position: absolute;
  bottom: 2px;
  right: 2px;
  font-size: 0.6rem;
  color: #666;
  opacity: 0;
  transition: opacity 0.15s ease;
  pointer-events: none;
}

.grid-cell:hover .cell-notation {
  opacity: 1;
}

/* HEX BOARD STYLES */
.hex-board-container {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  overflow: hidden;
  max-height: 80vh;
  position: relative;
}

.hex-board-header {
  font-weight: bold;
  margin-bottom: 12px;
}

.hex-board {
  /* Let SVG be its natural size based on width/height attributes */
  max-width: 100%;
  height: auto;
}

.hex-cell-group {
  cursor: pointer;
}

.hex-polygon {
  fill: rgba(255, 255, 255, 0.1);
  stroke: rgba(255, 255, 255, 0.3);
  stroke-width: 1.5;
  transition: all 0.15s ease;
}

.hex-polygon:hover {
  fill: rgba(0, 217, 255, 0.2);
  stroke: rgba(0, 217, 255, 0.6);
}

.hex-polygon.has-children {
  fill: rgba(255, 255, 255, 0.15);
}

.hex-polygon.action-selectable {
  fill: rgba(46, 204, 113, 0.2);
  stroke: rgba(46, 204, 113, 0.8);
  stroke-width: 2;
  animation: pulse-hex 2s ease-in-out infinite;
}

.hex-polygon.action-selectable:hover {
  fill: rgba(46, 204, 113, 0.4);
}

@keyframes pulse-hex {
  0%, 100% {
    stroke: rgba(46, 204, 113, 0.6);
  }
  50% {
    stroke: rgba(46, 204, 113, 1);
  }
}

.hex-polygon.is-board-highlighted {
  fill: rgba(0, 217, 255, 0.3);
  stroke: rgba(0, 217, 255, 0.8);
  stroke-width: 2;
}

.hex-polygon.is-board-selected {
  fill: rgba(0, 255, 136, 0.3);
  stroke: rgba(0, 255, 136, 0.8);
  stroke-width: 2.5;
}

/* SVG circle pieces for hex grid */
.hex-piece-circle {
  fill: #888;
  stroke: rgba(0, 0, 0, 0.3);
  stroke-width: 2;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
  transition: transform 0.15s ease;
}

.hex-piece-circle.player-0 {
  fill: url(#redGradient);
  fill: #e74c3c;
}

.hex-piece-circle.player-1 {
  fill: url(#blueGradient);
  fill: #3498db;
}

.hex-piece-circle:hover {
  transform: scale(1.05);
}

.hex-label {
  font-size: 12px;
  fill: #888;
  pointer-events: none;
}

/* Standalone hex cell (outside SVG) */
.hex-cell {
  width: 60px;
  height: 52px;
  background: rgba(255, 255, 255, 0.1);
  clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.hex-cell:hover {
  background: rgba(0, 217, 255, 0.2);
}

.hex-cell.action-selectable {
  background: rgba(46, 204, 113, 0.2);
  outline: 2px solid rgba(46, 204, 113, 0.6);
}

/* LEAF ELEMENT STYLES */
.piece {
  width: 40px;
  height: 40px;
  background: #e74c3c;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  color: #fff;
  font-weight: bold;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

/* Vue transition for hex pieces - start invisible */
.hex-piece-enter-from {
  opacity: 0;
  transform: scale(0.5);
}

.hex-piece-enter-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.hex-piece-enter-to {
  opacity: 1;
  transform: scale(1);
}

/* Ensure pieces inside hex-content-wrapper ARE visible */
.hex-content-wrapper .piece {
  display: flex !important;
}

/* GENERIC SPACE STYLES */
.space-container {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 12px;
}

.space-header {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

.space-label {
  font-weight: bold;
  color: #aaa;
}

.space-count {
  color: #666;
  font-size: 0.9rem;
}

.space-children {
  display: flex;
  flex-wrap: wrap;
  gap: var(--layout-gap, 8px);
  flex-direction: var(--layout-direction, row);
  align-items: var(--layout-align, flex-start);
  justify-content: var(--layout-align, flex-start);
}

/* Space overlap layout */
.space-children.has-overlap > * {
  margin-right: calc(-1 * var(--layout-overlap, 50%) * 70px); /* Assume card-like width */
}

.space-children.has-overlap > *:last-child {
  margin-right: 0;
}

/* Space fan layout */
.space-children.has-fan > * {
  --fan-angle: var(--layout-fan-angle, 30deg);
  --half-count: calc((var(--card-count, 1) - 1) / 2);
  --angle-step: calc(var(--fan-angle) / max(var(--card-count, 1) - 1, 1));
  --rotation: calc((var(--card-index, 0) - var(--half-count)) * var(--angle-step));
  transform: rotate(var(--rotation));
  transform-origin: center 150%;
}

/* OWNED ELEMENT STYLES */
.is-owned .hand-container {
  border: 1px solid rgba(0, 217, 255, 0.3);
  background: rgba(0, 217, 255, 0.05);
}

/* HIDDEN ELEMENT STYLES */
.is-hidden {
  opacity: 0.5;
}

/* BOARD INTERACTION STATES */
/* Highlighted when hovering a choice in ActionPanel */
.is-board-highlighted {
  box-shadow: 0 0 0 3px rgba(0, 217, 255, 0.6);
  z-index: 10;
}

.is-board-highlighted.grid-cell {
  background: rgba(0, 217, 255, 0.3);
}

.is-board-highlighted .piece {
  box-shadow: 0 0 12px rgba(0, 217, 255, 0.8);
  transform: scale(1.1);
}

/* Element selected via board click */
.is-board-selected {
  box-shadow: 0 0 0 3px #00ff88;
  z-index: 11;
}

.is-board-selected.grid-cell {
  background: rgba(0, 255, 136, 0.3);
}

.is-board-selected .piece {
  box-shadow: 0 0 12px rgba(0, 255, 136, 0.8);
  transform: scale(1.15);
}

/* Valid target highlight (when hovering a choice in ActionPanel) */
.is-valid-target {
  box-shadow: 0 0 0 2px rgba(255, 136, 0, 0.6);
}

.is-valid-target.grid-cell {
  background: rgba(255, 136, 0, 0.2);
}

/* Action-selectable pieces (source selection) */
.action-selectable.grid-cell.has-children {
  cursor: pointer;
}

.action-selectable.grid-cell.has-children:hover {
  background: rgba(0, 217, 255, 0.3);
}

.action-selectable.grid-cell.has-children:hover .piece {
  transform: scale(1.08);
  box-shadow: 0 6px 16px rgba(0, 217, 255, 0.4);
}

/* Action-selectable empty cells (destination selection) */
.action-selectable.grid-cell:not(.has-children) {
  cursor: pointer;
  background: rgba(0, 255, 136, 0.4) !important;
}

.action-selectable.grid-cell:not(.has-children)::after {
  content: '';
  position: absolute;
  width: 30%;
  height: 30%;
  background: rgba(0, 255, 136, 0.8);
  border-radius: 50%;
  animation: pulse-destination 1s ease-in-out infinite;
  pointer-events: none;
}

@keyframes pulse-destination {
  0%, 100% { transform: scale(1); opacity: 0.8; }
  50% { transform: scale(1.2); opacity: 1; }
}

/* Show notation when cell is highlighted or selected */
.is-board-highlighted .cell-notation,
.is-board-selected .cell-notation {
  opacity: 1;
  color: #fff;
}

/* DRAG AND DROP STYLES */
.is-draggable {
  cursor: grab;
}

.is-draggable:active {
  cursor: grabbing;
}

.is-dragging {
  opacity: 0.5;
  transform: scale(0.95);
}

.is-drop-target {
  background: rgba(0, 255, 136, 0.3) !important;
  box-shadow: 0 0 0 3px rgba(0, 255, 136, 0.6);
  animation: pulse-drop-target 1s ease-in-out infinite;
}

.is-drop-target::before {
  content: '';
  position: absolute;
  inset: 0;
  border: 2px dashed rgba(0, 255, 136, 0.8);
  border-radius: 4px;
  pointer-events: none;
}

@keyframes pulse-drop-target {
  0%, 100% {
    box-shadow: 0 0 0 3px rgba(0, 255, 136, 0.6);
  }
  50% {
    box-shadow: 0 0 0 5px rgba(0, 255, 136, 0.8);
  }
}

/* Piece dragging styles */
.piece.is-draggable {
  cursor: grab;
  transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
}

.piece.is-dragging {
  opacity: 0.4;
  transform: scale(0.8);
  box-shadow: none;
}

/* Card dragging styles */
.card-container.is-draggable {
  cursor: grab;
}

.card-container.is-dragging {
  opacity: 0.4;
  transform: scale(0.95) rotate(5deg);
}

/* Time travel diff highlighting */
.diff-added {
  outline: 3px solid #22c55e !important;
  outline-offset: 2px;
  box-shadow: 0 0 12px rgba(34, 197, 94, 0.5);
  animation: diff-pulse 1.5s ease-in-out infinite;
}

.diff-changed {
  outline: 3px solid #f59e0b !important;
  outline-offset: 2px;
  box-shadow: 0 0 12px rgba(245, 158, 11, 0.5);
  animation: diff-pulse 1.5s ease-in-out infinite;
}

@keyframes diff-pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}
</style>
