<script setup lang="ts">
/**
 * AutoRenderer — Host component for the auto-UI renderer system.
 *
 * Single source of truth for auto-UI rendering (D-01 — no dual path).
 * Responsibilities:
 *   1. Side-effect import of builtin-renderers.ts (registers all 8 built-ins once)
 *   2. Provide the full context chain expected by per-element renderers
 *   3. Select the archetype via selectArchetype() and dispatch to the matching template
 *   4. Wire FlyingCardsOverlay for flying-element animations
 *   5. Wire useAutoRendererAnimations (added in Task 2)
 *
 * Interaction props (selectableElements, selectedElements) are removed here — they
 * are supplied by useBoardInteraction() which per-element renderers access via
 * tryUseBoardInteraction(). No dual path for interaction state.
 */

// Side-effect import: registers all 8 built-in renderers at module load (Pitfall 5 guard).
// MUST be imported before any component that uses resolveRenderer().
import './builtin-renderers.js';

import { computed, provide, ref } from 'vue';
import { useFlyingElements } from '../../composables/useFlyingElements.js';
import FlyingCardsOverlay from '../helpers/FlyingCardsOverlay.vue';
import { DIE_ANIMATION_CONTEXT_KEY, createDieAnimationContext } from '../dice/die3d-state.js';
import { useAnimationEvents } from '../../composables/useAnimationEvents.js';
import { selectArchetype } from './archetype-selector.js';
import { useAutoRendererAnimations } from './useAutoRendererAnimations.js';
import GridBoardTemplate from './archetypes/GridBoardTemplate.vue';
import CardTemplate from './archetypes/CardTemplate.vue';
import TableauTemplate from './archetypes/TableauTemplate.vue';
import UnsupportedTopologyPanel from './archetypes/UnsupportedTopologyPanel.vue';

// ---------------------------------------------------------------------------
// Local GameElement interface — mirrors auto-ui-helpers.ts lines 12-19
// ---------------------------------------------------------------------------
export interface GameElement {
  id: number;
  name?: string;
  className: string;
  attributes?: Record<string, unknown>;
  children?: GameElement[];
  childCount?: number;
  __hidden?: boolean;
}

// ---------------------------------------------------------------------------
// Type for image info (used by findDefaultBackImage and per-element renderers)
// ---------------------------------------------------------------------------
type ImageInfo =
  | { type: 'url'; src: string }
  | { type: 'sprite'; sprite: string; x: number; y: number; width: number; height: number };

// ---------------------------------------------------------------------------
// Props — interaction arrays removed (useBoardInteraction provides those)
// ---------------------------------------------------------------------------
const props = defineProps<{
  /** The game view tree from the server */
  gameView: GameElement | null | undefined;
  /** Current player's seat */
  playerSeat: number;
}>();

// ---------------------------------------------------------------------------
// Die animation context — create once per UI tree, provide to all dice below
// ---------------------------------------------------------------------------
const dieAnimationContext = createDieAnimationContext();
provide(DIE_ANIMATION_CONTEXT_KEY, dieAnimationContext);

// ---------------------------------------------------------------------------
// Provide context chain — consumed by all per-element renderers
// selectableElements/selectedElements provided as empty refs since new renderers
// use tryUseBoardInteraction() directly; provided for any legacy inject consumers.
// ---------------------------------------------------------------------------
provide('playerSeat', props.playerSeat);
provide('selectableElements', ref(new Set<number>()));
provide('selectedElements', ref(new Set<number>()));

// ---------------------------------------------------------------------------
// findDefaultBackImage — scans element tree for the first card back image
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Top-level children for archetype dispatch
// ---------------------------------------------------------------------------
const topLevelChildren = computed(() => {
  if (!props.gameView) return [];
  return props.gameView.children ?? [];
});

// ---------------------------------------------------------------------------
// Archetype selection
// ---------------------------------------------------------------------------
const archetype = computed(() => selectArchetype(topLevelChildren.value));

// ---------------------------------------------------------------------------
// Flying elements — for FlyingCardsOverlay; fly API passed to animation wiring
// ---------------------------------------------------------------------------
const { flyingElements, fly } = useFlyingElements();

// ---------------------------------------------------------------------------
// Animation event wiring (RENDER-05) — inject-only, never createAnimationEvents
// If GameShell hasn't provided animation events, returns silently (no throw).
// ---------------------------------------------------------------------------
const animationEvents = useAnimationEvents();
useAutoRendererAnimations(animationEvents, { fly });
</script>

<template>
  <div class="auto-renderer">
    <FlyingCardsOverlay :flying-cards="flyingElements" />

    <GridBoardTemplate
      v-if="archetype === 'grid-board'"
      :top-level-children="topLevelChildren"
      :game-view="gameView"
    />
    <CardTemplate
      v-else-if="archetype === 'card'"
      :top-level-children="topLevelChildren"
    />
    <UnsupportedTopologyPanel
      v-else-if="archetype === 'unsupported'"
    />
    <TableauTemplate
      v-else
      :top-level-children="topLevelChildren"
    />
  </div>
</template>

<style scoped>
.auto-renderer {
  position: relative;
  height: 100%;
  overflow: hidden;
}
</style>
