<script setup lang="ts">
/**
 * AutoGameBoard - Automatically renders a game element tree
 *
 * This component recursively renders the game state tree, using
 * default renderers for different element types (Space, Piece, Card, etc.)
 *
 * Usage:
 * <AutoGameBoard
 *   :game-view="gameView"
 *   :player-position="playerPosition"
 *   :selectable-elements="selectableIds"
 *   @element-click="handleElementClick"
 * />
 */
import { computed, provide } from 'vue';
import AutoElement from './AutoElement.vue';

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
  /** Current player's position */
  playerPosition: number;
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
provide('playerPosition', props.playerPosition);
provide('selectableElements', computed(() => props.selectableElements ?? new Set()));
provide('selectedElements', computed(() => props.selectedElements ?? new Set()));

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
</script>

<template>
  <div class="auto-game-board" :class="layoutClass">
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
