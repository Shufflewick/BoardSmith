<script setup lang="ts">
/**
 * AutoGameBoard - Automatically renders a game element tree
 *
 * This component recursively renders the game state tree, using
 * default renderers for different element types (Space, Piece, Card, etc.)
 *
 * Features:
 * - Automatic FLIP animations for element movements
 * - Smart fly vs move animation based on visibility changes:
 *   - Public → Private: fly animation (card flips face-down as it travels)
 *   - Private → Private or Public → Public: regular move animation
 * - Respects prefers-reduced-motion accessibility setting
 *
 * Usage:
 * <AutoGameBoard
 *   :game-view="gameView"
 *   :player-seat="playerSeat"
 *   :selectable-elements="selectableIds"
 *   @element-click="handleElementClick"
 * />
 */
import { computed, provide, ref, watch, nextTick } from 'vue';
import AutoElement from './AutoElement.vue';
import { prefersReducedMotion } from '../../composables/useElementAnimation.js';
import { useFlyingElements } from '../../composables/useFlyingElements.js';
import FlyingCardsOverlay from '../helpers/FlyingCardsOverlay.vue';
import { DIE_ANIMATION_CONTEXT_KEY, createDieAnimationContext } from '../dice/die3d-state.js';

// Create and provide animation context for dice in this UI tree
// This ensures dice animate independently from dice in other UIs (like custom game UIs)
const dieAnimationContext = createDieAnimationContext();
provide(DIE_ANIMATION_CONTEXT_KEY, dieAnimationContext);

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
  /** The game view tree from the server */
  gameView: GameElement | null | undefined;
  /** Current player's seat */
  playerSeat: number;
  /** IDs of elements that can be selected (for action targeting) */
  selectableElements?: Set<number>;
  /** Currently selected element IDs */
  selectedElements?: Set<number>;
  /** Layout mode for top-level children */
  layout?: 'auto' | 'horizontal' | 'vertical' | 'grid';
}>();

const emit = defineEmits<{
  (e: 'elementClick', element: GameElement): void;
}>();

// Provide context to child elements
provide('playerSeat', props.playerSeat);
provide('selectableElements', computed(() => props.selectableElements ?? new Set()));
provide('selectedElements', computed(() => props.selectedElements ?? new Set()));

// Type for parsed image info (matches AutoElement's ImageInfo type)
type ImageInfo =
  | { type: 'url'; src: string }
  | { type: 'sprite'; sprite: string; x: number; y: number; width: number; height: number };

// Find default back image from any card in the game view
// Returns full ImageInfo object including sprite coordinates for proper rendering
function findDefaultBackImage(element: GameElement | null | undefined): ImageInfo | null {
  if (!element) return null;

  // Check this element's $images
  const images = element.attributes?.$images as { back?: string | { sprite: string; x?: number; y?: number; width?: number; height?: number } } | undefined;
  if (images?.back) {
    if (typeof images.back === 'string') {
      return { type: 'url', src: images.back };
    }
    // For coordinate-based sprites, return the FULL sprite object with coordinates
    if (typeof images.back === 'object' && images.back.sprite && typeof images.back.x === 'number' && typeof images.back.y === 'number') {
      return {
        type: 'sprite',
        sprite: images.back.sprite,
        x: images.back.x,
        y: images.back.y,
        width: images.back.width ?? 238,
        height: images.back.height ?? 333,
      };
    }
  }

  // Recursively check children
  if (element.children) {
    for (const child of element.children) {
      const found = findDefaultBackImage(child);
      if (found) return found;
    }
  }

  return null;
}

const defaultBackImage = computed(() => findDefaultBackImage(props.gameView));
provide('defaultBackImage', defaultBackImage);

// Get top-level children (excluding the root game element itself)
const topLevelChildren = computed(() => {
  if (!props.gameView) return [];
  return props.gameView.children ?? [];
});

