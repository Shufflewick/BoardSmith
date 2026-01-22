<script setup lang="ts">
import { computed } from 'vue';
import {
  INGREDIENT_TRACK_CONFIG,
  DISTILLATION_POINTS,
  DISTILLATION_ROWS,
  DISTILLATION_COMPLETION_BONUS,
  FULMINATE_POINTS,
  FULMINATE_COMPLETION_BONUS,
  POTION_ROWS,
  POISON_SKULLS_FOR_STAR,
  type AbilityType,
} from '@boardsmith/polyhedral-potions-rules';

// Type for ingredient track config
type IngredientTrackConfig = {
  boxes: number;
  abilities: { position: number; type: AbilityType }[];
  starAtEnd: boolean;
};

const props = defineProps<{
  gameView: any;
  playerSeat: number;
  players: any[];
}>();

// Die type colors matching the game
const DIE_COLORS: Record<string, string> = {
  d4: '#4CAF50',   // Green
  d6: '#9C27B0',   // Purple
  d8: '#2196F3',   // Blue
  d10: '#FF9800',  // Orange
  d12: '#E91E63',  // Pink
  d20: '#F44336',  // Red
};

// Ability icons/labels (used in ingredient track boxes)
const ABILITY_LABELS: Record<string, string> = {
  'subtract': '−',
  'flip': '↻',
  'reroll-2': '🎲',
  'draft-again': '↺',
  'refresh': '♻',
  'adjust': '±',
};

const ABILITY_NAMES: Record<string, string> = {
  'subtract': 'Subtract',
  'flip': 'Flip',
  'reroll-2': 'Reroll 2',
  'draft-again': 'Draft Again',
  'refresh': 'Refresh',
  'adjust': '+/- 1 or 2',
};

// Get player data from players prop
const playerData = computed(() => {
  if (!props.players) return null;
  return props.players.find((p: any) => p.seat === props.playerSeat);
});

// Ingredient tracks for the current player
const ingredientTracks = computed(() => {
  const tracks: Record<string, { boxes: { marked: boolean; ability?: string; star?: boolean }[] }> = {};

  for (const [dieType, configVal] of Object.entries(INGREDIENT_TRACK_CONFIG)) {
    const config = configVal as IngredientTrackConfig;
    const boxes = [];
    for (let i = 0; i < config.boxes; i++) {
      const box: { marked: boolean; ability?: string; star?: boolean } = { marked: false };
      const abilityConfig = config.abilities.find((a) => a.position === i);
      if (abilityConfig) {
        box.ability = abilityConfig.type;
      }
      if (i === config.boxes - 1 && config.starAtEnd) {
        box.star = true;
      }
      // Check if marked from player data
      if (playerData.value?.ingredientTracks?.[dieType]?.[i]?.marked) {
        box.marked = true;
      }
      boxes.push(box);
    }
    tracks[dieType] = { boxes };
  }

  return tracks;
});

// Potions crafted
const potionsCrafted = computed(() => {
  return playerData.value?.potionsCrafted || new Array(32).fill(false);
});

// Distillation tracks
const distillations = computed(() => {
  return playerData.value?.distillations || [[], [], [], []];
});

// Fulminate track
const fulminates = computed(() => {
  return playerData.value?.fulminates || [];
});

// Poison skulls
const poisonSkulls = computed(() => {
  return playerData.value?.poisonSkulls || 0;
});

// Stars
const stars = computed(() => {
  return playerData.value?.stars || 0;
});

// Score
const score = computed(() => {
  return playerData.value?.score || 0;
});

// Check if a potion row is complete
function isPotionRowComplete(row: { potions: number[]; stars: number }): boolean {
  return row.potions.every(p => potionsCrafted.value[p - 1]);
}
</script>

