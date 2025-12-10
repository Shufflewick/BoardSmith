# Auto-UI Enhancement Plan

**STATUS: IMPLEMENTED**

Based on comparison between `features/04-auto-ui-generation.md` and current implementation.

## Summary

The core Auto-UI infrastructure is solid. Key gaps are:
1. Hex grid layout support
2. Declarative layout configuration (overlap, fan, gap)
3. Drag-and-drop integration
4. Component override registry

## Phase 1: Declarative Layout Configuration

Add layout hints to Space class that AutoElement can use for rendering.

### 1.1 Add Layout Properties to Space Class

**File:** `packages/engine/src/element/space.ts`

```typescript
// Add to Space class
/** Layout direction for children */
$direction?: 'horizontal' | 'vertical';

/** Gap between children (CSS value) */
$gap?: string;

/** Overlap ratio for stacked elements (0-1, where 0.3 = 30% overlap) */
$overlap?: number;

/** Whether to fan children (like a hand of cards) */
$fan?: boolean;

/** Fan angle in degrees (default 30) */
$fanAngle?: number;

/** Alignment of children */
$align?: 'start' | 'center' | 'end' | 'stretch';
```

### 1.2 Update Hand Class with Default Layout

**File:** `packages/engine/src/element/hand.ts`

```typescript
// Hand should default to horizontal fan layout
this.$direction = 'horizontal';
this.$fan = true;
this.$fanAngle = 15;
this.$overlap = 0.5;
```

### 1.3 Update Deck Class with Default Layout

**File:** `packages/engine/src/element/deck.ts`

```typescript
// Deck should default to stacked layout
this.$direction = 'vertical';
this.$overlap = 0.95; // Heavy overlap for deck appearance
```

### 1.4 Update AutoElement to Use Layout Properties

**File:** `packages/ui/src/components/auto-ui/AutoElement.vue`

Read `$direction`, `$gap`, `$overlap`, `$fan`, `$fanAngle`, `$align` from element attributes and apply as CSS styles/classes.

## Phase 2: Hex Grid Support

### 2.1 Create HexGrid Engine Class

**File:** `packages/engine/src/element/hex-grid.ts` (new)

```typescript
export class HexGrid<G extends Game = any, P extends Player = any> extends Space<G, P> {
  readonly $layout: ElementLayout = 'hex-grid';

  /** Hex orientation: flat-top or pointy-top */
  $hexOrientation?: 'flat' | 'pointy';

  /** Coordinate system: offset, axial, or cube */
  $coordSystem?: 'offset' | 'axial' | 'cube';
}

export class HexCell<G extends Game = any, P extends Player = any> extends Space<G, P> {
  // Hex cells have q, r coordinates (axial) or x, y, z (cube)
}
```

### 2.2 Add Hex Grid Rendering to AutoElement

**File:** `packages/ui/src/components/auto-ui/AutoElement.vue`

Add case for `$layout === 'hex-grid'` that:
- Calculates hex positions using axial coordinates
- Supports both flat-top and pointy-top orientations
- Renders hexagonal cells with proper spacing

## Phase 3: Drag-and-Drop Integration

### 3.1 Update AutoElement for Draggable Elements

**File:** `packages/ui/src/components/auto-ui/AutoElement.vue`

- Detect when element is part of a move action selection
- Wrap draggable elements with Draggable component
- Handle drop targets for destination selection

### 3.2 Add Drag State to Board Interaction

**File:** `packages/ui/src/composables/useBoardInteraction.ts`

```typescript
// Add to BoardInteractionState
draggedElement: ElementRef | null;
dropTargets: ValidElement[];

// Add to BoardInteractionActions
startDrag: (element: ElementRef) => void;
endDrag: () => void;
setDropTargets: (elements: ValidElement[]) => void;
```

### 3.3 Update ActionPanel for Drag-Drop Actions

**File:** `packages/ui/src/components/auto-ui/ActionPanel.vue`

- Detect two-step "piece + destination" actions
- Enable drag mode when piece is selected
- Complete action when dropped on valid target

## Phase 4: Component Override Registry (Future)

This is lower priority - games can currently customize via CSS and slots.

### 4.1 Create Renderer Registry

**File:** `packages/ui/src/composables/useRendererRegistry.ts` (new)

```typescript
export function createRendererRegistry() {
  const renderers = new Map<string, Component>();

  return {
    register(elementType: string, component: Component) {
      renderers.set(elementType, component);
    },
    getRenderer(elementType: string): Component | null {
      return renderers.get(elementType) ?? null;
    }
  };
}
```

### 4.2 Update AutoElement to Check Registry

Check registry before using default rendering. If custom renderer exists, use it instead.

---

## Implementation Status

### Phase 1: Declarative Layout Configuration ✅ COMPLETE
- Added `$direction`, `$gap`, `$overlap`, `$fan`, `$fanAngle`, `$align` to Space class
- Hand class sets default fan layout (`$fan: true`, `$fanAngle: 30`, `$overlap: 0.5`)
- Deck class sets default stack layout (`$direction: 'vertical'`, `$overlap: 0.95`)
- AutoElement uses CSS variables for layout: `--layout-direction`, `--layout-gap`, `--layout-overlap`, `--layout-fan-angle`, `--layout-align`
- Added `.has-fan` and `.has-overlap` CSS classes with card rotation and negative margins

### Phase 2: Hex Grid Support ✅ COMPLETE
- Created `HexGrid` class with `$hexOrientation`, `$coordSystem`, `$qCoord`, `$rCoord`, `$hexSize`
- Created `HexCell` class with `$type: 'hex-cell'`
- Exported from `packages/engine/src/index.ts`
- AutoElement detects `$layout === 'hex-grid'` and renders SVG hex grid
- Supports both pointy-top and flat-top orientations
- Axial coordinate system with pixel conversion
- Hex polygons with hover, highlight, and selection states

### Phase 3: Drag-and-Drop Integration ✅ COMPLETE
- Added drag state to `useBoardInteraction`: `draggedElement`, `dropTargets`, `isDragging`
- Added drag actions: `startDrag`, `endDrag`, `setDropTargets`, `isDropTarget`, `isDraggedElement`, `triggerDrop`
- AutoElement pieces and cards are draggable when `isActionSelectable`
- Grid cells support drop with `@dragover` and `@drop` handlers
- CSS styles for `.is-draggable`, `.is-dragging`, `.is-drop-target`

### Phase 4: Component Override Registry ⏳ DEFERRED
- Lower priority - games can customize via CSS and slots

## Files Modified

| File | Changes |
|------|---------|
| `packages/engine/src/element/space.ts` | ✅ Added layout properties + types |
| `packages/engine/src/element/hand.ts` | ✅ Set default fan layout |
| `packages/engine/src/element/deck.ts` | ✅ Set default stack layout |
| `packages/engine/src/element/hex-grid.ts` | ✅ New file (HexGrid, HexCell) |
| `packages/engine/src/element/index.ts` | ✅ Export HexGrid, HexCell, types |
| `packages/engine/src/index.ts` | ✅ Export HexGrid, HexCell, types |
| `packages/ui/src/components/auto-ui/AutoElement.vue` | ✅ Layout CSS vars, hex rendering, drag handlers |
| `packages/ui/src/composables/useBoardInteraction.ts` | ✅ Drag state and actions |

## Testing

- Test layout properties with Go Fish (hand fan, deck stack)
- Test hex grid with a simple hex-based game
- Test drag-drop with Checkers (piece movement)
