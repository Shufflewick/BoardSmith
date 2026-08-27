<script setup lang="ts">
/**
 * THE DECKS TAB (#157).
 *
 * Every deck in the rendered view, its cards in order, and the edits a developer
 * needs while a game is running: shuffle, move a card to the top, nudge it up or
 * down, transfer it to another container.
 *
 * It owns its whole concern -- the search box, which decks are open, which card
 * is selected, and `useDeckWorkbench`'s edits and transfer dialog -- and takes
 * only what it cannot know: the view it is rendering, and how the panel copies
 * to the clipboard (which drives a panel-level toast).
 *
 * `useDebugBridge()` resolves through injection, so the tab reaches the host
 * without the panel threading a transport down to it.
 */
import { ref, computed } from 'vue';
import {
  discoverDecks,
  discoverCardContainers,
  filterDecks,
  decksExpandedBySearch,
  cardMatchesSearch,
  getCardDisplayName,
  type DeckInfo,
} from './debug-view-tree.js';
import { useDebugBridge } from '../../composables/useDebugBridge.js';
import { useDeckWorkbench } from '../../composables/useDeckWorkbench.js';
import DebugButton from './DebugButton.vue';
import DebugDialog from './DebugDialog.vue';
import DebugSearchInput from './DebugSearchInput.vue';

const props = defineProps<{
  /** The player view being rendered -- live, or a historical one during time travel. */
  view: unknown;
  /** The panel's copy-with-toast, so a copy here reads the same as anywhere else. */
  copy: (value: unknown) => void | Promise<void>;
}>();

const bridge = useDebugBridge();

const deckSearchQuery = ref('');
const expandedDecks = ref<Set<number>>(new Set());
const selectedDeckCard = ref<{ deckId: number; cardId: number } | null>(null);

const discoveredDecks = computed(() => discoverDecks(props.view));
const discoveredCardContainers = computed(() => discoverCardContainers(props.view));

const filteredDecks = computed(() => filterDecks(discoveredDecks.value, deckSearchQuery.value));

/** Decks the search pulled open on its own, because the match is on a card. */
const searchExpandedDecks = computed(() =>
  decksExpandedBySearch(filteredDecks.value, deckSearchQuery.value)
);

function isDeckExpanded(deckId: number): boolean {
  return expandedDecks.value.has(deckId) || searchExpandedDecks.value.has(deckId);
}

function toggleDeck(deckId: number) {
  const next = new Set(expandedDecks.value);
  if (next.has(deckId)) next.delete(deckId);
  else next.add(deckId);
  expandedDecks.value = next;
}

function selectDeckCard(deckId: number, cardId: number) {
  const isSelected = selectedDeckCard.value?.deckId === deckId
    && selectedDeckCard.value?.cardId === cardId;
  selectedDeckCard.value = isSelected ? null : { deckId, cardId };
}

const selectedCard = computed(() => {
  const selection = selectedDeckCard.value;
  if (!selection) return null;
  const deck = discoveredDecks.value.find(d => d.id === selection.deckId);
  return deck?.cards.find(c => c.id === selection.cardId) ?? null;
});

async function copyDeckToClipboard(deck: DeckInfo) {
  await props.copy({
    ...deck.fullObject,
    cards: deck.cards.map(c => c.fullObject),
  });
}

const {
  deckManipulationLoading,
  deckManipulationError,
  moveCardToTop,
  reorderCard,
  transferCard,
  shuffleDeck,
  moveCardUp,
  moveCardDown,
  transferDialogOpen,
  transferDialogCardId,
  transferDialogSourceDeckId,
  transferDialogTargetDeckId,
  transferDialogPosition,
  availableTargetContainers,
  openTransferDialog,
  closeTransferDialog,
  confirmTransfer,
} = useDeckWorkbench({ bridge, cardContainers: discoveredCardContainers });
</script>

