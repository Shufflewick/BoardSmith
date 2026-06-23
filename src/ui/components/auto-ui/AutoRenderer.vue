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

import { computed, onMounted, onUnmounted, provide, ref, watch } from 'vue';
import type { PresentationOverlay } from './presentation.js';
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
  /** Per-UI presentation overlay for visual metadata (D-04) */
  presentation?: PresentationOverlay;
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
// Presentation overlay — provided as computed so injectors re-render when prop changes (D-04)
provide('presentation', computed(() => props.presentation));

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
// Loading skeleton state — shown while gameView is null
// ---------------------------------------------------------------------------
const LOAD_TIMEOUT_MS = 8000;
const loadTimedOut = ref(false);
let loadTimer: ReturnType<typeof setTimeout> | null = null;

const emit = defineEmits<{
  retry: [];
}>();

function armLoadTimer() {
  if (loadTimer !== null) clearTimeout(loadTimer);
  loadTimer = setTimeout(() => {
    loadTimedOut.value = true;
  }, LOAD_TIMEOUT_MS);
}

function handleRetry() {
  loadTimedOut.value = false;
  armLoadTimer();
  emit('retry');
}

onMounted(() => {
  if (!props.gameView) armLoadTimer();
});

onUnmounted(() => {
  if (loadTimer !== null) {
    clearTimeout(loadTimer);
    loadTimer = null;
  }
});

watch(
  () => props.gameView,
  (newView) => {
    if (newView) {
      // Game state arrived — cancel the timer
      if (loadTimer !== null) {
        clearTimeout(loadTimer);
        loadTimer = null;
      }
      loadTimedOut.value = false;
    } else {
      // Back to null (reconnect scenario) — re-arm
      armLoadTimer();
    }
  },
);

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

    <!-- CF-3: null gameView loading state — animated skeleton + timeout retry -->
    <div v-if="!gameView" class="auto-renderer-empty">
      <div class="auto-renderer-skeleton" aria-busy="true" aria-label="Loading game…">
        <span class="sr-only">Loading game…</span>
        <div class="skeleton-bar skeleton-bar--wide" aria-hidden="true"></div>
        <div class="skeleton-bar skeleton-bar--medium" aria-hidden="true"></div>
        <div class="skeleton-bar skeleton-bar--narrow" aria-hidden="true"></div>
        <div class="skeleton-bar skeleton-bar--wide" aria-hidden="true"></div>
      </div>
      <div v-if="loadTimedOut" class="auto-renderer-retry">
        <p class="auto-renderer-retry__message">Still waiting for the game host&hellip;</p>
        <button class="auto-renderer-retry__btn" type="button" @click="handleRetry">Retry</button>
      </div>
    </div>

    <GridBoardTemplate
      v-else-if="archetype === 'grid-board'"
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
      v-else-if="gameView"
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

/* CF-3: null gameView loading state — skeleton + retry */
.auto-renderer-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
  height: 100%;
  padding: 32px;
}

/* Skeleton container */
.auto-renderer-skeleton {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 400px;
}

/* Placeholder bars */
.skeleton-bar {
  height: 16px;
  border-radius: var(--bsg-r-sm);
  background: var(--bsg-field);
  animation: skeleton-pulse var(--bsg-dur-base, 1s) ease-in-out infinite;
}

.skeleton-bar--wide  { width: 100%; }
.skeleton-bar--medium { width: 72%; }
.skeleton-bar--narrow { width: 48%; }

@keyframes skeleton-pulse {
  0%,
  100% { opacity: 1; }
  50%  { opacity: 0.4; }
}

@media (prefers-reduced-motion: reduce) {
  .skeleton-bar {
    animation: none;
  }
}

/* Screen-reader only helper (no raw hex — uses inherit) */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* Retry affordance */
.auto-renderer-retry {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.auto-renderer-retry__message {
  color: var(--bsg-ink-3);
  font-size: 14px;
  margin: 0;
}

.auto-renderer-retry__btn {
  padding: 8px 20px;
  border-radius: var(--bsg-r-sm);
  border: 1px solid var(--bsg-line);
  background: var(--bsg-surface);
  color: var(--bsg-ink);
  font-size: 14px;
  cursor: pointer;
}

.auto-renderer-retry__btn:hover {
  background: var(--bsg-field);
}
</style>
