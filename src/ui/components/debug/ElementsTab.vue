<script setup lang="ts">
/**
 * THE ELEMENTS TAB (#157).
 *
 * Every element in the rendered view, grouped by class, with a search over
 * names, notations, class names and ids, and a detail pane for whichever one is
 * selected. Selecting an element highlights it on the board, which is why this
 * tab emits rather than deciding: the highlight belongs to the game surface, not
 * to the panel.
 *
 * It also renders `customDebug` -- whatever the game itself chose to publish --
 * because that is element-shaped and this is where a developer looks for it.
 *
 * Takes the view it renders and the panel's copy-with-toast; owns everything
 * else about its own concern.
 */
import { ref, computed } from 'vue';
import {
  groupElementsByClass,
  filterElementGroups,
  getElementDisplayName,
  type GroupedElement,
} from './debug-view-tree.js';
import DebugButton from './DebugButton.vue';
import DebugSearchInput from './DebugSearchInput.vue';

const props = defineProps<{
  /** The player view being rendered -- live, or a historical one during time travel. */
  view: unknown;
  /** Whatever extra the game published for debugging, or null. */
  customDebugData: unknown;
  /** The panel's copy-with-toast, so a copy here reads the same as anywhere else. */
  copy: (value: unknown) => void | Promise<void>;
}>();

const emit = defineEmits<{ 'highlight-element': [elementId: number | null] }>();

const selectedElementId = ref<number | null>(null);
const elementSearchQuery = ref('');
const expandedElementGroups = ref<Set<string>>(new Set());

const groupedElements = computed(() => groupElementsByClass(props.view));

const filteredElementGroups = computed(() =>
  filterElementGroups(groupedElements.value, elementSearchQuery.value)
);

const selectedElement = computed<GroupedElement | null>(() => {
  if (selectedElementId.value === null) return null;
  for (const elements of Object.values(groupedElements.value)) {
    const found = elements.find(el => el.id === selectedElementId.value);
    if (found) return found;
  }
  return null;
});

function toggleElementGroup(className: string) {
  const next = new Set(expandedElementGroups.value);
  if (next.has(className)) next.delete(className);
  else next.add(className);
  expandedElementGroups.value = next;
}

/** Select an element and highlight it on the board; selecting it again clears. */
function selectElement(element: GroupedElement) {
  const next = selectedElementId.value === element.id ? null : element.id;
  selectedElementId.value = next;
  emit('highlight-element', next);
}

async function copyElementToClipboard(element: GroupedElement) {
  await props.copy(element.fullObject);
}
</script>

<template>
  <div
    id="debug-panel-elements"
    role="tabpanel"
    aria-labelledby="debug-tab-elements"
    class="tab-content elements-tab"
  >
        <!-- Search -->
        <div class="element-search">
          <DebugSearchInput
            v-model="elementSearchQuery"
            placeholder="Search elements..."
            aria-label="Search elements"
          />
        </div>

        <!-- Split View: List + Details -->
        <div class="elements-split-view" :class="{ 'has-selection': selectedElement }">
          <!-- Element List -->
          <div class="elements-list-panel">
            <div v-if="Object.keys(filteredElementGroups).length === 0" class="no-elements">
              No elements found
            </div>

            <div v-else class="element-groups">
              <div
                v-for="(elements, className) in filteredElementGroups"
                :key="className"
                class="element-group"
              >
                <div
                  class="element-group-header"
                  @click="toggleElementGroup(className)"
                >
                  <span class="group-arrow">
                    {{ expandedElementGroups.has(className) ? '▼' : '▶' }}
                  </span>
                  <span class="group-name">{{ className }}</span>
                  <span class="group-count">[{{ elements.length }}]</span>
                </div>

                <div v-if="expandedElementGroups.has(className)" class="element-list">
                  <div
                    v-for="element in elements"
                    :key="element.id"
                    class="element-item"
                    :class="{ selected: selectedElementId === element.id }"
                    @click="selectElement(element)"
                  >
                    <span class="element-name">{{ getElementDisplayName(element) }}</span>
                    <span class="element-id">#{{ element.id }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Element Detail Panel -->
          <div v-if="selectedElement" class="element-detail-panel">
            <div class="element-detail-header">
              <span class="element-detail-title">
                {{ selectedElement.className }} #{{ selectedElement.id }}
              </span>
              <div class="element-detail-actions">
                <DebugButton @click="copyElementToClipboard(selectedElement)" size="small" title="Copy JSON" >
                  Copy
                </DebugButton>
                <DebugButton @click="selectedElementId = null; emit('highlight-element', null)" size="small" title="Close" >
                  ×
                </DebugButton>
              </div>
            </div>
            <div class="element-detail-content">
              <pre class="element-json">{{ JSON.stringify(selectedElement.fullObject, null, 2) }}</pre>
            </div>
          </div>
        </div>

        <!-- Custom Debug Section -->
        <div v-if="customDebugData" class="custom-debug-section">
          <h4 class="section-title">Custom Debug</h4>
          <div class="custom-debug-content">
            <div
              v-for="(value, key) in customDebugData"
              :key="key"
              class="custom-debug-item"
            >
              <div class="custom-debug-key">
                <span>{{ key }}</span>
                <DebugButton size="small" class="custom-debug-copy" @click="copy(value)" title="Copy JSON" >
                  Copy
                </DebugButton>
              </div>
              <pre class="custom-debug-value">{{ JSON.stringify(value, null, 2) }}</pre>
            </div>
          </div>
        </div>
  </div>