// Determine layout class based on children types
const layoutClass = computed(() => {
  if (props.layout && props.layout !== 'auto') {
    return `layout-${props.layout}`;
  }

  // Auto-detect layout based on content
  const children = topLevelChildren.value;
  if (children.length === 0) return 'layout-empty';

  // If we have a mix of hands and boards, use vertical
  const hasHand = children.some(c => c.className === 'Hand');
  const hasBoard = children.some(c => c.className === 'Board' || c.attributes?.row !== undefined);

  if (hasBoard) return 'layout-vertical';
  if (hasHand) return 'layout-horizontal';

  return 'layout-auto';
});

function handleElementClick(element: GameElement) {
  emit('elementClick', element);
}

// ============================================
// Flying Cards Animation System
// ============================================
const { flyingElements: flyingCards, fly } = useFlyingElements();

// ============================================
// FLIP Animation System with Smart Fly Detection
// ============================================

const containerRef = ref<HTMLElement | null>(null);
const elementPositions = new Map<number, DOMRect>();
// Track visibility state: true = public (visible), false = private (hidden)
const elementVisibility = new Map<number, boolean>();
// Track parent container NAME for each element (more stable than ID)
const elementParentName = new Map<number, string>();
// Track card data for flying animations
const elementCardData = new Map<number, { rank?: string; suit?: string; faceImage?: string; backImage?: string }>();
// Track childCount for zones (to detect where cards went when hidden)
const zoneChildCount = new Map<string, number>();

// Recursively collect visibility, parent info, and card data from game element tree
function collectElementState(
  element: GameElement,
  parentName: string | null,
  stateMap: Map<number, boolean>,
  parentNameMap: Map<number, string>,
  cardDataMap: Map<number, { rank?: string; suit?: string; faceImage?: unknown; backImage?: unknown }>,
  childCountMap: Map<string, number>
) {
  // Check if this is a card
  const isCard = element.attributes?.$type === 'card';
  // Element is "public" if it's not hidden
  const isPublic = !element.__hidden && !element.attributes?.__hidden;

  stateMap.set(element.id, isPublic);
  if (parentName !== null) {
    parentNameMap.set(element.id, parentName);
  }

  // Track childCount for zones (decks, hands, spaces with hidden contents)
  if (element.name && element.childCount !== undefined) {
    childCountMap.set(element.name, element.childCount);
  }

  // Extract card data from element name (e.g., "5H" → { rank: '5', suit: 'H' }) and images
  if (isCard && element.name) {
    const match = element.name.match(/^(\d+|[AJQK])([CDHS]?)$/i);
    if (match) {
      // Get images from $images attribute - pass through as-is for flying cards
      // The flying cards overlay handles both string URLs and sprite objects
      const images = element.attributes?.$images as { face?: unknown; back?: unknown } | undefined;

      cardDataMap.set(element.id, {
        rank: match[1].toUpperCase(),
        suit: (match[2] || '').toUpperCase(),
        faceImage: images?.face,
        backImage: images?.back,
      });
    }
  }

  // Process children - use current element's name as parent for children
  if (element.children) {
    for (const child of element.children) {
      collectElementState(child, element.name ?? null, stateMap, parentNameMap, cardDataMap, childCountMap);
    }
  }
}

// Capture positions of all animatable elements AND container elements
function capturePositions() {
  elementPositions.clear();
  if (!containerRef.value) return;

  // Capture animatable elements (cards, pieces)
  const animatableElements = containerRef.value.querySelectorAll('[data-animatable="true"]');
  animatableElements.forEach((el) => {
    const id = parseInt(el.getAttribute('data-element-id') || '0', 10);
    if (id) {
      elementPositions.set(id, el.getBoundingClientRect());
    }
  });
}

// Capture visibility state from game view
function captureVisibilityState(gameView: GameElement | null | undefined) {
  elementVisibility.clear();
  elementParentName.clear();
  elementCardData.clear();
  zoneChildCount.clear();
  if (!gameView) return;
  collectElementState(gameView, null, elementVisibility, elementParentName, elementCardData, zoneChildCount);
}

