<script setup lang="ts">
/**
 * THE ACTIONS TAB (#157).
 *
 * Why an action a player expects is not on offer, which is the question this tab
 * exists to answer. It partitions every trace three ways:
 *
 *  - AVAILABLE: passes its own conditions AND the flow will accept it,
 *  - FLOW-RESTRICTED: passes its conditions but the flow will not accept it
 *    right now (the case that reads as a bug and is not one),
 *  - CONDITION-FAILED: refused by its own conditions, with the labelled
 *    condition that failed and the value it saw.
 *
 * Presentational: the panel owns the bridge fetch and the partitioning (its own
 * tests cover both), and this renders what it is handed and emits what a click
 * means.
 */
import { formatConditionValue } from './debug-format.js';
import type { ActionTrace, FlowContext, FlowStateInfo } from '../../composables/useDebugBridge.js';
import DebugButton from './DebugButton.vue';

defineProps<{
  actionTraces: ActionTrace[];
  tracesLoading: boolean;
  tracesError: string | null;
  flowContext: FlowContext | null;
  flowStateInfo: FlowStateInfo | null;
  trulyAvailableActions: ActionTrace[];
  flowRestrictedActions: ActionTrace[];
  conditionFailedActions: ActionTrace[];
}>();

const emit = defineEmits<{
  refresh: [];
  'copy-available': [];
  'copy-unavailable': [];
}>();
</script>