</template>

<style scoped>
/* Elements Tab */
.elements-tab {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.element-search {
  margin-bottom: 8px;
}
.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--bsg-ink);
  font-size: 12px;
  text-transform: uppercase;
  margin-bottom: 10px;
  letter-spacing: 0.5px;
}
/* Elements Section */
.elements-section {
  border-bottom: 1px solid var(--bsg-line);
  padding-bottom: 16px;
}
.no-elements {
  color: var(--bsg-ink-3);
  font-style: italic;
  font-size: 11px;
}
/* Elements split view layout */
.elements-split-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 200px;
}
.elements-split-view.has-selection {
  flex-direction: row;
  gap: 12px;
}
.elements-list-panel {
  flex: 1;
  min-width: 0;
  max-height: 400px;
  overflow-y: auto;
}
.elements-split-view.has-selection .elements-list-panel {
  flex: 0 0 40%;
  max-height: 400px;
}
.element-detail-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--bsg-surface-3);
  border-radius: 8px;
  overflow: hidden;
  max-height: 400px;
}
.element-detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--bsg-surface-2);
  border-bottom: 1px solid var(--bsg-line);
}
.element-detail-title {
  font-weight: 600;
  color: var(--bsg-accent);
  font-size: 13px;
}
.element-detail-actions {
  display: flex;
  gap: 4px;
}
.element-detail-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}
.element-json {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--bsg-ink-2);
}
.element-groups {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: none;
  overflow-y: visible;
}
.element-group {
  background: var(--bsg-surface-2);
  border-radius: 6px;
  overflow: hidden;
}
.element-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.2s;
}
.element-group-header:hover {
  background: var(--bsg-surface-3);
}
.group-arrow {
  color: var(--bsg-ink-3);
  font-size: 10px;
  width: 12px;
}
.group-name {
  color: var(--bsg-accent-2);
  font-weight: 500;
  font-size: 12px;
}
.group-count {
  color: var(--bsg-ink-2);
  font-size: 11px;
}
.element-list {
  padding: 4px 8px 8px;
  border-top: 1px solid var(--bsg-line);
}
.element-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}
.element-item:hover {
  background: var(--bsg-surface-3);
}
.element-item.selected {
  background: color-mix(in srgb, var(--bsg-accent-2) 20%, transparent);
  border: 1px solid color-mix(in srgb, var(--bsg-accent-2) 40%, transparent);
}
.element-name {
  color: var(--bsg-ink);
  font-size: 11px;
}
.element-id {
  color: var(--bsg-ink-3);
  font-size: 10px;
  font-family: var(--bsg-mono);
}
/* Custom Debug Section */
.custom-debug-section {
  padding-bottom: 16px;
  max-height: 400px;
  overflow-y: auto;
}
.custom-debug-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.custom-debug-item {
  background: var(--bsg-surface-2);
  border-radius: 6px;
  overflow: hidden;
}
.custom-debug-key {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: color-mix(in srgb, var(--bsg-accent-2) 10%, transparent);
  color: var(--bsg-accent-2);
  font-weight: 500;
  font-size: 11px;
}
.custom-debug-copy {
  opacity: 0.6;
  font-size: 9px !important;
  padding: 2px 6px !important;
}
.custom-debug-copy:hover {
  opacity: 1;
}
.custom-debug-value {
  margin: 0;
  padding: 8px 12px;
  font-family: var(--bsg-mono);
  font-size: 10px;
  color: var(--bsg-ok);
  overflow: auto;
  max-height: 200px;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
