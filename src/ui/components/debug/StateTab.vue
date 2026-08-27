<script setup lang="ts">
/**
 * THE STATE TAB (#157).
 *
 * The whole game state, as a tree you can open a path at a time or as raw JSON,
 * with a search that reads property names and leaf values.
 *
 * The two states a reader must be able to tell apart are why the markup is more
 * than a tree: a time-travel read that is still running, and one that FAILED.
 * Without them the panel falls back to the LIVE state while it is still dressed
 * in the historical border, and shows the reader the current game labelled as
 * the state after action N.
 *
 * Presentational: the panel owns the tree's open paths, the search, and the
 * clipboard, and its tests cover them.
 */
import { TreeNode } from './TreeNode.js';
import DebugButton from './DebugButton.vue';
import DebugSearchInput from './DebugSearchInput.vue';

defineProps<{
  displayedState: { state?: { phase?: string } } | null;
  formattedState: string;
  showRawState: boolean;
  stateSearchQuery: string;
  /** Paths the search leaves visible, or null when nothing is being searched. */
  visiblePaths: Set<string> | null;
  stateSearchFoundNothing: boolean;
  treeExpandedPaths: Set<string>;
  isViewingHistory: boolean;
  selectedActionIndex: number | null;
  historicalStateLoading: boolean;
  historicalStateError: string | null;
  gameId: string | null;
}>();

const emit = defineEmits<{
  'back-to-live': [];
  copy: [];
  download: [];
  'expand-all': [];
  'collapse-all': [];
  'toggle-path': [path: string];
  'copy-node': [value: unknown];
  'update:showRawState': [value: boolean];
  'update:stateSearchQuery': [value: string];
}>();
</script>

<template>
  <div
    id="debug-panel-state"
    role="tabpanel"
    aria-labelledby="debug-tab-state"
    class="tab-content state-tab"
  >
        <!-- Historical state banner -->
        <div v-if="isViewingHistory" class="historical-banner">
          <span class="historical-icon">&#9200;</span>
          <span>Viewing state after action {{ selectedActionIndex }}</span>
          <DebugButton size="small" @click="emit('back-to-live')">Back to Live</DebugButton>
        </div>

        <div class="state-actions">
          <DebugButton @click="emit('copy')" size="small">Copy</DebugButton>
          <DebugButton @click="emit('download')" size="small">Download</DebugButton>
          <DebugButton @click="emit('expand-all')" size="small">Expand</DebugButton>
          <DebugButton @click="emit('collapse-all')" size="small">Collapse</DebugButton>
          <label class="toggle-raw">
            <input type="checkbox" :checked="showRawState"
                @change="emit('update:showRawState', ($event.target as HTMLInputElement).checked)" />
            Raw
          </label>
        </div>

        <!-- Search box -->
        <div class="state-search">
          <DebugSearchInput
            :model-value="stateSearchQuery"
                @update:model-value="emit('update:stateSearchQuery', $event)"
            placeholder="Search state..."
            aria-label="Search state"
          />
        </div>

        <!--
          A time-travel read that is still running, or that failed. Without
          these the panel falls back to the LIVE state while `isViewingHistory`
          is still true, and shows it inside the historical border: the reader
          cannot tell a failed read from a state that genuinely looks that way.
        -->
        <div v-if="historicalStateLoading" class="historical-state-loading">
          Reading the state after action {{ selectedActionIndex }}&hellip;
        </div>
        <div v-else-if="historicalStateError" class="historical-state-error" role="alert">
          <strong>Could not read the state after action {{ selectedActionIndex }}.</strong>
          <span class="historical-state-reason">{{ historicalStateError }}</span>
          <span>
            Pick a more recent action, or press Back to Live to return to the current state.
          </span>
        </div>

        <div
          v-else
          class="state-display"
          :class="{ historical: isViewingHistory }"
        >
          <pre v-if="showRawState">{{ formattedState }}</pre>

          <!-- Tree View -->
          <div v-else class="state-tree">
            <!-- Recursive tree component inline -->
            <template v-if="displayedState">
              <div class="tree-root">
                <!-- Game info summary -->
                <div class="tree-summary" :class="{ historical: isViewingHistory }">
                  <span class="summary-item">
                    <span class="summary-label">ID:</span>
                    <span class="summary-value">{{ gameId || 'N/A' }}</span>
                  </span>
                  <span class="summary-item">
                    <span class="summary-label">Phase:</span>
                    <span class="summary-value">{{ displayedState?.state?.phase || 'N/A' }}</span>
                  </span>
                  <!-- Whose turn it is is already shown in the players panel; no need to repeat it here. -->
                </div>

                <!-- State tree (recursive component) -->
                <TreeNode
                  v-for="(value, key) in displayedState"
                  :key="key"
                  :node-key="String(key)"
                  :value="value"
                  :path="`root.${key}`"
                  :depth="0"
                  :expanded-paths="treeExpandedPaths"
                  :visible-paths="visiblePaths"
                  @toggle="emit('toggle-path', $event)"
                  @copy="emit('copy-node', $event)"
                />

                <div v-if="stateSearchFoundNothing" class="state-search-empty">
                  No part of the state matches &ldquo;{{ stateSearchQuery }}&rdquo;. The search
                  reads property names and leaf values.
                </div>
              </div>
            </template>
            <div v-else class="no-state">No state available</div>
          </div>
        </div>
  </div>
