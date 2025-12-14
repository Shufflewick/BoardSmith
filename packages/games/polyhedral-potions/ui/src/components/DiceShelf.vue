<script setup lang="ts">
import { computed, inject, ref, watch, nextTick, type Ref } from 'vue';
import { Die3D, useElementAnimation } from '@boardsmith/ui';
import type { BoardInteraction } from '@boardsmith/ui';

// FLIP animation for dice moving from shelf to drafted area
const { capturePositions, animateToCurrentPositions } = useElementAnimation();
const containerRef = ref<HTMLElement | null>(null);

const props = defineProps<{
  gameView: any;
  playerPosition: number;
  isMyTurn: boolean;
  availableActions: string[];
  action: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
  actionArgs: Record<string, any>;
  executeAction: (name: string) => Promise<void>;
  /** Players array for ability counts */
  players?: any[];
  /** Start an action's selection flow in ActionPanel */
  startAction: (name: string) => void;
}>();

// Board interaction for syncing with ActionPanel
const boardInteraction = inject<BoardInteraction>('boardInteraction');

// Die type display info
const DIE_INFO: Record<string, { color: string; label: string }> = {
  d4: { color: '#4CAF50', label: 'D4' },
  d6: { color: '#9C27B0', label: 'D6' },
  d8: { color: '#2196F3', label: 'D8' },
  d10: { color: '#FF9800', label: 'D10' },
  'd10%': { color: '#FF5722', label: 'D%' },
  d12: { color: '#E91E63', label: 'D12' },
  d20: { color: '#F44336', label: 'D20' },
};

// Get the ingredient shelf from gameView
const ingredientShelf = computed(() => {
  if (!props.gameView?.children) return null;
  return props.gameView.children.find(
    (c: any) => c.name === 'ingredient-shelf' || c.attributes?.$type === 'IngredientShelf'
  );
});

// Get all dice on the shelf
const shelfDice = computed(() => {
  if (!ingredientShelf.value?.children) return [];
  return ingredientShelf.value.children.filter(
    (c: any) => c.attributes?.$type === 'IngredientDie' || c.attributes?.sides
  );
});

// Get the current player's draft area
const draftArea = computed(() => {
  if (!props.gameView?.children) return null;
  return props.gameView.children.find(
    (c: any) => c.name === `draft-${props.playerPosition}`
  );
});

// Get drafted dice from the draft area
const draftedDice = computed(() => {
  if (!draftArea.value?.children) return [];
  return draftArea.value.children.filter(
    (c: any) => c.attributes?.$type === 'IngredientDie' || c.attributes?.sides
  );
});

// Check if draft action is available
const canDraft = computed(() => {
  return props.isMyTurn && props.availableActions.includes('draft');
});

// Handle die selection for drafting
function selectDie(dieId: string) {
  if (!canDraft.value) return;
  props.action('draft', { die: dieId });
}

// Check if a die is drafted (no longer on shelf, now in draft area)
function isDieDrafted(dieName: string): boolean {
  return draftedDice.value.some((d: any) => d.name === dieName);
}

// Get die info by name
function getDieInfo(name: string) {
  const key = name.toLowerCase().replace('%', '');
  return DIE_INFO[name] || DIE_INFO[key] || { color: '#888', label: name.toUpperCase() };
}

// Get die preview data for zoom preview
function getDiePreviewData(die: any): string {
  return JSON.stringify({
    sides: die.attributes?.sides ?? 6,
    value: die.attributes?.value ?? 1,
    color: getDieInfo(die.name).color,
  });
}

// Check if any dice are selectable (for showing hint)
const hasSelectableElements = computed(() => {
  if (!boardInteraction) return false;
  return shelfDice.value.some((die: any) =>
    boardInteraction.isSelectableElement({ id: die.id, name: die.name })
  );
});

// Get player data for abilities
const playerData = computed(() => {
  if (!props.players) return null;
  return props.players.find((p: any) => p.position === props.playerPosition);
});

// Check which ability actions are available
const canUseReroll = computed(() => props.isMyTurn && props.availableActions.includes('useReroll'));
const canUseFlip = computed(() => props.isMyTurn && props.availableActions.includes('useFlip'));
const canUseRefresh = computed(() => props.isMyTurn && props.availableActions.includes('useRefresh'));