<template>
  <div class="score-sheet">
    <!-- Header -->
    <div class="sheet-header">
      <h3>Score Sheet</h3>
      <div class="stars-display">
        <span v-for="i in 3" :key="i" class="star" :class="{ earned: i <= stars }">★</span>
      </div>
    </div>

    <!-- Ingredients Section -->
    <div class="section ingredients-section">
      <h4>Ingredients</h4>
      <div class="ingredient-tracks">
        <div
          v-for="(track, dieType) in ingredientTracks"
          :key="dieType"
          class="ingredient-row"
        >
          <div class="die-label" :style="{ backgroundColor: DIE_COLORS[dieType] }">
            {{ dieType.toUpperCase() }}
          </div>
          <div class="ingredient-boxes">
            <div
              v-for="(box, idx) in track.boxes"
              :key="idx"
              class="ingredient-box"
              :class="{ marked: box.marked, 'has-ability': box.ability, 'has-star': box.star }"
            >
              <span v-if="box.ability && !box.marked" class="ability-icon" :title="ABILITY_NAMES[box.ability]">
                {{ ABILITY_LABELS[box.ability] }}
              </span>
              <span v-else-if="box.star && !box.marked" class="star-icon">★</span>
              <span v-else-if="box.marked" class="check-mark">✓</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Potions Section -->
    <div class="section potions-section">
      <h4>Potions</h4>
      <div class="potions-grid">
        <template v-for="(row, rowIdx) in POTION_ROWS" :key="rowIdx">
          <div class="potion-row">
            <div
              v-for="potion in row.potions"
              :key="potion"
              class="potion-cell"
              :class="{ crafted: potionsCrafted[potion - 1] }"
            >
              {{ potion }}
            </div>
            <div class="row-stars">
              <span v-for="s in row.stars" :key="s" class="star" :class="{ earned: isPotionRowComplete(row) }">★</span>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- Tracks Section -->
    <div class="section tracks-section">
      <!-- Distillations -->
      <div class="distillations">
        <h4>Distillations <span class="track-hint">(↓ decreasing)</span></h4>
        <div class="distillation-columns">
          <div v-for="col in 4" :key="col" class="distillation-column">
            <div class="column-header">
              +{{ DISTILLATION_COMPLETION_BONUS[col - 1] }}
            </div>
            <div
              v-for="row in DISTILLATION_ROWS[col - 1]"
              :key="row"
              class="distillation-cell"
              :class="{ filled: distillations[col - 1]?.length >= row }"
            >
              <span v-if="distillations[col - 1]?.[row - 1]" class="cell-value">
                {{ distillations[col - 1][row - 1].value }}
              </span>
              <span v-else class="cell-points">
                {{ DISTILLATION_POINTS[col - 1][row - 1] >= 0 ? '+' : '' }}{{ DISTILLATION_POINTS[col - 1][row - 1] }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Fulminates -->
      <div class="fulminates">
        <h4>Fulminates <span class="track-hint">(↑ increasing)</span></h4>
        <div class="fulminate-track">
          <div
            v-for="(points, idx) in FULMINATE_POINTS"
            :key="idx"
            class="fulminate-cell"
            :class="{ filled: fulminates.length > idx }"
          >
            <span v-if="fulminates[idx]" class="cell-value">{{ fulminates[idx].value }}</span>
            <span v-else class="cell-points">+{{ points }}</span>
          </div>
          <div class="fulminate-bonus">+{{ FULMINATE_COMPLETION_BONUS }}</div>
        </div>
      </div>
    </div>

    <!-- Poisons Section -->
    <div class="section poisons-section">
      <h4>Poisons</h4>
      <div class="poison-track">
        <div
          v-for="i in POISON_SKULLS_FOR_STAR"
          :key="i"
          class="poison-skull"
          :class="{ filled: poisonSkulls >= i }"
        >
          💀
        </div>
        <div class="poison-star" :class="{ earned: poisonSkulls >= POISON_SKULLS_FOR_STAR }">★</div>
      </div>
      <div class="poison-points">{{ poisonSkulls }} × 2 = {{ poisonSkulls * 2 }} pts</div>
    </div>

    <!-- Score Section -->
    <div class="section score-section">
      <div class="score-display">
        <span class="score-label">SCORE</span>
        <span class="score-value">{{ score }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.score-sheet {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  border-radius: 12px;
  padding: 16px;
  color: #e0e0e0;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  max-height: 100%;
  overflow-y: auto;
}

.sheet-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 2px solid rgba(255, 215, 0, 0.3);
}

.sheet-header h3 {
  margin: 0;
  color: #ffd700;
  font-size: 1.3rem;
}

.stars-display {
  display: flex;
  gap: 4px;
}

.stars-display .star {
  font-size: 1.5rem;
  color: #444;
}

.stars-display .star.earned {
  color: #ffd700;
  text-shadow: 0 0 8px rgba(255, 215, 0, 0.6);
}

.section {
  margin-bottom: 16px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
}

.section h4 {
  margin: 0 0 10px 0;
  color: #00d9ff;
  font-size: 0.95rem;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.track-hint {
  font-size: 0.7rem;
  color: #888;
  text-transform: none;
  letter-spacing: 0;
}

/* Ingredients */
.ingredient-tracks {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ingredient-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.die-label {
  width: 36px;
  padding: 2px 4px;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: bold;
  color: white;
  text-align: center;
  text-shadow: 0 1px 2px rgba(0,0,0,0.5);
}

.ingredient-boxes {
  display: flex;
  gap: 4px;
}

.ingredient-box {
  width: 28px;
  height: 28px;
  border: 2px solid #444;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9rem;
  background: rgba(0, 0, 0, 0.3);
}

.ingredient-box.marked {
  background: rgba(76, 175, 80, 0.3);
  border-color: #4CAF50;
}

.ingredient-box.has-ability {
  border-color: #ff9800;
}

.ingredient-box.has-star {
  border-color: #ffd700;
}

.ability-icon {
  color: #ff9800;
  font-weight: bold;
}

.star-icon {
  color: #ffd700;
}

.check-mark {
  color: #4CAF50;
  font-weight: bold;
}

/* Potions */
.potions-grid {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.potion-row {
  display: flex;
  align-items: center;
  gap: 3px;
}

.potion-cell {
  width: 24px;
  height: 24px;
  border: 1px solid #444;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  background: rgba(0, 0, 0, 0.3);
}

.potion-cell.crafted {
  background: linear-gradient(135deg, #9C27B0 0%, #7B1FA2 100%);
  border-color: #BA68C8;
  color: white;
  font-weight: bold;
}

.row-stars {
  margin-left: 4px;
  display: flex;
  gap: 2px;
}

.row-stars .star {
  font-size: 0.9rem;
  color: #444;
}

.row-stars .star.earned {
  color: #ffd700;
}

/* Distillations */
.distillation-columns {
  display: flex;
  gap: 8px;
  justify-content: center;
}

.distillation-column {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}

.column-header {
  font-size: 0.7rem;
  color: #4CAF50;
  font-weight: bold;
  padding: 2px 6px;
  background: rgba(76, 175, 80, 0.2);
  border-radius: 4px;
}

.distillation-cell {
  width: 36px;
  height: 28px;
  border: 1px solid #444;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  background: rgba(0, 0, 0, 0.3);
}

.distillation-cell.filled {
  background: linear-gradient(135deg, #FF5722 0%, #E64A19 100%);
  border-color: #FF7043;
}

.cell-value {
  color: white;
  font-weight: bold;
  font-size: 0.85rem;
}

.cell-points {
  color: #888;
}

/* Fulminates */
.fulminate-track {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  align-items: center;
}

.fulminate-cell {
  width: 32px;
  height: 28px;
  border: 1px solid #444;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  background: rgba(0, 0, 0, 0.3);
}

.fulminate-cell.filled {
  background: linear-gradient(135deg, #2196F3 0%, #1976D2 100%);
  border-color: #64B5F6;
}

.fulminate-bonus {
  padding: 4px 8px;
  background: rgba(33, 150, 243, 0.3);
  border-radius: 4px;
  font-size: 0.7rem;
  color: #64B5F6;
  font-weight: bold;
}

/* Poisons */
.poison-track {
  display: flex;
  gap: 6px;
  align-items: center;
}

.poison-skull {
  font-size: 1.2rem;
  opacity: 0.3;
}

.poison-skull.filled {
  opacity: 1;
}

.poison-star {
  font-size: 1.2rem;
  color: #444;
  margin-left: 8px;
}

.poison-star.earned {
  color: #ffd700;
}

.poison-points {
  margin-top: 6px;
  font-size: 0.8rem;
  color: #888;
}

/* Score */
.score-section {
  background: linear-gradient(135deg, rgba(255, 215, 0, 0.1) 0%, rgba(255, 152, 0, 0.1) 100%);
  border: 2px solid rgba(255, 215, 0, 0.3);
}

.score-display {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.score-label {
  font-size: 1rem;
  font-weight: bold;
  color: #ffd700;
  letter-spacing: 2px;
}

.score-value {
  font-size: 2rem;
  font-weight: bold;
  color: #ffd700;
  text-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
}
</style>