</template>

<style scoped>
/* State Tab */
.state-actions {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
  align-items: center;
  flex-wrap: wrap;
}
.toggle-raw {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--bsg-ink-2);
  font-size: 12px;
  cursor: pointer;
}
.toggle-raw input {
  cursor: pointer;
}
.state-search {
  margin-bottom: 10px;
}
.state-display {
  background: var(--bsg-surface-3);
  border-radius: 8px;
  overflow: hidden;
  min-height: 0;
  overflow-y: auto;
  flex: 1;
}
.state-display pre {
  padding: 12px;
  margin: 0;
  font-family: var(--bsg-mono);
  font-size: 11px;
  color: var(--bsg-ok);
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
/* Tree View */
.state-tree {
  padding: 8px;
  font-family: var(--bsg-mono);
  font-size: 11px;
}
.tree-summary {
  display: flex;
  gap: 16px;
  padding: 8px 12px;
  background: color-mix(in srgb, var(--bsg-accent-2) 10%, transparent);
  border-radius: 6px;
  margin-bottom: 12px;
}
.summary-item {
  display: flex;
  gap: 4px;
}
.summary-label {
  color: var(--bsg-ink-2);
}
.summary-value {
  color: var(--bsg-accent-2);
  font-weight: 500;
}
.no-state {
  color: var(--bsg-ink-3);
  text-align: center;
  padding: 20px;
}
/* Historical State Banner */
.historical-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: color-mix(in srgb, var(--bsg-warn) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--bsg-warn) 30%, transparent);
  border-radius: 6px;
  margin-bottom: 12px;
  color: var(--bsg-warn);
  font-size: 12px;
}
.historical-icon {
  font-size: 16px;
}
.historical-banner button {
  margin-left: auto;
}
.historical-state-loading {
  padding: 12px;
  color: var(--bsg-ink-2);
  font-size: 12px;
  font-style: italic;
}
.historical-state-error {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  background: color-mix(in srgb, var(--bsg-danger) 12%, transparent);
  border: 1px solid var(--bsg-danger);
  border-radius: 6px;
  color: var(--bsg-danger);
  font-size: 12px;
  line-height: 1.5;
}
.historical-state-reason {
  font-family: var(--bsg-font-mono, monospace);
  color: var(--bsg-ink-2);
  word-break: break-word;
}
.state-search-empty {
  padding: 12px 4px;
  color: var(--bsg-ink-2);
  font-size: 12px;
  line-height: 1.5;
}
/* Historical state indicator */
.state-display.historical {
  border: 2px solid color-mix(in srgb, var(--bsg-warn) 30%, transparent);
  border-radius: 8px;
}
.tree-summary.historical {
  background: color-mix(in srgb, var(--bsg-warn) 15%, transparent);
}
</style>