// Ability display info
const ABILITY_INFO: Record<string, { label: string; icon: string; color: string }> = {
  'subtract': { label: 'Subtract', icon: '−', color: '#9C27B0' },
  'flip': { label: 'Flip', icon: '↻', color: '#9C27B0' },
  'reroll-2': { label: 'Reroll 2', icon: '🎲', color: '#2196F3' },
  'draft-again': { label: 'Draft Again', icon: '↺', color: '#4CAF50' },
  'refresh': { label: 'Refresh', icon: '♻', color: '#FF9800' },
  'adjust': { label: 'Adjust', icon: '±', color: '#FF9800' },
};

// Get all player abilities grouped by type with counts
const playerAbilities = computed(() => {
  if (!playerData.value?.abilities) return [];

  // Group abilities by type
  const grouped: Record<string, { type: string; total: number; unused: number }> = {};

  for (const ability of playerData.value.abilities) {
    if (!grouped[ability.type]) {
      grouped[ability.type] = { type: ability.type, total: 0, unused: 0 };
    }
    grouped[ability.type].total++;
    if (!ability.used) {
      grouped[ability.type].unused++;
    }
  }

  return Object.values(grouped);
});

// Check if an ability can be used right now
function canUseAbility(abilityType: string): boolean {
  if (!props.isMyTurn) return false;

  switch (abilityType) {
    case 'reroll-2':
      return props.availableActions.includes('useReroll');
    case 'flip':
      return props.availableActions.includes('useFlip');
    case 'refresh':
      return props.availableActions.includes('useRefresh');
    default:
      return false;
  }
}

// Use an ability
function useAbility(abilityType: string) {
  switch (abilityType) {
    case 'reroll-2':
      if (canUseReroll.value) props.startAction('useReroll');
      break;
    case 'flip':
      if (canUseFlip.value) props.startAction('useFlip');
      break;
    case 'refresh':
      if (canUseRefresh.value) props.startAction('useRefresh');
      break;
  }
}


// Check if a die is selectable via ActionPanel's current action
function isDieSelectable(dieName: string): boolean {
  if (!boardInteraction) return false;
  const die = shelfDice.value.find((d: any) => d.name === dieName);
  if (!die) return false;
  return boardInteraction.isSelectableElement({ id: die.id, name: dieName });
}

// Check if a die is highlighted (hovered in ActionPanel)
function isDieHighlighted(dieName: string): boolean {
  if (!boardInteraction) return false;
  const die = shelfDice.value.find((d: any) => d.name === dieName);
  if (!die) return false;
  return boardInteraction.isHighlighted({ id: die.id, name: dieName });
}

// Watch for changes in drafted dice and animate
watch(
  () => draftedDice.value.length,
  async (newCount, oldCount) => {
    if (oldCount === undefined || !containerRef.value) return;

    // A die was just drafted (count increased)
    if (newCount > oldCount) {
      // Capture positions before Vue updates DOM
      capturePositions(containerRef.value);

      // Wait for DOM update
      await nextTick();

      // Animate to new positions
      animateToCurrentPositions(containerRef.value);
    }
  }
);

// Handle die click - delegate to board interaction for action selection
function handleDieClick(dieName: string, dieId: number) {
  // If die is selectable for current action in ActionPanel, trigger selection
  if (boardInteraction && isDieSelectable(dieName)) {
    boardInteraction.triggerElementSelect({ id: dieId, name: dieName });
    return;
  }

  // Otherwise, if we can draft and die is not drafted, do normal draft
  if (canDraft.value && !isDieDrafted(dieName)) {
    selectDie(dieName);
  }
}
</script>