<template>
  <div
    id="debug-panel-actions"
    role="tabpanel"
    aria-labelledby="debug-tab-actions"
    class="tab-content actions-tab"
  >
        <div class="actions-header">
          <span class="actions-count">{{ actionTraces.length }} actions</span>
          <DebugButton @click="emit('refresh')" size="small" :disabled="tracesLoading">
            {{ tracesLoading ? 'Loading...' : 'Refresh' }}
          </DebugButton>
        </div>

        <!-- Flow Context Info Box -->
        <div v-if="flowContext || flowStateInfo" class="flow-context-box">
          <div class="flow-context-header">
            <span class="flow-context-icon">⚡</span>
            <span class="flow-context-title">Flow Context</span>
          </div>
          <div class="flow-context-details">
            <div v-if="flowStateInfo" class="flow-context-item">
              <span class="flow-context-label">Flow position:</span>
              <span class="flow-context-value">{{ flowStateInfo.description }}</span>
            </div>
            <template v-if="flowContext">
              <div v-if="flowContext.currentPhase" class="flow-context-item">
                <span class="flow-context-label">Phase:</span>
                <span class="flow-context-value">{{ flowContext.currentPhase }}</span>
              </div>
              <div class="flow-context-item">
                <span class="flow-context-label">Current player:</span>
                <span class="flow-context-value">{{ flowContext.currentPlayer ?? 'none' }}</span>
                <span v-if="flowContext.isMyTurn" class="flow-context-badge my-turn">Your turn</span>
                <span v-else class="flow-context-badge not-turn">Not your turn</span>
              </div>
              <div class="flow-context-item">
                <span class="flow-context-label">Flow allows:</span>
                <span class="flow-context-value flow-allowed-list">
                  <template v-if="flowContext.flowAllowedActions.length > 0">
                    {{ flowContext.flowAllowedActions.join(', ') }}
                  </template>
                  <template v-else>
                    <em>no actions</em>
                  </template>
                </span>
              </div>
            </template>
          </div>
        </div>

        <div v-if="tracesError" class="traces-error">
          {{ tracesError }}
        </div>

        <div v-else-if="actionTraces.length === 0" class="no-traces">
          No action traces available
        </div>

        <div v-else class="traces-list">
          <!-- Truly Available Actions (pass conditions AND in flow) -->
          <div class="trace-group">
            <div class="trace-group-header available">
              <span class="trace-icon">✓</span>
              <span class="trace-group-label">Available ({{ trulyAvailableActions.length }})</span>
              <DebugButton size="small" class="trace-copy-btn" @click="emit('copy-available')" title="Copy available actions" >
                Copy
              </DebugButton>
            </div>
            <div class="trace-items">
              <div
                v-for="trace in trulyAvailableActions"
                :key="trace.actionName"
                class="trace-item available"
              >
                <span class="trace-name">{{ trace.actionName }}</span>
                <span v-if="trace.selections.length > 0" class="trace-selections">
                  ({{ trace.selections.map(s => `${s.name}: ${s.choiceCount}`).join(', ') }})
                </span>
              </div>
              <div v-if="trulyAvailableActions.length === 0" class="trace-empty">
                No actions currently available
              </div>
            </div>
          </div>

          <!-- Flow-Restricted Actions (pass conditions but blocked by flow) -->
          <div v-if="flowRestrictedActions.length > 0" class="trace-group">
            <div class="trace-group-header flow-restricted">
              <span class="trace-icon">🚫</span>
              <span class="trace-group-label">Flow-Restricted ({{ flowRestrictedActions.length }})</span>
            </div>
            <div class="trace-items">
              <div class="flow-restricted-explanation">
                These actions pass their conditions but are not allowed by the current flow step.
                Add them to <code>actionStep({ actions: [...] })</code> in the flow definition.
              </div>
              <div
                v-for="trace in flowRestrictedActions"
                :key="trace.actionName"
                class="trace-item flow-restricted"
              >
                <span class="trace-name">{{ trace.actionName }}</span>
                <span class="trace-badge">would be available</span>
                <span v-if="trace.selections.length > 0" class="trace-selections">
                  ({{ trace.selections.map(s => `${s.name}: ${s.choiceCount}`).join(', ') }})
                </span>
              </div>
            </div>
          </div>

          <!-- Unavailable Actions (fail conditions) -->
          <div class="trace-group">
            <div class="trace-group-header unavailable">
              <span class="trace-icon">✗</span>
              <span class="trace-group-label">Condition Failed ({{ conditionFailedActions.length }})</span>
              <DebugButton size="small" class="trace-copy-btn" @click="emit('copy-unavailable')" title="Copy unavailable actions" >
                Copy
              </DebugButton>
            </div>
            <div class="trace-items">
              <div
                v-for="trace in conditionFailedActions"
                :key="trace.actionName"
                class="trace-item-detailed unavailable"
              >
                <div class="trace-item-header">
                  <span class="trace-name">{{ trace.actionName }}</span>
                  <span class="trace-reason">
                    <template v-if="trace.conditionError">
                      error: {{ trace.conditionError }}
                    </template>
                    <template v-else-if="trace.selections.some(s => s.choiceCount === 0)">
                      no choices for: {{ trace.selections.filter(s => s.choiceCount === 0).map(s => s.name).join(', ') }}
                    </template>
                    <!-- Don't show "condition failed" - it's noise. Details below will explain if available. -->
                  </span>
                </div>
                <!-- Show condition details if available -->
                <div v-if="trace.conditionDetails && trace.conditionDetails.length > 0" class="condition-details">
                  <div
                    v-for="(detail, idx) in trace.conditionDetails"
                    :key="idx"
                    class="condition-detail"
                    :class="{ passed: detail.passed, failed: !detail.passed }"
                  >
                    <span class="condition-icon">{{ detail.passed ? '✓' : '✗' }}</span>
                    <span class="condition-label">{{ detail.label }}</span>
                    <span class="condition-value">= {{ formatConditionValue(detail.value) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
  </div>
</template>

<style scoped>
.actions-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.actions-count {
  color: var(--bsg-ink-2);
  font-size: 12px;
}
/* Actions Section */
.actions-section {
  border-bottom: 1px solid var(--bsg-line);
  padding-bottom: 16px;
}
.traces-error {
  color: var(--bsg-danger);
  padding: 8px;
  background: color-mix(in srgb, var(--bsg-danger) 10%, transparent);
  border-radius: 6px;
  font-size: 11px;
}
.no-traces {
  color: var(--bsg-ink-3);
  font-style: italic;
  font-size: 11px;
}
.traces-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.trace-group {
  background: var(--bsg-surface-2);
  border-radius: 6px;
  overflow: hidden;
}
.trace-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
}
.trace-group-header.available {
  background: color-mix(in srgb, var(--bsg-ok) 15%, transparent);
  color: var(--bsg-ok);
}
.trace-group-header.unavailable {
  background: color-mix(in srgb, var(--bsg-danger) 15%, transparent);
  color: var(--bsg-danger);
}
.trace-group-header.flow-restricted {
  background: color-mix(in srgb, var(--bsg-warn) 15%, transparent);
  color: var(--bsg-warn);
}
.trace-group-label {
  flex: 1;
}
/* Flow Context Box */
.flow-context-box {
  background: color-mix(in srgb, var(--bsg-accent) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--bsg-accent) 30%, transparent);
  border-radius: 6px;
  margin-bottom: 12px;
  overflow: hidden;
}
.flow-context-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: color-mix(in srgb, var(--bsg-accent) 15%, transparent);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--bsg-accent);
}
.flow-context-icon {
  font-size: 12px;
}
.flow-context-details {
  padding: 8px 12px;
  font-size: 11px;
}
.flow-context-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
}
.flow-context-label {
  color: var(--bsg-ink-2);
  min-width: 100px;
}
.flow-context-value {
  color: var(--bsg-ink);
}
.flow-context-value.flow-allowed-list {
  color: var(--bsg-ok);
  font-family: monospace;
  font-size: 10px;
}
.flow-context-badge {
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
}
.flow-context-badge.my-turn {
  background: color-mix(in srgb, var(--bsg-ok) 20%, transparent);
  color: var(--bsg-ok);
}
.flow-context-badge.not-turn {
  background: color-mix(in srgb, var(--bsg-ink-2) 20%, transparent);
  color: var(--bsg-away);
}
/* Flow-restricted action items */
.trace-item.flow-restricted {
  padding: 6px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--bsg-warn);
}
.trace-item.flow-restricted .trace-name {
  color: var(--bsg-warn);
}
.trace-badge {
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 9px;
  background: color-mix(in srgb, var(--bsg-warn) 20%, transparent);
  color: var(--bsg-warn);
}
.flow-restricted-explanation {
  padding: 8px 12px;
  font-size: 10px;
  color: var(--bsg-away);
  background: var(--bsg-surface-2);
  border-bottom: 1px solid var(--bsg-line);
}
.flow-restricted-explanation code {
  background: var(--bsg-surface-3);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: monospace;
  color: var(--bsg-warn);
}
.trace-empty {
  padding: 8px 12px;
  font-size: 11px;
  color: var(--bsg-ink-3);
  font-style: italic;
}
.trace-copy-btn {
  opacity: 0.6;
  font-size: 9px !important;
  padding: 2px 6px !important;
  text-transform: none;
}
.trace-copy-btn:hover {
  opacity: 1;
}
.trace-icon {
  font-size: 12px;
}
.trace-items {
  padding: 4px 8px;
}
.trace-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  font-size: 11px;
  border-radius: 4px;
}
.trace-item.available .trace-name {
  color: var(--bsg-ok);
}
.trace-item.unavailable .trace-name {
  color: var(--bsg-danger);
}
.trace-selections {
  color: var(--bsg-ink-2);
  font-size: 10px;
}
.trace-reason {
  color: var(--bsg-ink-2);
  font-size: 10px;
  font-style: italic;
}
/* Detailed trace item for unavailable actions */
.trace-item-detailed {
  padding: 8px;
  background: var(--bsg-surface-2);
  border-radius: 6px;
  margin-bottom: 4px;
}
.trace-item-detailed.unavailable {
  border-left: 3px solid var(--bsg-danger);
}
.trace-item-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}
.trace-item-detailed .trace-name {
  color: var(--bsg-danger);
  font-weight: 500;
}
/* Condition details */
.condition-details {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--bsg-line);
}
.condition-detail {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  font-size: 10px;
  font-family: monospace;
}
.condition-detail.passed {
  color: var(--bsg-ok);
}
.condition-detail.failed {
  color: var(--bsg-danger);
}
.condition-icon {
  font-size: 9px;
  width: 12px;
  text-align: center;
}
.condition-label {
  color: var(--bsg-ink-2);
}
.condition-value {
  color: var(--bsg-ink-2);
  font-size: 9px;
}
</style>