// Find a container element in the DOM by zone name
// Prefers inner stack elements (deck-stack, hand-cards) over outer containers
function findContainerByName(zoneName: string): HTMLElement | null {
  if (!containerRef.value) return null;

  // First, try to find a deck-stack or hand-cards element (the actual stack, not container)
  const stackElement = containerRef.value.querySelector(
    `.deck-stack[data-zone="${zoneName}"], .hand-cards[data-zone="${zoneName}"], .deck-cards[data-zone="${zoneName}"]`
  );
  if (stackElement) return stackElement as HTMLElement;

  // Fall back to any element with data-zone attribute
  const element = containerRef.value.querySelector(`[data-zone="${zoneName}"]`);
  if (element) return element as HTMLElement;

  return null;
}

// Animate elements from old positions to new positions
// Elements that went from public→private use fly animation to their new parent container
async function animateMovements(
  oldVisibility: Map<number, boolean>,
  oldParentName: Map<number, string>,
  oldCardData: Map<number, { rank?: string; suit?: string }>,
  oldZoneChildCount: Map<string, number>
) {
  if (prefersReducedMotion.value) return;
  if (!containerRef.value) return;

  const flyPromises: Promise<void>[] = [];
  const animatedIds = new Set<number>();

  // Find zones that gained children (childCount increased) - these are destinations for hidden cards
  const zonesGainedChildren: string[] = [];
  // Find zones that lost children (childCount decreased) - these are sources for appearing cards
  const zonesLostChildren: string[] = [];
  for (const [zoneName, newCount] of zoneChildCount) {
    const oldCount = oldZoneChildCount.get(zoneName) ?? 0;
    if (newCount > oldCount) {
      zonesGainedChildren.push(zoneName);
    } else if (newCount < oldCount) {
      zonesLostChildren.push(zoneName);
    }
  }
  // Also check old zones that might have disappeared
  for (const [zoneName, oldCount] of oldZoneChildCount) {
    if (!zoneChildCount.has(zoneName) && oldCount > 0) {
      zonesLostChildren.push(zoneName);
    }
  }

  // First, check for cards that were visible but are now hidden (moved to hidden zone)
  // These need fly animations to their new parent container
  for (const [id, wasPublic] of oldVisibility) {
    if (!wasPublic) continue; // Skip cards that were already hidden

    const isStillInTree = elementVisibility.has(id);
    const isPublic = elementVisibility.get(id) ?? false;
    const oldRect = elementPositions.get(id);
    const cardData = oldCardData.get(id);

    // Card went from public to private (or disappeared from tree entirely)?
    const becameHidden = !isPublic || !isStillInTree;

    if (becameHidden && oldRect && cardData) {
      // Try to find destination: first check if card is still in tree with new parent
      let targetZoneName = elementParentName.get(id);

      // If card disappeared from tree, find a zone that gained children
      if (!isStillInTree && zonesGainedChildren.length > 0) {
        // Use the first zone that gained children as destination
        targetZoneName = zonesGainedChildren[0];
      }

      if (targetZoneName) {
        // Find the target container element by zone name
        const targetElement = findContainerByName(targetZoneName);

        if (targetElement) {
          animatedIds.add(id);
          flyPromises.push(
            fly({
              id: `fly-${id}-${Date.now()}`,
              startRect: oldRect,
              // Track the target container in real-time
              endRect: () => targetElement.getBoundingClientRect(),
              elementData: { ...cardData, faceUp: true },
              flip: true,
              duration: 400,
            })
          );
        }
      }
    }
  }

  // Check for cards that APPEARED (weren't visible before, now are) - these came from hidden zones
  // Only fly these if they came from a zone that lost children
  if (zonesLostChildren.length > 0) {
    // Find cards that are now visible but weren't before
    for (const [id, isPublic] of elementVisibility) {
      if (!isPublic) continue; // Skip hidden cards
      if (oldVisibility.has(id)) continue; // Skip cards that were already in tree

      const cardData = elementCardData.get(id);
      if (!cardData) continue;

      // Find the source zone (one that lost children)
      const sourceZoneName = zonesLostChildren[0];
      const sourceElement = findContainerByName(sourceZoneName);

      if (sourceElement) {
        // Find the card's new DOM element
        const cardElement = containerRef.value?.querySelector(`[data-element-id="${id}"]`);
        if (cardElement) {
          const sourceRect = sourceElement.getBoundingClientRect();
          // Get the actual card dimensions from the target element
          const targetRect = cardElement.getBoundingClientRect();
          animatedIds.add(id);
          flyPromises.push(
            fly({
              id: `fly-appear-${id}-${Date.now()}`,
              startRect: sourceRect,
              endRect: () => cardElement.getBoundingClientRect(),
              elementData: { ...cardData, faceUp: false }, // Start face down
              flip: true, // Flip to face up
              duration: 400,
              // Use target card dimensions, not source (deck) dimensions
              elementSize: { width: targetRect.width, height: targetRect.height },
            })
          );
        }
      }
    }
  }

  // Now handle regular FLIP animations for elements that are still visible
  const animatableElements = containerRef.value.querySelectorAll('[data-animatable="true"]');

  animatableElements.forEach((el) => {
    const id = parseInt(el.getAttribute('data-element-id') || '0', 10);

    // Skip if we already handled this with a fly animation
    if (animatedIds.has(id)) return;

    const oldRect = elementPositions.get(id);
    if (!oldRect) return;

    const newRect = el.getBoundingClientRect();
    const deltaX = oldRect.left - newRect.left;
    const deltaY = oldRect.top - newRect.top;

    // Only animate if actually moved (threshold of 1px)
    if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;

    // Regular move animation
    (el as HTMLElement).animate([
      { transform: `translate(${deltaX}px, ${deltaY}px)` },
      { transform: 'translate(0, 0)' }
    ], {
      duration: 300,
      easing: 'ease-out',
      fill: 'backwards'
    });
  });

  elementPositions.clear();

  // Wait for all fly animations to complete
  if (flyPromises.length > 0) {
    await Promise.all(flyPromises);
  }
}

