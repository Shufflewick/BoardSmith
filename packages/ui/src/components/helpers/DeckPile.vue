<script setup lang="ts">
import { ref, computed } from 'vue';

interface DeckPileProps {
  /** Number of cards in deck */
  count: number;
  /** Maximum visible stack depth */
  maxVisible?: number;
  /** Card width in pixels */
  cardWidth?: number;
  /** Card height in pixels */
  cardHeight?: number;
  /** Offset between stacked cards in pixels */
  stackOffset?: number;
  /** Whether the deck can be clicked to draw */
  clickable?: boolean;
  /** Show card count badge */
  showCount?: boolean;
}

const props = withDefaults(defineProps<DeckPileProps>(), {
  maxVisible: 5,
  cardWidth: 80,
  cardHeight: 120,
  stackOffset: 2,
  clickable: true,
  showCount: true,
});

const emit = defineEmits<{
  draw: [];
  shuffle: [];
}>();

const isShuffling = ref(false);

const visibleCards = computed(() => {
  return Math.min(props.count, props.maxVisible);
});

const stackHeight = computed(() => {
  return props.cardHeight + (visibleCards.value - 1) * props.stackOffset;
});

function draw() {
  if (props.clickable && props.count > 0 && !isShuffling.value) {
    emit('draw');
  }
}

function shuffle() {
  if (props.count > 1 && !isShuffling.value) {
    isShuffling.value = true;
    emit('shuffle');

    // Animation duration
    setTimeout(() => {
      isShuffling.value = false;
    }, 600);
  }
}

defineExpose({ shuffle });
</script>

<template>
  <div
    class="bs-deck-pile"
    :class="{
      'bs-deck-pile--clickable': clickable && count > 0,
      'bs-deck-pile--empty': count === 0,
      'bs-deck-pile--shuffling': isShuffling
    }"
    :style="{
      width: `${cardWidth}px`,
      height: `${stackHeight}px`
    }"
    @click="draw"
  >
    <!-- Stacked cards -->
    <div
      v-for="i in visibleCards"
      :key="i"
      class="bs-deck-pile__card"
      :class="{ 'bs-deck-pile__card--shuffling': isShuffling }"
      :style="{
        width: `${cardWidth}px`,
        height: `${cardHeight}px`,
        bottom: `${(i - 1) * stackOffset}px`,
        zIndex: i,
        animationDelay: isShuffling ? `${(i - 1) * 50}ms` : '0ms'
      }"
    >
      <slot name="card-back">
        <div class="bs-deck-pile__card-back">
          <div class="bs-deck-pile__card-pattern"></div>
        </div>
      </slot>
    </div>

    <!-- Empty state -->
    <div v-if="count === 0" class="bs-deck-pile__empty">
      <slot name="empty">
        <span>Empty</span>
      </slot>
    </div>

    <!-- Count badge -->
    <div v-if="showCount && count > 0" class="bs-deck-pile__count">
      {{ count }}
    </div>
  </div>
</template>

<style scoped>
.bs-deck-pile {
  position: relative;
  transition: transform 0.2s ease;
}

.bs-deck-pile--clickable {
  cursor: pointer;
}

.bs-deck-pile--clickable:hover {
  transform: translateY(-4px);
}

.bs-deck-pile--empty {
  cursor: default;
}

.bs-deck-pile__card {
  position: absolute;
  left: 0;
  border-radius: 8px;
  box-shadow: 1px 1px 3px rgba(0, 0, 0, 0.2);
  transition: transform 0.15s ease;
}

.bs-deck-pile__card--shuffling {
  animation: shuffle-card 0.6s ease;
}

@keyframes shuffle-card {
  0% { transform: translateX(0) rotate(0deg); }
  25% { transform: translateX(20px) rotate(5deg); }
  50% { transform: translateX(-15px) rotate(-3deg); }
  75% { transform: translateX(10px) rotate(2deg); }
  100% { transform: translateX(0) rotate(0deg); }
}

.bs-deck-pile--shuffling .bs-deck-pile__card:nth-child(odd) {
  animation-direction: reverse;
}

.bs-deck-pile__card-back {
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, #1a1a2e, #2d2d4a);
  border: 2px solid #333;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

.bs-deck-pile__card-pattern {
  width: 60%;
  height: 70%;
  background: repeating-linear-gradient(
    45deg,
    #3a3a5a,
    #3a3a5a 2px,
    transparent 2px,
    transparent 8px
  );
  border-radius: 4px;
  opacity: 0.5;
}

.bs-deck-pile__empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f0f0f0;
  border: 2px dashed #ccc;
  border-radius: 8px;
  color: #999;
  font-size: 14px;
}

.bs-deck-pile__count {
  position: absolute;
  bottom: -8px;
  right: -8px;
  min-width: 24px;
  height: 24px;
  padding: 0 6px;
  background: #4a90d9;
  color: white;
  font-size: 12px;
  font-weight: 600;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  z-index: 100;
}
</style>