<template>
  <div
    id="debug-panel-decks"
    role="tabpanel"
    aria-labelledby="debug-tab-decks"
    class="tab-content decks-tab"
  >
    <!-- Search -->
    <div class="deck-search">
      <DebugSearchInput
        v-model="deckSearchQuery"
        placeholder="Search decks or cards..."
        aria-label="Search decks or cards"
      />
    </div>

    <!-- Error message -->
    <div v-if="deckManipulationError" class="deck-error">
      {{ deckManipulationError }}
      <DebugButton size="small" @click="deckManipulationError = null">Dismiss</DebugButton>
    </div>

    <!-- No decks found -->
    <div v-if="filteredDecks.length === 0" class="no-decks">
      <template v-if="discoveredDecks.length === 0">
        No deck elements found in game state.
        <div class="deck-hint">
          Decks are elements with <code>$type: 'deck'</code> or className containing "Deck".
        </div>
      </template>
      <template v-else>
        No decks match your search.
      </template>
    </div>

    <!-- Decks list with split view -->
    <div v-else class="decks-split-view" :class="{ 'has-selection': selectedCard }">
      <!-- Deck List Panel -->
      <div class="decks-list-panel">
        <div
          v-for="deck in filteredDecks"
          :key="deck.id"
          class="deck-item"
        >
          <div
            class="deck-header"
            @click="toggleDeck(deck.id)"
          >
            <span class="deck-arrow">
              {{ isDeckExpanded(deck.id) ? '▼' : '▶' }}
            </span>
            <span class="deck-name">{{ deck.name }}</span>
            <span class="deck-count">[{{ deck.cards.length }} cards]</span>
            <div class="deck-actions" @click.stop>
              <DebugButton size="small" class="deck-action-btn" @click="shuffleDeck(deck.id)" :disabled="deckManipulationLoading" title="Shuffle deck" aria-label="Shuffle deck" >
                <span aria-hidden="true">🔀</span>
              </DebugButton>
              <DebugButton size="small" class="deck-action-btn" @click="copyDeckToClipboard(deck)" title="Copy deck JSON" aria-label="Copy deck JSON" >
                <span aria-hidden="true">📋</span>
              </DebugButton>
            </div>
          </div>

          <!-- Expanded card list -->
          <div v-if="isDeckExpanded(deck.id)" class="deck-cards">
            <div v-if="deck.cards.length === 0" class="deck-empty">
              Deck is empty
            </div>
            <div
              v-for="(card, index) in deck.cards"
              :key="card.id"
              class="card-item"
              :class="{
                selected: selectedDeckCard?.deckId === deck.id && selectedDeckCard?.cardId === card.id,
                'search-match': deckSearchQuery && cardMatchesSearch(card, deckSearchQuery)
              }"
              @click="selectDeckCard(deck.id, card.id)"
            >
              <span class="card-position">{{ index }}</span>
              <span class="card-name">{{ getCardDisplayName(card) }}</span>
              <span class="card-class">{{ card.className }}</span>
              <span class="card-id">#{{ card.id }}</span>
              <div class="card-actions" @click.stop>
                <button
                  class="card-action-btn"
                  @click="moveCardToTop(card.id)"
                  :disabled="index === 0 || deckManipulationLoading"
                  title="Move to top"
                  aria-label="Move to top"
                >
                  <span aria-hidden="true">⬆️</span>
                </button>
                <button
                  class="card-action-btn"
                  @click="moveCardUp(deck, card.id)"
                  :disabled="index === 0 || deckManipulationLoading"
                  title="Move up"
                  aria-label="Move up"
                >
                  <span aria-hidden="true">↑</span>
                </button>
                <button
                  class="card-action-btn"
                  @click="moveCardDown(deck, card.id)"
                  :disabled="index === deck.cards.length - 1 || deckManipulationLoading"
                  title="Move down"
                  aria-label="Move down"
                >
                  <span aria-hidden="true">↓</span>
                </button>
                <button
                  class="card-action-btn"
                  @click="openTransferDialog(card.id, deck.id)"
                  :disabled="discoveredCardContainers.length < 2 || deckManipulationLoading"
                  title="Transfer to another container"
                  aria-label="Transfer to another container"
                >
                  <span aria-hidden="true">➡️</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Card Detail Panel -->
      <div v-if="selectedCard" class="card-detail-panel">
        <div class="card-detail-header">
          <span class="card-detail-title">
            {{ selectedCard.className }} #{{ selectedCard.id }}
          </span>
          <div class="card-detail-actions">
            <DebugButton @click="copy(selectedCard.fullObject)" size="small" title="Copy JSON" >
              Copy
            </DebugButton>
            <DebugButton @click="selectedDeckCard = null" size="small" title="Close" >
              ×
            </DebugButton>
          </div>
        </div>
        <div class="card-detail-content">
          <pre class="card-json">{{ JSON.stringify(selectedCard.fullObject, null, 2) }}</pre>
        </div>
      </div>
    </div>

    <!-- Transfer Dialog -->
    <DebugDialog
      v-if="transferDialogOpen"
      title="Transfer Card"
      close-label="Close transfer dialog"
      @close="closeTransferDialog"
    >
      <div class="form-group">
        <label>Target Container:</label>
        <select v-model="transferDialogTargetDeckId">
          <option :value="null" disabled>Select a container...</option>
          <option v-for="container in availableTargetContainers" :key="container.id" :value="container.id">
            {{ container.name }} ({{ container.className }}, {{ container.cardCount }} cards)
          </option>
        </select>
      </div>
      <div class="form-group">
        <label>Position:</label>
        <div class="radio-group">
          <label>
            <input type="radio" v-model="transferDialogPosition" value="first" />
            Top (first)
          </label>
          <label>
            <input type="radio" v-model="transferDialogPosition" value="last" />
            Bottom (last)
          </label>
        </div>
      </div>
      <template #footer>
        <DebugButton @click="closeTransferDialog">Cancel</DebugButton>
        <DebugButton tone="primary" @click="confirmTransfer" :disabled="transferDialogTargetDeckId === null || deckManipulationLoading">
          {{ deckManipulationLoading ? 'Transferring...' : 'Transfer' }}
        </DebugButton>
      </template>
    </DebugDialog>

    <!-- Loading indicator -->
    <div v-if="deckManipulationLoading" class="deck-loading">
      Processing...
    </div>
  </div>