<template>
  <div ref="containerRef" class="dice-shelf">
    <!-- Abilities Panel -->
    <div v-if="playerAbilities.length > 0" class="abilities-panel">
      <h4>Abilities</h4>
      <div class="abilities-list">
        <button
          v-for="ability in playerAbilities"
          :key="ability.type"
          class="ability-badge"
          :class="{
            'can-use': canUseAbility(ability.type),
            'all-used': ability.unused === 0
          }"
          :style="{ '--ability-color': ABILITY_INFO[ability.type]?.color || '#888' }"
          :disabled="!canUseAbility(ability.type)"
          @click="useAbility(ability.type)"
        >
          <span class="ability-icon">{{ ABILITY_INFO[ability.type]?.icon || '?' }}</span>
          <span class="ability-label">{{ ABILITY_INFO[ability.type]?.label || ability.type }}</span>
          <span v-if="ability.total > 1 || ability.unused !== ability.total" class="ability-count">
            {{ ability.unused }}/{{ ability.total }}
          </span>
        </button>
      </div>
    </div>

    <div class="shelf-header">
      <h3>Ingredient Shelf</h3>
      <div v-if="hasSelectableElements" class="ability-hint">
        Select a die for the current action
      </div>
      <div v-else-if="canDraft" class="draft-hint">Click a die to draft it</div>
    </div>

    <div class="shelf-container">
      <div class="dice-row">
        <div
          v-for="die in shelfDice"
          :key="die.name"
          class="die-slot"
          :class="{
            drafted: isDieDrafted(die.name),
            selectable: isDieSelectable(die.name),
            highlighted: isDieHighlighted(die.name),
            clickable: isDieSelectable(die.name) || (canDraft && !isDieDrafted(die.name))
          }"
          @click="handleDieClick(die.name, die.id)"
        >
          <div class="die-label" :style="{ backgroundColor: getDieInfo(die.name).color }">
            {{ getDieInfo(die.name).label }}
          </div>

          <div
            class="die-display"
            :data-element-id="die.id"
            :data-animatable="!isDieDrafted(die.name)"
            :data-die-preview="!isDieDrafted(die.name) ? getDiePreviewData(die) : undefined"
          >
            <!-- Use Die3D component for 3D dice -->
            <Die3D
              v-if="!isDieDrafted(die.name)"
              :sides="die.attributes?.sides ?? 6"
              :value="die.attributes?.value ?? 1"
              :color="getDieInfo(die.name).color"
              :roll-count="die.attributes?.rollCount ?? 0"
              :die-id="die.id"
              :size="60"
            />
            <div v-else class="drafted-placeholder">
              Drafted
            </div>
          </div>

          <!-- D10 0/10 choice buttons (only in draft mode, not when selecting for action) -->
          <div v-if="!isDieSelectable(die.name) && canDraft && !isDieDrafted(die.name) && die.attributes?.sides === 10 && die.attributes?.value === 10" class="d10-choices">
            <button
              class="d10-choice"
              @click.stop="selectDie(`${die.name}:0`)"
            >
              Use as 0
            </button>
            <button
              class="d10-choice"
              @click.stop="selectDie(`${die.name}:10`)"
            >
              Use as 10
            </button>
          </div>

          <!-- Regular draft button (only when not selecting for action) -->
          <button
            v-else-if="!isDieSelectable(die.name) && canDraft && !isDieDrafted(die.name)"
            class="draft-button"
            @click.stop="selectDie(die.name)"
          >
            Draft ({{ die.attributes?.value ?? '?' }})
          </button>

          <!-- Show value when die is selectable for an action -->
          <div v-else-if="isDieSelectable(die.name) && !isDieDrafted(die.name)" class="die-value-label">
            {{ die.attributes?.value ?? '?' }}
          </div>
        </div>
      </div>
    </div>

    <!-- Drafted dice display -->
    <div v-if="draftedDice.length > 0" class="drafted-section">
      <h4>Drafted This Turn</h4>
      <div class="drafted-dice">
        <div
          v-for="die in draftedDice"
          :key="die.name"
          class="drafted-die"
          :data-element-id="die.id"
          data-animatable="true"
          :data-die-preview="getDiePreviewData(die)"
        >
          <Die3D
            :sides="die.attributes?.sides ?? 6"
            :value="die.attributes?.value ?? 1"
            :color="getDieInfo(die.name).color"
            :roll-count="die.attributes?.rollCount ?? 0"
            :die-id="die.id"
            :size="50"
          />
          <div class="drafted-value">{{ die.attributes?.value }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dice-shelf {
  background: linear-gradient(135deg, #2d1b4e 0%, #1a1a2e 100%);
  border-radius: 12px;
  padding: 16px;
  color: #e0e0e0;
}

.shelf-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.shelf-header h3 {
  margin: 0;
  color: #ba68c8;
  font-size: 1.2rem;
}

.draft-hint {
  font-size: 0.85rem;
  color: #4CAF50;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.shelf-container {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  padding: 16px;
  border: 2px solid rgba(186, 104, 200, 0.3);
}

.dice-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: center;
}

.die-slot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  transition: all 0.2s ease;
}

