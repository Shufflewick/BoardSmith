<script setup lang="ts">
import { ref, computed } from 'vue';

interface DiceRollerProps {
  /** Number of dice to roll */
  count?: number;
  /** Number of sides per die */
  sides?: number;
  /** Current values (controlled) */
  values?: number[];
  /** Animation duration in ms */
  animationDuration?: number;
  /** Dice size in pixels */
  size?: number;
}

const props = withDefaults(defineProps<DiceRollerProps>(), {
  count: 1,
  sides: 6,
  animationDuration: 800,
  size: 60,
});

const emit = defineEmits<{
  rolled: [values: number[]];
  rolling: [];
}>();

const isRolling = ref(false);
const displayValues = ref<number[]>(props.values ?? Array(props.count).fill(1));
const animationIntervals = ref<number[]>([]);

// Dice face characters for d6
const diceFaces: Record<number, string> = {
  1: '⚀',
  2: '⚁',
  3: '⚂',
  4: '⚃',
  5: '⚄',
  6: '⚅',
};

const diceDisplay = computed(() => {
  return displayValues.value.map(v => {
    if (props.sides === 6 && diceFaces[v]) {
      return diceFaces[v];
    }
    return String(v);
  });
});

function getRandomValue(): number {
  return Math.floor(Math.random() * props.sides) + 1;
}

function roll() {
  if (isRolling.value) return;

  isRolling.value = true;
  emit('rolling');

  // Clear any existing intervals
  animationIntervals.value.forEach(clearInterval);
  animationIntervals.value = [];

  // Generate final values
  const finalValues: number[] = [];
  for (let i = 0; i < props.count; i++) {
    finalValues.push(getRandomValue());
  }

  // Animate each die
  for (let i = 0; i < props.count; i++) {
    // Rapid value changes during roll
    const interval = setInterval(() => {
      displayValues.value[i] = getRandomValue();
    }, 50);

    animationIntervals.value.push(interval as unknown as number);

    // Stop animation and set final value
    setTimeout(() => {
      clearInterval(interval);
      displayValues.value[i] = finalValues[i];

      // Check if all dice finished
      if (i === props.count - 1) {
        isRolling.value = false;
        emit('rolled', finalValues);
      }
    }, props.animationDuration + (i * 100)); // Stagger the finish
  }
}

// Initialize display values
if (props.values) {
  displayValues.value = [...props.values];
}

defineExpose({ roll });
</script>

<template>
  <div class="bs-dice-roller">
    <div class="bs-dice-container">
      <div
        v-for="(value, index) in diceDisplay"
        :key="index"
        class="bs-die"
        :class="{ 'bs-die--rolling': isRolling }"
        :style="{
          width: `${size}px`,
          height: `${size}px`,
          fontSize: sides === 6 ? `${size * 0.8}px` : `${size * 0.5}px`
        }"
      >
        {{ value }}
      </div>
    </div>
    <button
      class="bs-roll-button"
      :disabled="isRolling"
      @click="roll"
    >
      <slot name="button">
        {{ isRolling ? 'Rolling...' : 'Roll' }}
      </slot>
    </button>
  </div>
</template>

<style scoped>
.bs-dice-roller {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.bs-dice-container {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
}

.bs-die {
  display: flex;
  align-items: center;
  justify-content: center;
  background: white;
  border: 2px solid #333;
  border-radius: 8px;
  font-family: system-ui, sans-serif;
  box-shadow: 2px 2px 4px rgba(0, 0, 0, 0.2);
  transition: transform 0.1s ease;
}

.bs-die--rolling {
  animation: dice-shake 0.1s infinite;
}

@keyframes dice-shake {
  0%, 100% { transform: rotate(-5deg) scale(1.1); }
  25% { transform: rotate(5deg) scale(1.05); }
  50% { transform: rotate(-3deg) scale(1.1); }
  75% { transform: rotate(3deg) scale(1.05); }
}

.bs-roll-button {
  padding: 10px 24px;
  font-size: 16px;
  font-weight: 600;
  background: linear-gradient(135deg, #4a90d9, #357abd);
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.bs-roll-button:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(74, 144, 217, 0.4);
}

.bs-roll-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