</template>

<style scoped>
/* Decks Tab */
.decks-tab {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.deck-search {
  margin-bottom: 4px;
}
.deck-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: color-mix(in srgb, var(--bsg-danger) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--bsg-danger) 30%, transparent);
  border-radius: 6px;
  color: var(--bsg-danger);
  font-size: 12px;
}
.no-decks {
  color: var(--bsg-ink-2);
  font-style: italic;
  padding: 20px;
  text-align: center;
  background: var(--bsg-surface-2);
  border-radius: 6px;
}
.deck-hint {
  margin-top: 8px;
  font-size: 11px;
  color: var(--bsg-ink-3);
}
.deck-hint code {
  background: color-mix(in srgb, var(--bsg-accent-2) 10%, transparent);
  padding: 2px 6px;
  border-radius: 3px;
  color: var(--bsg-accent-2);
  font-size: 10px;
}
/* Decks split view */
.decks-split-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 200px;
}
.decks-split-view.has-selection {
  flex-direction: row;
  gap: 12px;
}
.decks-list-panel {
  flex: 1;
  min-width: 0;
  max-height: 400px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.decks-split-view.has-selection .decks-list-panel {
  flex: 0 0 50%;
  max-height: 400px;
}
/* Deck item */
.deck-item {
  background: var(--bsg-surface-2);
  border-radius: 6px;
  overflow: hidden;
}
.deck-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.2s;
}
.deck-header:hover {
  background: var(--bsg-surface-3);
}
.deck-arrow {
  color: var(--bsg-ink-3);
  font-size: 10px;
  width: 12px;
}
.deck-name {
  color: var(--bsg-ink-2);
  font-weight: 500;
  font-size: 12px;
  flex: 1;
}
.deck-count {
  color: var(--bsg-ink-2);
  font-size: 11px;
}
.deck-actions {
  display: flex;
  gap: 4px;
  margin-left: auto;
}
.deck-action-btn {
  opacity: 0.6;
  font-size: 12px !important;
  padding: 2px 6px !important;
  line-height: 1;
}
.deck-action-btn:hover:not(:disabled) {
  opacity: 1;
}
.deck-action-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
/* Deck cards list */
.deck-cards {
  padding: 4px 8px 8px;
  border-top: 1px solid var(--bsg-line);
  max-height: 300px;
  overflow-y: auto;
}
.deck-empty {
  color: var(--bsg-ink-3);
  font-style: italic;
  padding: 8px;
  text-align: center;
  font-size: 11px;
}
.card-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 11px;
}
.card-item:hover {
  background: var(--bsg-surface-3);
}
.card-item.selected {
  background: color-mix(in srgb, var(--bsg-ink-2) 20%, transparent);
  border: 1px solid color-mix(in srgb, var(--bsg-ink-2) 40%, transparent);
}
.card-item.search-match {
  background: color-mix(in srgb, var(--bsg-warn) 20%, transparent);
  border: 1px solid color-mix(in srgb, var(--bsg-warn) 50%, transparent);
}
.card-item.search-match .card-name {
  color: var(--bsg-warn);
  font-weight: bold;
}
.card-position {
  min-width: 20px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bsg-surface-3);
  border-radius: 9px;
  font-size: 9px;
  color: var(--bsg-ink-2);
}
.card-name {
  color: var(--bsg-ink);
  flex: 1;
}
.card-class {
  color: var(--bsg-ink-3);
  font-size: 10px;
}
.card-id {
  color: var(--bsg-ink-3);
  font-size: 10px;
  font-family: var(--bsg-mono);
}
/* Card action buttons */
.card-actions {
  display: flex;
  gap: 2px;
  margin-left: auto;
  opacity: 0;
  transition: opacity 0.2s;
}
.card-item:hover .card-actions {
  opacity: 1;
}
.card-action-btn {
  min-width: 24px;
  min-height: 24px;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--bsg-line);
  border-radius: 4px;
  background: var(--bsg-surface-3);
  color: var(--bsg-ink-2);
  font-size: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}
.card-action-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--bsg-accent-2) 20%, transparent);
  border-color: color-mix(in srgb, var(--bsg-accent-2) 30%, transparent);
  color: var(--bsg-accent-2);
}
.card-action-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
/* Deck loading indicator */
.deck-loading {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: var(--bsg-bg);
  padding: 12px 20px;
  border-radius: 6px;
  color: var(--bsg-accent-2);
  font-size: 12px;
  z-index: 100;
}
/* Card detail panel */
.card-detail-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--bsg-surface-3);
  border-radius: 8px;
  overflow: hidden;
  max-height: 400px;
}
.card-detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--bsg-surface-2);
  border-bottom: 1px solid var(--bsg-line);
}
.card-detail-title {
  font-weight: 600;
  color: var(--bsg-ink-2);
  font-size: 13px;
}
.card-detail-actions {
  display: flex;
  gap: 4px;
}
.card-detail-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}
.card-json {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--bsg-ink-2);
}
/* Deck tab positioning */
.decks-tab {
  position: relative;
}
</style>