.die-slot:hover:not(.drafted) {
  background: rgba(255, 255, 255, 0.1);
  transform: translateY(-2px);
}

.die-slot.drafted {
  opacity: 0.4;
}

.die-label {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: bold;
  color: white;
  text-shadow: 0 1px 2px rgba(0,0,0,0.5);
}

.die-display {
  width: 70px;
  height: 70px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.drafted-placeholder {
  color: #666;
  font-style: italic;
  font-size: 0.8rem;
}

.d10-choices {
  display: flex;
  gap: 4px;
}

.d10-choice {
  padding: 4px 8px;
  font-size: 0.7rem;
  background: rgba(255, 152, 0, 0.3);
  border: 1px solid #ff9800;
  border-radius: 4px;
  color: #fff;
  cursor: pointer;
  transition: all 0.2s ease;
}

.d10-choice:hover {
  background: rgba(255, 152, 0, 0.5);
  transform: scale(1.05);
}

.draft-button {
  padding: 6px 12px;
  font-size: 0.8rem;
  background: linear-gradient(135deg, #4CAF50 0%, #388E3C 100%);
  border: none;
  border-radius: 4px;
  color: white;
  cursor: pointer;
  font-weight: bold;
  transition: all 0.2s ease;
}

.draft-button:hover {
  transform: scale(1.05);
  box-shadow: 0 2px 8px rgba(76, 175, 80, 0.4);
}

.drafted-section {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.drafted-section h4 {
  margin: 0 0 12px 0;
  color: #00d9ff;
  font-size: 0.9rem;
}

.drafted-dice {
  display: flex;
  gap: 16px;
  justify-content: center;
}

.drafted-die {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px;
  background: rgba(0, 217, 255, 0.1);
  border-radius: 8px;
  border: 1px solid rgba(0, 217, 255, 0.3);
}

.drafted-value {
  font-size: 1.2rem;
  font-weight: bold;
  color: #00d9ff;
}

/* Ability hint */
.ability-hint {
  font-size: 0.85rem;
  color: #2196F3;
  animation: pulse 2s infinite;
}

/* Die slot states */
.die-slot.clickable {
  cursor: pointer;
}

.die-slot.selectable {
  border: 2px solid #2196F3;
  background: rgba(33, 150, 243, 0.15);
  box-shadow: 0 0 8px rgba(33, 150, 243, 0.3);
}

.die-slot.selectable:hover:not(.drafted) {
  background: rgba(33, 150, 243, 0.25);
  box-shadow: 0 0 12px rgba(33, 150, 243, 0.5);
  transform: translateY(-4px);
}

.die-slot.highlighted {
  background: rgba(33, 150, 243, 0.3) !important;
  border: 2px solid #2196F3;
  box-shadow: 0 0 16px rgba(33, 150, 243, 0.6);
  transform: translateY(-4px);
}

.die-value-label {
  font-size: 1rem;
  font-weight: bold;
  color: #fff;
}

/* Abilities Panel */
.abilities-panel {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
  border: 1px solid rgba(255, 152, 0, 0.3);
}

.abilities-panel h4 {
  margin: 0 0 10px 0;
  color: #ff9800;
  font-size: 0.9rem;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.abilities-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ability-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 2px solid var(--ability-color, #888);
  border-radius: 8px;
  font-size: 0.85rem;
  color: #e0e0e0;
  cursor: default;
  transition: all 0.2s ease;
}

.ability-badge.can-use {
  cursor: pointer;
  background: rgba(255, 255, 255, 0.1);
  box-shadow: 0 0 8px color-mix(in srgb, var(--ability-color) 40%, transparent);
}

.ability-badge.can-use:hover {
  transform: scale(1.05);
  background: rgba(255, 255, 255, 0.15);
  box-shadow: 0 0 12px color-mix(in srgb, var(--ability-color) 60%, transparent);
}

.ability-badge.all-used {
  opacity: 0.4;
  border-style: dashed;
}

.ability-badge:disabled {
  cursor: default;
}

.ability-icon {
  font-size: 1.1rem;
}

.ability-label {
  font-weight: 500;
}

.ability-count {
  font-size: 0.75rem;
  background: rgba(0, 0, 0, 0.3);
  padding: 2px 6px;
  border-radius: 4px;
  color: #aaa;
}
</style>