// Watch for gameView changes and animate
watch(
  () => props.gameView,
  async (newView, oldView) => {
    // Skip if no previous view (initial load)
    if (!oldView) {
      // Initialize visibility state for first view
      captureVisibilityState(newView);
      return;
    }

    // Capture positions before Vue updates DOM
    capturePositions();

    // Save old state before updating
    const oldVisibility = new Map(elementVisibility);
    const oldParentName = new Map(elementParentName);
    const oldCardData = new Map(elementCardData);
    const oldZoneChildCount = new Map(zoneChildCount);

    // Wait for DOM to update
    await nextTick();

    // Capture new visibility state from updated view
    captureVisibilityState(newView);

    // Animate with smart fly detection
    await animateMovements(oldVisibility, oldParentName, oldCardData, oldZoneChildCount);
  },
  { deep: false } // Only watch reference changes, not deep mutations
);
</script>

<template>
  <div ref="containerRef" class="auto-game-board" :class="layoutClass">
    <div v-if="!gameView" class="loading">
      Loading game...
    </div>

    <div v-else class="game-elements">
      <AutoElement
        v-for="child in topLevelChildren"
        :key="child.id"
        :element="child"
        :depth="0"
        @element-click="handleElementClick"
      />
    </div>

    <!-- Flying cards overlay for public→private transitions -->
    <FlyingCardsOverlay :flying-cards="flyingCards" />
  </div>
</template>

<style scoped>
.auto-game-board {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 300px;
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: #888;
}

.game-elements {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.layout-horizontal .game-elements {
  flex-direction: row;
  flex-wrap: wrap;
}

.layout-grid .game-elements {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

.layout-vertical .game-elements {
  flex-direction: column;
}

.layout-auto .game-elements {
  /* Let children determine their layout */
}
</style>
