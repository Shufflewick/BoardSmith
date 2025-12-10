<script setup lang="ts">
import { computed } from 'vue';

interface CardFanProps {
  /** Array of card data */
  cards: unknown[];
  /** Currently selected card (by index or reference) */
  selected?: unknown;
  /** Maximum fan angle in degrees */
  maxAngle?: number;
  /** Card overlap percentage (0-1) */
  overlap?: number;
  /** Whether selection is disabled */
  disabled?: boolean;
  /** Card width in pixels */
  cardWidth?: number;
  /** Card height in pixels */
  cardHeight?: number;
}

const props = withDefaults(defineProps<CardFanProps>(), {
  maxAngle: 30,
  overlap: 0.6,
  disabled: false,
  cardWidth: 80,
  cardHeight: 120,
});

const emit = defineEmits<{
  select: [card: unknown, index: number];
  hover: [card: unknown | null, index: number | null];
}>();

const cardStyles = computed(() => {
  const count = props.cards.length;
  if (count === 0) return [];

  const angleStep = count > 1
    ? (props.maxAngle * 2) / (count - 1)
    : 0;
  const startAngle = -props.maxAngle;
  const overlapWidth = props.cardWidth * (1 - props.overlap);

  return props.cards.map((card, index) => {
    const angle = count > 1 ? startAngle + (angleStep * index) : 0;
    const isSelected = props.selected !== undefined &&
      (props.selected === card || props.selected === index);

    return {
      transform: `rotate(${angle}deg) translateY(${isSelected ? -20 : 0}px)`,
      transformOrigin: 'bottom center',
      left: `${index * overlapWidth}px`,
      zIndex: isSelected ? count + 1 : index,
      width: `${props.cardWidth}px`,
      height: `${props.cardHeight}px`,
    };
  });
});

const containerWidth = computed(() => {
  const count = props.cards.length;
  if (count === 0) return props.cardWidth;
  const overlapWidth = props.cardWidth * (1 - props.overlap);
  return overlapWidth * (count - 1) + props.cardWidth;
});

function selectCard(card: unknown, index: number) {
  if (!props.disabled) {
    emit('select', card, index);
  }
}

function hoverCard(card: unknown | null, index: number | null) {
  emit('hover', card, index);
}
</script>

<template>
  <div
    class="bs-card-fan"
    :style="{
      width: `${containerWidth}px`,
      height: `${cardHeight + 40}px`
    }"
  >
    <div
      v-for="(card, index) in cards"
      :key="index"
      class="bs-card-fan__card"
      :class="{
        'bs-card-fan__card--selected': selected === card || selected === index,
        'bs-card-fan__card--disabled': disabled
      }"
      :style="cardStyles[index]"
      @click="selectCard(card, index)"
      @mouseenter="hoverCard(card, index)"
      @mouseleave="hoverCard(null, null)"
    >
      <slot :card="card" :index="index">
        <!-- Default card rendering -->
        <div class="bs-card-fan__card-default">
          {{ typeof card === 'object' ? JSON.stringify(card) : card }}
        </div>
      </slot>
    </div>
  </div>
</template>

<style scoped>
.bs-card-fan {
  position: relative;
  display: flex;
  align-items: flex-end;
  padding-top: 20px;
}

.bs-card-fan__card {
  position: absolute;
  bottom: 0;
  cursor: pointer;
  transition: transform 0.2s ease, z-index 0s;
  border-radius: 8px;
  overflow: hidden;
}

.bs-card-fan__card:hover:not(.bs-card-fan__card--disabled) {
  transform: translateY(-30px) scale(1.05) !important;
  z-index: 100 !important;
}

.bs-card-fan__card--selected {
  box-shadow: 0 0 0 3px #4a90d9, 0 8px 16px rgba(0, 0, 0, 0.3);
}

.bs-card-fan__card--disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.bs-card-fan__card-default {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: white;
  border: 2px solid #333;
  border-radius: 8px;
  font-size: 12px;
  padding: 8px;
  box-sizing: border-box;
}
</style>
